import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const emptyOffer = {
  titulo: "",
  plataforma: "",
  precoAtual: "",
  precoAnterior: "",
  desconto: "",
  comissaoPercentual: "",
  comissaoEstimada: "",
  urlProduto: "",
  imagemUrl: "",
  classificacao: "verificar"
};

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [modoLogin, setModoLogin] = useState("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagemLogin, setMensagemLogin] = useState("");
  const [pagina, setPagina] = useState("inicio");
  const [pausado, setPausado] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState("testando");
  const [ofertas, setOfertas] = useState([]);
  const [plataformas, setPlataformas] = useState([]);
  const [carregandoOfertas, setCarregandoOfertas] = useState(false);
  const [mensagemOferta, setMensagemOferta] = useState("");
  const [mostrarNovaOferta, setMostrarNovaOferta] = useState(false);
  const [novaOferta, setNovaOferta] = useState(emptyOffer);

  useEffect(() => {
    verificarSessao();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUsuario(session?.user || null);
      setCarregando(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (usuario) carregarDados();
  }, [usuario]);

  async function verificarSessao() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      setUsuario(data.session?.user || null);
      setSupabaseStatus("conectado");
    } catch (error) {
      console.error(error);
      setSupabaseStatus("erro");
    } finally {
      setCarregando(false);
    }
  }

  async function carregarDados() {
    await Promise.all([carregarPlataformas(), carregarOfertas()]);
  }

  async function carregarPlataformas() {
    const { data, error } = await supabase
      .from("platforms")
      .select("id, nome, tipo, ativo")
      .order("nome");
    if (error) {
      console.error(error);
      return;
    }
    setPlataformas(data || []);
  }

  async function carregarOfertas() {
    setCarregandoOfertas(true);
    const { data, error } = await supabase
      .from("offers")
      .select("*, platforms(id, nome)")
      .eq("user_id", usuario.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      setMensagemOferta("Nao foi possivel carregar as ofertas.");
    } else {
      setOfertas(data || []);
    }
    setCarregandoOfertas(false);
  }

  function alterarNovaOferta(campo, valor) {
    setNovaOferta((atual) => ({ ...atual, [campo]: valor }));
  }

  function numero(valor) {
    if (valor === "" || valor == null) return null;
    const n = Number(String(valor).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  async function salvarOferta(event) {
    event.preventDefault();
    setMensagemOferta("");

    if (!novaOferta.titulo.trim()) {
      setMensagemOferta("Digite o nome da oferta.");
      return;
    }
    if (!novaOferta.plataforma) {
      setMensagemOferta("Selecione a plataforma.");
      return;
    }

    const payload = {
      user_id: usuario.id,
      platform_id: novaOferta.plataforma,
      titulo: novaOferta.titulo.trim(),
      url_produto: novaOferta.urlProduto.trim() || null,
      preco_atual: numero(novaOferta.precoAtual),
      preco_anterior: numero(novaOferta.precoAnterior),
      desconto_percentual: numero(novaOferta.desconto),
      comissao_percentual: numero(novaOferta.comissaoPercentual),
      comissao_estimada: numero(novaOferta.comissaoEstimada),
      moeda: "BRL",
      disponibilidade: true,
      classificacao: novaOferta.classificacao,
      permitido_afiliado: true,
      permitido_divulgacao: false,
      imagem_url: novaOferta.imagemUrl.trim() || null,
      encontrada_em: new Date().toISOString(),
      atualizada_em: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("offers")
      .insert(payload)
      .select("*, platforms(id, nome)")
      .single();

    if (error) {
      console.error(error);
      setMensagemOferta("Nao foi possivel salvar a oferta: " + error.message);
      return;
    }

    setOfertas((atual) => [data, ...atual]);
    setNovaOferta({ ...emptyOffer });
    setMostrarNovaOferta(false);
    setMensagemOferta("Oferta salva com sucesso.");
  }

  async function excluirOferta(id) {
    if (!window.confirm("Deseja excluir esta oferta?")) return;
    const { error } = await supabase
      .from("offers")
      .delete()
      .eq("id", id)
      .eq("user_id", usuario.id);
    if (error) {
      console.error(error);
      setMensagemOferta("Nao foi possivel excluir a oferta.");
      return;
    }
    setOfertas((atual) => atual.filter((item) => item.id !== id));
    setMensagemOferta("Oferta excluida.");
  }

  async function alterarClassificacao(id, classificacao) {
    const { data, error } = await supabase
      .from("offers")
      .update({ classificacao, atualizada_em: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", usuario.id)
      .select("*, platforms(id, nome)")
      .single();
    if (error) {
      console.error(error);
      return;
    }
    setOfertas((atual) => atual.map((item) => (item.id === id ? data : item)));
  }

  async function entrar(event) {
    event.preventDefault();
    setMensagemLogin("");
    if (!email.trim() || !senha) {
      setMensagemLogin("Digite seu e-mail e sua senha.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha
    });
    if (error) {
      console.error(error);
      setMensagemLogin("E-mail ou senha incorretos.");
    }
  }

  async function criarConta(event) {
    event.preventDefault();
    setMensagemLogin("");
    if (!email.trim() || !senha) {
      setMensagemLogin("Digite seu e-mail e crie uma senha.");
      return;
    }
    if (senha.length < 6) {
      setMensagemLogin("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha
    });
    if (error) {
      console.error(error);
      setMensagemLogin("Nao foi possivel criar a conta.");
      return;
    }
    setMensagemLogin(
      data.session
        ? ""
        : "Conta criada. Verifique seu e-mail para confirmar."
    );
  }

  async function sair() {
    await supabase.auth.signOut();
    setUsuario(null);
    setPagina("inicio");
    setEmail("");
    setSenha("");
    setOfertas([]);
  }

  function moeda(valor) {
    if (valor == null || valor === "") return "R$ 0,00";
    return Number(valor).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  const menu = [
    ["inicio", "Inicio"],
    ["ofertas", "Ofertas"],
    ["conteudo", "Conteudo"],
    ["resultados", "Resultados"],
    ["config", "Config"]
  ];

  const emRevisao = ofertas.filter((o) => o.classificacao === "verificar").length;
  const interessantes = ofertas.filter((o) => o.classificacao === "interessante").length;

  if (carregando) {
    return <div className="app"><main><div className="panel"><h1>ROBO DE OFERTAS</h1><p>Carregando...</p></div></main></div>;
  }

  if (!usuario) {
    return (
      <div className="app">
        <main>
          <div className="panel login">
            <h1>ROBO DE OFERTAS</h1>
            <p>{modoLogin === "entrar" ? "Entre na sua conta" : "Crie sua conta"}</p>
            <form onSubmit={modoLogin === "entrar" ? entrar : criarConta}>
              <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" /></label>
              <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Minimo 6 caracteres" /></label>
              {mensagemLogin && <p>{mensagemLogin}</p>}
              <button className="primary" type="submit">{modoLogin === "entrar" ? "ENTRAR" : "CRIAR CONTA"}</button>
            </form>
            <button className="secondary" onClick={() => { setMensagemLogin(""); setModoLogin(modoLogin === "entrar" ? "criar" : "entrar"); }}>
              {modoLogin === "entrar" ? "Criar uma conta" : "Ja tenho uma conta"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>ROBO DE OFERTAS</h1>
          <p className={pausado ? "status pausado" : "status"}>{pausado ? "Robo pausado" : "Robo ativo"}</p>
        </div>
        <button className="pause" onClick={() => setPausado(!pausado)}>{pausado ? "CONTINUAR" : "PAUSAR ROBO"}</button>
      </header>

      <main>
        {pagina === "inicio" && (
          <>
            <h2>Inicio</h2>
            <div className="panel">
              <h3>Conta</h3>
              <p>{usuario.email}</p>
              <button className="secondary" onClick={sair}>Sair</button>
            </div>
            <div className="panel">
              <h3>Conexao com a nuvem</h3>
              {supabaseStatus === "conectado" && <p className="status">Supabase conectado</p>}
              {supabaseStatus === "erro" && <p className="status pausado">Erro na conexao</p>}
            </div>
            <div className="cards">
              <div className="card"><span>Ofertas cadastradas</span><strong>{ofertas.length}</strong></div>
              <div className="card"><span>Aguardando revisao</span><strong>{emRevisao}</strong></div>
              <div className="card"><span>Ofertas interessantes</span><strong>{interessantes}</strong></div>
              <div className="card"><span>Cliques</span><strong>0</strong></div>
            </div>
            <div className="panel">
              <h3>Ofertas em destaque</h3>
              {interessantes === 0 && <p>Nenhuma oferta interessante cadastrada ainda.</p>}
              {ofertas.filter((o) => o.classificacao === "interessante").slice(0, 5).map((o) => (
                <div className="offer" key={o.id}>
                  <div className="offer-image">Oferta</div>
                  <div className="offer-info"><h3>{o.titulo}</h3><p>{o.platforms?.nome || "Plataforma"}</p><strong>{moeda(o.preco_atual)}</strong></div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "ofertas" && (
          <>
            <h2>Ofertas</h2>
            <div className="panel">
              <button className="primary" onClick={() => { setMostrarNovaOferta(!mostrarNovaOferta); setMensagemOferta(""); }}>
                {mostrarNovaOferta ? "FECHAR" : "+ NOVA OFERTA"}
              </button>
            </div>

            {mensagemOferta && <div className="panel"><p>{mensagemOferta}</p></div>}

            {mostrarNovaOferta && (
              <div className="panel">
                <h3>Cadastrar nova oferta</h3>
                <form onSubmit={salvarOferta}>
                  <label>Produto / titulo<input value={novaOferta.titulo} onChange={(e) => alterarNovaOferta("titulo", e.target.value)} placeholder="Ex.: Fritadeira Air Fryer" /></label>
                  <label>Plataforma
                    <select value={novaOferta.plataforma} onChange={(e) => alterarNovaOferta("plataforma", e.target.value)}>
                      <option value="">Selecione</option>
                      {plataformas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </label>
                  <label>Preco atual<input inputMode="decimal" value={novaOferta.precoAtual} onChange={(e) => alterarNovaOferta("precoAtual", e.target.value)} placeholder="Ex.: 199,90" /></label>
                  <label>Preco anterior<input inputMode="decimal" value={novaOferta.precoAnterior} onChange={(e) => alterarNovaOferta("precoAnterior", e.target.value)} placeholder="Ex.: 299,90" /></label>
                  <label>Desconto percentual<input inputMode="decimal" value={novaOferta.desconto} onChange={(e) => alterarNovaOferta("desconto", e.target.value)} placeholder="Ex.: 33,33" /></label>
                  <label>Comissao percentual<input inputMode="decimal" value={novaOferta.comissaoPercentual} onChange={(e) => alterarNovaOferta("comissaoPercentual", e.target.value)} placeholder="Ex.: 10" /></label>
                  <label>Comissao estimada<input inputMode="decimal" value={novaOferta.comissaoEstimada} onChange={(e) => alterarNovaOferta("comissaoEstimada", e.target.value)} placeholder="Ex.: 19,99" /></label>
                  <label>Link do produto<input type="url" value={novaOferta.urlProduto} onChange={(e) => alterarNovaOferta("urlProduto", e.target.value)} placeholder="https://..." /></label>
                  <label>Link da imagem<input type="url" value={novaOferta.imagemUrl} onChange={(e) => alterarNovaOferta("imagemUrl", e.target.value)} placeholder="https://..." /></label>
                  <label>Classificacao
                    <select value={novaOferta.classificacao} onChange={(e) => alterarNovaOferta("classificacao", e.target.value)}>
                      <option value="interessante">Interessante</option>
                      <option value="verificar">Verificar</option>
                      <option value="descartada">Descartada</option>
                    </select>
                  </label>
                  <button className="primary" type="submit">SALVAR OFERTA</button>
                </form>
              </div>
            )}

            <div className="panel">
              <h3>Ofertas cadastradas</h3>
              {carregandoOfertas && <p>Carregando ofertas...</p>}
              {!carregandoOfertas && ofertas.length === 0 && <p>Nenhuma oferta cadastrada ainda.</p>}
              {ofertas.map((o) => (
                <div className="offer" key={o.id}>
                  <div className="offer-image">Oferta</div>
                  <div className="offer-info">
                    <h3>{o.titulo}</h3>
                    <p>{o.platforms?.nome || "Plataforma"}</p>
                    <strong>{moeda(o.preco_atual)}</strong>
                    {o.desconto_percentual != null && <span>{o.desconto_percentual}% de desconto</span>}
                    <small>Comissao estimada: {moeda(o.comissao_estimada)}</small>
                    <small>Status: {o.classificacao}</small>
                    <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                      <select value={o.classificacao} onChange={(e) => alterarClassificacao(o.id, e.target.value)}>
                        <option value="interessante">Interessante</option>
                        <option value="verificar">Verificar</option>
                        <option value="descartada">Descartada</option>
                      </select>
                      <button className="secondary" onClick={() => excluirOferta(o.id)}>Excluir</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "conteudo" && (
          <>
            <h2>Conteudo</h2>
            <div className="panel">
              <h3>Criar conteudo</h3>
              <label>Tipo de video<select><option>Oferta rapida</option><option>Oferta + cupom</option><option>Problema para solucao</option><option>Beneficios</option><option>Lista</option></select></label>
              <label>Duracao<select><option>15 segundos</option><option>20 segundos</option><option>30 segundos</option></select></label>
              <label>Narracao<select><option>Sem voz</option><option>Voz feminina</option><option>Voz masculina</option></select></label>
              <button className="primary">Criar conteudo</button>
            </div>
          </>
        )}

        {pagina === "resultados" && (
          <>
            <h2>Resultados</h2>
            <div className="cards">
              <div className="card"><span>Visualizacoes</span><strong>0</strong></div>
              <div className="card"><span>Cliques</span><strong>0</strong></div>
              <div className="card"><span>Vendas</span><strong>0</strong></div>
              <div className="card"><span>Comissao</span><strong>R$ 0,00</strong></div>
            </div>
            <div className="panel"><h3>Desempenho por canal</h3><p>Instagram: 0 cliques</p><p>YouTube Shorts: 0 cliques</p><p>WhatsApp: 0 cliques</p><p>TikTok: 0 cliques</p></div>
          </>
        )}

        {pagina === "config" && (
          <>
            <h2>Configuracoes</h2>
            <div className="panel">
              <h3>Automacao</h3>
              <label><span>Aprovacao antes de publicar</span><input type="checkbox" defaultChecked /></label>
              <label><span>Modo automatico</span><input type="checkbox" /></label>
              <label><span>Instagram</span><input type="checkbox" /></label>
              <label><span>YouTube Shorts</span><input type="checkbox" /></label>
              <label><span>WhatsApp</span><input type="checkbox" /></label>
              <label><span>TikTok</span><input type="checkbox" /></label>
            </div>
            <div className="panel"><h3>Conta</h3><p>{usuario.email}</p><button className="secondary" onClick={sair}>Sair da conta</button></div>
          </>
        )}
      </main>

      <nav>
        {menu.map(([id, nome]) => (
          <button key={id} className={pagina === id ? "ativo" : ""} onClick={() => setPagina(id)}>
            <span>{id === "inicio" && "🏠"}{id === "ofertas" && "🔎"}{id === "conteudo" && "🎬"}{id === "resultados" && "📊"}{id === "config" && "⚙️"}</span>
            <small>{nome}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
