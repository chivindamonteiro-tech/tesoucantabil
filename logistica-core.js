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
  manutencoes: [],
  // manutencoes: [{id, viaturaId, data, tipoIntervencao, descricao, acessoriosTrocados, kmIntervencao,
  //   oficina, custo, previsaoProximaKm, previsaoProximaData, obs, criadoEm}]
  lotes: [],
  // lotes: [{id, armazemId, produtoId, lote, validade, quantidade, localizacao, criadoEm}]
  // localizacao = texto livre "Zona/Corredor/Posição" (ex.: "A/03/02"), para localização exata do produto
  recepcoes: [],
  // recepcoes: [{id, data, armazemId, fornecedor, numeroGuia, conferido, itens:[{produtoId,quantidade,lote,validade,localizacao}], obs, criadoEm}]
  reservas: [],
  // reservas: [{id, armazemId, produtoId, quantidade, motivo, data, criadoEm}]
  pickings: [],
  // pickings: [{id, armazemId, referencia, responsavel, data, status:'pendente'|'concluida',
  //   itens:[{produtoId, quantidadePedida, quantidadeSeparada, loteSugerido, localizacao, separado}],
  //   expedicaoId, criadoEm, concluidoEm}]
  embalagens: [],
  // embalagens: [{id, nome, tipo, capacidade, unidadeMedida, criadoEm}]
  expedicoes: [],
  // expedicoes: [{id, data, armazemOrigemId, destino, transportadora, viaturaId, motoristaId,
  //   pickingIds:[...], unidadesLogisticas:[{id, embalagemId, itens:[{produtoId,quantidade}], etiqueta}],
  //   conferido, custoTransporte, status:'planeada'|'em_transito'|'entregue',
  //   dataSaida, dataEntregaReal, confirmadoPor, obs, criadoEm}]
  motoristas: [],
  // motoristas: [{id, nome, contacto, numeroCarta, validadeCarta, ativo, criadoEm}]
  abastecimentos: [],
  // abastecimentos: [{id, viaturaId, data, litros, custo, kmAbastecimento, posto, obs, criadoEm}]
  kits: [],
  // kits: [{id, produtoFinalId, nome, itens:[{produtoId, quantidadeNecessaria}], criadoEm}]
  // (quantidadeNecessaria = quantidade de matéria-prima por 1 unidade do produto final)
  ordensProducao: [],
  // ordensProducao: [{id, data, kitId, produtoFinalId, armazemProducaoId, operadorId,
  //   quantidadeProduzida, itensConsumidos:[{produtoId, quantidadePrevista, quantidadeReal, lotesConsumidos:[{loteId,lote,quantidade}]}],
  //   desperdicios:[{produtoId, quantidade, motivo}], loteProduzido, obs, criadoEm}]
  operadores: [],
  // operadores: [{id, nome, contacto, turno, metaDiariaPicking, ativo, criadoEm}]
  configuracoes: {webhookStockBaixo:'', webhookLoteVencendo:''}
  // configuracoes.webhook* = endpoint HTTP neutro (qualquer serviço que aceite POST JSON:
  // Zapier, Make, n8n, endpoint próprio...) para onde o sistema notifica alertas.
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

    DBLogistica = Object.assign({armazens:[],produtos:[],stock:[],movimentos:[],viaturas:[],manutencoes:[],lotes:[],recepcoes:[],reservas:[],pickings:[],embalagens:[],expedicoes:[],motoristas:[],abastecimentos:[],kits:[],ordensProducao:[],operadores:[],configuracoes:{webhookStockBaixo:'',webhookLoteVencendo:''}}, data.data || {});
    if(!DBLogistica.armazens) DBLogistica.armazens = [];
    if(!DBLogistica.produtos) DBLogistica.produtos = [];
    if(!DBLogistica.stock) DBLogistica.stock = [];
    if(!DBLogistica.movimentos) DBLogistica.movimentos = [];
    if(!DBLogistica.viaturas) DBLogistica.viaturas = [];
    if(!DBLogistica.manutencoes) DBLogistica.manutencoes = [];
    if(!DBLogistica.lotes) DBLogistica.lotes = [];
    if(!DBLogistica.recepcoes) DBLogistica.recepcoes = [];
    if(!DBLogistica.reservas) DBLogistica.reservas = [];
    if(!DBLogistica.pickings) DBLogistica.pickings = [];
    if(!DBLogistica.embalagens) DBLogistica.embalagens = [];
    if(!DBLogistica.expedicoes) DBLogistica.expedicoes = [];
    if(!DBLogistica.motoristas) DBLogistica.motoristas = [];
    if(!DBLogistica.abastecimentos) DBLogistica.abastecimentos = [];
    if(!DBLogistica.kits) DBLogistica.kits = [];
    if(!DBLogistica.ordensProducao) DBLogistica.ordensProducao = [];
    if(!DBLogistica.operadores) DBLogistica.operadores = [];
    if(!DBLogistica.configuracoes) DBLogistica.configuracoes = {webhookStockBaixo:'', webhookLoteVencendo:''};
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
async function registarMovimentoLog({tipo, armazemOrigemId, armazemDestinoId, produtoId, quantidade, responsavel, obs, lote, validade, localizacao}){
  quantidade = Number(quantidade);
  if(!quantidade || quantidade <= 0) return {ok:false, msg:'Quantidade inválida.'};
  if(!produtoId) return {ok:false, msg:'Selecione um produto.'};

  if(tipo === 'saida' || tipo === 'transferencia'){
    if(!armazemOrigemId) return {ok:false, msg:'Selecione o armazém de origem.'};
    const disponivel = getDisponivelLog(armazemOrigemId, produtoId);
    if(disponivel < quantidade){
      return {ok:false, msg:`Stock disponível insuficiente no armazém de origem (disponível: ${disponivel}, pode haver stock reservado).`};
    }
  }
  if(tipo === 'transferencia' && armazemOrigemId === armazemDestinoId){
    return {ok:false, msg:'Origem e destino não podem ser o mesmo armazém.'};
  }

  if(tipo === 'entrada'){
    ajustarStockLog(armazemDestinoId, produtoId, quantidade);
    if(lote || validade || localizacao){
      registarLoteLog({armazemId: armazemDestinoId, produtoId, lote, validade, quantidade, localizacao});
    }
  }else if(tipo === 'saida'){
    ajustarStockLog(armazemOrigemId, produtoId, -quantidade);
    baixarLoteFEFOLog(armazemOrigemId, produtoId, quantidade);
  }else if(tipo === 'transferencia'){
    ajustarStockLog(armazemOrigemId, produtoId, -quantidade);
    baixarLoteFEFOLog(armazemOrigemId, produtoId, quantidade);
    ajustarStockLog(armazemDestinoId, produtoId, quantidade);
    if(lote || validade || localizacao){
      registarLoteLog({armazemId: armazemDestinoId, produtoId, lote, validade, quantidade, localizacao});
    }
  }

  DBLogistica.movimentos.push({
    id: uidLog(), data: hojeISOLog(), tipo,
    armazemOrigemId: armazemOrigemId || null,
    armazemDestinoId: armazemDestinoId || null,
    produtoId, quantidade, responsavel: responsavel || '', obs: obs || '',
    criadoEm: new Date().toISOString()
  });

  await saveDBLogistica();
  verificarEDispararAlertasIoTLog(); // best-effort, não bloqueia a resposta ao utilizador
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
   LOTES, VALIDADE E LOCALIZAÇÃO EXATA
   ------------------------------------------------------------
   Um produto pode ter vários lotes no mesmo armazém (datas de
   validade diferentes) e cada lote pode ter a sua localização
   exata (zona/corredor/posição). O stock agregado (DBLogistica.stock,
   via getStockLog) continua a ser a fonte da quantidade total —
   os lotes são o detalhe usado para rastreabilidade e alertas de
   validade, e para saber onde ir buscar fisicamente o produto.
   ============================================================ */
const DIAS_ALERTA_VALIDADE_LOTE_LOG = 15; // avisa 15 dias antes do lote vencer

function lotesDoProdutoLog(armazemId, produtoId, estrategia){
  estrategia = estrategia || getEstrategiaSaidaProdutoLog(produtoId);
  const lotes = DBLogistica.lotes.filter(l=>l.armazemId===armazemId && l.produtoId===produtoId && l.quantidade > 0);
  if(estrategia === 'FIFO'){
    return lotes.sort((a,b)=> new Date(a.criadoEm) - new Date(b.criadoEm));
  }
  // FEFO (default): primeiro a vencer, primeiro a sair — sem validade vai para o fim
  return lotes.sort((a,b)=> (a.validade||'9999-99-99').localeCompare(b.validade||'9999-99-99'));
}

function getEstrategiaSaidaProdutoLog(produtoId){
  const p = DBLogistica.produtos.find(x=>x.id===produtoId);
  return (p && p.estrategiaSaida) || 'FEFO';
}

/* Regista entrada num lote (cria o lote se não existir, ou soma
   quantidade se já existir o mesmo lote+validade+localização). */
function registarLoteLog({armazemId, produtoId, lote, validade, quantidade, localizacao}){
  quantidade = Number(quantidade) || 0;
  if(!armazemId || !produtoId || !quantidade) return;
  let l = DBLogistica.lotes.find(x=>x.armazemId===armazemId && x.produtoId===produtoId &&
    (x.lote||'') === (lote||'') && (x.validade||'') === (validade||''));
  if(!l){
    l = {id: uidLog(), armazemId, produtoId, lote: lote||'', validade: validade||null,
         quantidade: 0, localizacao: localizacao||'', criadoEm: new Date().toISOString()};
    DBLogistica.lotes.push(l);
  }
  l.quantidade = Math.round((l.quantidade + quantidade) * 1000) / 1000;
  if(localizacao) l.localizacao = localizacao;
}

/* Baixa quantidade de lote(s) de um produto/armazém seguindo a
   estratégia de saída do produto: FEFO (First Expired, First Out —
   consome primeiro quem vence primeiro) ou FIFO (First In, First
   Out — consome primeiro o lote mais antigo). Usado nas saídas/
   transferências e na conclusão de picking. */
function baixarLoteEstrategiaLog(armazemId, produtoId, quantidade){
  let falta = Number(quantidade) || 0;
  const lotes = lotesDoProdutoLog(armazemId, produtoId);
  for(const l of lotes){
    if(falta <= 0) break;
    const consumo = Math.min(l.quantidade, falta);
    l.quantidade = Math.round((l.quantidade - consumo) * 1000) / 1000;
    falta = Math.round((falta - consumo) * 1000) / 1000;
  }
}
// nome antigo mantido como alias, para não partir chamadas já existentes
const baixarLoteFEFOLog = baixarLoteEstrategiaLog;

function statusValidadeLoteLog(validade){
  if(!validade) return {estado:'sem_validade', diasRestantes:null};
  const dias = diasEntreLog(hojeISOLog(), validade);
  if(dias < 0) return {estado:'vencido', diasRestantes:dias};
  if(dias <= DIAS_ALERTA_VALIDADE_LOTE_LOG) return {estado:'a_vencer', diasRestantes:dias};
  return {estado:'valido', diasRestantes:dias};
}

/* Lotes vencidos ou perto de vencer, em todos os armazéns — alimenta os Alertas. */
function lotesAVencerLog(){
  return DBLogistica.lotes
    .filter(l=>l.quantidade > 0 && l.validade)
    .map(l=>({lote:l, ...statusValidadeLoteLog(l.validade)}))
    .filter(x=>x.estado==='vencido' || x.estado==='a_vencer')
    .sort((a,b)=> (a.diasRestantes??0) - (b.diasRestantes??0));
}

/* ============================================================
   STOCK RESERVADO / DISPONÍVEL
   ------------------------------------------------------------
   Uma reserva "trava" parte do stock (ex.: já vendido/alocado
   mas ainda não retirado fisicamente), sem mexer na quantidade
   física registada em DBLogistica.stock.
   ============================================================ */
function getReservadoLog(armazemId, produtoId){
  return DBLogistica.reservas
    .filter(r=>r.armazemId===armazemId && r.produtoId===produtoId)
    .reduce((s,r)=> s + Number(r.quantidade||0), 0);
}

function getDisponivelLog(armazemId, produtoId){
  return Math.round((getStockLog(armazemId, produtoId) - getReservadoLog(armazemId, produtoId)) * 1000) / 1000;
}

async function registarReservaLog({armazemId, produtoId, quantidade, motivo}){
  quantidade = Number(quantidade);
  if(!quantidade || quantidade <= 0) return {ok:false, msg:'Quantidade inválida.'};
  if(quantidade > getDisponivelLog(armazemId, produtoId)) return {ok:false, msg:'Quantidade acima do stock disponível.'};
  DBLogistica.reservas.push({id: uidLog(), armazemId, produtoId, quantidade, motivo: motivo||'', data: hojeISOLog(), criadoEm: new Date().toISOString()});
  await saveDBLogistica();
  return {ok:true};
}

async function libertarReservaLog(reservaId){
  DBLogistica.reservas = DBLogistica.reservas.filter(r=>r.id!==reservaId);
  await saveDBLogistica();
  return {ok:true};
}

/* ============================================================
   RECEÇÃO DE MERCADORIAS (INBOUND)
   ------------------------------------------------------------
   Regista a chegada de mercadoria de um fornecedor a um armazém:
   conferência (fornecedor, nº guia/fatura), e por cada item —
   quantidade, lote, validade e localização de arrumação. Cada
   item gera automaticamente um movimento de entrada (mantendo o
   histórico de Transferências consistente) e, se tiver lote,
   entra também em DBLogistica.lotes com a sua localização exata.
   ============================================================ */
async function registarRecepcaoLog({armazemId, fornecedor, numeroGuia, data, itens, conferido, operadorId, obs}){
  if(!armazemId) return {ok:false, msg:'Selecione o armazém de destino.'};
  if(!itens || !itens.length) return {ok:false, msg:'Adicione pelo menos um item à receção.'};

  for(const it of itens){
    const qtd = Number(it.quantidade);
    if(!it.produtoId || !qtd || qtd <= 0) return {ok:false, msg:'Cada item precisa de produto e quantidade válida.'};
  }

  const itensRegistados = itens.map(it=>({
    produtoId: it.produtoId, quantidade: Number(it.quantidade),
    lote: it.lote||'', validade: it.validade||null, localizacao: it.localizacao||''
  }));

  itensRegistados.forEach(it=>{
    ajustarStockLog(armazemId, it.produtoId, it.quantidade);
    if(it.lote || it.validade || it.localizacao){
      registarLoteLog({armazemId, produtoId: it.produtoId, lote: it.lote, validade: it.validade,
        quantidade: it.quantidade, localizacao: it.localizacao});
    }
    DBLogistica.movimentos.push({
      id: uidLog(), data: data || hojeISOLog(), tipo:'entrada',
      armazemOrigemId: null, armazemDestinoId: armazemId,
      produtoId: it.produtoId, quantidade: it.quantidade,
      responsavel: fornecedor||'', obs: `Receção${numeroGuia?' — Guia '+numeroGuia:''}`,
      criadoEm: new Date().toISOString()
    });
  });

  DBLogistica.recepcoes.push({
    id: uidLog(), data: data || hojeISOLog(), armazemId, fornecedor: fornecedor||'',
    numeroGuia: numeroGuia||'', conferido: !!conferido, itens: itensRegistados, obs: obs||'',
    operadorId: operadorId||null, criadoEm: new Date().toISOString()
  });

  await saveDBLogistica();
  return {ok:true};
}

/* ============================================================
   4. ARMAZENAMENTO INTELIGENTE
   ------------------------------------------------------------
   Sugestão automática de localização, organização por categoria/
   velocidade de venda, e reposição automática entre armazéns.
   (Estratégia FIFO/FEFO por produto já implementada acima.)
   ============================================================ */

/* Sugere uma localização para arrumar um produto: primeiro olha
   para onde esse mesmo produto já está guardado nesse armazém;
   se for a primeira vez, olha para outros produtos da mesma
   categoria no armazém e sugere a mesma zona (organização por
   categoria). Devolve null se não houver nenhuma pista. */
function sugerirLocalizacaoLog(armazemId, produtoId){
  const lotesProduto = DBLogistica.lotes.filter(l=>l.armazemId===armazemId && l.produtoId===produtoId && l.localizacao);
  if(lotesProduto.length){
    const contagem = {};
    lotesProduto.forEach(l=> contagem[l.localizacao] = (contagem[l.localizacao]||0)+1);
    return Object.entries(contagem).sort((a,b)=>b[1]-a[1])[0][0];
  }
  const produto = DBLogistica.produtos.find(p=>p.id===produtoId);
  if(produto && produto.categoria){
    const idsCategoria = DBLogistica.produtos.filter(p=>p.categoria===produto.categoria).map(p=>p.id);
    const lotesCategoria = DBLogistica.lotes.filter(l=>l.armazemId===armazemId && idsCategoria.includes(l.produtoId) && l.localizacao);
    if(lotesCategoria.length){
      const zona = lotesCategoria[0].localizacao.split('/')[0];
      return zona + ' (zona da categoria "' + produto.categoria + '")';
    }
  }
  return null;
}

/* Curva ABC por velocidade de venda/consumo: soma as quantidades
   saídas (saída + transferência a partir do armazém) de cada
   produto e classifica em A (mais rápidos, ~80% do volume),
   B (~15%) e C (~5% restantes, giro lento). */
function curvaABCLog(){
  const totais = {};
  DBLogistica.movimentos.forEach(m=>{
    if(m.tipo === 'saida' || m.tipo === 'transferencia'){
      totais[m.produtoId] = (totais[m.produtoId]||0) + Number(m.quantidade||0);
    }
  });
  const linhas = DBLogistica.produtos.map(p=>({produto:p, total: totais[p.id]||0}))
    .sort((a,b)=> b.total - a.total);
  const somaTotal = linhas.reduce((s,l)=>s+l.total,0);
  let acumulado = 0;
  return linhas.map(l=>{
    acumulado += l.total;
    const pct = somaTotal ? (acumulado/somaTotal*100) : 0;
    const classe = l.total===0 ? '—' : pct<=80 ? 'A' : pct<=95 ? 'B' : 'C';
    return {...l, classe};
  });
}

/* Sugestões de reposição automática: para cada produto abaixo do
   stock mínimo numa Unidade de Negócio, sugere transferir a falta
   a partir do Armazém Central (ou Área de Produção, se o Central
   não tiver disponível), limitado ao que está disponível. */
function sugestoesReposicaoLog(){
  const sugestoes = [];
  produtosAbaixoMinimoLog().forEach(a=>{
    if(a.armazem.tipo !== 'unidade') return; // só repõe unidades de venda
    const origens = DBLogistica.armazens.filter(x=>x.tipo==='central' || x.tipo==='producao');
    for(const origem of origens){
      const disponivelOrigem = getDisponivelLog(origem.id, a.produto.id);
      if(disponivelOrigem > 0){
        sugestoes.push({
          armazemOrigem: origem, armazemDestino: a.armazem, produto: a.produto,
          quantidadeSugerida: Math.min(a.falta, disponivelOrigem)
        });
        break;
      }
    }
  });
  return sugestoes;
}

/* Produtos/lotes sem localização definida — para priorizar a
   organização física do armazém (otimização de espaço). */
function lotesSemLocalizacaoLog(){
  return DBLogistica.lotes.filter(l=>l.quantidade>0 && !l.localizacao);
}

/* ============================================================
   5. SEPARAÇÃO DE PRODUTOS (PICKING)
   ------------------------------------------------------------
   Lista de separação por encomenda: picking manual, com sugestão
   automática de lote (respeitando a estratégia FIFO/FEFO do
   produto) e ordenação dos itens por localização (picking por
   zona), para reduzir erros e otimizar o percurso no armazém.
   Wave picking (várias encomendas em simultâneo), picking por voz
   e picking com dispositivos/realidade aumentada dependem de
   hardware dedicado e ficam fora do âmbito deste sistema web.
   ============================================================ */
function criarPickingLog({armazemId, referencia, responsavel, operadorId, itens}){
  if(!armazemId) return {ok:false, msg:'Selecione o armazém.'};
  if(!itens || !itens.length) return {ok:false, msg:'Adicione pelo menos um item à separação.'};
  if(!operadorId){
    const sugerido = sugerirOperadorLog();
    if(sugerido) operadorId = sugerido.id;
  }

  const itensPicking = itens.map(it=>{
    const lotes = lotesDoProdutoLog(armazemId, it.produtoId);
    const loteSugerido = lotes.length ? lotes[0] : null;
    return {
      produtoId: it.produtoId,
      quantidadePedida: Number(it.quantidade),
      quantidadeSeparada: 0,
      loteSugerido: loteSugerido ? loteSugerido.lote : '',
      localizacao: loteSugerido ? loteSugerido.localizacao : (sugerirLocalizacaoLog(armazemId, it.produtoId) || ''),
      separado: false
    };
  }).sort((a,b)=> (a.localizacao||'zzz').localeCompare(b.localizacao||'zzz')); // picking por zona: ordena pelo percurso

  const picking = {
    id: uidLog(), armazemId, referencia: referencia||'', responsavel: responsavel||'', operadorId: operadorId||null,
    data: hojeISOLog(), status: 'pendente', itens: itensPicking, criadoEm: new Date().toISOString()
  };
  DBLogistica.pickings = DBLogistica.pickings || [];
  DBLogistica.pickings.push(picking);
  return {ok:true, picking};
}

function getPickingLog(id){
  return (DBLogistica.pickings||[]).find(p=>p.id===id);
}

/* Marca um item da lista como separado fisicamente (picking manual,
   confirmação item a item — reduz erros humanos). Não mexe em stock
   ainda; o stock só é baixado quando a separação é concluída. */
function marcarItemSeparadoLog(pickingId, produtoId, separado){
  const picking = getPickingLog(pickingId);
  if(!picking) return {ok:false, msg:'Lista de separação não encontrada.'};
  const item = picking.itens.find(i=>i.produtoId===produtoId);
  if(!item) return {ok:false, msg:'Item não encontrado.'};
  item.separado = separado;
  item.quantidadeSeparada = separado ? item.quantidadePedida : 0;
  return {ok:true};
}

/* Conclui a separação: baixa o stock (armazém → saída, seguindo a
   estratégia FIFO/FEFO do produto) de todos os itens marcados como
   separados, e regista o movimento com referência à encomenda. */
async function concluirPickingLog(pickingId){
  const picking = getPickingLog(pickingId);
  if(!picking) return {ok:false, msg:'Lista de separação não encontrada.'};
  const pendentes = picking.itens.filter(i=>!i.separado);
  if(pendentes.length) return {ok:false, msg:`Ainda há ${pendentes.length} item(ns) por confirmar como separado(s).`};

  picking.itens.forEach(it=>{
    ajustarStockLog(picking.armazemId, it.produtoId, -it.quantidadeSeparada);
    baixarLoteEstrategiaLog(picking.armazemId, it.produtoId, it.quantidadeSeparada);
    DBLogistica.movimentos.push({
      id: uidLog(), data: hojeISOLog(), tipo:'saida',
      armazemOrigemId: picking.armazemId, armazemDestinoId: null,
      produtoId: it.produtoId, quantidade: it.quantidadeSeparada,
      responsavel: picking.responsavel||'', obs: `Picking${picking.referencia?' — Encomenda '+picking.referencia:''}`,
      criadoEm: new Date().toISOString()
    });
  });
  picking.status = 'concluida';
  picking.concluidoEm = new Date().toISOString();
  await saveDBLogistica();
  verificarEDispararAlertasIoTLog();
  return {ok:true};
}

/* ============================================================
   6. EMBALAGEM E EXPEDIÇÃO
   ------------------------------------------------------------
   Depois de uma (ou várias) lista(s) de picking concluída(s),
   consolidam-se numa Expedição: agrupa os itens numa unidade
   logística (com etiqueta de transporte), passa por conferência
   final antes do envio, e segue o ciclo Planeada → Em Trânsito →
   Entregue. "Gestão de docas" não se aplica à escala da operação
   (não há cais de carga dedicados) — fica como campo livre de
   observações, se um dia for preciso registar onde carregou.
   ============================================================ */
function registarEmbalagemLog({nome, tipo, capacidade, unidadeMedida}){
  if(!nome) return {ok:false, msg:'Indique o nome da embalagem/unidade logística.'};
  DBLogistica.embalagens.push({id: uidLog(), nome, tipo: tipo||'', capacidade: capacidade?Number(capacidade):null, unidadeMedida: unidadeMedida||'', criadoEm: new Date().toISOString()});
  return {ok:true};
}

/* Pickings concluídos e ainda não consolidados numa expedição —
   é o que fica disponível para "Consolidação de Pedidos". */
function pickingsProntosParaExpedirLog(){
  return (DBLogistica.pickings||[]).filter(p=>p.status==='concluida' && !p.expedicaoId);
}

function gerarEtiquetaExpedicaoLog({id, destino, data, itensConsolidados}){
  const linhas = itensConsolidados.map(it=>`  • ${(DBLogistica.produtos.find(p=>p.id===it.produtoId)||{}).nome||it.produtoId} — ${it.quantidade}`).join('\n');
  return `EXPEDIÇÃO Nº ${id}\nDestino: ${destino}\nData: ${data}\nItens:\n${linhas}`;
}

/* Consolida um ou mais pickings concluídos numa única Expedição:
   agrupa os itens (soma quantidades do mesmo produto entre
   pickings diferentes) numa unidade logística e gera a etiqueta
   de transporte. A conferência final e o despacho são passos
   seguintes, separados, para garantir que nada sai sem ser
   verificado. */
function criarExpedicaoLog({armazemOrigemId, destino, transportadora, viaturaId, motoristaId, custoTransporte, embalagemId, pickingIds}){
  if(!pickingIds || !pickingIds.length) return {ok:false, msg:'Selecione pelo menos uma lista de picking concluída.'};
  const pickings = pickingIds.map(id=>getPickingLog(id)).filter(Boolean);
  if(pickings.some(p=>p.status!=='concluida' || p.expedicaoId)) return {ok:false, msg:'Só é possível expedir pickings concluídos e ainda não expedidos.'};

  const itensConsolidados = {};
  pickings.forEach(p=> p.itens.forEach(it=>{
    itensConsolidados[it.produtoId] = (itensConsolidados[it.produtoId]||0) + Number(it.quantidadeSeparada||0);
  }));
  const itensArray = Object.entries(itensConsolidados).map(([produtoId,quantidade])=>({produtoId, quantidade}));

  const id = uidLog();
  const data = hojeISOLog();
  const unidade = {id: uidLog(), embalagemId: embalagemId||null, itens: itensArray, etiqueta: ''};
  unidade.etiqueta = gerarEtiquetaExpedicaoLog({id, destino, data, itensConsolidados: itensArray});

  const expedicao = {
    id, data, armazemOrigemId: armazemOrigemId||null, destino: destino||'',
    transportadora: transportadora||'', viaturaId: viaturaId||null, motoristaId: motoristaId||null,
    pickingIds: pickings.map(p=>p.id), unidadesLogisticas:[unidade],
    conferido:false, custoTransporte: Number(custoTransporte)||0, status:'planeada',
    dataSaida:null, dataEntregaReal:null, confirmadoPor:'', obs:'', criadoEm: new Date().toISOString()
  };
  DBLogistica.expedicoes.push(expedicao);
  pickings.forEach(p=> p.expedicaoId = id);
  return {ok:true, expedicao};
}

function getExpedicaoLog(id){
  return DBLogistica.expedicoes.find(e=>e.id===id);
}

async function confirmarConferenciaExpedicaoLog(expedicaoId){
  const exp = getExpedicaoLog(expedicaoId);
  if(!exp) return {ok:false, msg:'Expedição não encontrada.'};
  exp.conferido = true;
  await saveDBLogistica();
  return {ok:true};
}

/* Expedição automática: despacha assim que a conferência estiver
   feita, sem passos manuais adicionais — usado quando não há
   necessidade de um responsável extra para autorizar a saída. */
async function despacharExpedicaoLog(expedicaoId){
  const exp = getExpedicaoLog(expedicaoId);
  if(!exp) return {ok:false, msg:'Expedição não encontrada.'};
  if(!exp.conferido) return {ok:false, msg:'Faça a conferência antes do envio.'};
  exp.status = 'em_transito';
  exp.dataSaida = hojeISOLog();
  if(exp.viaturaId){
    const v = getViaturaLog(exp.viaturaId);
    if(v) v.estado = 'Em Rota';
  }
  await saveDBLogistica();
  return {ok:true};
}

async function confirmarEntregaExpedicaoLog(expedicaoId, {confirmadoPor, obs}={}){
  const exp = getExpedicaoLog(expedicaoId);
  if(!exp) return {ok:false, msg:'Expedição não encontrada.'};
  if(exp.status !== 'em_transito') return {ok:false, msg:'A expedição ainda não foi despachada.'};
  exp.status = 'entregue';
  exp.dataEntregaReal = hojeISOLog();
  exp.confirmadoPor = confirmadoPor || '';
  if(obs) exp.obs = obs;
  if(exp.viaturaId){
    const v = getViaturaLog(exp.viaturaId);
    if(v && v.estado === 'Em Rota') v.estado = 'Disponível';
  }
  await saveDBLogistica();
  return {ok:true};
}

/* ============================================================
   7. GESTÃO DE TRANSPORTES
   ------------------------------------------------------------
   Planeamento de entregas e controlo de custos de transporte já
   ficam cobertos pelo ciclo de Expedição acima (viatura, motorista,
   transportadora, custo, datas planeada/real). Aqui fica o cadastro
   de motoristas e a leitura de performance. "Rotas inteligentes",
   "Rastreamento de cargas" e "Integração GPS" dependem de um
   serviço de mapas/GPS externo — fora do âmbito deste sistema.
   ============================================================ */
function registarMotoristaLog({nome, contacto, numeroCarta, validadeCarta}){
  if(!nome) return {ok:false, msg:'Indique o nome do motorista.'};
  DBLogistica.motoristas.push({id: uidLog(), nome, contacto: contacto||'', numeroCarta: numeroCarta||'', validadeCarta: validadeCarta||null, ativo:true, criadoEm: new Date().toISOString()});
  return {ok:true};
}

function getMotoristaLog(id){
  return DBLogistica.motoristas.find(m=>m.id===id);
}

/* Entregas realizadas + em curso, por motorista — a "performance"
   possível de medir sem GPS/telemetria: volume de entregas concluídas
   e a pontualidade (comparando data de saída com data de entrega). */
function performanceMotoristasLog(){
  return DBLogistica.motoristas.map(m=>{
    const expedicoesM = DBLogistica.expedicoes.filter(e=>e.motoristaId===m.id);
    const entregues = expedicoesM.filter(e=>e.status==='entregue');
    const emCurso = expedicoesM.filter(e=>e.status==='em_transito');
    const ultima = [...entregues].sort((a,b)=> new Date(b.dataEntregaReal)-new Date(a.dataEntregaReal))[0];
    return {motorista:m, totalEntregas: entregues.length, emCurso: emCurso.length, ultimaEntrega: ultima ? ultima.dataEntregaReal : null};
  });
}

/* ============================================================
   8. GESTÃO DE FROTA — COMBUSTÍVEL E CUSTOS
   ------------------------------------------------------------
   Cadastro de viaturas, quilometragem, manutenção preventiva,
   controlo de documentos e histórico já implementados acima.
   Aqui completa-se com registo de combustível e custo total por
   veículo (manutenção + combustível). "Histórico de viagens" usa
   as Expedições já ligadas a cada viatura.
   ============================================================ */
async function registarAbastecimentoLog(dados){
  const viatura = getViaturaLog(dados.viaturaId);
  if(!viatura) return {ok:false, msg:'Viatura não encontrada.'};
  const litros = Number(dados.litros);
  if(!litros || litros<=0) return {ok:false, msg:'Indique os litros abastecidos.'};
  DBLogistica.abastecimentos.push({
    id: uidLog(), viaturaId: dados.viaturaId, data: dados.data || hojeISOLog(),
    litros, custo: Number(dados.custo)||0,
    kmAbastecimento: dados.kmAbastecimento?Number(dados.kmAbastecimento):null,
    posto: dados.posto||'', obs: dados.obs||'', criadoEm: new Date().toISOString()
  });
  if(dados.kmAbastecimento && (!viatura.kmAtual || Number(dados.kmAbastecimento) > viatura.kmAtual)){
    viatura.kmAtual = Number(dados.kmAbastecimento);
  }
  await saveDBLogistica();
  return {ok:true};
}

function abastecimentosDaViaturaLog(viaturaId){
  return DBLogistica.abastecimentos.filter(a=>a.viaturaId===viaturaId).sort((a,b)=> new Date(b.data)-new Date(a.data));
}

/* Custo total por veículo: soma manutenções + combustível, e
   consumo médio (litros por 100km), quando há km suficiente registado. */
function custosPorViaturaLog(){
  return DBLogistica.viaturas.map(v=>{
    const custoManutencao = manutencoesDaViaturaLog(v.id).reduce((s,m)=>s+Number(m.custo||0),0);
    const abastecimentos = abastecimentosDaViaturaLog(v.id);
    const custoCombustivel = abastecimentos.reduce((s,a)=>s+Number(a.custo||0),0);
    const litrosTotal = abastecimentos.reduce((s,a)=>s+Number(a.litros||0),0);
    return {viatura:v, custoManutencao, custoCombustivel, custoTotal: custoManutencao+custoCombustivel, litrosTotal};
  });
}

function viagensDaViaturaLog(viaturaId){
  return DBLogistica.expedicoes.filter(e=>e.viaturaId===viaturaId).sort((a,b)=> new Date(b.data)-new Date(a.data));
}

/* ============================================================
   9. GESTÃO DE PRODUÇÃO INTEGRADA
   ------------------------------------------------------------
   Kits de produção (receita/BOM): quanto de cada matéria-prima é
   preciso por unidade do produto final. Uma Ordem de Produção usa
   o kit para calcular o consumo previsto, baixa a matéria-prima do
   Armazém de Produção (seguindo a estratégia FIFO/FEFO de cada
   matéria — abastecimento automático da fábrica), regista o
   desperdício à parte, e dá entrada do produto acabado num lote
   novo que guarda a rastreabilidade dos lotes de matéria-prima
   consumidos (origem do produto).
   ============================================================ */
function registarKitLog({produtoFinalId, nome, itens}){
  if(!produtoFinalId) return {ok:false, msg:'Selecione o produto final.'};
  if(!itens || !itens.length) return {ok:false, msg:'Adicione pelo menos uma matéria-prima ao kit.'};
  DBLogistica.kits.push({id: uidLog(), produtoFinalId, nome: nome||'', itens, criadoEm: new Date().toISOString()});
  return {ok:true};
}

function kitsDoProdutoLog(produtoFinalId){
  return DBLogistica.kits.filter(k=>k.produtoFinalId===produtoFinalId);
}

/* Baixa lote(s) de matéria-prima seguindo a estratégia do produto e
   devolve QUAIS lotes (e quanto de cada) foram consumidos — é o que
   permite depois "Rastreamento da Origem dos Produtos". */
function baixarLoteComRastreioLog(armazemId, produtoId, quantidade){
  let falta = Number(quantidade) || 0;
  const lotes = lotesDoProdutoLog(armazemId, produtoId);
  const consumidos = [];
  for(const l of lotes){
    if(falta <= 0) break;
    const consumo = Math.min(l.quantidade, falta);
    l.quantidade = Math.round((l.quantidade - consumo) * 1000) / 1000;
    falta = Math.round((falta - consumo) * 1000) / 1000;
    consumidos.push({loteId: l.id, lote: l.lote, quantidade: consumo});
  }
  return consumidos;
}

async function registarOrdemProducaoLog({kitId, armazemProducaoId, quantidadeProduzida, operadorId, loteProduzido, validadeProduzido, localizacaoProduzido, desperdicios, obs}){
  const kit = DBLogistica.kits.find(k=>k.id===kitId);
  if(!kit) return {ok:false, msg:'Selecione um kit de produção válido.'};
  quantidadeProduzida = Number(quantidadeProduzida);
  if(!quantidadeProduzida || quantidadeProduzida<=0) return {ok:false, msg:'Indique a quantidade a produzir.'};
  desperdicios = (desperdicios||[]).map(d=>({produtoId:d.produtoId, quantidade:Number(d.quantidade)||0, motivo:d.motivo||''}));

  // valida disponibilidade antes de baixar seja o que for (consumo previsto + desperdício dessa matéria-prima)
  for(const item of kit.itens){
    const previsto = Number(item.quantidadeNecessaria) * quantidadeProduzida;
    const perda = desperdicios.filter(d=>d.produtoId===item.produtoId).reduce((s,d)=>s+d.quantidade,0);
    const necessario = previsto + perda;
    if(getDisponivelLog(armazemProducaoId, item.produtoId) < necessario){
      const nome = (DBLogistica.produtos.find(p=>p.id===item.produtoId)||{}).nome||item.produtoId;
      return {ok:false, msg:`Stock disponível insuficiente de "${nome}" no Armazém de Produção.`};
    }
  }

  const itensConsumidos = kit.itens.map(item=>{
    const previsto = Number(item.quantidadeNecessaria) * quantidadeProduzida;
    const perda = desperdicios.filter(d=>d.produtoId===item.produtoId).reduce((s,d)=>s+d.quantidade,0);
    const real = previsto + perda;
    ajustarStockLog(armazemProducaoId, item.produtoId, -real);
    const lotesConsumidos = baixarLoteComRastreioLog(armazemProducaoId, item.produtoId, real);
    return {produtoId: item.produtoId, quantidadePrevista: previsto, quantidadeReal: real, lotesConsumidos};
  });

  ajustarStockLog(armazemProducaoId, kit.produtoFinalId, quantidadeProduzida);
  if(loteProduzido || validadeProduzido || localizacaoProduzido){
    registarLoteLog({armazemId: armazemProducaoId, produtoId: kit.produtoFinalId, lote: loteProduzido, validade: validadeProduzido, quantidade: quantidadeProduzida, localizacao: localizacaoProduzido});
  }

  DBLogistica.movimentos.push({
    id: uidLog(), data: hojeISOLog(), tipo:'entrada', armazemOrigemId:null, armazemDestinoId: armazemProducaoId,
    produtoId: kit.produtoFinalId, quantidade: quantidadeProduzida, responsavel: '',
    obs: `Produção${loteProduzido?' — Lote '+loteProduzido:''}`, criadoEm: new Date().toISOString()
  });

  DBLogistica.ordensProducao.push({
    id: uidLog(), data: hojeISOLog(), kitId, produtoFinalId: kit.produtoFinalId, armazemProducaoId, operadorId: operadorId||null,
    quantidadeProduzida, itensConsumidos, desperdicios, loteProduzido: loteProduzido||'', obs: obs||'', criadoEm: new Date().toISOString()
  });

  await saveDBLogistica();
  verificarEDispararAlertasIoTLog();
  return {ok:true};
}

/* Consumo real vs previsto agregado — mostra onde a produção está a
   gastar mais matéria-prima do que a receita prevê (indício de
   desperdício não registado ou receita desatualizada). */
function consumoRealVsPrevistoLog(){
  const totais = {};
  DBLogistica.ordensProducao.forEach(o=> o.itensConsumidos.forEach(it=>{
    if(!totais[it.produtoId]) totais[it.produtoId] = {previsto:0, real:0};
    totais[it.produtoId].previsto += it.quantidadePrevista;
    totais[it.produtoId].real += it.quantidadeReal;
  }));
  return Object.entries(totais).map(([produtoId, t])=>({
    produto: DBLogistica.produtos.find(p=>p.id===produtoId),
    previsto: Math.round(t.previsto*1000)/1000, real: Math.round(t.real*1000)/1000,
    desvio: Math.round((t.real-t.previsto)*1000)/1000
  }));
}

/* ============================================================
   10. GESTÃO DE PESSOAS NO ARMAZÉM
   ------------------------------------------------------------
   Cadastro de operadores, turnos e metas; produtividade calculada
   a partir dos pickings e receções que cada operador executou.
   "Distribuição automática de tarefas" = ao criar um picking sem
   indicar operador, o sistema sugere o operador ativo com menos
   listas pendentes no momento (equilibra a carga).
   ============================================================ */
function registarOperadorLog({nome, contacto, turno, metaDiariaPicking}){
  if(!nome) return {ok:false, msg:'Indique o nome do operador.'};
  DBLogistica.operadores.push({id: uidLog(), nome, contacto: contacto||'', turno: turno||'', metaDiariaPicking: metaDiariaPicking?Number(metaDiariaPicking):null, ativo:true, criadoEm: new Date().toISOString()});
  return {ok:true};
}

function getOperadorLog(id){
  return DBLogistica.operadores.find(o=>o.id===id);
}

/* Sugere o operador ativo com menos pickings pendentes no momento —
   distribuição automática de tarefas equilibrando a carga. */
function sugerirOperadorLog(){
  const ativos = DBLogistica.operadores.filter(o=>o.ativo);
  if(!ativos.length) return null;
  const cargaAtual = id => (DBLogistica.pickings||[]).filter(p=>p.operadorId===id && p.status==='pendente').length;
  return ativos.sort((a,b)=> cargaAtual(a.id)-cargaAtual(b.id))[0];
}

/* Produtividade: nº de pickings concluídos, itens totais separados,
   tempo médio de picking (minutos, do início "criadoEm" à conclusão
   "concluidoEm"), e comparação com a meta diária definida. */
function produtividadeOperadoresLog(){
  return DBLogistica.operadores.map(op=>{
    const pickingsOp = (DBLogistica.pickings||[]).filter(p=>p.operadorId===op.id && p.status==='concluida');
    const totalItens = pickingsOp.reduce((s,p)=> s + p.itens.reduce((si,it)=>si+Number(it.quantidadeSeparada||0),0), 0);
    const tempos = pickingsOp.filter(p=>p.criadoEm && p.concluidoEm).map(p=> (new Date(p.concluidoEm)-new Date(p.criadoEm))/60000);
    const tempoMedioMin = tempos.length ? Math.round(tempos.reduce((s,t)=>s+t,0)/tempos.length) : null;
    const receçõesOp = (DBLogistica.recepcoes||[]).filter(r=>r.operadorId===op.id).length;
    return {
      operador: op, pickingsConcluidos: pickingsOp.length, itensSeparados: Math.round(totalItens*1000)/1000,
      tempoMedioMin, receçõesConferidas: receçõesOp,
      atingiuMeta: op.metaDiariaPicking ? pickingsOp.length >= op.metaDiariaPicking : null
    };
  });
}

/* ============================================================
   11. CÓDIGO DE BARRAS / QR CODE
   ------------------------------------------------------------
   Cada produto pode ter um código associado (campo codigoBarras),
   usado para localizar o produto rapidamente ao ler com a câmara
   (via BarcodeDetector nativo do navegador, sem serviços externos).
   RFID, terminais/tablets industriais dedicados e leitores
   portáteis são hardware específico e ficam fora do âmbito de um
   sistema em navegador; IoT (sensores em tempo real) idem.
   ============================================================ */
function getProdutoPorCodigoLog(codigo){
  if(!codigo) return null;
  return DBLogistica.produtos.find(p=>p.codigoBarras && p.codigoBarras === codigo) || null;
}

/* ============================================================
   11b. INTEGRAÇÃO IoT — WEBHOOK GENÉRICO E NEUTRO
   ------------------------------------------------------------
   Em vez de integrar com um fornecedor específico de sensores/IoT,
   o sistema expõe um "webhook de saída": sempre que um alerta
   relevante ocorre, faz um POST com JSON simples para o endereço
   configurado. Qualquer serviço que aceite um POST HTTP — Zapier,
   Make, n8n, um endpoint próprio — pode ligar-se a partir daqui,
   sem depender de nenhuma marca ou protocolo proprietário. Falhas
   de rede são silenciosas (best-effort) para nunca travar o uso
   normal do sistema por causa de uma notificação.
   ============================================================ */
async function dispararWebhookLog(url, payload){
  if(!url) return {ok:false, msg:'Sem endereço configurado.'};
  try{
    await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    return {ok:true};
  }catch(e){
    return {ok:false, msg:'Não foi possível contactar o endereço (verifique o URL e a ligação).'};
  }
}

async function guardarConfiguracoesLog({webhookStockBaixo, webhookLoteVencendo}){
  DBLogistica.configuracoes = {webhookStockBaixo: webhookStockBaixo||'', webhookLoteVencendo: webhookLoteVencendo||''};
  await saveDBLogistica();
  return {ok:true};
}

/* Verifica o estado atual (stock abaixo do mínimo + lotes a vencer)
   e dispara os webhooks configurados com o resumo — chamado a pedido
   do utilizador (botão "Verificar e Notificar Agora"), e também de
   forma automática depois de qualquer movimento de stock. */
async function verificarEDispararAlertasIoTLog(){
  const cfg = DBLogistica.configuracoes || {};
  const abaixoMinimo = produtosAbaixoMinimoLog();
  const aVencer = lotesAVencerLog();
  const resultados = {};
  if(cfg.webhookStockBaixo && abaixoMinimo.length){
    resultados.stockBaixo = await dispararWebhookLog(cfg.webhookStockBaixo, {
      evento:'stock_abaixo_minimo', data: new Date().toISOString(),
      itens: abaixoMinimo.map(a=>({armazem:a.armazem.nome, produto:a.produto.nome, atual:a.atual, minimo:a.produto.stockMinimo, falta:a.falta}))
    });
  }
  if(cfg.webhookLoteVencendo && aVencer.length){
    resultados.loteVencendo = await dispararWebhookLog(cfg.webhookLoteVencendo, {
      evento:'lotes_a_vencer', data: new Date().toISOString(),
      itens: aVencer.map(a=>({produto:(DBLogistica.produtos.find(p=>p.id===a.lote.produtoId)||{}).nome, lote:a.lote.lote, validade:a.lote.validade, estado:a.estado, quantidade:a.lote.quantidade}))
    });
  }
  return resultados;
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
