/* ============================================================
   PRODUCAO-CORE.JS — Módulo independente de Produção (MES + MRP)
   ============================================================
   Ficheiro próprio do departamento de Produção. NÃO mexe nos
   dados da Contabilidade/Tesouraria (core.js), da Hotelaria
   (hotel-core.js) nem da Logística (logistica-core.js) — usa a
   mesma ligação Supabase, mas grava numa linha própria da tabela
   "producao_data", para nunca entrar em conflito com o resto do
   sistema.

   Por decisão explícita: este módulo fica INDEPENDENTE da
   Logística por agora (não consome automaticamente o stock do
   Armazém Central nem alimenta a Área de Produção). Essa ligação
   pode ser feita depois, numa fase seguinte.

   Todos os nomes aqui têm o sufixo "Prod" para nunca colidirem
   com core.js/hotel-core.js/logistica-core.js, caso um dia
   fiquem incluídos na mesma página.

   Inclui no <head> do producao.html, por esta ordem:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="producao-core.js"></script>
   ============================================================ */

const SUPABASE_URL_PROD = "https://okwvzccirgxnpugypsgf.supabase.co";
const SUPABASE_ANON_KEY_PROD = "sb_publishable_pOtoNEKOi2nZaiZVqn2uhQ_WTwy5ctm";

const supaProd = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL_PROD, SUPABASE_ANON_KEY_PROD)
  : null;

/* ---------- utilidades genéricas ---------- */
function uidProd(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function hojeISOProd(){
  return new Date().toISOString().split('T')[0];
}

function diasEntreProd(dataISO1, dataISO2){
  const d1 = new Date(dataISO1 + 'T00:00:00');
  const d2 = new Date(dataISO2 + 'T00:00:00');
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function toastProd(msg){
  let el = document.getElementById('toastBoxProd');
  if(!el){
    el = document.createElement('div');
    el.id = 'toastBoxProd';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#14232B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.opacity = '0'; }, 2500);
}

function arredProd(n, casas=2){
  const f = Math.pow(10, casas);
  return Math.round((Number(n)||0) * f) / f;
}

/* ============================================================
   ESQUEMA REAL DO NEGÓCIO
   ------------------------------------------------------------
   Mesmas Unidades de Negócio já usadas no resto do sistema —
   uma Ordem de Produção pode ser etiquetada com a unidade a que
   se destina, só para efeitos de relatório (sem ligação real ao
   stock da Logística nesta fase).
   ============================================================ */
const UNIDADES_NEGOCIO_PROD = [
  "ZOOM'S LODGE",
  "BAKERY LINE-MAIN STORE",
  "BAKERY LINE-CFM STORE",
  "BAKERY LINE-NEW STORE"
];

const ESTADOS_OP_PROD = ['planeada', 'em_producao', 'finalizada', 'cancelada'];
const ESTADOS_OP_LABEL_PROD = {
  planeada: '🗓️ Planeada',
  em_producao: '⏳ Em Produção',
  finalizada: '✅ Finalizada',
  cancelada: '❌ Cancelada'
};

const ESTADOS_LOTE_PROD = ['pendente', 'aprovado', 'reprovado', 'quarentena'];
const ESTADOS_LOTE_LABEL_PROD = {
  pendente: '🕓 Pendente',
  aprovado: '✅ Aprovado',
  reprovado: '❌ Reprovado',
  quarentena: '🔒 Quarentena'
};

/* Testes de qualidade padrão sugeridos — o utilizador pode registar
   outros tipos livremente ao preencher o campo. */
const TIPOS_TESTE_QUALIDADE_PROD = ['Peso', 'Aparência', 'Temperatura', 'Textura', 'Sabor', 'Embalagem'];

const TIPOS_INTERVENCAO_MANUT_PROD = [
  'Manutenção Preventiva', 'Manutenção Corretiva', 'Limpeza Profunda', 'Calibração', 'Outra'
];

/* Intervalo padrão entre manutenções preventivas de um equipamento,
   usado para calcular a previsão da próxima quando o equipamento não
   tem um intervalo próprio definido no cadastro. */
const INTERVALO_PREVENTIVA_HORAS_DEFAULT_PROD = 500;
const INTERVALO_PREVENTIVA_DIAS_DEFAULT_PROD = 90;

const DIAS_ALERTA_VALIDADE_LOTE_PROD = 2;     // avisa 2 dias antes do lote vencer
const DIAS_ALERTA_MANUTENCAO_PROD = 15;       // avisa 15 dias antes da preventiva prevista
const LIMIAR_DESVIO_CONSUMO_ALERTA_PROD = 8;  // % de desvio face ao previsto que gera alerta/sugestão da IA

/* ============================================================
   INTEGRAÇÃO COM A LOGÍSTICA (ligada)
   ------------------------------------------------------------
   Ao finalizar uma Ordem de Produção, este módulo passa a:
   1) Dar SAÍDA automática da matéria-prima consumida no Armazém
      Central da Logística ('central');
   2) Dar ENTRADA automática do produto acabado na Área de
      Produção da Logística ('producao').
   Usa os MESMOS ids de armazém já definidos em ARMAZENS_DEFAULT_LOG
   (logistica-core.js). Requer que logistica-core.js esteja incluído
   ANTES de producao-core.js na página (ver producao.html) — se não
   estiver, a integração é ignorada silenciosamente e o módulo
   continua a funcionar de forma independente.
   ============================================================ */
const ARMAZEM_CENTRAL_LOG_ID_PROD = 'central';
const ARMAZEM_PRODUCAO_LOG_ID_PROD = 'producao';

/* Verifica se o módulo de Logística está carregado na mesma página. */
function logisticaDisponivelProd(){
  return typeof DBLogistica !== 'undefined' && typeof ajustarStockLog === 'function' && typeof saveDBLogistica === 'function';
}

/* Encontra (por nome, sem distinguir maiúsculas/minúsculas) ou cria
   automaticamente um produto no catálogo da Logística — usado tanto
   para matérias-primas de uma ficha técnica como para o produto
   acabado, para que o stock possa ser movimentado sem exigir
   configuração manual prévia de cada item nos dois módulos. */
function encontrarOuCriarProdutoLogProd(nome, unidadeMedida, categoria){
  if(!logisticaDisponivelProd() || !nome) return null;
  const nomeNorm = nome.trim().toLowerCase();
  let produto = DBLogistica.produtos.find(p=> (p.nome||'').trim().toLowerCase() === nomeNorm);
  if(!produto){
    produto = {id: uidProd(), nome: nome.trim(), categoria: categoria || '', unidadeMedida: unidadeMedida || 'Un', stockMinimo: null};
    DBLogistica.produtos.push(produto);
  }
  return produto;
}

/* Regista um movimento de stock na Logística a partir da Produção,
   sem bloquear por stock insuficiente (a matéria-prima já foi
   fisicamente consumida) — apenas devolve aviso se ficar negativo. */
function registarMovimentoAutomaticoLogProd(tipo, armazemId, produtoId, quantidade, obs){
  const disponivelAntes = getStockLog(armazemId, produtoId);
  ajustarStockLog(armazemId, produtoId, tipo === 'entrada' ? quantidade : -quantidade);
  DBLogistica.movimentos.push({
    id: uidProd(), data: hojeISOProd(), tipo,
    armazemOrigemId: tipo === 'saida' ? armazemId : null,
    armazemDestinoId: tipo === 'entrada' ? armazemId : null,
    produtoId, quantidade, responsavel: 'Produção (automático)', obs: obs || '',
    criadoEm: new Date().toISOString()
  });
  return (tipo === 'saida' && disponivelAntes < quantidade);
}

/* Consulta o stock de um item na Logística pelo NOME (sem criar nada) —
   usado só para mostrar informação na interface antes de confirmar. */
function stockArmazemLogPorNomeProd(armazemId, nome){
  if(!logisticaDisponivelProd() || !nome) return null;
  const nomeNorm = nome.trim().toLowerCase();
  const produtoLog = DBLogistica.produtos.find(p=> (p.nome||'').trim().toLowerCase() === nomeNorm);
  if(!produtoLog) return null;
  return getStockLog(armazemId, produtoLog.id);
}

/* Executa a integração completa para uma OP finalizada: consome as
   matérias-primas no Central e dá entrada do produto acabado na Área
   de Produção. Devolve {ok, avisos[]}. Grava a Logística UMA vez no
   final (todas as movimentações em lote). */
async function integrarFinalizacaoComLogisticaProd(op, quantidadeReal, loteCodigo){
  const resultado = {ok:false, avisos:[]};
  if(!logisticaDisponivelProd()){
    resultado.avisos.push('Módulo de Logística não está carregado nesta página — stock não foi atualizado.');
    return resultado;
  }
  try{
    op.consumos.forEach(c=>{
      const qtd = Number(c.real);
      if(!qtd) return;
      const produtoLog = encontrarOuCriarProdutoLogProd(c.nome, c.unidade);
      const ficouNegativo = registarMovimentoAutomaticoLogProd('saida', ARMAZEM_CENTRAL_LOG_ID_PROD, produtoLog.id, qtd, `Consumo automático — OP ${op.numero}`);
      if(ficouNegativo) resultado.avisos.push(`Stock de "${c.nome}" ficou negativo no Armazém Central após este consumo — confirme a contagem física.`);
    });

    const produto = getProdutoProd(op.produtoId);
    const produtoLogAcabado = encontrarOuCriarProdutoLogProd(produto ? produto.nome : 'Produto Acabado', produto ? produto.unidadeMedida : 'Un', 'Produto Acabado');
    registarMovimentoAutomaticoLogProd('entrada', ARMAZEM_PRODUCAO_LOG_ID_PROD, produtoLogAcabado.id, quantidadeReal, `Produção automática — OP ${op.numero}${loteCodigo ? ` — Lote ${loteCodigo}` : ''}`);

    await saveDBLogistica();
    resultado.ok = true;
  }catch(e){
    console.warn('Erro na integração Produção → Logística:', e);
    resultado.avisos.push('Não foi possível atualizar o stock da Logística automaticamente — tente novamente.');
  }
  return resultado;
}

/* ---------- estado dos dados de Produção ---------- */
let DBProducao = {
  produtos: [],
  // produtos: [{id, nome, categoria, unidadeMedida, criadoEm}]
  fichasTecnicas: [],
  // fichasTecnicas: [{id, produtoId, nome, rendimento, unidadeRendimento,
  //   ingredientes:[{id, nome, quantidade, unidade, custoUnitario}], obs, criadoEm}]
  ordens: [],
  // ordens: [{id, numero, produtoId, fichaTecnicaId, unidadeNegocio,
  //   quantidadePrevista, quantidadeReal, dataInicio, dataPrevista, dataConclusao,
  //   estado, responsavel, maoDeObra, energia, obs,
  //   consumos:[{ingredienteId, nome, unidade, custoUnitario, previsto, real}],
  //   loteId, criadoEm}]
  lotes: [],
  // lotes: [{id, codigo, opId, produtoId, dataProducao, dataValidade, estado, obs, criadoEm}]
  testes: [],
  // testes: [{id, loteId, tipo, resultado:'aprovado'|'reprovado', obs, data, criadoEm}]
  equipamentos: [],
  // equipamentos: [{id, nome, tipo, intervaloHorasManutencao, intervaloDiasManutencao, horasUsoAtual, obs, criadoEm}]
  manutencoes: [],
  // manutencoes: [{id, equipamentoId, data, tipoIntervencao, descricao, custo,
  //   horasNoMomento, previsaoProximaHoras, previsaoProximaData, obs, criadoEm}]
  contadorOP: 0
};

let versaoProd = null;
let semColunaVersaoProd = false;

/* Carrega os dados de producao_data (linha id="main"). Se a tabela/linha
   ainda não existir, cria-a com os valores padrão acima. */
async function carregarDadosProducao(){
  if(!supaProd){ toastProd('Sem ligação ao Supabase.'); return; }
  try{
    let { data, error } = await supaProd.from('producao_data').select('*').eq('id','main').maybeSingle();

    if(error && String(error.message||'').toLowerCase().includes('column')){
      semColunaVersaoProd = true;
      ({ data, error } = await supaProd.from('producao_data').select('id,data').eq('id','main').maybeSingle());
    }
    if(error) throw error;

    if(!data){
      // primeira vez: cria a linha com os valores padrão
      const payload = { id:'main', data: DBProducao };
      if(!semColunaVersaoProd) payload.versao = 1;
      const { error: errIns } = await supaProd.from('producao_data').insert(payload);
      if(errIns) console.warn(errIns);
      versaoProd = 1;
      return;
    }

    DBProducao = Object.assign({
      produtos:[], fichasTecnicas:[], ordens:[], lotes:[], testes:[],
      equipamentos:[], manutencoes:[], contadorOP:0
    }, data.data || {});
    ['produtos','fichasTecnicas','ordens','lotes','testes','equipamentos','manutencoes'].forEach(k=>{
      if(!DBProducao[k]) DBProducao[k] = [];
    });
    if(!DBProducao.contadorOP) DBProducao.contadorOP = 0;
    versaoProd = data.versao || 1;
  }catch(e){
    console.warn('Erro ao carregar dados de produção:', e);
    toastProd('Não consegui carregar os dados da produção — a usar valores locais.');
  }
}

/* Grava DBProducao inteiro em producao_data, com bloqueio otimista
   (igual ao padrão usado no core.js / hotel-core.js / logistica-core.js),
   tentando de novo automaticamente se houver conflito de versão. */
async function saveDBProducao(tentativas = 3){
  if(!supaProd){ toastProd('Sem ligação ao Supabase — alterações só ficam localmente.'); return {ok:false}; }
  try{
    if(semColunaVersaoProd){
      const { error } = await supaProd.from('producao_data').update({data: DBProducao}).eq('id','main');
      if(error) throw error;
      return {ok:true};
    }

    const versaoEsperada = versaoProd;
    const novaVersao = versaoEsperada + 1;
    const { data: dataUpd, error: errUpd } = await supaProd
      .from('producao_data')
      .update({data: DBProducao, versao: novaVersao, updated_at: new Date().toISOString()})
      .eq('id','main').eq('versao', versaoEsperada)
      .select();

    if(errUpd){
      console.warn(errUpd);
      toastProd('Não foi possível guardar. Tenta novamente.');
      return {ok:false};
    }
    if(dataUpd && dataUpd.length){
      versaoProd = novaVersao;
      return {ok:true};
    }

    // conflito: outra pessoa gravou entretanto — recarrega e tenta de novo
    if(tentativas > 0){
      const dbLocal = DBProducao;
      await carregarDadosProducao();
      DBProducao = dbLocal; // mantém as alterações locais por cima dos dados recarregados
      return await saveDBProducao(tentativas - 1);
    }
    toastProd('Conflito ao guardar — tenta novamente.');
    return {ok:false};
  }catch(e){
    console.warn(e);
    toastProd('Erro ao guardar dados da produção.');
    return {ok:false};
  }
}

/* ============================================================
   PRODUTOS (produzidos) & FICHAS TÉCNICAS
   ============================================================ */
function getProdutoProd(id){
  return DBProducao.produtos.find(p=>p.id===id);
}

async function criarProdutoProd({nome, categoria, unidadeMedida}){
  if(!nome) return {ok:false, msg:'Indique o nome do produto.'};
  DBProducao.produtos.push({id: uidProd(), nome, categoria: categoria||'', unidadeMedida: unidadeMedida||'Un', criadoEm: new Date().toISOString()});
  await saveDBProducao();
  return {ok:true};
}

function getFichaTecnicaProd(id){
  return DBProducao.fichasTecnicas.find(f=>f.id===id);
}

function fichasDoProdutoProd(produtoId){
  return DBProducao.fichasTecnicas.filter(f=>f.produtoId===produtoId);
}

/* Custo total da ficha técnica (soma dos ingredientes) e custo por
   unidade de rendimento — usado para calcular custo previsto de uma OP. */
function custoFichaTecnicaProd(ficha){
  const total = (ficha.ingredientes||[]).reduce((s,i)=> s + (Number(i.quantidade)||0) * (Number(i.custoUnitario)||0), 0);
  const rendimento = Number(ficha.rendimento) || 1;
  return { total: arredProd(total), porUnidade: arredProd(total / rendimento, 4) };
}

async function criarFichaTecnicaProd(dados){
  if(!dados.produtoId) return {ok:false, msg:'Selecione o produto.'};
  if(!dados.nome) return {ok:false, msg:'Indique um nome para a ficha técnica.'};
  const rendimento = Number(dados.rendimento);
  if(!rendimento || rendimento <= 0) return {ok:false, msg:'Indique o rendimento (quantas unidades esta ficha produz).'};
  const ingredientes = (dados.ingredientes||[]).filter(i=>i.nome).map(i=>({
    id: uidProd(), nome: i.nome, quantidade: Number(i.quantidade)||0,
    unidade: i.unidade||'', custoUnitario: Number(i.custoUnitario)||0
  }));
  if(!ingredientes.length) return {ok:false, msg:'Adicione pelo menos um ingrediente.'};

  DBProducao.fichasTecnicas.push({
    id: uidProd(), produtoId: dados.produtoId, nome: dados.nome,
    rendimento, unidadeRendimento: dados.unidadeRendimento || 'Un',
    ingredientes, obs: dados.obs || '', criadoEm: new Date().toISOString()
  });
  await saveDBProducao();
  return {ok:true};
}

/* ============================================================
   ORDENS DE PRODUÇÃO
   ============================================================ */
function proximoNumeroOPProd(){
  DBProducao.contadorOP = (DBProducao.contadorOP || 0) + 1;
  return String(DBProducao.contadorOP).padStart(5, '0');
}

function getOPProd(id){
  return DBProducao.ordens.find(o=>o.id===id);
}

/* Cria uma nova Ordem de Produção a partir de uma ficha técnica,
   calculando automaticamente o consumo PREVISTO de cada ingrediente
   proporcional à quantidade a produzir. */
async function criarOrdemProducaoProd(dados){
  const ficha = getFichaTecnicaProd(dados.fichaTecnicaId);
  if(!ficha) return {ok:false, msg:'Selecione uma ficha técnica válida.'};
  const quantidadePrevista = Number(dados.quantidadePrevista);
  if(!quantidadePrevista || quantidadePrevista <= 0) return {ok:false, msg:'Indique a quantidade prevista.'};
  if(!dados.dataInicio) return {ok:false, msg:'Indique a data de início.'};

  const fator = quantidadePrevista / (Number(ficha.rendimento) || 1);
  const consumos = (ficha.ingredientes||[]).map(i=>({
    ingredienteId: i.id, nome: i.nome, unidade: i.unidade, custoUnitario: i.custoUnitario,
    previsto: arredProd((Number(i.quantidade)||0) * fator, 3), real: null
  }));

  const op = {
    id: uidProd(), numero: proximoNumeroOPProd(),
    produtoId: ficha.produtoId, fichaTecnicaId: ficha.id,
    unidadeNegocio: dados.unidadeNegocio || '',
    quantidadePrevista, quantidadeReal: null,
    dataInicio: dados.dataInicio, dataPrevista: dados.dataPrevista || null, dataConclusao: null,
    estado: 'planeada', responsavel: dados.responsavel || '',
    maoDeObra: 0, energia: 0, obs: dados.obs || '',
    consumos, loteId: null, criadoEm: new Date().toISOString()
  };
  DBProducao.ordens.push(op);
  await saveDBProducao();
  return {ok:true, id: op.id};
}

async function iniciarOrdemProducaoProd(opId){
  const op = getOPProd(opId);
  if(!op) return {ok:false, msg:'OP não encontrada.'};
  if(op.estado !== 'planeada') return {ok:false, msg:'Só é possível iniciar uma OP planeada.'};
  op.estado = 'em_producao';
  await saveDBProducao();
  return {ok:true};
}

async function cancelarOrdemProducaoProd(opId){
  const op = getOPProd(opId);
  if(!op) return {ok:false, msg:'OP não encontrada.'};
  if(op.estado === 'finalizada') return {ok:false, msg:'Uma OP finalizada não pode ser cancelada.'};
  op.estado = 'cancelada';
  await saveDBProducao();
  return {ok:true};
}

/* Finaliza a OP: regista quantidade real, consumo real por ingrediente,
   mão de obra e energia, e (opcionalmente) gera automaticamente o Lote
   já ligado a esta OP. */
async function finalizarOrdemProducaoProd(opId, dados){
  const op = getOPProd(opId);
  if(!op) return {ok:false, msg:'OP não encontrada.'};
  if(op.estado === 'finalizada') return {ok:false, msg:'Esta OP já está finalizada.'};

  const quantidadeReal = Number(dados.quantidadeReal);
  if(!quantidadeReal && quantidadeReal !== 0) return {ok:false, msg:'Indique a quantidade real produzida.'};

  op.quantidadeReal = quantidadeReal;
  op.maoDeObra = Number(dados.maoDeObra) || 0;
  op.energia = Number(dados.energia) || 0;
  op.dataConclusao = dados.dataConclusao || hojeISOProd();
  op.estado = 'finalizada';

  op.consumos.forEach(c=>{
    const real = dados.consumosReais ? dados.consumosReais[c.ingredienteId] : undefined;
    c.real = (real !== undefined && real !== '' && real !== null) ? Number(real) : c.previsto;
  });

  let loteId = null;
  let codigoLoteGerado = null;
  if(dados.gerarLote){
    codigoLoteGerado = dados.codigoLote || sugerirCodigoLoteProd(op);
    const lote = {
      id: uidProd(), codigo: codigoLoteGerado,
      opId: op.id, produtoId: op.produtoId,
      dataProducao: op.dataConclusao, dataValidade: dados.dataValidade || null,
      estado: 'pendente', obs: '', criadoEm: new Date().toISOString()
    };
    DBProducao.lotes.push(lote);
    loteId = lote.id;
    op.loteId = loteId;
  }

  await saveDBProducao();

  // Integração com a Logística: consome matéria-prima do Central e dá
  // entrada do produto acabado na Área de Produção, automaticamente.
  const integracaoLogistica = await integrarFinalizacaoComLogisticaProd(op, quantidadeReal, codigoLoteGerado);

  return {ok:true, loteId, integracaoLogistica};
}

function sugerirCodigoLoteProd(op){
  const produto = getProdutoProd(op.produtoId);
  const prefixo = (produto ? produto.nome : 'LOTE').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase() || 'LOT';
  const dataCompacta = (op.dataConclusao || hojeISOProd()).split('-').reverse().join('').slice(0,6);
  return `${prefixo}-${dataCompacta}-${op.numero}`;
}

/* ---------- Custos e desempenho de uma OP ---------- */
function custoPrevistoOPProd(op){
  const materiaPrima = op.consumos.reduce((s,c)=> s + (Number(c.previsto)||0) * (Number(c.custoUnitario)||0), 0);
  return arredProd(materiaPrima);
}

function custoRealOPProd(op){
  const materiaPrima = op.consumos.reduce((s,c)=> s + (Number(c.real!=null?c.real:c.previsto)||0) * (Number(c.custoUnitario)||0), 0);
  return {
    materiaPrima: arredProd(materiaPrima),
    maoDeObra: arredProd(op.maoDeObra),
    energia: arredProd(op.energia),
    total: arredProd(materiaPrima + (Number(op.maoDeObra)||0) + (Number(op.energia)||0))
  };
}

function eficienciaOPProd(op){
  if(op.quantidadeReal == null || !op.quantidadePrevista) return null;
  return arredProd((op.quantidadeReal / op.quantidadePrevista) * 100, 1);
}

/* Desvio de consumo por ingrediente (%), positivo = gastou mais do que
   o previsto (perda), negativo = poupança. */
function desviosConsumoOPProd(op){
  return op.consumos.map(c=>{
    if(c.real == null || !c.previsto) return {...c, desvioPct: null};
    const desvio = ((c.real - c.previsto) / c.previsto) * 100;
    return {...c, desvioPct: arredProd(desvio, 1)};
  });
}

/* ============================================================
   LOTES & QUALIDADE
   ============================================================ */
function getLoteProd(id){
  return DBProducao.lotes.find(l=>l.id===id);
}

function testesDoLoteProd(loteId){
  return DBProducao.testes.filter(t=>t.loteId===loteId).sort((a,b)=> new Date(b.data)-new Date(a.data));
}

/* Estado consolidado de um lote a partir dos testes registados:
   'reprovado' se algum teste reprovou, 'aprovado' se há testes e
   todos passaram, 'pendente' se ainda não há testes suficientes. */
function estadoQualidadeLoteProd(loteId){
  const testes = testesDoLoteProd(loteId);
  if(!testes.length) return 'pendente';
  if(testes.some(t=>t.resultado==='reprovado')) return 'reprovado';
  return 'aprovado';
}

async function registarTesteQualidadeProd(dados){
  const lote = getLoteProd(dados.loteId);
  if(!lote) return {ok:false, msg:'Lote não encontrado.'};
  if(!dados.tipo) return {ok:false, msg:'Indique o tipo de teste.'};
  if(!dados.resultado) return {ok:false, msg:'Indique o resultado do teste.'};

  DBProducao.testes.push({
    id: uidProd(), loteId: dados.loteId, tipo: dados.tipo, resultado: dados.resultado,
    obs: dados.obs || '', data: dados.data || hojeISOProd(), criadoEm: new Date().toISOString()
  });

  // Atualiza o estado do lote conforme o conjunto de testes
  lote.estado = estadoQualidadeLoteProd(lote.id);

  await saveDBProducao();
  return {ok:true};
}

async function alterarEstadoLoteProd(loteId, estado, obs){
  const lote = getLoteProd(loteId);
  if(!lote) return {ok:false, msg:'Lote não encontrado.'};
  if(!ESTADOS_LOTE_PROD.includes(estado)) return {ok:false, msg:'Estado inválido.'};
  lote.estado = estado;
  if(obs) lote.obs = obs;
  await saveDBProducao();
  return {ok:true};
}

/* Lotes vencidos ou perto de vencer (dentro da janela de alerta). */
function lotesAVencerProd(){
  const hoje = hojeISOProd();
  return DBProducao.lotes
    .filter(l=>l.dataValidade && l.estado !== 'reprovado')
    .map(l=>({lote:l, dias: diasEntreProd(hoje, l.dataValidade)}))
    .filter(x=> x.dias <= DIAS_ALERTA_VALIDADE_LOTE_PROD)
    .sort((a,b)=> a.dias - b.dias);
}

/* ============================================================
   EQUIPAMENTOS & MANUTENÇÃO
   ============================================================ */
function getEquipamentoProd(id){
  return DBProducao.equipamentos.find(e=>e.id===id);
}

async function criarEquipamentoProd(dados){
  if(!dados.nome) return {ok:false, msg:'Indique o nome do equipamento.'};
  DBProducao.equipamentos.push({
    id: uidProd(), nome: dados.nome, tipo: dados.tipo || '',
    intervaloHorasManutencao: dados.intervaloHorasManutencao ? Number(dados.intervaloHorasManutencao) : null,
    intervaloDiasManutencao: dados.intervaloDiasManutencao ? Number(dados.intervaloDiasManutencao) : null,
    horasUsoAtual: dados.horasUsoAtual ? Number(dados.horasUsoAtual) : 0,
    obs: dados.obs || '', criadoEm: new Date().toISOString()
  });
  await saveDBProducao();
  return {ok:true};
}

function manutencoesDoEquipamentoProd(equipamentoId){
  return DBProducao.manutencoes.filter(m=>m.equipamentoId===equipamentoId).sort((a,b)=> new Date(b.data)-new Date(a.data));
}

function ultimaPreventivaEquipProd(equipamentoId){
  return manutencoesDoEquipamentoProd(equipamentoId).find(m=>m.tipoIntervencao==='Manutenção Preventiva') || null;
}

async function registarManutencaoEquipProd(dados){
  const equip = getEquipamentoProd(dados.equipamentoId);
  if(!equip) return {ok:false, msg:'Equipamento não encontrado.'};
  if(!dados.data) return {ok:false, msg:'Indique a data da intervenção.'};

  const horas = dados.horasNoMomento !== '' && dados.horasNoMomento != null ? Number(dados.horasNoMomento) : null;

  const registo = {
    id: uidProd(), equipamentoId: dados.equipamentoId, data: dados.data,
    tipoIntervencao: dados.tipoIntervencao, descricao: dados.descricao || '',
    custo: Number(dados.custo) || 0, horasNoMomento: horas,
    previsaoProximaHoras: null, previsaoProximaData: null,
    obs: dados.obs || '', criadoEm: new Date().toISOString()
  };

  if(dados.tipoIntervencao === 'Manutenção Preventiva'){
    const intervaloHoras = Number(equip.intervaloHorasManutencao) || INTERVALO_PREVENTIVA_HORAS_DEFAULT_PROD;
    const intervaloDias = Number(equip.intervaloDiasManutencao) || INTERVALO_PREVENTIVA_DIAS_DEFAULT_PROD;
    if(horas != null) registo.previsaoProximaHoras = horas + intervaloHoras;
    const dProx = new Date(dados.data + 'T00:00:00');
    dProx.setDate(dProx.getDate() + intervaloDias);
    registo.previsaoProximaData = dProx.toISOString().split('T')[0];
  }

  DBProducao.manutencoes.push(registo);
  if(horas != null && (!equip.horasUsoAtual || horas > equip.horasUsoAtual)) equip.horasUsoAtual = horas;

  await saveDBProducao();
  return {ok:true};
}

function previsaoProximaPreventivaEquipProd(equipamentoId){
  const ultima = ultimaPreventivaEquipProd(equipamentoId);
  if(!ultima || !ultima.previsaoProximaData) return null;
  const equip = getEquipamentoProd(equipamentoId);
  const horasFalta = (ultima.previsaoProximaHoras != null && equip && equip.horasUsoAtual != null)
    ? arredProd(ultima.previsaoProximaHoras - equip.horasUsoAtual, 1) : null;
  const diasFalta = diasEntreProd(hojeISOProd(), ultima.previsaoProximaData);
  return {
    previsaoHoras: ultima.previsaoProximaHoras, previsaoData: ultima.previsaoProximaData,
    horasFalta, diasFalta,
    vencida: diasFalta < 0 || (horasFalta != null && horasFalta < 0)
  };
}

/* ============================================================
   ALERTAS CONSOLIDADOS
   ============================================================ */
function alertasProducaoProd(){
  const alertas = [];

  lotesAVencerProd().forEach(x=>{
    alertas.push({
      tipo: 'lote', gravidade: x.dias < 0 ? 'grave' : 'aviso',
      texto: x.dias < 0
        ? `Lote ${x.lote.codigo} venceu há ${Math.abs(x.dias)} dia(s).`
        : `Lote ${x.lote.codigo} vence em ${x.dias} dia(s).`
    });
  });

  DBProducao.lotes.filter(l=>l.estado==='reprovado').forEach(l=>{
    alertas.push({tipo:'qualidade', gravidade:'grave', texto:`Lote ${l.codigo} foi reprovado no controlo de qualidade.`});
  });

  DBProducao.equipamentos.forEach(e=>{
    const prev = previsaoProximaPreventivaEquipProd(e.id);
    if(prev && (prev.vencida || (prev.diasFalta != null && prev.diasFalta <= DIAS_ALERTA_MANUTENCAO_PROD))){
      alertas.push({
        tipo:'manutencao', gravidade: prev.vencida ? 'grave' : 'aviso',
        texto: prev.vencida
          ? `Manutenção preventiva de "${e.nome}" está vencida.`
          : `Manutenção preventiva de "${e.nome}" prevista para ${prev.previsaoData} (${prev.diasFalta} dia(s)).`
      });
    }
  });

  const hoje = hojeISOProd();
  DBProducao.ordens.filter(o=> o.estado==='em_producao' && o.dataPrevista && o.dataPrevista < hoje).forEach(o=>{
    const produto = getProdutoProd(o.produtoId);
    alertas.push({tipo:'op_atraso', gravidade:'aviso', texto:`OP ${o.numero} (${produto?produto.nome:'—'}) está atrasada — previsão era ${o.dataPrevista}.`});
  });

  // Stock da Logística relevante para a Produção (Central e Área de Produção)
  if(logisticaDisponivelProd() && typeof produtosAbaixoMinimoLog === 'function'){
    produtosAbaixoMinimoLog().forEach(a=>{
      if(a.armazem.id === ARMAZEM_CENTRAL_LOG_ID_PROD || a.armazem.id === ARMAZEM_PRODUCAO_LOG_ID_PROD){
        alertas.push({
          tipo:'stock_logistica', gravidade: a.quantidade <= 0 ? 'grave' : 'aviso',
          texto: `Stock de "${a.produto.nome}" no ${a.armazem.nome} está abaixo do mínimo (${a.quantidade} / mín. ${a.produto.stockMinimo}).`
        });
      }
    });
  }

  return alertas;
}

/* ============================================================
   IA PRODUÇÃO — sugestões heurísticas a partir dos dados reais
   ------------------------------------------------------------
   Não chama nenhuma API externa: analisa OPs finalizadas e aponta,
   em linguagem simples, onde há mais desperdício de matéria-prima
   ou quebra de eficiência, para orientar decisões de redução de
   custo. Pode ser substituído mais tarde por um modelo real.
   ============================================================ */
function sugestoesIAProd(){
  const finalizadas = DBProducao.ordens.filter(o=>o.estado==='finalizada');
  if(!finalizadas.length){
    return ['Ainda não há Ordens de Produção finalizadas suficientes para gerar sugestões. Finalize algumas OPs (com consumo real preenchido) para a IA começar a identificar desperdícios e desvios.'];
  }

  const sugestoes = [];

  // Desvio médio de consumo por ingrediente, entre todas as OPs finalizadas
  const somaPorIngrediente = {};
  finalizadas.forEach(op=>{
    desviosConsumoOPProd(op).forEach(c=>{
      if(c.desvioPct == null) return;
      if(!somaPorIngrediente[c.nome]) somaPorIngrediente[c.nome] = {soma:0, n:0};
      somaPorIngrediente[c.nome].soma += c.desvioPct;
      somaPorIngrediente[c.nome].n += 1;
    });
  });
  const piores = Object.entries(somaPorIngrediente)
    .map(([nome, v])=> ({nome, media: arredProd(v.soma / v.n, 1)}))
    .filter(x=> x.media >= LIMIAR_DESVIO_CONSUMO_ALERTA_PROD)
    .sort((a,b)=> b.media - a.media);

  piores.slice(0,3).forEach(p=>{
    sugestoes.push(`"${p.nome}" está a ser consumido em média ${p.media}% acima do previsto nas fichas técnicas — vale a pena rever pesagem/porcionamento ou verificar desperdício no manuseio.`);
  });

  // Eficiência média (quantidade real vs prevista)
  const eficiencias = finalizadas.map(eficienciaOPProd).filter(e=>e!=null);
  if(eficiencias.length){
    const media = arredProd(eficiencias.reduce((s,e)=>s+e,0) / eficiencias.length, 1);
    if(media < 95){
      sugestoes.push(`A eficiência média das últimas Ordens de Produção é ${media}% (quantidade real vs prevista) — abaixo do ideal. Verifique se há perdas em quebras, refugo ou paragens de equipamento.`);
    }
  }

  // Lotes reprovados
  const reprovados = DBProducao.lotes.filter(l=>l.estado==='reprovado').length;
  if(reprovados){
    sugestoes.push(`Há ${reprovados} lote(s) reprovado(s) no controlo de qualidade — analise se há um padrão comum (mesmo produto, mesmo turno, mesmo equipamento) antes de repetir a produção.`);
  }

  if(!sugestoes.length){
    sugestoes.push('Os consumos e a eficiência das últimas Ordens de Produção estão dentro do esperado — sem desvios relevantes a assinalar de momento.');
  }
  return sugestoes;
}
