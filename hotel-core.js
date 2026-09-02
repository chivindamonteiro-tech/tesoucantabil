/* ============================================================
   HOTEL-CORE.JS — Módulo independente de Hotelaria (Zoom's Lodge)
   ============================================================
   Ficheiro próprio do departamento de Hotelaria. NÃO mexe nos
   dados da Contabilidade/Tesouraria (core.js) — usa a mesma
   ligação Supabase, mas grava numa linha própria da tabela
   "hotel_data", para nunca entrar em conflito com o
   Tesoucantábil.

   Todos os nomes aqui têm o sufixo "Hotel" para nunca colidirem
   com o core.js, caso um dia os dois fiquem incluídos na mesma
   página (ex.: para poderes lançar receitas na tesouraria).

   Inclui no <head> do hotel.html, por esta ordem:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="hotel-core.js"></script>
   ============================================================ */

const SUPABASE_URL_HOTEL = "https://okwvzccirgxnpugypsgf.supabase.co";
const SUPABASE_ANON_KEY_HOTEL = "sb_publishable_pOtoNEKOi2nZaiZVqn2uhQ_WTwy5ctm";

const supaHotel = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL_HOTEL, SUPABASE_ANON_KEY_HOTEL)
  : null;

/* ---------- utilidades genéricas ---------- */
function uidHotel(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/* ============================================================
   ESQUEMA REAL DO TESOUCANTÁBIL (contabilidade.html)
   ------------------------------------------------------------
   Estas constantes replicam EXATAMENTE os valores usados em
   DB.lancamentos no contabilidade.html, para que os lançamentos
   gerados aqui (Sinal, Folio, Split no Check-out) fiquem 100%
   compatíveis com os relatórios, filtros e categorias do
   Tesoucantábil (nada de "Receita"/"receita" trocado, nem
   "TPA" em vez de "TPA (Multicaixa)").
   ============================================================ */
const UNIDADE_HOTEL = "ZOOM'S LODGE";

const FORMAS_PAGAMENTO_HOTEL = ["Cash","Banco","TPA (Multicaixa)","Multicaixa Express","Transferência Bancária"];

/* Mesmas 7 contas do Plano de Contas do Tesoucantábil (CASH + 6 contas bancárias) */
const CONTAS_HOTEL = [
  {codigo:"CASH", nome:"CAIXA TESOURARIA (Caixa Geral)"},
  {codigo:"BAI-KZ-001", nome:"BAI-KZ-001 (BAI, KZ)"},
  {codigo:"BAI-EUR-001", nome:"BAI-EUR-001 (BAI, EUR)"},
  {codigo:"BAI-USD-002", nome:"BAI-USD-002 (BAI, USD)"},
  {codigo:"BAI-003", nome:"BAI-003 (BAI)"},
  {codigo:"BFA-KZ-002", nome:"BFA-KZ-002 (BFA, KZ)"},
  {codigo:"BFA-001", nome:"BFA-001 (BFA)"}
];

/* Mapeamento de Tipo de Venda do Zoom's Lodge → Categoria (Receitas Operacionais),
   idêntico ao TIPOS_VENDA_ZOOMS_LODGE do contabilidade.html */
const TIPOS_VENDA_ZOOMS_LODGE_HOTEL = {
  "Hospedagem": "Prestação de Serviços de Alojamento",
  "Restauração": "Receitas de Restauração",
  "Bar": "Receitas de Bar e Bebidas",
  "Lavandaria": "Receitas de Lavandaria",
  "Transfer": "Receitas de Transfer",
  "Taxa sobre o Valor": "Taxas e Outros Encargos",
  "Outros Serviços": "Receitas de Outros Serviços"
};

/* Rótulo de exibição — igual ao labelFormaPagamento do contabilidade.html */
function labelFormaPagamentoHotel(f){ return f==='Cash' ? 'Cash (Numerário)' : (f||'—'); }

/* Origem automática = Unidade + CASH/BANCO, exatamente como origemAutomatica()
   no contabilidade.html (usado nos relatórios agrupados por Origem/RESUMO). */
function origemAutomaticaHotel(forma){
  return `${UNIDADE_HOTEL} ${forma==='Cash' ? 'CASH' : 'BANCO'}`;
}

/* Número de referência interno da fatura do hotel (não é a série oficial
   gerarNumeroFatura do Tesoucantábil, que vive só dentro do contabilidade.html —
   mas identifica claramente a origem no campo nFatura do Lançamento). */
function gerarNumeroFaturaHotel(quartoId){
  const ano = new Date().getFullYear();
  return `ZL/${ano}/H-${quartoId}-${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

function toastHotel(msg, tipo='info'){
  let el = document.getElementById('toastBoxHotel');
  if(!el){
    el = document.createElement('div');
    el.id = 'toastBoxHotel';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#14232B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.opacity = '0'; }, 2500);
}

/* ---------- estado dos dados de Hotelaria ---------- */
let DBHotel = {
  // Os tipos de quarto reais (T0, T2, T2-P, T2+1, T2+2, T2+2 VIP, T3) são
  // criados automaticamente pelo seedQuartosDefaultHotel() em hotel.html,
  // a partir da Tabela de Preços das Suites 2026. Não colocar aqui tipos
  // genéricos de exemplo — já causou 4 tipos "fantasma" (Standard/Luxo/
  // Suite/Familiar) sem quartos associados a aparecerem na Tabela de Preços
  // e no formulário de Nova Reserva.
  tiposQuarto: [],
  quartos: [],
  reservas: [],
  bloqueios: [],
  planosTarifarios: [
    {id:'rack', nome:'Rack Rate', desconto:0},
    {id:'corp', nome:'Corporate', desconto:10},
    {id:'promo', nome:'Promocional', desconto:15},
    {id:'pacote', nome:'Pacote', desconto:20}
  ],
  sazonalidade: [
    // {id, dataIni, dataFim, nome, multiplicador (ex: 1.5 para high season)}
  ],
  canais: [
    {id:'direto', nome:'Direto (balcão)', comissao:0},
    {id:'telefone', nome:'Telefone', comissao:0},
    {id:'email', nome:'E-mail', comissao:0},
    {id:'booking', nome:'Booking.com', comissao:15},
    {id:'airbnb', nome:'Airbnb', comissao:15},
    {id:'expedia', nome:'Expedia', comissao:18},
    {id:'agencia', nome:'Agência', comissao:20}
  ],
  cupons: [
    // {id, codigo, desconto%, dataExp, usos_max, usos_atuais}
  ],
  hospedes: [],
  estadias: [],
  folio: [],
  faturas: [],
  reservasCanalExterno: [],
  configCanais: {
    icalImportUrls: []
    // {id, canalId, nome, url}
  },
  fechosCaixaHotel: [],
  // fechosCaixaHotel: [{id, data, linhas:[{formaPagamento,conta,tipoVenda,valor}], total, lancamentoIds, criadoEm}]
  // hospedes: [{id, nome, documento, contacto, email, morada, pais, notas, dataPrimeira, totalEstadias, fidelizacao}]
  // estadias: [{id, hospedeId, checkinReal, checkoutReal, quartoId, taxaRef, notas, faturaRef}]
  // folio: [{id, reservaId, data, tipo:'consumo'|'extra'|'desconto'|'sinal'|'pagamento', descricao, categoria, valor, formaPagamento}]
  //   valor > 0 = a débito do hóspede (consumo/extra); valor negativo/'pagamento'/'sinal' reduz o saldo em aberto
  // faturas: [{id, reservaId, numero, itens:[{descricao,valor}], total, formaPagamento, dataEmissao, lancamentoId}]
  // reservasCanalExterno: [{id, canalId, uid, quartoId, checkinPrevisto, checkoutPrevisto, hospedeNome, origemUrl}]
  comunicacoes: [],
  // comunicacoes: [{id, reservaId, tipo:'confirmacao'|'lembrete_checkin'|'feedback', destinatarioEmail,
  //   assunto, corpo, estado:'pendente'|'enviado'|'sem_email', geradoEm, enviarApartirDe, enviadoEm}]
  limpezasFeitas: [],
  // limpezasFeitas: [{quartoId, data, confirmadoEm}] — confirmação manual de que um quarto foi limpo numa data
  camareiras: [],
  // camareiras: [{id, nome, contacto, ativo}]
  estadosQuartoHotel: [],
  // estadosQuartoHotel: [{id, quartoId, data, estado, camareiraId, notas, minibarOk, minibarNotas, inspecionadoPor, atualizadoEm}]
  //   estado: 'limpeza-pendente' | 'em-limpeza' | 'limpo' | 'inspecao' | 'aprovado' | 'manutencao' | 'fora-servico'
  objetosPerdidos: [],
  // objetosPerdidos: [{id, data, quartoId, descricao, encontradoPor, notas, estado:'guardado'|'devolvido', devolvidoA, devolvidoEm, criadoEm}]
  grupos: []
  // grupos: [{id, nomeEmpresa, nif, contacto, email, responsavel, observacoes, criadoEm}] — ficha
  //   da empresa/entidade de uma Reserva de Grupo (vários quartos reservados em simultâneo).
  //   Cada quarto do grupo continua a ser uma reserva normal em DBHotel.reservas, só que com
  //   o campo reserva.grupoId a apontar para o id aqui — assim toda a lógica já existente de
  //   folio, check-in/out, comunicações e impressão por quarto continua a funcionar sem alterações.
};

let versaoHotel = null;
let semColunaVersaoHotel = false;

/* Carrega os dados de hotel_data (linha id="main"). Se a tabela/linha
   ainda não existir, cria-a com os valores padrão acima. */
async function carregarDadosHotel(){
  if(!supaHotel){ toastHotel('Sem ligação ao Supabase.'); return; }
  try{
    let { data, error } = await supaHotel.from('hotel_data').select('*').eq('id','main').maybeSingle();

    if(error && String(error.message||'').toLowerCase().includes('column')){
      semColunaVersaoHotel = true;
      ({ data, error } = await supaHotel.from('hotel_data').select('id,data').eq('id','main').maybeSingle());
    }
    if(error) throw error;

    if(!data){
      // primeira vez: cria a linha com os valores padrão
      const payload = { id:'main', data: DBHotel };
      if(!semColunaVersaoHotel) payload.versao = 1;
      const { error: errIns } = await supaHotel.from('hotel_data').insert(payload);
      if(errIns) console.warn(errIns);
      versaoHotel = 1;
      return;
    }

    DBHotel = Object.assign({tiposQuarto:[],quartos:[],reservas:[],bloqueios:[],hospedes:[],estadias:[],folio:[],faturas:[],reservasCanalExterno:[],configCanais:{icalImportUrls:[]},fechosCaixaHotel:[],comunicacoes:[],limpezasFeitas:[],grupos:[]}, data.data || {});
    if(!DBHotel.folio) DBHotel.folio = [];
    if(!DBHotel.faturas) DBHotel.faturas = [];
    if(!DBHotel.reservasCanalExterno) DBHotel.reservasCanalExterno = [];
    if(!DBHotel.configCanais) DBHotel.configCanais = {icalImportUrls:[]};
    if(!DBHotel.fechosCaixaHotel) DBHotel.fechosCaixaHotel = [];
    if(!DBHotel.comunicacoes) DBHotel.comunicacoes = [];
    if(!DBHotel.limpezasFeitas) DBHotel.limpezasFeitas = [];
    if(!DBHotel.camareiras) DBHotel.camareiras = [];
    if(!DBHotel.estadosQuartoHotel) DBHotel.estadosQuartoHotel = [];
    if(!DBHotel.objetosPerdidos) DBHotel.objetosPerdidos = [];
    if(!DBHotel.grupos) DBHotel.grupos = [];
    versaoHotel = data.versao || 1;
  }catch(e){
    console.warn('Erro ao carregar dados de hotelaria:', e);
    toastHotel('Não consegui carregar os dados do hotel — a usar valores locais.');
  }
}

/* Grava DBHotel inteiro em hotel_data, com bloqueio otimista (igual
   ao padrão usado no core.js), tentando de novo automaticamente se
   houver conflito de versão. */
async function saveDBHotel(tentativas = 3){
  if(!supaHotel){ toastHotel('Sem ligação ao Supabase — alterações só ficam localmente.'); return {ok:false}; }
  try{
    if(semColunaVersaoHotel){
      const { error } = await supaHotel.from('hotel_data').update({data: DBHotel}).eq('id','main');
      if(error) throw error;
      return {ok:true};
    }

    const versaoEsperada = versaoHotel;
    const novaVersao = versaoEsperada + 1;
    const { data: dataUpd, error: errUpd } = await supaHotel
      .from('hotel_data')
      .update({data: DBHotel, versao: novaVersao, updated_at: new Date().toISOString()})
      .eq('id','main').eq('versao', versaoEsperada)
      .select();

    if(errUpd){
      console.warn(errUpd);
      toastHotel('Não foi possível guardar. Tenta novamente.');
      return {ok:false};
    }
    if(dataUpd && dataUpd.length){
      versaoHotel = novaVersao;
      return {ok:true};
    }

    // conflito: outra pessoa gravou entretanto — recarrega e tenta de novo
    if(tentativas > 0){
      const dbLocal = DBHotel;
      await carregarDadosHotel();
      DBHotel = dbLocal; // mantém as alterações locais por cima dos dados recarregados
      return await saveDBHotel(tentativas - 1);
    }
    toastHotel('Conflito ao guardar — tenta novamente.');
    return {ok:false};
  }catch(e){
    console.warn('Erro ao gravar dados de hotelaria:', e);
    toastHotel('Erro ao guardar os dados do hotel.');
    return {ok:false};
  }
}

/* ---------- lógica de disponibilidade e bloqueios ---------- */
function quartoOcupadoHotel(quartoId, checkin, checkout){
  // Verifica reservas confirmadas/provisórias
  const temReserva = DBHotel.reservas.some(r =>
    r.quartoId === quartoId &&
    r.estado !== 'cancelada' &&
    !(checkout <= r.checkinPrevisto || checkin >= r.checkoutPrevisto)
  );
  
  // Verifica bloqueios (manutenção, limpeza, VIP)
  const temBloqueio = DBHotel.bloqueios.some(b =>
    b.quartoId === quartoId &&
    !(checkout <= b.dataIni || checkin >= b.dataFim)
  );
  
  return temReserva || temBloqueio;
}

function getQuartosDisponivelHotel(tipoId, checkin, checkout){
  return DBHotel.quartos.filter(q => 
    q.tipoId === tipoId && !quartoOcupadoHotel(q.id, checkin, checkout)
  );
}

function getOcupacaoHotel(data){
  // Retorna {quartoId: {estado, reservaId}} para uma data específica
  const ocupacao = {};
  
  DBHotel.quartos.forEach(q => {
    ocupacao[q.id] = {estado: 'livre', id: null};
  });
  
  DBHotel.bloqueios.forEach(b => {
    if(data >= b.dataIni && data < b.dataFim){
      ocupacao[b.quartoId] = {estado: 'bloqueado', id: b.id};
    }
  });
  
  DBHotel.reservas.forEach(r => {
    // Reservas canceladas ou já com check-out feito não devem ocupar o mapa
    if(r.estado === 'cancelada' || r.estado === 'checkout') return;

    // Se já houve check-out (mesmo antecipado), usa essa data real como limite;
    // caso contrário, usa a data de check-out prevista.
    const fimEfetivo = r.checkoutReal || r.checkoutPrevisto;

    if(data >= r.checkinPrevisto && data < fimEfetivo){
      ocupacao[r.quartoId] = {estado: r.estado, id: r.id};
    }
  });
  
  return ocupacao;
}

/* ---------- Lembretes Operacionais do Dia (Check-in / Check-out) ----------
   Sistema estático (sem cron/servidor): recalculado sempre que a app é
   aberta/renderizada, com base na data de hoje.
   - checkinsHoje: reservas cujo check-in está previsto para hoje — já
     entram automaticamente no Relatório da Cozinha (não é preciso mais
     nenhuma ação para isso; serve só de aviso/confirmação visual).
   - checkoutsPendentesHoje: reservas cujo check-out está previsto para
     hoje e que ainda não foram confirmadas no sistema (estado ainda não
     é 'checkout') — lembrete para a receção ir confirmar a saída. */
/* ---------- Confirmação Manual de Limpeza ----------
   Não há, por natureza, um sinal automático de "quarto limpo" (ao
   contrário do check-out, que já é uma ação registada no sistema) —
   por isso a equipa de limpeza/receção confirma manualmente, quarto a
   quarto, através do lembrete no ecrã. */
function limpezaConfirmadaHotel(quartoId, data){
  return (DBHotel.limpezasFeitas||[]).some(l => l.quartoId === quartoId && l.data === data);
}

function confirmarLimpezaHotel(quartoId, data){
  DBHotel.limpezasFeitas = DBHotel.limpezasFeitas || [];
  if(!limpezaConfirmadaHotel(quartoId, data)){
    DBHotel.limpezasFeitas.push({quartoId, data, confirmadoEm: new Date().toISOString()});
    saveDBHotel();
  }
}

/* ============================================================
   HOUSEKEEPING — Estado dos quartos, tarefas, camareiras,
   minibar e objetos perdidos e achados.
   ------------------------------------------------------------
   Camada de estado por quarto/dia, à parte da confirmação binária
   de limpezasFeitas (que continua a alimentar os lembretes do
   dia): permite seguir o quarto por várias etapas (Limpeza
   Pendente → Em Limpeza → Limpo → Inspeção → Aprovado), além de
   Manutenção/Fora de Serviço. Ao chegar a 'limpo' ou 'aprovado',
   sincroniza automaticamente com confirmarLimpezaHotel(), para
   não duplicar a lógica dos lembretes operacionais.
   ============================================================ */
function getEstadoQuartoHotel(quartoId, data){
  const registos = (DBHotel.estadosQuartoHotel||[]).filter(e => e.quartoId === quartoId && e.data === data);
  return registos.length ? registos[registos.length - 1] : null;
}

function definirEstadoQuartoHotel(quartoId, data, estado, opcoes={}){
  DBHotel.estadosQuartoHotel = DBHotel.estadosQuartoHotel || [];
  let registo = getEstadoQuartoHotel(quartoId, data);
  if(registo){
    registo.estado = estado;
    if(opcoes.camareiraId !== undefined) registo.camareiraId = opcoes.camareiraId;
    if(opcoes.notas !== undefined) registo.notas = opcoes.notas;
    if(opcoes.minibarOk !== undefined) registo.minibarOk = opcoes.minibarOk;
    if(opcoes.minibarNotas !== undefined) registo.minibarNotas = opcoes.minibarNotas;
    if(opcoes.inspecionadoPor !== undefined) registo.inspecionadoPor = opcoes.inspecionadoPor;
    registo.atualizadoEm = new Date().toISOString();
  } else {
    registo = {
      id: uidHotel(), quartoId, data, estado,
      camareiraId: opcoes.camareiraId || '',
      notas: opcoes.notas || '',
      minibarOk: opcoes.minibarOk !== undefined ? opcoes.minibarOk : null,
      minibarNotas: opcoes.minibarNotas || '',
      inspecionadoPor: opcoes.inspecionadoPor || '',
      atualizadoEm: new Date().toISOString()
    };
    DBHotel.estadosQuartoHotel.push(registo);
  }
  if(estado === 'limpo' || estado === 'aprovado'){
    confirmarLimpezaHotel(quartoId, data);
  }
  saveDBHotel();
  return registo;
}

/* Estado "em tempo real" de um quarto numa data: usa o registo explícito
   de Housekeeping se existir; caso contrário, deduz de bloqueios de
   manutenção ativos ou de limpeza pendente (checkin/checkout do dia
   ainda não confirmado); por defeito, considera-se limpo. */
function estadoTempoRealQuartoHotel(quartoId, data){
  const registo = getEstadoQuartoHotel(quartoId, data);
  if(registo) return registo.estado;
  const bloqueioAtivo = (DBHotel.bloqueios||[]).find(b => b.quartoId === quartoId && data >= b.dataIni && data < b.dataFim);
  if(bloqueioAtivo && bloqueioAtivo.tipo === 'manutencao') return 'manutencao';
  const pendente = DBHotel.reservas.some(r =>
    r.estado !== 'cancelada' &&
    (r.checkinPrevisto === data || r.checkoutPrevisto === data) &&
    !limpezaConfirmadaHotel(quartoId, data)
  );
  return pendente ? 'limpeza-pendente' : 'limpo';
}

/* Lista diária de limpeza: quartos com checkin/checkout hoje, quartos
   atualmente ocupados (limpeza de rotina) e quartos já com um estado
   registado nesta data (para não desaparecerem da lista depois de
   alguém começar a trabalhar neles). */
function listaLimpezaDiariaHotel(data){
  const relevantes = new Map();
  DBHotel.reservas.forEach(r => {
    if(r.estado === 'cancelada') return;
    if(r.checkinPrevisto === data || r.checkoutPrevisto === data){
      relevantes.set(r.quartoId, true);
    } else if((r.checkinReal||r.checkinPrevisto) <= data && r.checkoutPrevisto > data && r.estado !== 'checkout'){
      relevantes.set(r.quartoId, true);
    }
  });
  (DBHotel.estadosQuartoHotel||[]).filter(e => e.data === data).forEach(e => relevantes.set(e.quartoId, true));

  return Array.from(relevantes.keys()).map(quartoId => {
    const quarto = DBHotel.quartos.find(q => q.id === quartoId);
    const registo = getEstadoQuartoHotel(quartoId, data);
    const camareira = registo && registo.camareiraId ? (DBHotel.camareiras||[]).find(c => c.id === registo.camareiraId) : null;
    return {
      quartoId,
      numero: quarto ? quarto.numero : quartoId,
      estado: registo ? registo.estado : 'limpeza-pendente',
      camareiraId: registo ? registo.camareiraId : '',
      camareiraNome: camareira ? camareira.nome : '',
      notas: registo ? registo.notas : '',
      minibarOk: registo ? registo.minibarOk : null
    };
  }).sort((a,b) => String(a.numero).localeCompare(String(b.numero), undefined, {numeric:true}));
}

/* ---------- Camareiras ---------- */
function adicionarCamareiraHotel(nome, contacto=''){
  DBHotel.camareiras = DBHotel.camareiras || [];
  const c = {id: uidHotel(), nome, contacto, ativo: true};
  DBHotel.camareiras.push(c);
  saveDBHotel();
  return c;
}

function toggleCamareiraAtivaHotel(id){
  const c = (DBHotel.camareiras||[]).find(x => x.id === id);
  if(c){ c.ativo = !c.ativo; saveDBHotel(); }
}

function removerCamareiraHotel(id){
  DBHotel.camareiras = (DBHotel.camareiras||[]).filter(c => c.id !== id);
  saveDBHotel();
}

/* ---------- Objetos Perdidos e Achados ---------- */
function registarObjetoPerdidoHotel({data, quartoId, descricao, encontradoPor='', notas=''}){
  DBHotel.objetosPerdidos = DBHotel.objetosPerdidos || [];
  const item = {
    id: uidHotel(),
    data: data || new Date().toISOString().slice(0,10),
    quartoId: quartoId || '',
    descricao, encontradoPor, notas,
    estado: 'guardado', devolvidoA: '', devolvidoEm: '',
    criadoEm: new Date().toISOString()
  };
  DBHotel.objetosPerdidos.push(item);
  saveDBHotel();
  return item;
}

function marcarObjetoDevolvidoHotel(id, devolvidoA){
  const item = (DBHotel.objetosPerdidos||[]).find(o => o.id === id);
  if(!item) return;
  item.estado = 'devolvido';
  item.devolvidoA = devolvidoA;
  item.devolvidoEm = new Date().toISOString();
  saveDBHotel();
}

function getLembretesOperacionaisHotel(){
  const hoje = new Date().toISOString().split('T')[0];

  const checkinsHoje = DBHotel.reservas.filter(r =>
    r.estado !== 'cancelada' && r.checkinPrevisto === hoje
  );

  const checkoutsPendentesHoje = DBHotel.reservas.filter(r =>
    r.estado !== 'cancelada' && r.estado !== 'checkout' && r.checkoutPrevisto === hoje
  );

  // Quartos a limpar hoje: os que fazem check-out hoje (saída, mesmo já
  // confirmada) e os que fazem check-in hoje (limpeza prévia à chegada),
  // excluindo os já confirmados como limpos nesta data.
  const quartosParaLimpar = new Map();
  DBHotel.reservas.forEach(r => {
    if(r.estado === 'cancelada') return;
    if((r.checkoutPrevisto === hoje || r.checkinPrevisto === hoje) && !limpezaConfirmadaHotel(r.quartoId, hoje)){
      const quarto = DBHotel.quartos.find(q => q.id === r.quartoId);
      quartosParaLimpar.set(r.quartoId, quarto ? quarto.numero : r.quartoId);
    }
  });
  const limpezaPendenteHoje = Array.from(quartosParaLimpar, ([quartoId, numero]) => ({quartoId, numero}));

  return {hoje, checkinsHoje, checkoutsPendentesHoje, limpezaPendenteHoje};
}

function calcularNoitesHotel(dataIni, dataFim){
  const cin = new Date(dataIni);
  const cout = new Date(dataFim);
  return Math.round((cout - cin) / 86400000);
}

/* ---------- Tarifação Dinâmica ---------- */
function getMultiplicadorSazonalidade(data){
  // Retorna multiplicador de preço para uma data
  const d = new Date(data);
  const encontrado = DBHotel.sazonalidade.find(s => {
    const ini = new Date(s.dataIni);
    const fim = new Date(s.dataFim);
    return d >= ini && d <= fim;
  });
  return encontrado ? encontrado.multiplicador : 1.0;
}

function calcularTarifaNoiteHotel(tipoId, data, planoId, canalId){
  // Calcula tarifa de 1 noite com sazonalidade, plano e canal
  const tipo = DBHotel.tiposQuarto.find(t => t.id === tipoId);
  if(!tipo) return 0;
  
  const plano = DBHotel.planosTarifarios.find(p => p.id === planoId) || DBHotel.planosTarifarios[0];
  const sazonalidade = getMultiplicadorSazonalidade(data);
  
  // Preço base com sazonalidade
  let preco = tipo.precoBase * sazonalidade;
  
  // Aplicar desconto do plano tarifário
  preco = preco * (1 - plano.desconto / 100);
  
  return Math.round(preco);
}

function calcularTotalReservaHotel(tipoId, dataIni, dataFim, planoId, canalId, descontoAdicional=0, cupomId=null, contarUsoCupom=true){
  // Calcula total com todas as variáveis
  const noites = calcularNoitesHotel(dataIni, dataFim);
  let total = 0;
  
  // Somar tarifa de cada noite (sazonalidade pode variar por dia)
  let d = new Date(dataIni);
  for(let i = 0; i < noites; i++){
    const dataStr = d.toISOString().split('T')[0];
    total += calcularTarifaNoiteHotel(tipoId, dataStr, planoId, canalId);
    d.setDate(d.getDate() + 1);
  }
  
  // Aplicar desconto adicional (percentual)
  if(descontoAdicional > 0){
    total = total * (1 - descontoAdicional / 100);
  }
  
  // Aplicar cupom se fornecido. contarUsoCupom=false serve para recalcular
  // o total de uma reserva já existente (ex.: ao editá-la) sem consumir
  // outra vez o cupão — o uso já foi contado na criação da reserva.
  if(cupomId){
    const cupom = DBHotel.cupons.find(c => c.id === cupomId);
    if(cupom && (!contarUsoCupom || cupom.usos_atuais < cupom.usos_max)){
      const descCupom = (total * cupom.desconto) / 100;
      total -= descCupom;
      if(contarUsoCupom) cupom.usos_atuais = (cupom.usos_atuais || 0) + 1;
    }
  }
  
  return Math.round(total);
}

function validarCupomHotel(codigo){
  // Valida e retorna cupom se válido
  const cupom = DBHotel.cupons.find(c => c.codigo === codigo);
  if(!cupom) return {ok:false, msg:'Cupom não encontrado'};
  
  const agora = new Date();
  const expiracao = new Date(cupom.dataExp);
  if(agora > expiracao) return {ok:false, msg:'Cupom expirado'};
  
  if(cupom.usos_atuais >= cupom.usos_max) return {ok:false, msg:'Cupom sem utilizações restantes'};
  
  return {ok:true, cupom};
}

/* ---------- Gestão de Hóspedes e Ficha ---------- */
function obterOuCriarHospede(nome, documento, contacto, email='', genero=''){
  // Se existe hóspede com este documento, retorna-o
  let hospede = DBHotel.hospedes.find(h => h.documento === documento);
  if(hospede){
    // Preenche o género se ainda não estava definido (não sobrepõe um já registado).
    if(genero && !hospede.genero) hospede.genero = genero;
    return hospede;
  }
  
  // Criar novo hóspede
  hospede = {
    id: uidHotel(),
    nome: nome,
    documento: documento,
    contacto: contacto,
    email: email,
    genero: genero || '',
    morada: '',
    pais: '',
    notas: '',
    preferencias: [],
    dataPrimeira: new Date().toISOString().split('T')[0],
    totalEstadias: 0,
    diasTotais: 0,
    fidelizacao: 'bronze', // bronze, prata, ouro, platina
    descricaoGuest: '',
    vip: false,
    notasVip: ''
  };
  
  DBHotel.hospedes.push(hospede);
  return hospede;
}

function registarEstadiaHotel(reservaId, checkinReal, checkoutReal, quartoId, notas=''){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva) return;
  
  const noites = calcularNoitesHotel(checkinReal, checkoutReal);
  
  const estadia = {
    id: uidHotel(),
    reservaId: reservaId,
    hospedeId: null, // será preenchido se houver
    checkinReal: checkinReal,
    checkoutReal: checkoutReal,
    quartoId: quartoId,
    noites: noites,
    totalPago: 0,
    notas: notas,
    avaliacao: 0,
    dataCriacao: new Date().toISOString().split('T')[0]
  };
  
  DBHotel.estadias.push(estadia);
  
  // Atualizar fidelização do hóspede
  if(reserva.hospedeId){
    const hospede = DBHotel.hospedes.find(h => h.id === reserva.hospedeId);
    if(hospede){
      hospede.totalEstadias = (hospede.totalEstadias || 0) + 1;
      hospede.diasTotais = (hospede.diasTotais || 0) + noites;
      
      // Atualizar nível fidelização
      if(hospede.totalEstadias >= 10) hospede.fidelizacao = 'platina';
      else if(hospede.totalEstadias >= 5) hospede.fidelizacao = 'ouro';
      else if(hospede.totalEstadias >= 2) hospede.fidelizacao = 'prata';
      else hospede.fidelizacao = 'bronze';
    }
  }
  
  return estadia;
}

/* ============================================================
   GESTÃO DE HÓSPEDES VIP
   ------------------------------------------------------------
   Marcação manual de VIP (independente da fidelização automática
   por nº de estadias), com notas próprias (ex.: preferências
   especiais, alergias, protocolo de receção).
   ============================================================ */
function alternarVipHospede(hospedeId, notasVip){
  const hospede = DBHotel.hospedes.find(h => h.id === hospedeId);
  if(!hospede) return null;
  hospede.vip = !hospede.vip;
  if(notasVip !== undefined) hospede.notasVip = notasVip;
  saveDBHotel();
  return hospede;
}

function listaHospedesVipHotel(){
  return DBHotel.hospedes.filter(h => h.vip || h.fidelizacao === 'platina');
}

/* ============================================================
   MAPA VISUAL DE QUARTOS
   ------------------------------------------------------------
   Estado único "em tempo real" de cada quarto numa data, combinando
   Reservas (ocupado/reservado), Bloqueios (manutenção) e
   Housekeeping (limpeza-pendente/em-limpeza/limpo/inspeção/
   fora-serviço) — para o mapa visual da Receção.
   ============================================================ */
function getStatusMapaQuartoHotel(quartoId, data){
  const ocupacao = getOcupacaoHotel(data);
  const ocup = ocupacao[quartoId] || {estado:'livre', id:null};

  if(ocup.estado === 'checkin'){
    return {status:'ocupado', label:'Ocupado', reservaId: ocup.id};
  }
  if(['confirmada','garantida','provisoria'].includes(ocup.estado)){
    return {status:'reservado', label:'Reservado', reservaId: ocup.id};
  }
  if(ocup.estado === 'bloqueado'){
    const bloqueio = DBHotel.bloqueios.find(b => b.id === ocup.id);
    if(bloqueio && bloqueio.tipo === 'manutencao'){
      return {status:'manutencao', label:'Manutenção', bloqueioId: ocup.id, subtipo: bloqueio.subtipo||''};
    }
    return {status:'reservado', label:'Reservado (Bloqueio)', bloqueioId: ocup.id};
  }

  // Sem reserva/bloqueio ativos hoje: o estado depende do Housekeeping
  const hk = estadoTempoRealQuartoHotel(quartoId, data);
  const mapaLabel = {
    'limpeza-pendente':'Limpeza Pendente', 'em-limpeza':'Em Limpeza',
    'inspecao':'Inspeção', 'manutencao':'Manutenção', 'fora-servico':'Fora de Serviço',
    'limpo':'Limpo', 'aprovado':'Livre'
  };
  if(hk === 'aprovado' || !hk) return {status:'livre', label:'Livre'};
  return {status: hk, label: mapaLabel[hk] || 'Livre'};
}

function mapaQuartosHotel(data){
  return DBHotel.quartos.slice()
    .sort((a,b) => String(a.numero).localeCompare(String(b.numero), undefined, {numeric:true}))
    .map(q => {
      const tipo = DBHotel.tiposQuarto.find(t => t.id === q.tipoId);
      return {quarto:q, tipo, ...getStatusMapaQuartoHotel(q.id, data)};
    });
}

/* Quartos livres neste preciso momento (para Walk-in) — usa "hoje" como
   check-in e "amanhã" como check-out mínimo, para reaproveitar a mesma
   verificação de conflitos das reservas normais (quartoOcupadoHotel). */
function quartosLivresAgoraHotel(){
  const hoje = new Date().toISOString().split('T')[0];
  return DBHotel.quartos.filter(q => {
    const st = getStatusMapaQuartoHotel(q.id, hoje).status;
    return st === 'livre' || st === 'limpo';
  });
}

/* ============================================================
   TROCA DE QUARTO
   ------------------------------------------------------------
   Move uma reserva atualmente em check-in para outro quarto
   disponível, mantendo o histórico da troca na própria reserva.
   ============================================================ */
function trocarQuartoReservaHotel(reservaId, novoQuartoId, motivo=''){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva) return {ok:false, erro:'Reserva não encontrada.'};
  const novoQuarto = DBHotel.quartos.find(q => q.id === novoQuartoId);
  if(!novoQuarto) return {ok:false, erro:'Quarto de destino não encontrado.'};
  if(novoQuartoId === reserva.quartoId) return {ok:false, erro:'O quarto escolhido é o mesmo que o atual.'};

  const quartoAntigo = DBHotel.quartos.find(q => q.id === reserva.quartoId);
  reserva.historicoTrocas = reserva.historicoTrocas || [];
  reserva.historicoTrocas.push({
    data: new Date().toISOString(),
    quartoAntigoId: reserva.quartoId,
    quartoAntigoNumero: quartoAntigo ? quartoAntigo.numero : reserva.quartoId,
    quartoNovoId: novoQuartoId,
    quartoNovoNumero: novoQuarto.numero,
    motivo
  });
  reserva.quartoId = novoQuartoId;

  saveDBHotel();
  return {ok:true, reserva, quartoAntigo, novoQuarto};
}

/* ============================================================
   EXTENSÃO DE ESTADIA
   ------------------------------------------------------------
   Prolonga o check-out previsto de uma reserva já em check-in,
   verificando que o mesmo quarto continua livre nas noites extra
   e lançando o valor das noites adicionais no Folio (mesma tarifa
   base da reserva original).
   ============================================================ */
function estenderEstadiaHotel(reservaId, novoCheckoutPrevisto){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva) return {ok:false, erro:'Reserva não encontrada.'};
  if(novoCheckoutPrevisto <= reserva.checkoutPrevisto) return {ok:false, erro:'A nova data de check-out tem de ser depois da atual.'};

  // Verificar se o quarto está livre nas noites extra (excluindo a própria reserva)
  const temConflito = DBHotel.reservas.some(r =>
    r.id !== reservaId && r.quartoId === reserva.quartoId && r.estado !== 'cancelada' &&
    !(novoCheckoutPrevisto <= r.checkinPrevisto || reserva.checkoutPrevisto >= r.checkoutPrevisto)
  ) || DBHotel.bloqueios.some(b =>
    b.quartoId === reserva.quartoId &&
    !(novoCheckoutPrevisto <= b.dataIni || reserva.checkoutPrevisto >= b.dataFim)
  );
  if(temConflito) return {ok:false, erro:'O quarto já tem reserva/bloqueio nas noites extra pedidas.'};

  const noitesExtra = calcularNoitesHotel(reserva.checkoutPrevisto, novoCheckoutPrevisto);
  const valorExtra = noitesExtra * (reserva.precoNoite || 0);

  reserva.checkoutPrevisto = novoCheckoutPrevisto;
  reserva.numNoites = (reserva.numNoites || 0) + noitesExtra;

  if(valorExtra > 0){
    adicionarFolioHotel(reservaId, {
      tipo:'extra', descricao:`Extensão de estadia (+${noitesExtra} noite${noitesExtra>1?'s':''})`,
      tipoVenda:'Hospedagem', valor: valorExtra
    });
  }

  saveDBHotel();
  return {ok:true, reserva, noitesExtra, valorExtra};
}

/* ============================================================
   DEPÓSITO / CAUÇÃO
   ------------------------------------------------------------
   Fluxo próprio, separado do Sinal de reserva: fica retido à parte
   no Folio (tipo 'caucao'), sem entrar no saldo em aberto do
   check-out (calcularSaldoFolioHotel só soma sinal/pagamento/
   desconto), e é devolvido (total ou parcialmente) no check-out
   ou antes dele.
   ============================================================ */
function registarCaucaoHotel(reservaId, valor, formaPagamento='Cash', conta='CASH', obs=''){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva) return {ok:false, erro:'Reserva não encontrada.'};
  reserva.caucaoValor = (reserva.caucaoValor || 0) + Number(valor);
  reserva.caucaoFormaPagamento = formaPagamento;
  reserva.caucaoConta = conta;
  reserva.caucaoEstado = 'retida';
  reserva.caucaoObs = obs;
  adicionarFolioHotel(reservaId, {tipo:'caucao', descricao:`Depósito/Caução${obs?' — '+obs:''}`, tipoVenda:'Caução', valor: Number(valor), formaPagamento});
  saveDBHotel();
  return {ok:true, reserva};
}

function devolverCaucaoHotel(reservaId, valorDevolvido, obs=''){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva || !reserva.caucaoValor) return {ok:false, erro:'Não há caução registada nesta reserva.'};
  reserva.caucaoValorDevolvido = (reserva.caucaoValorDevolvido || 0) + Number(valorDevolvido);
  reserva.caucaoEstado = reserva.caucaoValorDevolvido >= reserva.caucaoValor ? 'devolvida' : 'retida-parcial';
  reserva.caucaoObsDevolucao = obs;
  const retido = reserva.caucaoValor - reserva.caucaoValorDevolvido;
  adicionarFolioHotel(reservaId, {tipo:'caucao-devolucao', descricao:`Devolução de Caução${obs?' — '+obs:''}${retido>0?` (retido ${retido} Kz)`:''}`, tipoVenda:'Caução', valor: -Number(valorDevolvido)});
  saveDBHotel();
  return {ok:true, reserva};
}

/* ============================================================
   WALK-IN
   ------------------------------------------------------------
   Reserva criada e já com check-in feito na hora, para hóspede sem
   reserva prévia. Reaproveita obterOuCriarHospede/calcularTotal
   ReservaHotel, mas fixa checkin/checkout reais a hoje e exige que
   o quarto escolhido esteja livre neste momento.
   ============================================================ */
function criarWalkInHotel(dados){
  const hoje = new Date().toISOString().split('T')[0];
  const quarto = DBHotel.quartos.find(q => q.id === dados.quartoId);
  if(!quarto) return {ok:false, erro:'Selecione um quarto.'};
  if(quartoOcupadoHotel(quarto.id, hoje, dados.checkoutPrevisto)) return {ok:false, erro:'Esse quarto já não está livre para o período indicado.'};

  const tipo = DBHotel.tiposQuarto.find(t => t.id === quarto.tipoId);
  const noites = calcularNoitesHotel(hoje, dados.checkoutPrevisto);
  if(noites <= 0) return {ok:false, erro:'Check-out deve ser depois de hoje.'};

  const hospede = obterOuCriarHospede(dados.hospedeNome, dados.hospedeDoc, dados.hospedeContacto, dados.hospedeEmail||'', dados.hospedeGenero||'');
  const totalReserva = calcularTotalReservaHotel(quarto.tipoId, hoje, dados.checkoutPrevisto, 'rack', 'direto', 0, null);

  const reserva = {
    id: uidHotel(),
    hospedeId: hospede.id,
    hospedeNome: dados.hospedeNome, hospedeDoc: dados.hospedeDoc||'', hospedeContacto: dados.hospedeContacto||'',
    hospedeGenero: dados.hospedeGenero || '',
    preferencias: dados.preferencias || '',
    numHospedes: Number(dados.numHospedes) || 1,
    quartoId: quarto.id, tipoId: quarto.tipoId,
    checkinPrevisto: hoje, checkoutPrevisto: dados.checkoutPrevisto,
    checkinReal: hoje, checkoutReal: null,
    estado: 'checkin',
    planoId: 'rack', canalId: 'direto',
    precoNoite: tipo.precoBase, numNoites: noites,
    totalReserva,
    descontoAd: 0, cupomId: null,
    sinal: Number(dados.sinal)||0,
    formaPagamentoSinal: dados.formaPagamentoSinal || 'Cash',
    contaSinal: dados.contaSinal || (dados.formaPagamentoSinal === 'Cash' ? 'CASH' : 'BAI-KZ-001'),
    sinalLancado: false, sinalLancadoValor: 0,
    observacoes: `[WALK-IN] ${dados.observacoes||''}`.trim(),
    walkIn: true,
    criadoEm: new Date().toISOString()
  };
  DBHotel.reservas.push(reserva);

  if(reserva.sinal > 0){
    adicionarFolioHotel(reserva.id, {tipo:'sinal', descricao:'Pagamento no Walk-in', valor: reserva.sinal, formaPagamento: reserva.formaPagamentoSinal});
  }

  saveDBHotel();
  return {ok:true, reserva, quarto};
}

/* ============================================================
   RESERVAS DE GRUPO (EMPRESAS) — várias reservas de quarto em
   simultâneo, ligadas por um grupoId comum a uma única ficha de
   empresa/responsável. Cada quarto continua a ser uma reserva
   normal em DBHotel.reservas (com reserva.grupoId a apontar para
   cá) — assim toda a lógica já existente de Folio, check-in/out,
   Comunicações e impressão por quarto funciona sem alterações;
   esta secção só junta o que é comum aos quartos do mesmo grupo.
   ============================================================ */
function criarGrupoReservaHotel({nomeEmpresa, nif='', contacto='', email='', responsavel='', observacoes=''}){
  const grupo = {
    id: uidHotel(),
    nomeEmpresa, nif, contacto, email, responsavel, observacoes,
    criadoEm: new Date().toISOString()
  };
  DBHotel.grupos.push(grupo);
  return grupo;
}

function getReservasDoGrupoHotel(grupoId){
  return DBHotel.reservas.filter(r => r.grupoId === grupoId);
}

/* Agrega os valores de todos os quartos ativos (não cancelados) de um
   grupo — total contratado, total já pago/abatido (via Folio de cada
   quarto) e saldo em aberto — reaproveitando as mesmas funções do
   Folio individual, quarto a quarto. */
function calcularTotaisGrupoHotel(grupoId){
  const reservas = getReservasDoGrupoHotel(grupoId).filter(r => r.estado !== 'cancelada');
  return reservas.reduce((acc, r) => {
    acc.totalReserva += Number(r.totalReserva) || 0;
    acc.totalPago += totalPagoFolioHotel(r.id);
    acc.saldo += calcularSaldoFolioHotel(r.id);
    return acc;
  }, {totalReserva:0, totalPago:0, saldo:0, numQuartos: reservas.length});
}

/* Cancela todas as reservas do grupo que ainda não fizeram check-out
   (as que já saíram, ou já estavam canceladas, ficam como estavam). */
function cancelarGrupoHotel(grupoId){
  const reservas = getReservasDoGrupoHotel(grupoId);
  reservas.forEach(r => {
    if(r.estado !== 'checkout' && r.estado !== 'cancelada') r.estado = 'cancelada';
  });
  return reservas.length;
}

/* ============================================================
   COMUNICAÇÃO AUTOMÁTICA COM O HÓSPEDE
   ============================================================
   Este é um sistema estático (frontend + Supabase como base de dados),
   sem servidor de e-mail próprio — por isso "automático" aqui significa:
   o sistema deteta sozinho QUANDO cada mensagem deve existir (reserva
   criada, check-in a aproximar-se, estadia terminada) e prepara o
   assunto/corpo prontos a enviar, numa fila (DBHotel.comunicacoes).
   O envio em si é feito com um clique em "✉️ Enviar" — abre o cliente
   de e-mail do utilizador (mailto:) já preenchido — ou pode ser copiado
   para outro sistema de envio. Não há disparo automático sem alguém
   abrir a app (não existe cron/servidor), por isso a Fila de Comunicações
   deve ser consultada regularmente (ex.: ao abrir o dia). */
const CONFIG_COMUNICACOES_HOTEL = {
  diasAntesLembreteCheckin: 2,   // quantos dias antes do check-in previsto o lembrete fica pronto a enviar
  diasDepoisFeedback: 1          // quantos dias depois do check-out o pedido de feedback fica pronto a enviar
};

function hospedeDaReservaHotel(reserva){
  return reserva.hospedeId ? DBHotel.hospedes.find(h => h.id === reserva.hospedeId) : null;
}

/* Gera o assunto/corpo de cada tipo de comunicação. Mantido simples e
   em texto corrido (sem HTML) para funcionar bem tanto em mailto: como
   colado à mão num sistema de e-mail/WhatsApp. */
function templateComunicacaoHotel(tipo, reserva){
  const tipoQuarto = DBHotel.tiposQuarto.find(t => t.id === reserva.tipoId);
  const quarto = DBHotel.quartos.find(q => q.id === reserva.quartoId);
  const nomeQuarto = quarto ? `Quarto ${quarto.numero}${tipoQuarto ? ' — ' + tipoQuarto.nome : ''}` : (tipoQuarto ? tipoQuarto.nome : 'a atribuir');
  const nome = reserva.hospedeNome || 'Hóspede';

  if(tipo === 'confirmacao'){
    return {
      assunto: `Confirmação da sua reserva — Zoom's Lodge`,
      corpo: `Olá ${nome},\n\n`
        + `A sua reserva no Zoom's Lodge está confirmada. Seguem os detalhes:\n\n`
        + `Check-in: ${reserva.checkinPrevisto}\n`
        + `Check-out: ${reserva.checkoutPrevisto}\n`
        + `Quarto: ${nomeQuarto}\n`
        + `Nº de hóspedes: ${reserva.numHospedes || 1}\n`
        + `Total da reserva: ${reserva.totalReserva || 0} Kz\n`
        + `Sinal pago: ${reserva.sinal || 0} Kz\n\n`
        + `Se precisar de alterar ou cancelar a reserva, contacte-nos com a maior antecedência possível.\n\n`
        + `Esperamos por si!\nEquipa Zoom's Lodge`
    };
  }
  if(tipo === 'lembrete_checkin'){
    return {
      assunto: `Lembrete: o seu check-in aproxima-se — Zoom's Lodge`,
      corpo: `Olá ${nome},\n\n`
        + `Faltam poucos dias para a sua estadia no Zoom's Lodge!\n\n`
        + `Check-in previsto: ${reserva.checkinPrevisto}\n`
        + `Check-out previsto: ${reserva.checkoutPrevisto}\n`
        + `Quarto: ${nomeQuarto}\n\n`
        + `Traga um documento de identificação válido para o check-in. Se tiver alguma preferência ou pedido especial, responda a este e-mail.\n\n`
        + `Até já!\nEquipa Zoom's Lodge`
    };
  }
  if(tipo === 'feedback'){
    return {
      assunto: `Como foi a sua estadia? — Zoom's Lodge`,
      corpo: `Olá ${nome},\n\n`
        + `Esperamos que tenha gostado da sua estadia connosco entre ${reserva.checkinPrevisto} e ${reserva.checkoutPrevisto}.\n\n`
        + `A sua opinião é muito importante para continuarmos a melhorar — responda a este e-mail com o seu feedback, ou deixe uma avaliação online.\n\n`
        + `Obrigado por escolher o Zoom's Lodge. Esperamos recebê-lo novamente em breve!\n\n`
        + `Equipa Zoom's Lodge`
    };
  }
  return {assunto:'', corpo:''};
}

/* Cria (se ainda não existir) uma comunicação pendente na fila para
   uma reserva+tipo. Evita duplicados — cada reserva só tem uma
   comunicação de cada tipo. enviarApartirDe é informativo (mostra
   quando a mensagem passa a fazer sentido ser enviada); para a
   confirmação é imediato. */
function criarComunicacaoHotel(reservaId, tipo, enviarApartirDe=null){
  DBHotel.comunicacoes = DBHotel.comunicacoes || [];
  const jaExiste = DBHotel.comunicacoes.some(c => c.reservaId === reservaId && c.tipo === tipo);
  if(jaExiste) return null;

  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva) return null;
  const hospede = hospedeDaReservaHotel(reserva);
  const email = (hospede && hospede.email) || '';
  const {assunto, corpo} = templateComunicacaoHotel(tipo, reserva);

  const comunicacao = {
    id: uidHotel(),
    reservaId,
    tipo,
    destinatarioEmail: email,
    assunto, corpo,
    estado: email ? 'pendente' : 'sem_email',
    geradoEm: new Date().toISOString(),
    enviarApartirDe: enviarApartirDe || new Date().toISOString().split('T')[0],
    enviadoEm: null
  };
  DBHotel.comunicacoes.push(comunicacao);
  return comunicacao;
}

/* Percorre as reservas e garante que a fila tem os itens que faltam:
   - Lembrete de check-in: reservas cujo check-in previsto está a
     CONFIG_COMUNICACOES_HOTEL.diasAntesLembreteCheckin dias ou menos
     (e ainda não passou), desde que a reserva não esteja cancelada.
   - Feedback pós-estadia: reservas já com check-out real feito.
   Chamar isto ao carregar a app (e ao mudar de dia) garante que a
   fila fica sempre atualizada, mesmo sem cron/servidor — é o utilizador,
   ao abrir a app, que "dispara" a atualização. A confirmação é criada
   à parte, no momento em que a reserva é submetida (ver submeterReserva). */
function atualizarFilaComunicacoesHotel(){
  DBHotel.comunicacoes = DBHotel.comunicacoes || [];
  const hoje = new Date();
  hoje.setHours(0,0,0,0);

  DBHotel.reservas.forEach(r => {
    if(r.estado === 'cancelada') return;

    // Lembrete de check-in
    if(r.checkinPrevisto && !r.checkinReal){
      const dataCheckin = new Date(r.checkinPrevisto);
      const diffDias = Math.round((dataCheckin - hoje) / 86400000);
      if(diffDias <= CONFIG_COMUNICACOES_HOTEL.diasAntesLembreteCheckin && diffDias >= 0){
        criarComunicacaoHotel(r.id, 'lembrete_checkin', r.checkinPrevisto);
      }
    }

    // Feedback pós-estadia
    if(r.checkoutReal){
      const dataCheckout = new Date(r.checkoutReal);
      dataCheckout.setDate(dataCheckout.getDate() + CONFIG_COMUNICACOES_HOTEL.diasDepoisFeedback);
      criarComunicacaoHotel(r.id, 'feedback', dataCheckout.toISOString().split('T')[0]);
    }
  });
}

/* Abre o cliente de e-mail do utilizador com o rascunho pronto e
   marca a comunicação como enviada (assume-se que quem clicou vai
   mesmo enviar — não há confirmação de entrega, tal como qualquer
   envio manual). */
function enviarComunicacaoHotel(comunicacaoId){
  const c = (DBHotel.comunicacoes||[]).find(x => x.id === comunicacaoId);
  if(!c) return;
  if(!c.destinatarioEmail){ toastHotel('Este hóspede não tem e-mail registado — atualize a ficha do hóspede.'); return; }
  const mailto = `mailto:${encodeURIComponent(c.destinatarioEmail)}?subject=${encodeURIComponent(c.assunto)}&body=${encodeURIComponent(c.corpo)}`;
  window.location.href = mailto;
  c.estado = 'enviado';
  c.enviadoEm = new Date().toISOString();
  saveDBHotel();
}

function marcarComunicacaoEnviadaHotel(comunicacaoId){
  const c = (DBHotel.comunicacoes||[]).find(x => x.id === comunicacaoId);
  if(!c) return;
  c.estado = 'enviado';
  c.enviadoEm = new Date().toISOString();
  saveDBHotel();
}

function apagarComunicacaoHotel(comunicacaoId){
  DBHotel.comunicacoes = (DBHotel.comunicacoes||[]).filter(c => c.id !== comunicacaoId);
  saveDBHotel();
}

/* ---------- ligação (opcional) à Tesouraria/Contabilidade ----------
   Só usar quando quiseres registar manualmente um resumo de receita
   de hotelaria na tesouraria (ex.: sinal recebido, resumo de fecho).
   NÃO emite fatura — só cria um lançamento de resumo, tal como já
   fazes hoje com os resumos de caixa de outros setores.
   Requer que core.js esteja também incluído na página, e que a
   função adicionarLancamentoPartilhado exista nele. */
async function gerarLancamentoReceitaHotel(reserva, valor, descricao, opcoes={}){
  if(typeof adicionarLancamentoPartilhado !== 'function'){
    toastHotel('Função de lançamento partilhado não disponível nesta página.');
    return {ok:false};
  }
  const forma = opcoes.formaPagamento || 'Cash';
  const tipoVenda = opcoes.tipoVenda || 'Hospedagem';
  const categoria = TIPOS_VENDA_ZOOMS_LODGE_HOTEL[tipoVenda] || TIPOS_VENDA_ZOOMS_LODGE_HOTEL['Hospedagem'];
  return await adicionarLancamentoPartilhado({
    id: uidHotel(),
    historico: [],
    data: new Date().toISOString().slice(0,10),
    tipo: 'Receita',
    unidade: UNIDADE_HOTEL,
    formaPagamento: forma,
    conta: opcoes.conta || (forma === 'Cash' ? 'CASH' : 'BAI-KZ-001'),
    categoria,
    origem: origemAutomaticaHotel(forma),
    entidade: '',
    nif: '',
    nFatura: gerarNumeroFaturaHotel(reserva.quartoId),
    valor: Number(valor) || 0,
    moeda: 'KZ',
    iva: 'Não',
    taxaIVA: 0,
    descricao: `${descricao} - ${reserva.hospedeNome} (Qt.${reserva.quartoId})`
  });
}

/* Classifica o valor pago no momento da reserva face ao total, para decidir
   se deve ligar-se de imediato aos lançamentos da Tesouraria (espelhar na
   conta real da empresa): 'total' (pagamento 100%+), 'sinal50' (>=50% do
   total) ou 'parcial' (<50%, fica só registado no folio até se decidir
   lançar manualmente). */
function classificarPagamentoReservaHotel(valorPago, totalReserva){
  const total = Number(totalReserva) || 0;
  const pago = Number(valorPago) || 0;
  if(pago <= 0) return 'nenhum';
  if(total <= 0) return 'parcial';
  const percentual = pago / total;
  if(percentual >= 0.999) return 'total';
  if(percentual >= 0.5) return 'sinal50';
  return 'parcial';
}

/* ============================================================
   CONTA CORRENTE DO HÓSPEDE (FOLIO) — consumos, extras, sinais
   ============================================================ */

/* Adiciona um lançamento ao folio de uma reserva.
   tipo: 'consumo' | 'extra' | 'desconto' | 'sinal' | 'pagamento'
   tipoVenda (só relevante para consumo/extra): 'Hospedagem'|'Restauração'|'Bar'|'Lavandaria'|'Transfer'|'Taxa sobre o Valor'|'Outros Serviços'
   — decide em que Categoria de Receita este valor vai cair no Tesoucantábil.
   Convenção: consumo/extra somam ao saldo devedor; desconto/sinal/pagamento reduzem. */
function adicionarFolioHotel(reservaId, {tipo, descricao, tipoVenda='Hospedagem', valor, formaPagamento='', pago=false, pct=null}){
  const pctNum = (pct !== null && pct !== '' && pct !== undefined && !isNaN(Number(pct))) ? Number(pct) : null;
  const item = {
    id: uidHotel(),
    reservaId,
    data: new Date().toISOString().slice(0,10),
    tipo,
    descricao,
    tipoVenda,
    valor: Number(valor)||0,
    formaPagamento,
    pago: !!pago,
    pct: pctNum // % sobre o preço da reserva usado para calcular o valor (quando aplicável) — fica gravado para poder refletir no Folio e no Talão/Ficha de Reserva
  };
  DBHotel.folio.push(item);
  return item;
}

function removerFolioHotel(folioId){
  DBHotel.folio = DBHotel.folio.filter(f => f.id !== folioId);
}

function listarFolioReservaHotel(reservaId){
  return DBHotel.folio.filter(f => f.reservaId === reservaId).sort((a,b)=> a.data.localeCompare(b.data));
}

/* Total consumido em Extras/Consumos (não inclui a diária da reserva).
   Exclui os que já foram pagos na hora (pago:true) — esses já foram
   lançados como venda na Tesouraria e não devem voltar a entrar no
   saldo em aberto do check-out. */
function totalExtrasFolioHotel(reservaId){
  return listarFolioReservaHotel(reservaId)
    .filter(f => (f.tipo === 'consumo' || f.tipo === 'extra') && !f.pago)
    .reduce((s,f)=> s + f.valor, 0);
}

/* Total já pago/abatido (sinais + pagamentos + descontos) */
function totalPagoFolioHotel(reservaId){
  return listarFolioReservaHotel(reservaId)
    .filter(f => f.tipo === 'sinal' || f.tipo === 'pagamento' || f.tipo === 'desconto')
    .reduce((s,f)=> s + f.valor, 0);
}

/* Saldo em aberto da conta corrente = diária da reserva + extras/consumos − pago/descontos */
function calcularSaldoFolioHotel(reservaId){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  const base = reserva ? (reserva.totalReserva || 0) : 0;
  return base + totalExtrasFolioHotel(reservaId) - totalPagoFolioHotel(reservaId);
}

/* ============================================================
   FATURAÇÃO / SPLIT DE CONTAS — várias faturas para 1 reserva
   ============================================================ */

/* Gera N "faturas" (documentos de cobrança internos) para a mesma reserva,
   cada uma com os seus próprios itens, e lança cada uma na Tesouraria via
   adicionarLancamentoPartilhado (core.js) — já no esquema real do
   contabilidade.html (tipo:'Receita', unidade, formaPagamento, conta,
   categoria de Receita Operacional, origem calculada) — e mantém o
   registo em DBHotel.faturas.
   divisoes: [{ itens:[{descricao,valor,tipoVenda}], formaPagamento, conta }] */
async function gerarFaturasSplitHotel(reservaId, divisoes){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva) return {ok:false, msg:'Reserva não encontrada'};

  const geradas = [];
  for(const div of divisoes){
    const total = (div.itens||[]).reduce((s,i)=> s + (Number(i.valor)||0), 0);
    if(total <= 0) continue;
    const forma = div.formaPagamento || 'Cash';
    const conta = div.conta || (forma === 'Cash' ? 'CASH' : 'BAI-KZ-001');
    const numero = gerarNumeroFaturaHotel(reserva.quartoId);
    const fatura = {
      id: uidHotel(),
      reservaId,
      numero,
      itens: div.itens,
      total,
      formaPagamento: forma,
      conta,
      dataEmissao: new Date().toISOString().slice(0,10),
      lancamentoIds: []
    };

    // "lancado" controla o estado do Resumo de Fecho de Caixa (ver "📤 Lançamentos"):
    // só fica true quando TODOS os itens desta fatura confirmarem lançamento na
    // Tesouraria — caso contrário a fatura entra como "pendente" no resumo.
    let todosLancados = true;

    if(typeof adicionarLancamentoPartilhado === 'function'){
      // Um Lançamento por item, para cada um cair na Categoria de Receita certa
      // (Hospedagem/Restauração/Bar/Lavandaria/Transfer/Taxa sobre o Valor/Outros), tal como o Tesoucantábil espera.
      for(const item of (div.itens||[])){
        const tipoVenda = item.tipoVenda || 'Hospedagem';
        const categoria = TIPOS_VENDA_ZOOMS_LODGE_HOTEL[tipoVenda] || TIPOS_VENDA_ZOOMS_LODGE_HOTEL['Hospedagem'];
        const idLanc = uidHotel();
        const resultado = await adicionarLancamentoPartilhado({
          id: idLanc,
          historico: [],
          data: fatura.dataEmissao,
          tipo: 'Receita',
          unidade: UNIDADE_HOTEL,
          formaPagamento: forma,
          conta,
          categoria,
          origem: origemAutomaticaHotel(forma),
          entidade: '',
          nif: '',
          nFatura: numero,
          valor: Number(item.valor) || 0,
          moeda: 'KZ',
          iva: 'Não',
          taxaIVA: 0,
          descricao: `${numero} — ${reserva.hospedeNome} (Qt.${reserva.quartoId}): ${item.descricao}`
        });
        fatura.lancamentoIds.push(idLanc);
        if(resultado && resultado.ok === false){
          todosLancados = false;
          toastHotel(`Aviso: fatura ${numero} registada localmente, mas um lançamento na Tesouraria falhou.`);
        }
      }
    } else {
      todosLancados = false;
      toastHotel('Tesouraria (core.js) não está ligada — faturas guardadas só localmente.');
    }

    fatura.lancado = todosLancados;
    DBHotel.faturas.push(fatura);
    geradas.push(fatura);
  }

  await saveDBHotel();
  return {ok:true, faturas:geradas};
}

function listarFaturasReservaHotel(reservaId){
  return DBHotel.faturas.filter(f => f.reservaId === reservaId);
}

/* ============================================================
   LANÇAMENTOS — RESUMO DE FECHO DE CAIXA (mesma lógica do
   "Fecho de Caixa Dividido" do contabilidade.html: consolida a
   faturação do check-out por Forma de Pagamento e lança-a na
   Tesouraria). O check-out (gerarFaturasSplitHotel) já lança cada
   fatura automaticamente linha a linha; este módulo é o botão de
   "Lançamentos" que dá visibilidade a isso e recupera faturas que
   fiquem pendentes (Tesouraria indisponível ou lançamento falhado
   no momento do check-out).
   ============================================================ */

/* Faturas de check-out ainda não 100% lançadas na Tesouraria,
   opcionalmente filtradas por data de emissão. */
function faturasPendentesHotel(data=''){
  return DBHotel.faturas.filter(f => f.lancado !== true && (!data || f.dataEmissao === data));
}

/* Decompõe as faturas pendentes nos seus itens (cada item já tem
   Forma de Pagamento/Conta/Tipo de Venda próprios) e agrupa por
   Forma+Conta+Tipo de Venda — são estas as linhas do Resumo de
   Fecho de Caixa a lançar (uma por combinação). */
function resumoLinhasPendentesHotel(data=''){
  const grupos = {};
  faturasPendentesHotel(data).forEach(f=>{
    (f.itens||[]).forEach(item=>{
      const tipoVenda = item.tipoVenda || 'Hospedagem';
      const chave = `${f.formaPagamento}|${f.conta}|${tipoVenda}`;
      if(!grupos[chave]) grupos[chave] = {formaPagamento:f.formaPagamento, conta:f.conta, tipoVenda, valor:0, faturaIds:new Set()};
      grupos[chave].valor += Number(item.valor)||0;
      grupos[chave].faturaIds.add(f.id);
    });
  });
  return Object.values(grupos).map(g=>({...g, faturaIds:[...g.faturaIds]}));
}

/* Lança o Resumo de Fecho de Caixa na Tesouraria: um Lançamento de
   Receita por linha (Forma de Pagamento + Tipo de Venda), marca as
   faturas incluídas como lancado:true, e guarda o resumo em
   DBHotel.fechosCaixaHotel para auditoria — igual ao histórico de
   Fecho de Caixa da Contabilidade. */
async function lancarResumoFechoCaixaHotel(data, linhas){
  if(typeof adicionarLancamentoPartilhado !== 'function'){
    return {ok:false, msg:'Tesouraria (core.js) não está ligada nesta página.'};
  }
  const lancamentoIds = [];
  const faturaIdsTodas = new Set();
  for(const linha of linhas){
    const valor = Number(linha.valor)||0;
    if(valor <= 0) continue;
    const categoria = TIPOS_VENDA_ZOOMS_LODGE_HOTEL[linha.tipoVenda] || TIPOS_VENDA_ZOOMS_LODGE_HOTEL['Hospedagem'];
    const idLanc = uidHotel();
    const resultado = await adicionarLancamentoPartilhado({
      id: idLanc,
      historico: [],
      data,
      tipo: 'Receita',
      unidade: UNIDADE_HOTEL,
      formaPagamento: linha.formaPagamento,
      conta: linha.conta,
      categoria,
      origem: origemAutomaticaHotel(linha.formaPagamento),
      entidade: '',
      nif: '',
      nFatura: `ZL/RESUMO/${data}`,
      valor,
      moeda: 'KZ',
      iva: 'Não',
      taxaIVA: 0,
      descricao: `Resumo de Fecho de Caixa — Check-out Hotel (${labelFormaPagamentoHotel(linha.formaPagamento)} · ${linha.tipoVenda}), ${data}`
    });
    if(resultado && resultado.ok === false){
      return {ok:false, msg:'Falha ao lançar na Tesouraria — tenta novamente.'};
    }
    lancamentoIds.push(idLanc);
    (linha.faturaIds||[]).forEach(id=>faturaIdsTodas.add(id));
  }
  if(!lancamentoIds.length) return {ok:false, msg:'Não há valores a lançar.'};

  faturaIdsTodas.forEach(id=>{
    const f = DBHotel.faturas.find(x=>x.id===id);
    if(f) f.lancado = true;
  });

  if(!DBHotel.fechosCaixaHotel) DBHotel.fechosCaixaHotel = [];
  DBHotel.fechosCaixaHotel.push({
    id: uidHotel(),
    data,
    linhas: linhas.filter(l=>Number(l.valor)>0).map(l=>({formaPagamento:l.formaPagamento, conta:l.conta, tipoVenda:l.tipoVenda, valor:Number(l.valor)||0})),
    total: linhas.reduce((s,l)=>s+(Number(l.valor)||0),0),
    lancamentoIds,
    criadoEm: new Date().toISOString()
  });

  await saveDBHotel();
  return {ok:true, lancamentoIds};
}

/* ============================================================
   CANAIS E DISTRIBUIÇÃO
   ------------------------------------------------------------
   Nota honesta sobre limites técnicos: uma ligação em tempo real
   a Booking.com, Airbnb ou Expedia (channel manager "verdadeiro")
   exige contas de parceiro certificadas nessas plataformas, com
   credenciais/API própria e normalmente um servidor backend — não
   é algo que uma página HTML estática consiga fazer sozinha.
   O que ESTE módulo oferece, de forma realista e sem custos:
   1) Registo manual de reservas vindas por telefone/e-mail
      (já coberto pelo formulário de Nova Reserva, canal "Direto").
   2) Exportação de um calendário iCal (.ics) com os quartos
      ocupados, para colares no "Sincronizar calendários" do
      Booking/Airbnb/Expedia — evita overbooking.
   3) Importação de feeds iCal (.ics) que essas plataformas
      disponibilizam, criando Bloqueios automáticos nos quartos
      correspondentes, para essas reservas externas também
      aparecerem aqui como indisponíveis.
   ============================================================ */

/* Gera o conteúdo .ics com os períodos ocupados (reservas + bloqueios) */
function gerarICalHotel(){
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZoomsLodge//Hotelaria//PT'
  ];
  const fmt = (d) => d.replace(/-/g,'');

  DBHotel.reservas.filter(r => r.estado !== 'cancelada').forEach(r => {
    linhas.push('BEGIN:VEVENT');
    linhas.push(`UID:${r.id}@zoomslodge`);
    linhas.push(`DTSTART;VALUE=DATE:${fmt(r.checkinPrevisto)}`);
    linhas.push(`DTEND;VALUE=DATE:${fmt(r.checkoutPrevisto)}`);
    linhas.push(`SUMMARY:Ocupado — Qt.${r.quartoId} (${r.hospedeNome||'reserva'})`);
    linhas.push('END:VEVENT');
  });

  DBHotel.bloqueios.forEach(b => {
    linhas.push('BEGIN:VEVENT');
    linhas.push(`UID:${b.id}@zoomslodge`);
    linhas.push(`DTSTART;VALUE=DATE:${fmt(b.dataIni)}`);
    linhas.push(`DTEND;VALUE=DATE:${fmt(b.dataFim)}`);
    linhas.push(`SUMMARY:Bloqueado — Qt.${b.quartoId} (${b.motivo||'manutenção'})`);
    linhas.push('END:VEVENT');
  });

  linhas.push('END:VCALENDAR');
  return linhas.join('\r\n');
}

function baixarICalHotel(){
  const conteudo = gerarICalHotel();
  const blob = new Blob([conteudo], {type:'text/calendar'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zoomslodge-ocupacao-${new Date().toISOString().slice(0,10)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Faz o parse simples de um ficheiro .ics (texto) e devolve os eventos
   [{uid, dataIni, dataFim, resumo}] — suficiente para feeds padrão de
   disponibilidade do Booking/Airbnb/Expedia. */
function parseICalHotel(textoIcs){
  const eventos = [];
  const blocos = textoIcs.split('BEGIN:VEVENT').slice(1);
  blocos.forEach(bloco => {
    const uid = (bloco.match(/UID:([^\r\n]+)/)||[])[1] || uidHotel();
    const dtStart = (bloco.match(/DTSTART[^:]*:([^\r\n]+)/)||[])[1];
    const dtEnd = (bloco.match(/DTEND[^:]*:([^\r\n]+)/)||[])[1];
    const resumo = (bloco.match(/SUMMARY:([^\r\n]+)/)||[])[1] || '';
    const paraData = (v) => v ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : null;
    if(dtStart && dtEnd){
      eventos.push({uid, dataIni: paraData(dtStart), dataFim: paraData(dtEnd), resumo});
    }
  });
  return eventos;
}

/* Importa um feed iCal externo (ex.: Booking.com) e cria Bloqueios
   correspondentes no quarto indicado, para nunca haver overbooking. */
function importarICalHotel(textoIcs, canalId, quartoId){
  const eventos = parseICalHotel(textoIcs);
  let criados = 0;
  eventos.forEach(ev => {
    if(!ev.dataIni || !ev.dataFim) return;
    const jaExiste = DBHotel.bloqueios.some(b => b.origemUid === ev.uid);
    if(jaExiste) return;
    DBHotel.bloqueios.push({
      id: uidHotel(),
      quartoId,
      dataIni: ev.dataIni,
      dataFim: ev.dataFim,
      motivo: `Reserva externa (${canalId}) — ${ev.resumo}`,
      origemUid: ev.uid,
      origemCanal: canalId
    });
    criados++;
  });
  return {ok:true, criados, total: eventos.length};
}

/* ============================================================
   RELATÓRIOS — Ocupação, ADR, RevPAR, Forecast, Chegadas/Partidas
   ============================================================ */

function listarDatasEntre(dataIni, dataFim){
  const datas = [];
  let d = new Date(dataIni);
  const fim = new Date(dataFim);
  while(d < fim){
    datas.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return datas;
}

/* Taxa de ocupação diária e média do período */
function relatorioOcupacaoHotel(dataIni, dataFim){
  const totalQuartos = DBHotel.quartos.length || 1;
  const dias = listarDatasEntre(dataIni, dataFim);
  const porDia = dias.map(dataStr => {
    const ocupacao = getOcupacaoHotel(dataStr);
    const ocupados = Object.values(ocupacao).filter(o => o.estado !== 'livre').length;
    return {data: dataStr, ocupados, totalQuartos, taxa: totalQuartos ? (ocupados/totalQuartos*100) : 0};
  });
  const mediaOcupados = porDia.reduce((s,d)=>s+d.ocupados,0) / (porDia.length||1);
  const taxaMedia = totalQuartos ? (mediaOcupados/totalQuartos*100) : 0;
  return {porDia, taxaMedia, totalQuartos};
}

/* ADR (Tarifa Média Diária) = Receita de alojamento / Noites vendidas
   RevPAR = Receita de alojamento / (Quartos disponíveis x dias do período) */
function relatorioADRRevPARHotel(dataIni, dataFim){
  const totalQuartos = DBHotel.quartos.length || 1;
  const dias = listarDatasEntre(dataIni, dataFim).length || 1;

  const reservasNoPeriodo = DBHotel.reservas.filter(r =>
    r.estado !== 'cancelada' && r.estado !== 'waitlist' &&
    !(r.checkoutPrevisto <= dataIni || r.checkinPrevisto >= dataFim)
  );

  let receitaTotal = 0;
  let noitesVendidas = 0;
  reservasNoPeriodo.forEach(r => {
    const ini = r.checkinPrevisto < dataIni ? dataIni : r.checkinPrevisto;
    const fim = r.checkoutPrevisto > dataFim ? dataFim : r.checkoutPrevisto;
    const noites = Math.max(0, calcularNoitesHotel(ini, fim));
    noitesVendidas += noites;
    const noitesTotais = Math.max(1, calcularNoitesHotel(r.checkinPrevisto, r.checkoutPrevisto));
    receitaTotal += (r.totalReserva || 0) * (noites / noitesTotais);
  });

  const adr = noitesVendidas ? (receitaTotal / noitesVendidas) : 0;
  const revpar = (totalQuartos * dias) ? (receitaTotal / (totalQuartos * dias)) : 0;

  return {receitaTotal: Math.round(receitaTotal), noitesVendidas, adr: Math.round(adr), revpar: Math.round(revpar), totalQuartos, dias};
}

/* Previsão de ocupação para os próximos N dias, com base nas reservas
   já confirmadas/garantidas/provisórias (não cancelada) */
function relatorioForecastHotel(diasFrente=14){
  const hoje = new Date().toISOString().slice(0,10);
  const fim = new Date();
  fim.setDate(fim.getDate() + diasFrente);
  return relatorioOcupacaoHotel(hoje, fim.toISOString().slice(0,10));
}

/* ---------- Chegadas e partidas previstas para uma data específica (default: hoje) */
function relatorioChegadasPartidasHotel(dataStr){
  const data = dataStr || new Date().toISOString().slice(0,10);
  const chegadas = DBHotel.reservas.filter(r => r.checkinPrevisto === data && r.estado !== 'cancelada');
  const partidas = DBHotel.reservas.filter(r => r.checkoutPrevisto === data && r.estado !== 'cancelada');
  return {data, chegadas, partidas};
}

/* ============================================================
   RELATÓRIO OPERACIONAL DIÁRIO (fim do dia)
   ------------------------------------------------------------
   Junta, numa só consulta/impressão, o que os outros
   departamentos precisam de saber para preparar o dia seguinte:
     - Cozinha/Buffet: quantos hóspedes estão hospedados (por
       quarto), para calcular quantidades.
     - Limpeza: que quartos estiveram ocupados (limpeza de
       manutenção) e que quartos tiveram check-out (limpeza
       completa/turnover).
     - Serviços Gerais: que quartos têm uma intervenção de
       manutenção pendente, e de que tipo.
   ============================================================ */
const TIPOS_MANUTENCAO_HOTEL = ['Elétrica','Canalização','Ar Condicionado','Mobiliário','Pintura','Eletrodomésticos','Outro'];

function relatorioOperacionalDiarioHotel(data){
  const dataRef = data || new Date().toISOString().slice(0,10);

  // Hóspedes em casa nesta data: check-in já feito, check-out ainda não.
  const hospedesEmCasa = DBHotel.reservas
    .filter(r => r.estado === 'checkin')
    .map(r => {
      const quarto = DBHotel.quartos.find(q => q.id === r.quartoId);
      const tipo = DBHotel.tiposQuarto.find(t => t.id === r.tipoId);
      return {
        reservaId: r.id,
        hospedeNome: r.hospedeNome,
        quartoId: r.quartoId,
        quartoNumero: quarto ? quarto.numero : r.quartoId,
        tipoQuarto: tipo ? tipo.nome : '-',
        numHospedes: Number(r.numHospedes) || 1,
        checkinReal: r.checkinReal,
        checkoutPrevisto: r.checkoutPrevisto
      };
    })
    .sort((a,b) => String(a.quartoNumero).localeCompare(String(b.quartoNumero), undefined, {numeric:true}));
  const totalHospedes = hospedesEmCasa.reduce((s,h) => s + h.numHospedes, 0);

  // Quartos com check-out feito nesta data — precisam de limpeza completa (turnover).
  const quartosCheckoutHoje = DBHotel.reservas
    .filter(r => r.estado === 'checkout' && r.checkoutReal === dataRef)
    .map(r => {
      const quarto = DBHotel.quartos.find(q => q.id === r.quartoId);
      return {
        reservaId: r.id,
        hospedeNome: r.hospedeNome,
        quartoId: r.quartoId,
        quartoNumero: quarto ? quarto.numero : r.quartoId
      };
    });

  // Manutenção pendente: bloqueios de tipo "manutencao" ativos nesta data.
  const manutencaoPendente = DBHotel.bloqueios
    .filter(b => b.tipo === 'manutencao' && dataRef >= b.dataIni && dataRef < b.dataFim)
    .map(b => {
      const quarto = DBHotel.quartos.find(q => q.id === b.quartoId);
      return {
        quartoId: b.quartoId,
        quartoNumero: quarto ? quarto.numero : b.quartoId,
        subtipo: b.subtipo || 'Outro',
        observacoes: b.observacoes || '',
        dataIni: b.dataIni,
        dataFim: b.dataFim
      };
    });

  return {data: dataRef, hospedesEmCasa, totalHospedes, quartosCheckoutHoje, manutencaoPendente};
}

/* Cria o bloqueio de Manutenção associado a um check-out (quando o
   hóspede assinala que o quarto precisa de intervenção). Reaproveita
   o mesmo esquema de DBHotel.bloqueios já usado em "🔒 Bloqueios",
   apenas com o campo extra "subtipo" para identificar o tipo de
   intervenção nos relatórios dos Serviços Gerais. */
function criarBloqueioManutencaoHotel(quartoId, subtipo, observacoes, dataIni, diasBloqueio=2){
  const ini = new Date(dataIni);
  const fim = new Date(ini);
  fim.setDate(fim.getDate() + diasBloqueio);
  const bloqueio = {
    id: uidHotel(),
    quartoId,
    tipo: 'manutencao',
    subtipo,
    dataIni,
    dataFim: fim.toISOString().slice(0,10),
    observacoes,
    origem: 'checkout'
  };
  DBHotel.bloqueios.push(bloqueio);
  return bloqueio;
}

/* ---------- Impressão do Relatório Operacional Diário ----------
   Mesmo motor de impressão (cabeçalho/secções/assinaturas) do
   contabilidade.html, com sufixo "Hotel" para não colidir com
   core.js caso as duas páginas venham a partilhar o mesmo DOM.
   Requer, do lado do HTML, um <div id="printOverlayHotel"> com
   <div id="printSheetHotel"> lá dentro (ver hotel.html). */
function abrirImpressaoHotel(html){
  const sheet = document.getElementById('printSheetHotel');
  const overlay = document.getElementById('printOverlayHotel');
  if(!sheet || !overlay) return;
  sheet.innerHTML = html;
  overlay.classList.add('is-open');
}
function fecharImpressaoHotel(){
  document.getElementById('printOverlayHotel')?.classList.remove('is-open');
}
function printFieldHotel(label, value){
  return `<tr><td class="print-label">${label}</td><td>${value}</td></tr>`;
}
function printSectionHTMLHotel(heading, rows, highlight){
  return `<h3 class="print-section-title">${heading}</h3><table class="print-field-table${highlight?' is-highlight':''}"><tbody>${rows.map(([l,v])=>printFieldHotel(l,v)).join('')}</tbody></table>`;
}
function printDocHTMLHotel({code, title, subtitle, sections=[], gridHTML='', note='', signatures=[]}){
  const head = `
  <div class="print-head">
    <div><div class="print-brand">🏨 ZOOM'S LODGE</div><div class="print-brand-sub">Hotelaria — Operações</div></div>
    <div class="print-doc-meta"><div class="print-code">${code}</div><div class="print-title">${title}</div></div>
  </div>
  <p class="print-subtitle">${subtitle}</p>`;
  const sectionsHTML = sections.map(s => printSectionHTMLHotel(s.heading, s.rows, s.highlight)).join('');
  const noteHTML = note ? `<div class="print-note">${note}</div>` : '';
  const sigHTML = signatures.length ? `<div class="print-signatures">${signatures.map(s=>`<div class="print-sig"><div class="print-sig-line"></div><span>${s}</span></div>`).join('')}</div>` : '';
  return head + sectionsHTML + (gridHTML||'') + noteHTML + sigHTML;
}

/* ---------- Impressão da Ficha de Reserva (Talão, para o hóspede assinar) ----------
   Documento de confirmação da reserva, com todos os dados acordados
   (hóspede, quarto, período, tarifa, sinal, condições) para o hóspede
   conferir e assinar — normalmente entregue/assinado no check-in ou no
   ato da reserva presencial. Usa o mesmo motor de impressão (abrirImpressaoHotel
   / printDocHTMLHotel) já usado no Relatório Operacional.
   Inclui também a Forma de Pagamento do sinal e, quando existirem, os
   lançamentos do Folio (incluindo os cobrados como % sobre o preço da
   reserva) — para que a Ficha de Reserva reflita sempre a mesma informação
   que consta no Folio, e não apenas o valor em Kz. */
function imprimirTalaoReservaHotel(reservaId){
  const r = DBHotel.reservas.find(x => x.id === reservaId);
  if(!r) return;
  const tipo = DBHotel.tiposQuarto.find(t => t.id === r.tipoId);
  const quarto = DBHotel.quartos.find(q => q.id === r.quartoId);
  const plano = DBHotel.planosTarifarios.find(p => p.id === r.planoId);
  const canal = DBHotel.canais.find(c => c.id === r.canalId);
  const saldoReserva = Math.max(0, Number(r.totalReserva||0) - Number(r.sinal||0));
  const itensFolio = listarFolioReservaHotel(reservaId);

  const gridFolio = itensFolio.length ? `
    <h3 class="print-section-title">📒 Lançamentos do Folio (Consumos, Extras, Taxas, Descontos e Pagamentos)</h3>
    <table class="print-grid-table">
      <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th class="num">% s/ Preço</th><th class="num">Valor</th><th>Forma de Pagamento</th></tr></thead>
      <tbody>
        ${itensFolio.map(f => `
          <tr>
            <td>${f.data}</td>
            <td>${f.tipo}</td>
            <td>${f.descricao}${f.tipoVenda?` (${f.tipoVenda})`:''}</td>
            <td class="num">${(f.pct !== null && f.pct !== undefined) ? f.pct + '%' : '—'}</td>
            <td class="num">${formatarKzHotel(f.valor)} Kz</td>
            <td>${f.formaPagamento ? labelFormaPagamentoHotel(f.formaPagamento) : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  abrirImpressaoHotel(printDocHTMLHotel({
    code: 'RES-' + r.id.slice(-6).toUpperCase(),
    title: 'Ficha de Reserva',
    subtitle: 'Confirmação dos dados e condições da reserva — a assinar pelo hóspede como confirmação de aceitação.',
    sections: [
      {heading: 'Dados do Hóspede', rows: [
        ['Nome', r.hospedeNome || '—'],
        ['Documento de Identificação', r.hospedeDoc || '—'],
        ['Contacto', r.hospedeContacto || '—'],
        ['Nº de Hóspedes', r.numHospedes || 1],
      ]},
      {heading: 'Dados da Reserva', rows: [
        ['Quarto', quarto ? `${quarto.numero} (${tipo ? tipo.nome : ''})` : (tipo ? tipo.nome : '—')],
        ['Check-in Previsto', r.checkinPrevisto || '—'],
        ['Check-out Previsto', r.checkoutPrevisto || '—'],
        ['Nº de Noites', r.numNoites || '—'],
        ['Plano Tarifário', plano ? plano.nome : '—'],
        ['Canal de Reserva', canal ? canal.nome : '—'],
        ['Estado da Reserva', r.estado || '—'],
      ], highlight:true},
      {heading: 'Valores', rows: [
        ['Preço por Noite', `${r.precoNoite||0} Kz`],
        ['Total da Reserva', `${r.totalReserva||0} Kz`],
        ['Sinal Pago', `${r.sinal||0} Kz`],
        ['Forma de Pagamento do Sinal', r.sinal ? labelFormaPagamentoHotel(r.formaPagamentoSinal) : '—'],
        ['Saldo a Pagar (no check-in/check-out)', `${saldoReserva} Kz`],
      ]},
      ...(r.observacoes || r.preferencias ? [{heading: 'Observações / Preferências', rows: [
        ['Observações', r.observacoes || '—'],
        ...(r.preferencias ? [['Preferências', r.preferencias]] : []),
      ]}] : []),
    ],
    gridHTML: gridFolio,
    note: 'Ao assinar, o hóspede confirma que os dados acima estão corretos e aceita as condições de reserva, incluindo a política de cancelamento, quaisquer taxas cobradas em percentagem sobre o preço da reserva, e o saldo a liquidar no check-in ou check-out.',
    signatures: ['Hóspede · Data', 'Receção · Data'],
  }));
}

/* ---------- Impressão da Ficha de Reserva de Grupo ----------
   Documento único que reúne todos os quartos de uma Reserva de Grupo
   (mesma empresa/entidade), com os dados da empresa, uma linha por
   quarto (ocupante, período, total, sinal, forma de pagamento e
   estado) e os totais agregados do grupo. Cada quarto mantém também
   a sua própria Ficha de Reserva e Folio individuais — este documento
   é um resumo consolidado, útil para a empresa assinar de uma vez. */
function imprimirFichaGrupoHotel(grupoId){
  const grupo = DBHotel.grupos.find(g => g.id === grupoId);
  if(!grupo) return;
  const reservas = getReservasDoGrupoHotel(grupoId);
  const totais = calcularTotaisGrupoHotel(grupoId);

  const gridQuartos = `
    <h3 class="print-section-title">🛏️ Quartos da Reserva de Grupo (${reservas.length})</h3>
    <table class="print-grid-table">
      <thead><tr><th>Quarto</th><th>Ocupante</th><th>Período</th><th class="num">Total</th><th class="num">Sinal</th><th>Forma Pagto.</th><th>Estado</th></tr></thead>
      <tbody>
        ${reservas.length ? reservas.map(r => {
          const quarto = DBHotel.quartos.find(q => q.id === r.quartoId);
          return `<tr>
            <td>${quarto ? quarto.numero : (r.quartoId || '—')}</td>
            <td>${r.hospedeNome}</td>
            <td>${r.checkinPrevisto} → ${r.checkoutPrevisto}</td>
            <td class="num">${formatarKzHotel(r.totalReserva)} Kz</td>
            <td class="num">${formatarKzHotel(r.sinal)} Kz</td>
            <td>${labelFormaPagamentoHotel(r.formaPagamentoSinal)}</td>
            <td>${r.estado}</td>
          </tr>`;
        }).join('') : '<tr><td colspan="7">Sem quartos associados a este grupo.</td></tr>'}
        <tr style="font-weight:bold;">
          <td colspan="3">TOTAL DO GRUPO (${totais.numQuartos} quarto(s) ativo(s))</td>
          <td class="num">${formatarKzHotel(totais.totalReserva)} Kz</td>
          <td class="num">${formatarKzHotel(totais.totalPago)} Kz pago</td>
          <td colspan="2">Saldo: ${formatarKzHotel(totais.saldo)} Kz</td>
        </tr>
      </tbody>
    </table>`;

  abrirImpressaoHotel(printDocHTMLHotel({
    code: 'GRP-' + grupo.id.slice(-6).toUpperCase(),
    title: 'Ficha de Reserva de Grupo',
    subtitle: 'Confirmação de vários quartos reservados em simultâneo para a mesma empresa/entidade — a assinar pelo responsável.',
    sections: [
      {heading: 'Dados da Empresa/Grupo', rows: [
        ['Nome da Empresa/Grupo', grupo.nomeEmpresa || '—'],
        ['NIF / Documento', grupo.nif || '—'],
        ['Pessoa de Contacto', grupo.responsavel || '—'],
        ['Contacto', grupo.contacto || '—'],
        ['Email', grupo.email || '—'],
      ], highlight:true},
      ...(grupo.observacoes ? [{heading: 'Observações', rows: [['Observações', grupo.observacoes]]}] : []),
    ],
    gridHTML: gridQuartos,
    note: 'Ao assinar, o responsável confirma os dados de todos os quartos listados acima, incluindo tarifas, sinais e o saldo a liquidar no check-in/check-out de cada quarto.',
    signatures: ['Responsável da Empresa/Grupo · Data', 'Receção · Data'],
  }));
}

/* ---------- Impressão do Folio (Conta Corrente) ----------
   Documento com todos os lançamentos da conta corrente da reserva
   (consumos, extras, taxas — incluindo a % sobre o preço quando
   aplicável —, descontos, sinal e pagamentos), a Forma de Pagamento de
   cada um, e o saldo em aberto. Usa o mesmo motor de impressão do
   Talão / Relatório Operacional. */
function imprimirFolioHotel(reservaId){
  const r = DBHotel.reservas.find(x => x.id === reservaId);
  if(!r) return;
  const quarto = DBHotel.quartos.find(q => q.id === r.quartoId);
  const itensFolio = listarFolioReservaHotel(reservaId);
  const saldo = calcularSaldoFolioHotel(reservaId);

  const gridFolio = `
    <h3 class="print-section-title">📒 Lançamentos do Folio</h3>
    <table class="print-grid-table">
      <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th class="num">% s/ Preço</th><th class="num">Valor</th><th>Forma de Pagamento</th></tr></thead>
      <tbody>
        ${itensFolio.length ? itensFolio.map(f => `
          <tr>
            <td>${f.data}</td>
            <td>${f.tipo}</td>
            <td>${f.descricao}${f.tipoVenda?` (${f.tipoVenda})`:''}${f.pago?' ✔ paga':''}</td>
            <td class="num">${(f.pct !== null && f.pct !== undefined) ? f.pct + '%' : '—'}</td>
            <td class="num">${formatarKzHotel(f.valor)} Kz</td>
            <td>${f.formaPagamento ? labelFormaPagamentoHotel(f.formaPagamento) : '—'}</td>
          </tr>`).join('') : '<tr><td colspan="6">Sem lançamentos.</td></tr>'}
        <tr style="font-weight:bold;"><td colspan="4">SALDO EM ABERTO</td><td class="num">${formatarKzHotel(saldo)} Kz</td><td></td></tr>
      </tbody>
    </table>`;

  abrirImpressaoHotel(printDocHTMLHotel({
    code: 'FOL-' + r.id.slice(-6).toUpperCase(),
    title: 'Folio — Conta Corrente',
    subtitle: 'Extrato de todos os lançamentos da conta corrente da reserva, com respetivas formas de pagamento.',
    sections: [
      {heading: 'Dados da Reserva', rows: [
        ['Hóspede', r.hospedeNome || '—'],
        ['Quarto', quarto ? quarto.numero : (r.quartoId || '—')],
        ['Diária (base da reserva)', `${formatarKzHotel(r.totalReserva)} Kz`],
        ['Saldo em Aberto', `${formatarKzHotel(saldo)} Kz`],
      ], highlight:true},
    ],
    gridHTML: gridFolio,
    signatures: ['Hóspede · Data', 'Receção · Data'],
  }));
}

/* Monta e abre, numa única folha, o Relatório Operacional Diário
   (Cozinha/Buffet + Limpeza + Serviços Gerais) para a data indicada. */
function imprimirRelatorioOperacionalHotel(data){
  const r = relatorioOperacionalDiarioHotel(data);

  const gridCozinha = `
    <h3 class="print-section-title">🍽️ Cozinha / Buffet — Hóspedes em Casa (${r.totalHospedes})</h3>
    <table class="print-grid-table">
      <thead><tr><th>Quarto</th><th>Hóspede</th><th>Tipo de Quarto</th><th class="num">Nº Hóspedes</th></tr></thead>
      <tbody>${r.hospedesEmCasa.length ? r.hospedesEmCasa.map(h=>`<tr><td>${h.quartoNumero}</td><td>${h.hospedeNome}</td><td>${h.tipoQuarto}</td><td class="num">${h.numHospedes}</td></tr>`).join('') : '<tr><td colspan="4">Sem hóspedes em casa nesta data.</td></tr>'}
      <tr style="font-weight:bold;"><td colspan="3">TOTAL DE HÓSPEDES</td><td class="num">${r.totalHospedes}</td></tr>
      </tbody>
    </table>`;

  const gridLimpeza = `
    <h3 class="print-section-title">🧹 Limpeza — Controlo de Quartos</h3>
    <table class="print-grid-table">
      <thead><tr><th>Quarto</th><th>Hóspede</th><th>Tipo de Limpeza</th></tr></thead>
      <tbody>
        ${r.hospedesEmCasa.map(h=>`<tr><td>${h.quartoNumero}</td><td>${h.hospedeNome}</td><td>Limpeza de manutenção (ocupado)</td></tr>`).join('')}
        ${r.quartosCheckoutHoje.map(q=>`<tr><td>${q.quartoNumero}</td><td>${q.hospedeNome}</td><td>Limpeza completa (check-out)</td></tr>`).join('')}
        ${(!r.hospedesEmCasa.length && !r.quartosCheckoutHoje.length) ? '<tr><td colspan="3">Sem quartos a assinalar.</td></tr>' : ''}
      </tbody>
    </table>`;

  const gridManutencao = `
    <h3 class="print-section-title">🔧 Serviços Gerais — Manutenção Pendente</h3>
    <table class="print-grid-table">
      <thead><tr><th>Quarto</th><th>Tipo de Intervenção</th><th>Observações</th><th>Período</th></tr></thead>
      <tbody>${r.manutencaoPendente.length ? r.manutencaoPendente.map(m=>`<tr><td>${m.quartoNumero}</td><td>${m.subtipo}</td><td>${m.observacoes||'-'}</td><td>${m.dataIni} → ${m.dataFim}</td></tr>`).join('') : '<tr><td colspan="4">Sem intervenções de manutenção pendentes.</td></tr>'}
      </tbody>
    </table>`;

  abrirImpressaoHotel(printDocHTMLHotel({
    code: 'REL-OP-' + r.data,
    title: 'Relatório Operacional Diário',
    subtitle: `Resumo de fim do dia para preparação do dia seguinte — Cozinha/Buffet, Limpeza e Serviços Gerais. Data de referência: ${r.data}.`,
    gridHTML: gridCozinha + gridLimpeza + gridManutencao,
    signatures: ['Receção · Data/Hora', 'Cozinha (recebido) · Data/Hora', 'Limpeza (recebido) · Data/Hora', 'Serviços Gerais (recebido) · Data/Hora']
  }));
}
