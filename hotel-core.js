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
  tiposQuarto: [
    {id:'std', nome:'Standard', capacidade:2, precoBase:15000},
    {id:'lux', nome:'Luxo', capacidade:2, precoBase:25000},
    {id:'suite', nome:'Suite', capacidade:3, precoBase:40000},
    {id:'fam', nome:'Familiar', capacidade:4, precoBase:35000}
  ],
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
  }
  // hospedes: [{id, nome, documento, contacto, email, morada, pais, notas, dataPrimeira, totalEstadias, fidelizacao}]
  // estadias: [{id, hospedeId, checkinReal, checkoutReal, quartoId, taxaRef, notas, faturaRef}]
  // folio: [{id, reservaId, data, tipo:'consumo'|'extra'|'desconto'|'sinal'|'pagamento', descricao, categoria, valor, formaPagamento}]
  //   valor > 0 = a débito do hóspede (consumo/extra); valor negativo/'pagamento'/'sinal' reduz o saldo em aberto
  // faturas: [{id, reservaId, numero, itens:[{descricao,valor}], total, formaPagamento, dataEmissao, lancamentoId}]
  // reservasCanalExterno: [{id, canalId, uid, quartoId, checkinPrevisto, checkoutPrevisto, hospedeNome, origemUrl}]
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

    DBHotel = Object.assign({tiposQuarto:[],quartos:[],reservas:[],bloqueios:[],hospedes:[],estadias:[],folio:[],faturas:[],reservasCanalExterno:[],configCanais:{icalImportUrls:[]}}, data.data || {});
    if(!DBHotel.folio) DBHotel.folio = [];
    if(!DBHotel.faturas) DBHotel.faturas = [];
    if(!DBHotel.reservasCanalExterno) DBHotel.reservasCanalExterno = [];
    if(!DBHotel.configCanais) DBHotel.configCanais = {icalImportUrls:[]};
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
    if(r.estado !== 'cancelada' && data >= r.checkinPrevisto && data < r.checkoutPrevisto){
      ocupacao[r.quartoId] = {estado: r.estado, id: r.id};
    }
  });
  
  return ocupacao;
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

function calcularTotalReservaHotel(tipoId, dataIni, dataFim, planoId, canalId, descontoAdicional=0, cupomId=null){
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
  
  // Aplicar cupom se fornecido
  if(cupomId){
    const cupom = DBHotel.cupons.find(c => c.id === cupomId);
    if(cupom && cupom.usos_atuais < cupom.usos_max){
      const descCupom = (total * cupom.desconto) / 100;
      total -= descCupom;
      cupom.usos_atuais = (cupom.usos_atuais || 0) + 1;
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
function obterOuCriarHospede(nome, documento, contacto, email=''){
  // Se existe hóspede com este documento, retorna-o
  let hospede = DBHotel.hospedes.find(h => h.documento === documento);
  if(hospede) return hospede;
  
  // Criar novo hóspede
  hospede = {
    id: uidHotel(),
    nome: nome,
    documento: documento,
    contacto: contacto,
    email: email,
    morada: '',
    pais: '',
    notas: '',
    preferencias: [],
    dataPrimeira: new Date().toISOString().split('T')[0],
    totalEstadias: 0,
    diasTotais: 0,
    fidelizacao: 'bronze', // bronze, prata, ouro, platina
    descricaoGuest: ''
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

/* ---------- ligação (opcional) à Tesouraria/Contabilidade ----------
   Só usar quando quiseres registar manualmente um resumo de receita
   de hotelaria na tesouraria (ex.: sinal recebido, resumo de fecho).
   NÃO emite fatura — só cria um lançamento de resumo, tal como já
   fazes hoje com os resumos de caixa de outros setores.
   Requer que core.js esteja também incluído na página, e que a
   função adicionarLancamentoPartilhado exista nele. */
async function gerarLancamentoReceitaHotel(reserva, valor, descricao){
  if(typeof adicionarLancamentoPartilhado !== 'function'){
    toastHotel('Função de lançamento partilhado não disponível nesta página.');
    return {ok:false};
  }
  return await adicionarLancamentoPartilhado({
    id: uidHotel(),
    data: new Date().toISOString().slice(0,10),
    categoria: 'Hotelaria - Alojamento',
    descricao: `${descricao} - ${reserva.hospedeNome} (Qt.${reserva.quartoId})`,
    valor: valor,
    tipo: 'receita'
  });
}

/* ============================================================
   CONTA CORRENTE DO HÓSPEDE (FOLIO) — consumos, extras, sinais
   ============================================================ */

/* Adiciona um lançamento ao folio de uma reserva.
   tipo: 'consumo' | 'extra' | 'desconto' | 'sinal' | 'pagamento'
   Convenção: consumo/extra somam ao saldo devedor; desconto/sinal/pagamento reduzem. */
function adicionarFolioHotel(reservaId, {tipo, descricao, categoria='', valor, formaPagamento=''}){
  const item = {
    id: uidHotel(),
    reservaId,
    data: new Date().toISOString().slice(0,10),
    tipo,
    descricao,
    categoria,
    valor: Number(valor)||0,
    formaPagamento
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

/* Total consumido em Extras/Consumos (não inclui a diária da reserva) */
function totalExtrasFolioHotel(reservaId){
  return listarFolioReservaHotel(reservaId)
    .filter(f => f.tipo === 'consumo' || f.tipo === 'extra')
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
   adicionarLancamentoPartilhado (core.js), mantendo o registo em DBHotel.faturas.
   divisoes: [{ itens:[{descricao,valor}], formaPagamento, unidade }] */
async function gerarFaturasSplitHotel(reservaId, divisoes){
  const reserva = DBHotel.reservas.find(r => r.id === reservaId);
  if(!reserva) return {ok:false, msg:'Reserva não encontrada'};

  const geradas = [];
  for(const div of divisoes){
    const total = (div.itens||[]).reduce((s,i)=> s + (Number(i.valor)||0), 0);
    if(total <= 0) continue;
    const numero = `FL-${reserva.quartoId}-${Date.now().toString(36).slice(-5)}-${geradas.length+1}`;
    const fatura = {
      id: uidHotel(),
      reservaId,
      numero,
      itens: div.itens,
      total,
      formaPagamento: div.formaPagamento || 'Cash',
      dataEmissao: new Date().toISOString().slice(0,10),
      lancamentoId: null
    };

    if(typeof adicionarLancamentoPartilhado === 'function'){
      const desc = (div.itens||[]).map(i=>i.descricao).join(', ');
      const resultado = await adicionarLancamentoPartilhado({
        id: uidHotel(),
        data: fatura.dataEmissao,
        categoria: 'Hotelaria - Alojamento',
        descricao: `${fatura.numero} — ${reserva.hospedeNome} (Qt.${reserva.quartoId}): ${desc}`,
        valor: total,
        tipo: 'receita',
        formaPagamento: fatura.formaPagamento,
        unidade: div.unidade || 'ZOOM\'S LODGE'
      });
      fatura.lancamentoId = fatura.id;
      if(resultado && resultado.ok === false){
        toastHotel(`Aviso: fatura ${numero} registada localmente, mas o lançamento na Tesouraria falhou.`);
      }
    } else {
      toastHotel('Tesouraria (core.js) não está ligada — faturas guardadas só localmente.');
    }

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
    r.estado !== 'cancelada' &&
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

/* Chegadas e partidas previstas para uma data específica (default: hoje) */
function relatorioChegadasPartidasHotel(dataStr){
  const data = dataStr || new Date().toISOString().slice(0,10);
  const chegadas = DBHotel.reservas.filter(r => r.checkinPrevisto === data && r.estado !== 'cancelada');
  const partidas = DBHotel.reservas.filter(r => r.checkoutPrevisto === data && r.estado !== 'cancelada');
  return {data, chegadas, partidas};
}
