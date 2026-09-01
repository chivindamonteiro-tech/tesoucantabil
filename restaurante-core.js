/* ============================================================
   RESTAURANTE-CORE.JS — Módulo independente de Restauração (POS)
   ============================================================
   Ficheiro próprio do departamento de Restauração. NÃO mexe nos
   dados da Contabilidade/Tesouraria (core.js), da Hotelaria
   (hotel-core.js) nem da Logística (logistica-core.js) — usa a
   mesma ligação Supabase, mas grava numa linha própria da tabela
   "restaurante_data", para nunca entrar em conflito com o resto
   do sistema.

   INTEGRAÇÃO COM TESOUCANTABIL:
   → Todos os lançamentos de restaurante (consumos de mesas, serviços
     de bar, extras) são gravados como linhas de "folio" dos hóspedes
     (se consumo no quarto) OU como fecho de caixa independente
     (se pagamento direto na mesa).
   → As formas de pagamento, contas bancárias e categorias de receita
     são IDÊNTICAS às do Tesoucantabil, para que os relatórios,
     filtros e fechos de caixa funcionem perfeitamente.

   Todos os nomes aqui têm o sufixo "Rest" para nunca colidirem
   com core.js/hotel-core.js/logistica-core.js, caso um dia
   fiquem incluídos na mesma página.

   Inclui no <head> do restaurante.html, por esta ordem:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="restaurante-core.js"></script>
   ============================================================ */

const SUPABASE_URL_REST = "https://okwvzccirgxnpugypsgf.supabase.co";
const SUPABASE_ANON_KEY_REST = "sb_publishable_pOtoNEKOi2nZaiZVqn2uhQ_WTwy5ctm";

const supaRest = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL_REST, SUPABASE_ANON_KEY_REST)
  : null;

/* ---------- utilidades genéricas ---------- */
function uidRest(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function hojeISORest(){
  return new Date().toISOString().split('T')[0];
}

function diasEntreRest(dataISO1, dataISO2){
  const d1 = new Date(dataISO1 + 'T00:00:00');
  const d2 = new Date(dataISO2 + 'T00:00:00');
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function arredRest(n, casas=2){
  const f = Math.pow(10, casas);
  return Math.round((Number(n)||0) * f) / f;
}

function toastRest(msg, tipo='info'){
  let el = document.getElementById('toastBoxRest');
  if(!el){
    el = document.createElement('div');
    el.id = 'toastBoxRest';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#14232B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.opacity = '0'; }, 2500);
}

/* ============================================================
   ESQUEMA REAL DO TESOUCANTÁBIL (contabilidade.html)
   ============================================================
   Estas constantes replicam EXATAMENTE os valores usados no
   Tesoucantabil, para que os lançamentos gerados pelo Restaurante
   fiquem 100% compatíveis com os relatórios, filtros e fechos de
   caixa (nada de "Receita"/"receita" trocado).
   ============================================================ */

const UNIDADE_RESTO = "ZOOM'S LODGE";

const FORMAS_PAGAMENTO_REST = ["Cash","Banco","TPA (Multicaixa)","Multicaixa Express","Transferência Bancária"];

/* Mesmas 7 contas do Plano de Contas do Tesoucantábil */
const CONTAS_REST = [
  {codigo:"CASH", nome:"CAIXA TESOURARIA (Caixa Geral)"},
  {codigo:"BAI-KZ-001", nome:"BAI-KZ-001 (BAI, KZ)"},
  {codigo:"BAI-EUR-001", nome:"BAI-EUR-001 (BAI, EUR)"},
  {codigo:"BAI-USD-002", nome:"BAI-USD-002 (BAI, USD)"},
  {codigo:"BAI-003", nome:"BAI-003 (BAI)"},
  {codigo:"BFA-KZ-002", nome:"BFA-KZ-002 (BFA, KZ)"},
  {codigo:"BFA-001", nome:"BFA-001 (BFA)"}
];

/* Mapeamento de Tipo de Venda (Restaurante) → Categoria, idêntico ao TIPOS_VENDA_ZOOMS_LODGE */
const TIPOS_VENDA_RESTAURANTE = {
  "Restauração": "Receitas de Restauração",
  "Bar": "Receitas de Bar e Bebidas",
  "Serviço": "Receitas de Outros Serviços"
};

function labelFormaPagamentoRest(f){ 
  return f==='Cash' ? 'Cash (Numerário)' : (f||'—'); 
}

/* Origem automática = Unidade + CASH/BANCO */
function origemAutomaticaRest(forma){
  return `${UNIDADE_RESTO} ${forma==='Cash' ? 'CASH' : 'BANCO'}`;
}

/* Número de referência interno para comanda/fatura do restaurante */
function gerarNumeroComandaRest(){
  const ano = new Date().getFullYear();
  const mes = String(new Date().getMonth() + 1).padStart(2, '0');
  const dia = String(new Date().getDate()).padStart(2, '0');
  const seq = Date.now().toString(36).slice(-5).toUpperCase();
  return `ZL/${ano}/${mes}/${dia}-${seq}`;
}

/* ---------- estado dos dados de Restaurante ---------- */
let DBRest = {
  // Configuração de mesas e zonas
  zonas: [], // [{id, nome, descricao}] — ex: "Sala Principal", "Esplanada", "Bar"
  mesas: [], // [{id, zonaId, numero, capacidade, statusAtual, reservada, notas}]
  
  // Cardápio digital
  categorias: [], // [{id, nome, icone, descricao, ordenacao}] — ex: "Entradas", "Pratos Principais"
  produtos: [], // [{id, categoriaId, nome, descricao, preco, disponivel, foto, calorias, alergenos}]
  combos: [], // [{id, nome, descricao, preco, itens:[{produtoId, quantidade}], desconto%}]
  
  // Pedidos e comandas
  comandas: [], // [{id, mesaId, hospedeId, garcomId, dataAbertura, dataFecho, status:'aberta'|'fechada'|'paga', pedidos:[...], observacoes}]
  pedidos: [], // [{id, comandaId, numero, dataPedido, itens:[{produtoId,qtd,especiais,preco}], status:'recebido'|'em-prep'|'pronto'|'entregue', observacoesCozinha, dataEntrega}]
  
  // Funcionários
  garcons: [], // [{id, nome, contacto, ativo, comissao%}]
  chefes: [], // [{id, nome, contacto, ativo, especialidade}]
  
  // Consumo no quarto (integração hotel)
  consumosQuarto: [], // [{id, hospedeId, quartoId, dataLancamento, items:[{descricao,qtd,preco}], total, lancadoEm, processoFaturaHotel}]
  
  // Mesas reservadas
  reservasMesa: [], // [{id, data, hora, mesaId, zonaId, nomeCliente, contacto, numeroMesas, notas, confirmedEm}]
  
  // Caixa e pagamentos
  fechosCaixaResto: [], // [{id, data, linhas:[{tipoVenda,forma,conta,valor}], total, lancamentoIds, criadoEm}]
  
  // Configuração
  horariosFuncionamento: [], // [{dia:0-6, abertura:'08:00', fecho:'23:00'}]
  taxasServico: {
    percentual: 10, // taxa padrão em percentagem
    aplicarPorcentagem: true
  },
  
  // Estatísticas diárias
  estatisticas: [] // [{data, vendas, ticketMedio, mesasUsadas, ocupacaoMedia, pedidosProcessados, tempoMedioPreparacao}]
};

let versaoRest = null;
let semColunaVersaoRest = false;

/* Carrega os dados de restaurante_data (linha id="main") */
async function carregarDadosRest(){
  if(!supaRest){ toastRest('Sem ligação ao Supabase.'); return; }
  try{
    let { data, error } = await supaRest.from('restaurante_data').select('*').eq('id','main').maybeSingle();

    if(error && String(error.message||'').toLowerCase().includes('column')){
      semColunaVersaoRest = true;
      ({ data, error } = await supaRest.from('restaurante_data').select('id,data').eq('id','main').maybeSingle());
    }
    if(error) throw error;

    if(!data){
      // primeira vez: cria a linha com os valores padrão
      const payload = { id:'main', data: DBRest };
      if(!semColunaVersaoRest) payload.versao = 1;
      const { error: errIns } = await supaRest.from('restaurante_data').insert(payload);
      if(errIns) console.warn(errIns);
      versaoRest = 1;
      return;
    }

    DBRest = Object.assign({
      zonas:[],mesas:[],categorias:[],produtos:[],combos:[],comandas:[],pedidos:[],
      garcons:[],chefes:[],consumosQuarto:[],reservasMesa:[],fechosCaixaResto:[],
      horariosFuncionamento:[],taxasServico:{percentual:10,aplicarPorcentagem:true},estatisticas:[]
    }, data.data || {});
    
    // Garante que todos os campos existem
    if(!DBRest.consumosQuarto) DBRest.consumosQuarto = [];
    if(!DBRest.reservasMesa) DBRest.reservasMesa = [];
    if(!DBRest.fechosCaixaResto) DBRest.fechosCaixaResto = [];
    if(!DBRest.garcons) DBRest.garcons = [];
    if(!DBRest.chefes) DBRest.chefes = [];
    if(!DBRest.horariosFuncionamento) DBRest.horariosFuncionamento = [];
    if(!DBRest.taxasServico) DBRest.taxasServico = {percentual:10,aplicarPorcentagem:true};
    if(!DBRest.estatisticas) DBRest.estatisticas = [];
    
    versaoRest = data.versao || 1;
  }catch(e){
    console.warn('Erro ao carregar dados de restaurante:', e);
    toastRest('Não consegui carregar os dados do restaurante — a usar valores locais.');
  }
}

/* Grava DBRest inteiro com bloqueio otimista */
async function saveDBRest(tentativas = 3){
  if(!supaRest){ 
    toastRest('Sem ligação ao Supabase — alterações só ficam localmente.'); 
    return {ok:false}; 
  }
  try{
    if(semColunaVersaoRest){
      const { error } = await supaRest.from('restaurante_data').update({data: DBRest}).eq('id','main');
      if(error) throw error;
      return {ok:true};
    }

    const versaoEsperada = versaoRest;
    const novaVersao = versaoEsperada + 1;
    const { data: dataUpd, error: errUpd } = await supaRest
      .from('restaurante_data')
      .update({data: DBRest, versao: novaVersao, updated_at: new Date().toISOString()})
      .eq('id','main').eq('versao', versaoEsperada)
      .select();

    if(errUpd){
      console.warn(errUpd);
      toastRest('Não foi possível guardar. Tenta novamente.');
      return {ok:false};
    }
    if(dataUpd && dataUpd.length){
      versaoRest = novaVersao;
      return {ok:true};
    }

    // Conflito: recarrega e tenta de novo
    if(tentativas > 0){
      const dbLocal = DBRest;
      await carregarDadosRest();
      DBRest = dbLocal; 
      return await saveDBRest(tentativas - 1);
    }
    toastRest('Conflito ao guardar — tenta novamente.');
    return {ok:false};
  }catch(e){
    console.warn('Erro ao gravar dados de restaurante:', e);
    toastRest('Erro ao guardar os dados do restaurante.');
    return {ok:false};
  }
}

/* ============================================================
   LEITURA (SOMENTE LEITURA) DOS LANÇAMENTOS DO CHEFE DE CAIXA
   NO TESOUCANTÁBIL (index.html)
   ------------------------------------------------------------
   O Restaurante não grava nada nesta tabela — só lê, para o Fecho
   de Caixa do Restaurante mostrar os lançamentos que o(a) Chefe de
   Caixa já declarou no Tesoucantábil (aba "📝 Fecho de Caixa" →
   Lançamentos), para conferência. Mesma tabela/linha usada pelo
   index-17-corrigido.html: supa.from('erp_data').select('data')
   .eq('id','main'). Filtra por Unidade = UNIDADE_RESTO ("ZOOM'S
   LODGE") e Categoria = "Receitas de Restauração" (o mesmo valor
   que TIPOS_VENDA_ZOOMS_LODGE['Restauração'] produz no index) —
   se essa categoria mudar de nome lá, atualizar aqui também.
   ============================================================ */
const CATEGORIA_RECEITA_RESTAURACAO_TESOUCANTABIL = TIPOS_VENDA_RESTAURANTE["Restauração"]; // "Receitas de Restauração"

async function buscarLancamentosChefeCaixaRest(data){
  if(!supaRest) return {ok:false, msg:'Sem ligação ao Supabase.', linhas:[]};
  try{
    const { data: linha, error } = await supaRest
      .from('erp_data')
      .select('data')
      .eq('id', 'main')
      .maybeSingle();
    if(error) throw error;

    const lancamentos = (linha && linha.data && Array.isArray(linha.data.lancamentos)) ? linha.data.lancamentos : [];
    const linhas = lancamentos.filter(l =>
      l.data === data &&
      l.unidade === UNIDADE_RESTO &&
      l.categoria === CATEGORIA_RECEITA_RESTAURACAO_TESOUCANTABIL
    );
    const total = arredRest(linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0));
    return {ok:true, linhas, total};
  }catch(e){
    console.warn('Erro ao buscar lançamentos do Chefe de Caixa (Tesoucantábil):', e);
    return {ok:false, msg:'Não foi possível ler os lançamentos do Tesoucantábil — verifique a ligação.', linhas:[], total:0};
  }
}

/* ============================================================
   LÓGICA DE MESAS
   ============================================================ */

function getMesaRest(mesaId){
  return DBRest.mesas.find(m => m.id === mesaId);
}

function getMesasDisponiveisRest(data, hora){
  // Retorna mesas que não estão reservadas nessa data/hora
  return DBRest.mesas.filter(m => {
    const temReserva = DBRest.reservasMesa.some(r => 
      r.mesaId === m.id && 
      r.data === data && 
      r.confirmedEm !== null // confirmada
    );
    const temComanda = DBRest.comandas.some(c => 
      c.mesaId === m.id && 
      c.status !== 'paga' // comanda em aberto
    );
    return !temReserva && !temComanda;
  });
}

function getTotalOcupacaoRest(data){
  const mesasTotal = DBRest.mesas.length;
  const mesasOcupadas = DBRest.comandas.filter(c => {
    const pedidos = DBRest.pedidos.filter(p => p.comandaId === c.id);
    return c.statusAtual !== 'paga' && pedidos.length > 0;
  }).length;
  return mesasTotal > 0 ? arredRest((mesasOcupadas / mesasTotal) * 100) : 0;
}

/* ============================================================
   LÓGICA DE COMANDAS E PEDIDOS
   ============================================================ */

function novaComandaRest(mesaId, garcomId){
  const comanda = {
    id: uidRest(),
    mesaId: mesaId,
    hospedeId: null,
    garcomId: garcomId,
    numero: gerarNumeroComandaRest(),
    dataAbertura: new Date().toISOString(),
    dataFecho: null,
    status: 'aberta', // aberta|fechada|paga
    pedidos: [],
    observacoes: '',
    subTotal: 0,
    taxaServico: 0,
    desconto: 0,
    total: 0
  };
  DBRest.comandas.push(comanda);
  return comanda;
}

function novoPedidoRest(comandaId, itens, observacoes=''){
  // itens: [{produtoId, quantidade, especiais}]
  const comanda = DBRest.comandas.find(c => c.id === comandaId);
  if(!comanda) return null;

  const pedido = {
    id: uidRest(),
    comandaId: comandaId,
    numero: `${comanda.numero}-${comanda.pedidos.length + 1}`,
    dataPedido: new Date().toISOString(),
    itens: itens.map(item => {
      const produto = DBRest.produtos.find(p => p.id === item.produtoId);
      return {
        id: uidRest(),
        produtoId: item.produtoId,
        nome: produto?.nome || 'Produto desconhecido',
        quantidade: item.quantidade,
        preco: produto?.preco || 0,
        especiais: item.especiais || '',
        subtotal: arredRest((produto?.preco || 0) * item.quantidade)
      };
    }),
    status: 'recebido', // recebido|em-prep|pronto|entregue
    observacoesCozinha: observacoes,
    dataEnvio: null,
    dataPronto: null,
    dataEntrega: null,
    cozinhaId: null,
    despachante: null
  };

  comanda.pedidos.push(pedido.id);
  DBRest.pedidos.push(pedido);
  recalcularTotalComandaRest(comandaId);
  
  return pedido;
}

function recalcularTotalComandaRest(comandaId){
  const comanda = DBRest.comandas.find(c => c.id === comandaId);
  if(!comanda) return;

  const pedidos = DBRest.pedidos.filter(p => p.comandaId === comandaId);
  let subTotal = 0;
  
  pedidos.forEach(pedido => {
    pedido.itens.forEach(item => {
      subTotal += item.subtotal;
    });
  });

  comanda.subTotal = arredRest(subTotal);
  
  // Aplica taxa de serviço
  comanda.taxaServico = DBRest.taxasServico.aplicarPorcentagem 
    ? arredRest(subTotal * (DBRest.taxasServico.percentual / 100))
    : 0;
  
  comanda.total = arredRest(comanda.subTotal + comanda.taxaServico - comanda.desconto);
}

function fecharComandaRest(comandaId){
  const comanda = DBRest.comandas.find(c => c.id === comandaId);
  if(!comanda) return null;
  comanda.status = 'fechada';
  comanda.dataFecho = new Date().toISOString();
  return comanda;
}

function pagarComandaRest(comandaId, formaPagamento, conta, referencia=''){
  const comanda = DBRest.comandas.find(c => c.id === comandaId);
  if(!comanda) return null;

  recalcularTotalComandaRest(comandaId);
  
  // Se for consumo no quarto, lança no folio do hóspede
  if(comanda.hospedeId){
    const consumo = {
      id: uidRest(),
      comandaId: comandaId,
      hospedeId: comanda.hospedeId,
      dataLancamento: new Date().toISOString(),
      descricao: `Consumo Restaurante - ${comanda.numero}`,
      valor: comanda.total,
      tipo: 'consumo',
      categoria: 'Restauração'
    };
    DBRest.consumosQuarto.push(consumo);
  } else {
    // Senão, cria um fecho de caixa local
    const linhaFecho = {
      comandaId: comandaId,
      numero: comanda.numero,
      tipoVenda: 'Restauração',
      valor: comanda.total,
      formaPagamento: formaPagamento,
      conta: conta,
      referencia: referencia,
      garcom: DBRest.garcons.find(g => g.id === comanda.garcomId)?.nome || 'N/A',
      dataHora: new Date().toISOString()
    };
    
    // Verifica se já existe um fecho do dia, senão cria novo
    const hoje = hojeISORest();
    let fecho = DBRest.fechosCaixaResto.find(f => f.data === hoje);
    if(!fecho){
      fecho = {
        id: uidRest(),
        data: hoje,
        linhas: [],
        total: 0,
        lancamentoIds: [],
        criadoEm: new Date().toISOString()
      };
      DBRest.fechosCaixaResto.push(fecho);
    }
    fecho.linhas.push(linhaFecho);
    fecho.total = arredRest(fecho.total + comanda.total);
  }

  comanda.status = 'paga';
  comanda.formaPagamento = formaPagamento;
  comanda.conta = conta;
  
  return comanda;
}

/* ============================================================
   INTEGRAÇÃO COM HOTEL (consumo no quarto)
   ------------------------------------------------------------
   Requer que hotel-core.js esteja incluído ANTES de
   restaurante-core.js na página (ver restaurante-1.html) — se não
   estiver, a integração é ignorada silenciosamente e o Restaurante
   continua a funcionar de forma independente (mesmo padrão já
   usado entre producao-core.js e logistica-core.js).
   ============================================================ */

/* Verifica se o módulo de Hotelaria está carregado na mesma página. */
function hotelDisponivelRest(){
  return typeof DBHotel !== 'undefined'
    && typeof adicionarFolioHotel === 'function'
    && typeof getStatusMapaQuartoHotel === 'function'
    && typeof saveDBHotel === 'function';
}

/* Lista os quartos REAIS do Hotel que estão atualmente ocupados
   (check-in feito, ainda sem check-out) — para preencher o
   dropdown do "Consumo no Quarto" com quartos e hóspedes reais,
   em vez de o utilizador escrever o número/ID à mão. */
function listarQuartosOcupadosHotelRest(){
  if(!hotelDisponivelRest()) return [];
  const hoje = hojeISORest();
  return DBHotel.quartos
    .map(q => {
      const st = getStatusMapaQuartoHotel(q.id, hoje);
      if(st.status !== 'ocupado' || !st.reservaId) return null;
      const reserva = DBHotel.reservas.find(r => r.id === st.reservaId);
      if(!reserva) return null;
      return {
        quartoId: q.id,
        numero: q.numero,
        reservaId: reserva.id,
        hospedeNome: reserva.hospedeNome || 'Hóspede'
      };
    })
    .filter(Boolean)
    .sort((a,b) => String(a.numero).localeCompare(String(b.numero), undefined, {numeric:true}));
}

/* Lança um consumo do Restaurante diretamente no folio do hóspede,
   via adicionarFolioHotel (hotel-core.js) — mesmo mecanismo que o
   check-out do Hotel já usa para somar a diária + extras. O consumo
   entra como "por pagar" (pago:false), ou seja, fica no saldo em
   aberto do hóspede e só é cobrado/lançado na Tesouraria no
   check-out (evita duplicar o lançamento aqui no Restaurante).
   Grava também uma cópia local em DBRest.consumosQuarto, só para
   histórico/consulta dentro do próprio Restaurante. */
async function lançarConsumoQuartoRest(reservaId, quartoId, descricao, valor, categoria='Restauração'){
  const consumo = {
    id: uidRest(),
    reservaId: reservaId,
    quartoId: quartoId,
    descricao: descricao,
    valor: valor,
    categoria: categoria,
    dataLancamento: new Date().toISOString(),
    lancadoEm: null,
    espelhadoNoFolio: false
  };

  if(hotelDisponivelRest() && reservaId){
    try{
      const itemFolio = adicionarFolioHotel(reservaId, {
        tipo: 'consumo',
        descricao: `[Restaurante] ${descricao}`,
        tipoVenda: 'Restauração',
        valor: Number(valor) || 0,
        formaPagamento: '',
        pago: false
      });
      const resultado = await saveDBHotel();
      if(resultado && resultado.ok){
        consumo.espelhadoNoFolio = true;
        consumo.folioId = itemFolio.id;
      } else {
        toastRest('Consumo registado no Restaurante, mas não foi possível gravar no folio do Hotel — tente novamente.', 'danger');
      }
    }catch(e){
      console.warn('Erro ao espelhar consumo no folio do Hotel:', e);
      toastRest('Consumo registado no Restaurante, mas não foi possível espelhar no folio do Hotel.', 'danger');
    }
  }

  DBRest.consumosQuarto.push(consumo);
  await saveDBRest();
  return consumo;
}

/* ============================================================
   LÓGICA DE RESERVA DE MESAS
   ============================================================ */

function reservarMesaRest(data, hora, mesaId, nomeCliente, contacto, numeroMesas=1, notas=''){
  const reserva = {
    id: uidRest(),
    data: data,
    hora: hora,
    mesaId: mesaId,
    nomeCliente: nomeCliente,
    contacto: contacto,
    numeroMesas: numeroMesas,
    notas: notas,
    confirmedEm: null,
    criadaEm: new Date().toISOString()
  };
  DBRest.reservasMesa.push(reserva);
  return reserva;
}

/* ============================================================
   RELATÓRIOS
   ============================================================ */

function relatorioVendasRest(dataIni, dataFim){
  let totalVendas = 0;
  let numPedidos = 0;
  let numMesas = 0;
  const vendidosPorProduto = {};
  const vendidosPorGarcom = {};
  
  DBRest.comandas.forEach(comanda => {
    if(comanda.status === 'paga' && comanda.dataFecho){
      if(comanda.dataFecho.split('T')[0] >= dataIni && comanda.dataFecho.split('T')[0] <= dataFim){
        totalVendas += comanda.total;
        numMesas++;
        
        const garcom = DBRest.garcons.find(g => g.id === comanda.garcomId);
        const nomeGarcom = garcom?.nome || 'Sem garçom';
        vendidosPorGarcom[nomeGarcom] = (vendidosPorGarcom[nomeGarcom] || 0) + comanda.total;
        
        comanda.pedidos.forEach(pedidoId => {
          const pedido = DBRest.pedidos.find(p => p.id === pedidoId);
          if(pedido){
            numPedidos++;
            pedido.itens.forEach(item => {
              vendidosPorProduto[item.nome] = (vendidosPorProduto[item.nome] || 0) + item.quantidade;
            });
          }
        });
      }
    }
  });

  return {
    dataIni,
    dataFim,
    totalVendas: arredRest(totalVendas),
    ticketMedio: arredRest(numMesas > 0 ? totalVendas / numMesas : 0),
    mesasServidas: numMesas,
    pedidosProcessados: numPedidos,
    vendidosPorProduto,
    vendidosPorGarcom,
    produtosMaisVendidos: Object.entries(vendidosPorProduto)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  };
}

function relatorioOcupacaoRest(data){
  const mesasTotal = DBRest.mesas.length;
  const mesasOcupadas = DBRest.comandas.filter(c => {
    return c.status !== 'paga' && c.dataAbertura.split('T')[0] === data;
  }).length;
  
  const ocupacao = mesasTotal > 0 ? arredRest((mesasOcupadas / mesasTotal) * 100) : 0;
  
  return {
    data,
    mesasTotal,
    mesasOcupadas,
    mesasLivres: mesasTotal - mesasOcupadas,
    ocupacao: ocupacao + '%'
  };
}

function relatorioDesempenhoGarcomRest(dataIni, dataFim){
  const desempenho = {};
  
  DBRest.comandas.forEach(comanda => {
    if(comanda.status === 'paga' && comanda.dataFecho){
      if(comanda.dataFecho.split('T')[0] >= dataIni && comanda.dataFecho.split('T')[0] <= dataFim){
        const garcom = DBRest.garcons.find(g => g.id === comanda.garcomId);
        const nomeGarcom = garcom?.nome || 'Sem garçom';
        
        if(!desempenho[nomeGarcom]){
          desempenho[nomeGarcom] = {
            nome: nomeGarcom,
            totalVendas: 0,
            numMesas: 0,
            numPedidos: 0,
            comissao: 0
          };
        }
        
        desempenho[nomeGarcom].totalVendas += comanda.total;
        desempenho[nomeGarcom].numMesas++;
        desempenho[nomeGarcom].numPedidos += comanda.pedidos.length;
        
        if(garcom?.comissao){
          desempenho[nomeGarcom].comissao += arredRest(comanda.total * (garcom.comissao / 100));
        }
      }
    }
  });
  
  // Ordena por vendas
  return Object.values(desempenho)
    .map(g => ({
      ...g,
      totalVendas: arredRest(g.totalVendas),
      ticketMedio: arredRest(g.numMesas > 0 ? g.totalVendas / g.numMesas : 0),
      comissao: arredRest(g.comissao)
    }))
    .sort((a, b) => b.totalVendas - a.totalVendas);
}

function relatorioTempoPreparacaoRest(dataIni, dataFim){
  const tempos = [];
  
  DBRest.pedidos.forEach(pedido => {
    const data = pedido.dataPedido.split('T')[0];
    if(data >= dataIni && data <= dataFim && pedido.dataPronto && pedido.dataPedido){
      const tempoMs = new Date(pedido.dataPronto) - new Date(pedido.dataPedido);
      const tempoMin = Math.round(tempoMs / 60000);
      tempos.push(tempoMin);
    }
  });
  
  const media = tempos.length > 0 ? Math.round(tempos.reduce((a,b) => a+b) / tempos.length) : 0;
  const minimo = tempos.length > 0 ? Math.min(...tempos) : 0;
  const maximo = tempos.length > 0 ? Math.max(...tempos) : 0;
  
  return {
    dataIni,
    dataFim,
    pedidosAnalisados: tempos.length,
    tempoMedioMin: media,
    tempoMinimoMin: minimo,
    tempoMaximoMin: maximo
  };
}

/* ============================================================
   FUNÇÕES AUXILIARES PARA INTERFACE
   ============================================================ */

function getZonaRest(zonaId){
  return DBRest.zonas.find(z => z.id === zonaId);
}

function getGarcomRest(garcomId){
  return DBRest.garcons.find(g => g.id === garcomId);
}

function getProdutoRest(produtoId){
  return DBRest.produtos.find(p => p.id === produtoId);
}

function getCategoriaRest(categoriaId){
  return DBRest.categorias.find(c => c.id === categoriaId);
}

function getComandaRest(comandaId){
  return DBRest.comandas.find(c => c.id === comandaId);
}

function getPedidoRest(pedidoId){
  return DBRest.pedidos.find(p => p.id === pedidoId);
}
