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
    {id:'direto', nome:'Direto', comissao:0},
    {id:'booking', nome:'Booking.com', comissao:15},
    {id:'agencia', nome:'Agência', comissao:20}
  ],
  cupons: [
    // {id, codigo, desconto%, dataExp, usos_max, usos_atuais}
  ],
  hospedes: [],
  estadias: []
  // hospedes: [{id, nome, documento, contacto, email, morada, pais, notas, dataPrimeira, totalEstadias, fidelizacao}]
  // estadias: [{id, hospedeId, checkinReal, checkoutReal, quartoId, taxaRef, notas, faturaRef}]
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

    DBHotel = Object.assign({tiposQuarto:[],quartos:[],reservas:[],bloqueios:[]}, data.data || {});
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
