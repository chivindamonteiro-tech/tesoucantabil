/* ============================================================
   LOGISTICA-CORE.JS — Módulo independente de Logística (WMS + Frota)
   ============================================================
   Ficheiro próprio do departamento de Logística. NÃO mexe nos
   dados da Contabilidade/Tesouraria (core.js) nem da Hotelaria
   (hotel-core.js) — usa a mesma ligação Supabase, mas grava numa
   linha própria da tabela "logistica_data", para nunca entrar em
   conflito com o Tesoucantábil nem com o hotel.

   Todos os nomes aqui têm o sufixo "Log" para nunca colidirem
   com core.js/hotel-core.js, caso um dia fiquem incluídos na
   mesma página.

   Inclui no <head> do logistica.html, por esta ordem:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="logistica-core.js"></script>
   ============================================================ */

const SUPABASE_URL_LOG = "https://okwvzccirgxnpugypsgf.supabase.co";
const SUPABASE_ANON_KEY_LOG = "sb_publishable_pOtoNEKOi2nZaiZVqn2uhQ_WTwy5ctm";

const supaLog = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL_LOG, SUPABASE_ANON_KEY_LOG)
  : null;

/* ---------- utilidades genéricas ---------- */
function uidLog(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function hojeISOLog(){
  return new Date().toISOString().split('T')[0];
}

function diasEntreLog(dataISO1, dataISO2){
  const d1 = new Date(dataISO1 + 'T00:00:00');
  const d2 = new Date(dataISO2 + 'T00:00:00');
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function toastLog(msg, tipo='info'){
  let el = document.getElementById('toastBoxLog');
  if(!el){
    el = document.createElement('div');
    el.id = 'toastBoxLog';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#14232B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.opacity = '0'; }, 2500);
}

/* ============================================================
   ESQUEMA REAL DO NEGÓCIO
   ------------------------------------------------------------
   Estas constantes espelham as Unidades de Negócio REAIS já
   usadas no Tesoucantábil (contabilidade.html → UNIDADES_NEGOCIO)
   e na Hotelaria (hotel-core.js → UNIDADE_HOTEL), para que os
   armazéns e a frota da Logística fiquem ligados às mesmas
   unidades que já existem no resto do sistema — nada de
   "Restaurante"/"Loja"/"Lodge" genéricos que não existem na
   nossa operação real.
   ============================================================ */
const UNIDADES_NEGOCIO_LOG = [
  "ZOOM'S LODGE",
  "BAKERY LINE-MAIN STORE",
  "BAKERY LINE-CFM STORE",
  "BAKERY LINE-NEW STORE"
];

/* ---------- Armazéns por defeito ----------
   Estrutura real: 1 Armazém Central (recebe compras/fornecedores
   e abastece tudo), 1 Área de Produção (fábrica da Bakery Line —
   produz e consome matéria-prima vinda do Central), e 1 armazém
   por Unidade de Negócio (onde o stock fica disponível para venda
   depois de uma transferência a partir do Central ou da Produção). */
const ARMAZENS_DEFAULT_LOG = [
  {id:'central',  nome:'Armazém Central',                         tipo:'central',   unidade:null,                       localizacao:'Sede — Luanda'},
  {id:'producao', nome:'Área de Produção',                        tipo:'producao',  unidade:'BAKERY LINE',              localizacao:'Fábrica — Bakery Line'},
  {id:'zl',       nome:"Armazém — Zoom's Lodge",                  tipo:'unidade',   unidade:"ZOOM'S LODGE",             localizacao:"Zoom's Lodge"},
  {id:'bl-main',  nome:'Armazém — Bakery Line (Main Store)',      tipo:'unidade',   unidade:'BAKERY LINE-MAIN STORE',   localizacao:'Main Store'},
  {id:'bl-cfm',   nome:'Armazém — Bakery Line (CFM Store)',       tipo:'unidade',   unidade:'BAKERY LINE-CFM STORE',    localizacao:'CFM Store'},
  {id:'bl-new',   nome:'Armazém — Bakery Line (New Store)',       tipo:'unidade',   unidade:'BAKERY LINE-NEW STORE',    localizacao:'New Store'}
];

const TIPOS_ARMAZEM_LABEL_LOG = {
  central:  '🏭 Armazém Central',
  producao: '🥖 Área de Produção',
  unidade:  '🏬 Unidade de Negócio'
};

/* ---------- Frota: tipos de intervenção e documentação ---------- */
const TIPOS_INTERVENCAO_MANUTENCAO_LOG = [
  'Manutenção Preventiva', 'Manutenção Corretiva', 'Revisão Programada',
  'Troca de Pneus', 'Chapa e Pintura', 'Elétrica', 'Outra'
];

/* Intervalo padrão entre manutenções preventivas — usado para calcular
   a previsão da próxima, quando a viatura não tem um intervalo próprio
   definido no cadastro. */
const INTERVALO_PREVENTIVA_KM_DEFAULT_LOG = 10000;
const INTERVALO_PREVENTIVA_DIAS_DEFAULT_LOG = 180; // ~6 meses

/* Documentos obrigatórios para uma viatura circular legalmente em Angola,
   usados no cadastro para identificar o que cada viatura tem e alertar
   do que falta ou está a vencer. */
const DOCUMENTOS_OBRIGATORIOS_VIATURA_LOG = [
  'Livrete (DUA)',
  'Seguro Automóvel',
  'Inspeção Periódica (Vistoria)',
  'Selo / Imposto de Circulação',
  'Extintor (verificação)'
];

const DIAS_ALERTA_VALIDADE_DOCUMENTO_LOG = 30; // avisa 30 dias antes de vencer

/* ---------- estado dos dados de Logística ---------- */
let DBLogistica = {
  armazens: [],
  // armazens: [{id, nome, tipo:'central'|'producao'|'unidade', unidade, localizacao, ativo}]
  produtos: [],
  // produtos: [{id, nome, categoria, unidadeMedida, stockMinimo}]
  stock: [],
  // stock: [{armazemId, produtoId, quantidade}]
  movimentos: [],
  // movimentos: [{id, data, tipo:'entrada'|'saida'|'transferencia', armazemOrigemId, armazemDestinoId, produtoId, quantidade, responsavel, obs, criadoEm}]
  viaturas: [],
  // viaturas: [{id, marca, modelo, matricula, ano, tipoViatura, unidade, motoristaHabitual, estado, kmAtual,
  //   intervaloPreventivaKm, intervaloPreventivaDias,
  //   documentos: [{tipo, numero, validade, obs}], criadoEm}]
  manutencoes: []
  // manutencoes: [{id, viaturaId, data, tipoIntervencao, descricao, acessoriosTrocados, kmIntervencao,
  //   oficina, custo, previsaoProximaKm, previsaoProximaData, obs, criadoEm}]
};

let versaoLog = null;
let semColunaVersaoLog = false;

/* Carrega os dados de logistica_data (linha id="main"). Se a tabela/linha
   ainda não existir, cria-a com os valores padrão acima. */
async function carregarDadosLogistica(){
  if(!supaLog){ toastLog('Sem ligação ao Supabase.'); return; }
  try{
    let { data, error } = await supaLog.from('logistica_data').select('*').eq('id','main').maybeSingle();

    if(error && String(error.message||'').toLowerCase().includes('column')){
      semColunaVersaoLog = true;
      ({ data, error } = await supaLog.from('logistica_data').select('id,data').eq('id','main').maybeSingle());
    }
    if(error) throw error;

    if(!data){
      // primeira vez: cria a linha com os valores padrão
      const payload = { id:'main', data: DBLogistica };
      if(!semColunaVersaoLog) payload.versao = 1;
      const { error: errIns } = await supaLog.from('logistica_data').insert(payload);
      if(errIns) console.warn(errIns);
      versaoLog = 1;
      return;
    }

    DBLogistica = Object.assign({armazens:[],produtos:[],stock:[],movimentos:[],viaturas:[],manutencoes:[]}, data.data || {});
    if(!DBLogistica.armazens) DBLogistica.armazens = [];
    if(!DBLogistica.produtos) DBLogistica.produtos = [];
    if(!DBLogistica.stock) DBLogistica.stock = [];
    if(!DBLogistica.movimentos) DBLogistica.movimentos = [];
    if(!DBLogistica.viaturas) DBLogistica.viaturas = [];
    if(!DBLogistica.manutencoes) DBLogistica.manutencoes = [];
    versaoLog = data.versao || 1;
  }catch(e){
    console.warn('Erro ao carregar dados de logística:', e);
    toastLog('Não consegui carregar os dados da logística — a usar valores locais.');
  }
}

/* Grava DBLogistica inteiro em logistica_data, com bloqueio otimista
   (igual ao padrão usado no core.js / hotel-core.js), tentando de novo
   automaticamente se houver conflito de versão. */
async function saveDBLogistica(tentativas = 3){
  if(!supaLog){ toastLog('Sem ligação ao Supabase — alterações só ficam localmente.'); return {ok:false}; }
  try{
    if(semColunaVersaoLog){
      const { error } = await supaLog.from('logistica_data').update({data: DBLogistica}).eq('id','main');
      if(error) throw error;
      return {ok:true};
    }

    const versaoEsperada = versaoLog;
    const novaVersao = versaoEsperada + 1;
    const { data: dataUpd, error: errUpd } = await supaLog
      .from('logistica_data')
      .update({data: DBLogistica, versao: novaVersao, updated_at: new Date().toISOString()})
      .eq('id','main').eq('versao', versaoEsperada)
      .select();

    if(errUpd){
      console.warn(errUpd);
      toastLog('Não foi possível guardar. Tenta novamente.');
      return {ok:false};
    }
    if(dataUpd && dataUpd.length){
      versaoLog = novaVersao;
      return {ok:true};
    }

    // conflito: outra pessoa gravou entretanto — recarrega e tenta de novo
    if(tentativas > 0){
      const dbLocal = DBLogistica;
      await carregarDadosLogistica();
      DBLogistica = dbLocal; // mantém as alterações locais por cima dos dados recarregados
      return await saveDBLogistica(tentativas - 1);
    }
    toastLog('Conflito ao guardar — tenta novamente.');
    return {ok:false};
  }catch(e){
    console.warn(e);
    toastLog('Erro ao guardar dados da logística.');
    return {ok:false};
  }
}

/* Seed automático dos 6 armazéns reais na primeira carga */
async function autoSeedArmazensLogistica(){
  let mudou = false;
  ARMAZENS_DEFAULT_LOG.forEach(a=>{
    if(!DBLogistica.armazens.some(x=>x.id===a.id)){
      DBLogistica.armazens.push({...a, ativo:true});
      mudou = true;
    }
  });
  if(mudou){
    await saveDBLogistica();
    console.log('🏗️ Primeira carga: armazéns por defeito criados (Central, Área de Produção + 1 por Unidade de Negócio).');
  }
}

/* ============================================================
   ARMAZÉNS / STOCK / TRANSFERÊNCIAS
   ============================================================ */
function getArmazemLog(id){
  return DBLogistica.armazens.find(a=>a.id===id);
}

function getStockLog(armazemId, produtoId){
  const s = DBLogistica.stock.find(x=>x.armazemId===armazemId && x.produtoId===produtoId);
  return s ? s.quantidade : 0;
}

function ajustarStockLog(armazemId, produtoId, delta){
  let s = DBLogistica.stock.find(x=>x.armazemId===armazemId && x.produtoId===produtoId);
  if(!s){
    s = {armazemId, produtoId, quantidade:0};
    DBLogistica.stock.push(s);
  }
  s.quantidade = Math.round((s.quantidade + delta) * 1000) / 1000;
}

/* Regista um movimento de stock: entrada (compra/produção), saída
   (consumo/quebra) ou transferência entre armazéns (ex.: Central →
   Unidade de Negócio, ou Área de Produção → Unidade de Negócio). */
async function registarMovimentoLog({tipo, armazemOrigemId, armazemDestinoId, produtoId, quantidade, responsavel, obs}){
  quantidade = Number(quantidade);
  if(!quantidade || quantidade <= 0) return {ok:false, msg:'Quantidade inválida.'};
  if(!produtoId) return {ok:false, msg:'Selecione um produto.'};

  if(tipo === 'saida' || tipo === 'transferencia'){
    if(!armazemOrigemId) return {ok:false, msg:'Selecione o armazém de origem.'};
    const disponivel = getStockLog(armazemOrigemId, produtoId);
    if(disponivel < quantidade){
      return {ok:false, msg:`Stock insuficiente no armazém de origem (disponível: ${disponivel}).`};
    }
  }
  if(tipo === 'transferencia' && armazemOrigemId === armazemDestinoId){
    return {ok:false, msg:'Origem e destino não podem ser o mesmo armazém.'};
  }

  if(tipo === 'entrada'){
    ajustarStockLog(armazemDestinoId, produtoId, quantidade);
  }else if(tipo === 'saida'){
    ajustarStockLog(armazemOrigemId, produtoId, -quantidade);
  }else if(tipo === 'transferencia'){
    ajustarStockLog(armazemOrigemId, produtoId, -quantidade);
    ajustarStockLog(armazemDestinoId, produtoId, quantidade);
  }

  DBLogistica.movimentos.push({
    id: uidLog(), data: hojeISOLog(), tipo,
    armazemOrigemId: armazemOrigemId || null,
    armazemDestinoId: armazemDestinoId || null,
    produtoId, quantidade, responsavel: responsavel || '', obs: obs || '',
    criadoEm: new Date().toISOString()
  });

  await saveDBLogistica();
  return {ok:true};
}

/* Produtos abaixo do stock mínimo, por armazém — alimenta o alerta de
   Compras Inteligentes / reabastecimento a partir do Central. */
function produtosAbaixoMinimoLog(){
  const alertas = [];
  DBLogistica.produtos.forEach(p=>{
    if(!p.stockMinimo) return;
    DBLogistica.armazens.forEach(a=>{
      const qtd = getStockLog(a.id, p.id);
      if(qtd < p.stockMinimo){
        alertas.push({armazem:a, produto:p, quantidade:qtd, falta: p.stockMinimo - qtd});
      }
    });
  });
  return alertas;
}

/* ============================================================
   FROTA — MANUTENÇÃO
   ============================================================ */
function getViaturaLog(id){
  return DBLogistica.viaturas.find(v=>v.id===id);
}

function manutencoesDaViaturaLog(viaturaId){
  return DBLogistica.manutencoes
    .filter(m=>m.viaturaId===viaturaId)
    .sort((a,b)=> new Date(b.data) - new Date(a.data));
}

function ultimaPreventivaLog(viaturaId){
  return manutencoesDaViaturaLog(viaturaId).find(m=>m.tipoIntervencao === 'Manutenção Preventiva') || null;
}

/* Regista uma manutenção. Para Preventiva, calcula automaticamente a
   previsão da próxima (por km percorridos e por data), usando o
   intervalo próprio da viatura ou o intervalo padrão. Também atualiza
   o km atual da viatura (nunca deixa recuar o odómetro). */
async function registarManutencaoLog(dados){
  const viatura = getViaturaLog(dados.viaturaId);
  if(!viatura) return {ok:false, msg:'Viatura não encontrada.'};
  if(!dados.data) return {ok:false, msg:'Indique a data da intervenção.'};
  const km = Number(dados.kmIntervencao);
  if(!km && km !== 0) return {ok:false, msg:'Indique a quilometragem no dia da intervenção.'};

  const registo = {
    id: uidLog(),
    viaturaId: dados.viaturaId,
    data: dados.data,
    tipoIntervencao: dados.tipoIntervencao,
    descricao: dados.descricao || '',
    acessoriosTrocados: dados.acessoriosTrocados || '',
    kmIntervencao: km,
    oficina: dados.oficina || '',
    custo: Number(dados.custo) || 0,
    previsaoProximaKm: null,
    previsaoProximaData: null,
    obs: dados.obs || '',
    criadoEm: new Date().toISOString()
  };

  if(dados.tipoIntervencao === 'Manutenção Preventiva'){
    const intervaloKm = Number(viatura.intervaloPreventivaKm) || INTERVALO_PREVENTIVA_KM_DEFAULT_LOG;
    const intervaloDias = Number(viatura.intervaloPreventivaDias) || INTERVALO_PREVENTIVA_DIAS_DEFAULT_LOG;
    registo.previsaoProximaKm = km + intervaloKm;
    const dProx = new Date(dados.data + 'T00:00:00');
    dProx.setDate(dProx.getDate() + intervaloDias);
    registo.previsaoProximaData = dProx.toISOString().split('T')[0];
  }

  DBLogistica.manutencoes.push(registo);

  if(!viatura.kmAtual || km > viatura.kmAtual) viatura.kmAtual = km;
  if(viatura.estado === 'Manutenção' && dados.concluida) viatura.estado = 'Disponível';

  await saveDBLogistica();
  return {ok:true};
}

/* Previsão ativa da próxima manutenção preventiva de uma viatura,
   a partir do registo preventivo mais recente. */
function previsaoProximaPreventivaLog(viaturaId){
  const ultima = ultimaPreventivaLog(viaturaId);
  if(!ultima || !ultima.previsaoProximaData) return null;
  const viatura = getViaturaLog(viaturaId);
  const kmFalta = viatura && viatura.kmAtual != null ? ultima.previsaoProximaKm - viatura.kmAtual : null;
  const diasFalta = diasEntreLog(hojeISOLog(), ultima.previsaoProximaData);
  return {
    previsaoKm: ultima.previsaoProximaKm,
    previsaoData: ultima.previsaoProximaData,
    kmFalta, diasFalta,
    vencida: diasFalta < 0 || (kmFalta != null && kmFalta < 0)
  };
}

/* ============================================================
   FROTA — DOCUMENTOS (cadastro, validade e alertas)
   ============================================================ */
/* Estado de um documento de viatura: 'em_falta' (nunca cadastrado),
   'sem_validade' (cadastrado mas sem data de validade), 'vencido',
   'a_vencer' (dentro da janela de alerta) ou 'valido'. */
function statusDocumentoLog(doc){
  if(!doc) return {estado:'em_falta', diasRestantes:null};
  if(!doc.validade) return {estado:'sem_validade', diasRestantes:null};
  const dias = diasEntreLog(hojeISOLog(), doc.validade);
  if(dias < 0) return {estado:'vencido', diasRestantes:dias};
  if(dias <= DIAS_ALERTA_VALIDADE_DOCUMENTO_LOG) return {estado:'a_vencer', diasRestantes:dias};
  return {estado:'valido', diasRestantes:dias};
}

/* Garante que TODOS os documentos obrigatórios estão avaliados para
   uma viatura — os que não existirem no cadastro entram como "em falta".
   É isto que garante o controlo completo pedido: nenhum documento
   necessário fica de fora da verificação. */
function checklistDocumentosViaturaLog(viatura){
  return DOCUMENTOS_OBRIGATORIOS_VIATURA_LOG.map(tipo=>{
    const doc = (viatura.documentos||[]).find(d=>d.tipo===tipo);
    return {tipo, doc: doc||null, ...statusDocumentoLog(doc)};
  });
}

/* Alertas consolidados de toda a frota: documentos em falta/vencidos/a
   vencer + manutenções preventivas vencidas ou próximas. Usado no
   Dashboard e na vista de Alertas. */
function alertasFrotaLog(){
  const alertas = [];
  DBLogistica.viaturas.forEach(v=>{
    checklistDocumentosViaturaLog(v).forEach(c=>{
      if(c.estado === 'em_falta' || c.estado === 'vencido' || c.estado === 'a_vencer' || c.estado === 'sem_validade'){
        alertas.push({viatura:v, tipo:'documento', documento:c.tipo, estado:c.estado, diasRestantes:c.diasRestantes});
      }
    });
    const prev = previsaoProximaPreventivaLog(v.id);
    if(prev && (prev.vencida || (prev.diasFalta != null && prev.diasFalta <= DIAS_ALERTA_VALIDADE_DOCUMENTO_LOG))){
      alertas.push({viatura:v, tipo:'manutencao', estado: prev.vencida ? 'vencida' : 'a_vencer', previsao:prev});
    }
  });
  return alertas;
}
