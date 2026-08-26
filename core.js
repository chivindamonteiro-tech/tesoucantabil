/* ============================================================
   TESOUCANTABIL — CORE PARTILHADO (core.js)
   ============================================================
   Ficheiro comum a TODOS os departamentos do projeto (Tesouraria/
   Contabilidade, Hotelaria, RH, Produção, Logística, etc.). Cada
   ficheiro .html do projeto inclui este script:
     <script src="core.js"></script>
   para partilhar a MESMA ligação ao servidor (Supabase), o MESMO
   login/papéis de acesso da equipa, e as constantes/funções que
   todos os departamentos precisam — sem duplicar (e desalinhar)
   esta parte em cada ficheiro novo.

   Guarda-se aqui SÓ o que é realmente comum e estável entre
   departamentos. A lógica própria de cada departamento (ecrãs,
   tabelas, formulários, regras de negócio específicas) fica no
   próprio ficheiro desse departamento — nunca aqui.

   IMPORTANTE: este ficheiro tem de estar na mesma pasta (ou o
   caminho no <script src="..."> tem de apontar corretamente) de
   cada ficheiro .html do projeto publicado no GitHub Pages.
   ============================================================ */

/* ---------- Ligação ao Supabase (mesmo projeto/base de dados do Tesoucantábil) ---------- */
const SUPABASE_URL = "https://okwvzccirgxnpugypsgf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_pOtoNEKOi2nZaiZVqn2uhQ_WTwy5ctm";
const supa = (typeof window!=='undefined' && window.supabase && SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------- Sessão / Papel de acesso (partilhado por todos os departamentos) ----------
   Usa a MESMA tabela team_roles já criada para o Tesoucantábil — os papéis e postos
   atribuídos lá aplicam-se em qualquer departamento que use este core.js. */
let meuEmail = null;
let meuPapel = 'colaborador';
let meuPosto = null;

async function carregarPapel(){
  meuPapel = 'colaborador'; meuPosto = null;
  try{
    const { data, error } = await supa.from('team_roles').select('role').eq('email', meuEmail).maybeSingle();
    if(!error && data){
      meuPapel = data.role;
      try{
        const { data: dataPosto, error: erroPosto } = await supa.from('team_roles').select('posto').eq('email', meuEmail).maybeSingle();
        if(!erroPosto && dataPosto) meuPosto = dataPosto.posto || null;
      }catch(e2){ /* coluna "posto" ainda não existe — ignora, fica sem posto */ }
    } else if(!error && !data){
      await supa.from('team_roles').insert({email: meuEmail, role: 'colaborador'});
    }
  }catch(e){ console.warn('Sem tabela team_roles ainda — a tratar como colaborador.', e); }
}

/* ---------- Utilitários partilhados ---------- */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,9); }
function hoje(){ return new Date().toISOString().slice(0,10); }
function fmt(n){ return (Number(n)||0).toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function xmlEsc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg){
  let t=document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
  t.textContent=msg; t.style.display='block';
  clearTimeout(window._tt); window._tt=setTimeout(()=>{ t.style.display='none'; },2200);
}
/* Rótulo de exibição da Forma de Pagamento — o valor interno continua "Cash" (usado em
   todas as comparações/lógica); isto só troca o texto mostrado ao utilizador. */
function labelFormaPagamento(f){ return f==='Cash' ? 'Cash (Numerário)' : (f||'—'); }

/* ---------- Dados mestre partilhados entre departamentos ----------
   Mantidos alinhados manualmente com o Tesoucantábil (index/erp principal) — se um dia
   mudar a lista de Contas ou Origens lá, replique aqui também. */
const FORMAS_PAGAMENTO = ["Cash","Banco","TPA (Multicaixa)","Multicaixa Express","Transferência Bancária"];
const CONTAS = [
 {codigo:"BAI-KZ-001",nome:"BAI-KZ-001 (BAI, KZ)"},
 {codigo:"BAI-EUR-001",nome:"BAI-EUR-001 (BAI, EUR)"},
 {codigo:"BAI-USD-002",nome:"BAI-USD-002 (BAI, USD)"},
 {codigo:"BAI-003",nome:"BAI-003 (BAI)"},
 {codigo:"BFA-KZ-002",nome:"BFA-KZ-002 (BFA, KZ)"},
 {codigo:"BFA-001",nome:"BFA-001 (BFA)"},
 {codigo:"CASH",nome:"CAIXA TESOURARIA (Caixa Geral)"},
];
const ORIGENS = ["ZOOM'S LODGE CASH","ZOOM'S LODGE BANCO",
"BAKERY LINE-MAIN STORE CASH","BAKERY LINE-MAIN STORE BANCO",
"BAKERY LINE-CFM STORE CASH","BAKERY LINE-CFM STORE BANCO",
"BAKERY LINE-NEW STORE CASH","BAKERY LINE-NEW STORE BANCO",
"SUPRIMENTOS"];
const UNIDADES_NEGOCIO = [...new Set(ORIGENS.filter(o=>o!=='SUPRIMENTOS').map(o=>o.replace(/ (CASH|BANCO)$/,'')))].concat(["SUPRIMENTOS"]);
const CATEGORIAS_RECEITAS = [
 "Venda de Mercadorias","Venda de Produtos Acabados","Prestação de Serviços",
 "Prestação de Serviços de Alojamento","Receitas de Restauração","Receitas de Padaria e Pastelaria",
 "Receitas de Loja / Comércio a Retalho","Receitas de Bar e Bebidas","Receitas de Outros Serviços",
 "Outras Receitas Operacionais",
];

/* ---------- Escrita partilhada em erp_data (só para ACRESCENTAR Lançamentos) ----------
   Os departamentos NÃO leem nem gravam o erp_data inteiro (isso continua a ser só do
   Tesoucantábil) — usam esta função só para acrescentar um Lançamento novo (receita/despesa)
   gerado pela sua operação (ex.: check-out de um quarto), sem arriscar sobrescrever o resto
   dos dados de Tesouraria. Faz sempre uma leitura fresca + gravação com bloqueio otimista
   (igual ao já usado no Tesoucantábil), com tentativas automáticas se houver conflito
   (outra pessoa a gravar dados ao mesmo tempo em qualquer um dos ficheiros do projeto). */
async function adicionarLancamentoPartilhado(lanc, tentativas=3){
  for(let i=0;i<tentativas;i++){
    let { data, error } = await supa.from('erp_data').select('data, versao').eq('id','main').single();
    if(error && String(error.message||'').toLowerCase().includes('versao')){
      ({ data, error } = await supa.from('erp_data').select('data').eq('id','main').single());
      if(error){ console.warn(error); return {ok:false, erro:error.message}; }
      const atual = data.data || {};
      atual.lancamentos = Array.isArray(atual.lancamentos) ? atual.lancamentos : [];
      atual.lancamentos.push(lanc);
      const { error: err2 } = await supa.from('erp_data').update({data: atual, updated_at: new Date().toISOString()}).eq('id','main');
      if(err2){ console.warn(err2); return {ok:false, erro:err2.message}; }
      return {ok:true};
    }
    if(error){ console.warn(error); return {ok:false, erro:error.message}; }
    const atual = data.data || {};
    atual.lancamentos = Array.isArray(atual.lancamentos) ? atual.lancamentos : [];
    atual.lancamentos.push(lanc);
    const versaoEsperada = (data.versao===undefined||data.versao===null) ? 0 : data.versao;
    const novaVersao = versaoEsperada + 1;
    const { data: dataUpd, error: errUpd } = await supa.from('erp_data')
      .update({data: atual, updated_at: new Date().toISOString(), versao: novaVersao})
      .eq('id','main').eq('versao', versaoEsperada).select('versao');
    if(errUpd){
      if(String(errUpd.message||'').toLowerCase().includes('versao')){
        const { error: err3 } = await supa.from('erp_data').update({data: atual, updated_at: new Date().toISOString()}).eq('id','main');
        if(err3){ console.warn(err3); return {ok:false, erro:err3.message}; }
        return {ok:true};
      }
      console.warn(errUpd); return {ok:false, erro:errUpd.message};
    }
    if(dataUpd && dataUpd.length) return {ok:true};
    /* conflito de versão — outra pessoa gravou entretanto; tenta novamente do zero */
  }
  return {ok:false, erro:'Não foi possível gravar depois de várias tentativas — outra pessoa está a gravar dados ao mesmo tempo. Tente novamente.'};
}

/* ---------- Genérico: carregar/gravar os dados PRÓPRIOS de um departamento ----------
   Cada departamento tem a sua própria tabela no Supabase (ex.: hotel_data, rh_data,
   producao_data...), com o mesmo desenho já usado no Tesoucantábil: uma única linha
   (id="main"), coluna jsonb "data", e bloqueio otimista por coluna "versao" — crie a
   tabela no SQL Editor do Supabase com o mesmo modelo do erp_data, só trocando o nome
   (ver instruções no ficheiro do departamento). */
function criarArmazemDepartamento(nomeTabela){
  let versao = null, semColunaVersao = false;
  return {
    async carregar(valoresPadrao){
      try{
        let { data, error } = await supa.from(nomeTabela).select('data, versao').eq('id','main').single();
        if(error && String(error.message||'').toLowerCase().includes('versao')){
          semColunaVersao = true;
          ({ data, error } = await supa.from(nomeTabela).select('data').eq('id','main').single());
        }
        if(error) throw error;
        if(data && !semColunaVersao) versao = (data.versao===undefined||data.versao===null) ? 0 : data.versao;
        return Object.assign({}, valoresPadrao, (data && data.data) || {});
      }catch(e){
        console.warn(`Erro ao carregar ${nomeTabela}`, e);
        toast(`Não consegui carregar os dados de "${nomeTabela}" — confirme se a tabela já foi criada no Supabase.`);
        return Object.assign({}, valoresPadrao);
      }
    },
    async gravar(dados){
      try{
        if(semColunaVersao){
          const { error } = await supa.from(nomeTabela).update({data: dados, updated_at: new Date().toISOString()}).eq('id','main');
          if(error) throw error;
          return true;
        }
        const versaoEsperada = versao||0, novaVersao = versaoEsperada+1;
        const { data, error } = await supa.from(nomeTabela)
          .update({data: dados, updated_at: new Date().toISOString(), versao: novaVersao})
          .eq('id','main').eq('versao', versaoEsperada).select('versao');
        if(error){
          if(String(error.message||'').toLowerCase().includes('versao')){
            semColunaVersao = true;
            const { error: error2 } = await supa.from(nomeTabela).update({data: dados, updated_at: new Date().toISOString()}).eq('id','main');
            if(error2) throw error2;
            toast('Aviso: a proteção contra gravações simultâneas ainda não está ativa nesta tabela.');
            return true;
          }
          throw error;
        }
        if(!data || !data.length){
          alert('⚠️ Outra pessoa gravou alterações neste sistema entretanto.\n\nPara não apagar o trabalho dela, a tua última ação NÃO foi guardada.\n\nA página vai recarregar com os dados mais recentes — por favor repete a última ação.');
          location.reload();
          return false;
        }
        versao = novaVersao;
        return true;
      }catch(e){ console.warn(e); toast('Erro ao guardar no servidor. Tente novamente.'); return false; }
    }
  };
}

/* ---------- Login (mesmo ecrã/lógica de sempre, partilhado por todos os departamentos) ----------
   Cada ficheiro .html do projeto deve ter no seu HTML os elementos: #loginScreen,
   #formLogin, #loginEmail, #loginSenha, #loginErro, #app (com #nav e #main dentro) —
   ver hotel.html como modelo pronto a copiar para o próximo departamento.
   Chame iniciarLogin(aoEntrar, aoSair) no fim do script do departamento. */
async function iniciarLogin(aoEntrar, aoSair){
  if(!supa){
    document.getElementById('loginScreen').style.display='flex';
    document.getElementById('loginErro').textContent = 'Ainda não configurada a ligação ao Supabase.';
    return;
  }
  const { data: { session } } = await supa.auth.getSession();
  if(session){ meuEmail = session.user.email; await carregarPapel(); await aoEntrar(); }
  else aoSair();

  supa.auth.onAuthStateChange(async (event, session)=>{
    /* Evita recarregar a app em revalidações de sessão (ex.: voltar da câmara/galeria),
       só em login/logout reais — igual ao Tesoucantábil. */
    if(event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION'){
      if(session) meuEmail = session.user.email;
      return;
    }
    if(session){ meuEmail = session.user.email; await carregarPapel(); await aoEntrar(); }
    else aoSair();
  });

  document.getElementById('formLogin').onsubmit = async e=>{
    e.preventDefault();
    const email=document.getElementById('loginEmail').value.trim();
    const senha=document.getElementById('loginSenha').value;
    const erroEl=document.getElementById('loginErro');
    erroEl.textContent='';
    const { error } = await supa.auth.signInWithPassword({email,password:senha});
    if(error) erroEl.textContent = error.message;
  };
}
async function sairSessao(){ await supa.auth.signOut(); }
