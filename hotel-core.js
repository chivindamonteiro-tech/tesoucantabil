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

function toastHotel(msg){
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
  reservas: []
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

    DBHotel = Object.assign({tiposQuarto:[],quartos:[],reservas:[]}, data.data || {});
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

/* ---------- lógica de reservas ---------- */
function quartoOcupadoHotel(quartoId, checkin, checkout){
  return DBHotel.reservas.some(r =>
    r.quartoId === quartoId &&
    r.estado !== 'cancelada' &&
    !(checkout <= r.checkinPrevisto || checkin >= r.checkoutPrevisto)
  );
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
