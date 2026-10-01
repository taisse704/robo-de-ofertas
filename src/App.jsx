import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const FRONTEND_BUILD_VERSION = "2026-10-01-separacao-ml-shopee";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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

const providers = [
  { key: "shopee", name: "Shopee" },
  { key: "mercadolivre", name: "Mercado Livre" },
  { key: "magalu", name: "Magalu" },
  { key: "amazon", name: "Amazon" }
];

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
  const [listaOfertas, setListaOfertas] = useState([]);
  const [plataformas, setPlataformas] = useState([]);
  const [contasAfiliadas, setContasAfiliadas] = useState([]);
  const [carregandoOfertas, setCarregandoOfertas] = useState(false);
  const [carregandoAfiliadas, setCarregandoAfiliadas] = useState(false);
  const [mensagemOferta, setMensagemOferta] = useState("");
  const [mensagemShopee, setMensagemShopee] = useState("");
  const [carregandoShopee, setCarregandoShopee] = useState(false);
  const [mensagemAfiliadas, setMensagemAfiliadas] = useState("");
  const [config, setConfig] = useState({ativo:true,busca_automatica:true,publicar_automaticamente:true,aprovacao_antes_publicar:false,instagram:false,youtube:false,whatsapp:false,tiktok:false,kwai:false,facebook:false,pinterest:false,intervalo_minutos:30});
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [mensagemConfig, setMensagemConfig] = useState("");
  const [conteudos, setConteudos] = useState([]);
  const [mensagemConteudo, setMensagemConteudo] = useState("");
  const [aprovandoConteudo, setAprovandoConteudo] = useState(null);
  const [instagramConectado, setInstagramConectado] = useState(false);
  const [desconectandoAfiliada, setDesconectandoAfiliada] = useState(null);

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

  async function carregarConfiguracao() {
    const [{ data }, { data: canais }, { data: contasCanais }] = await Promise.all([
      supabase.from("robot_settings").select("*").eq("user_id", usuario.id).maybeSingle(),
      supabase.from("publication_channels").select("tipo,ativo").eq("user_id", usuario.id),
      supabase.from("channel_accounts").select("canal,status").eq("user_id", usuario.id)
    ]);
    const mapa = { instagram: false, youtube: false, whatsapp: false, tiktok: false, kwai: false, facebook: false, pinterest: false };
    const instagramAccount = (contasCanais || []).find((ch) => ch.canal === "instagram" && ch.status === "conectada");
    setInstagramConectado(!!instagramAccount);
    for (const ch of canais || []) {
      if (ch.tipo === "instagram") mapa.instagram = !!ch.ativo && !!instagramAccount;
      if (ch.tipo === "youtube_shorts" || ch.tipo === "youtube") mapa.youtube = !!ch.ativo;
      if (ch.tipo === "whatsapp") mapa.whatsapp = !!ch.ativo;
      if (ch.tipo === "tiktok") mapa.tiktok = !!ch.ativo;
      if (ch.tipo === "kwai") mapa.kwai = !!ch.ativo;
      if (ch.tipo === "facebook") mapa.facebook = !!ch.ativo;
      if (ch.tipo === "pinterest") mapa.pinterest = !!ch.ativo;
    }
    if (data) {
      setConfig(prev => ({ ...prev, ...(data.configuracao || {}), ...mapa, ativo: data.ativo, busca_automatica: data.busca_automatica, publicar_automaticamente: data.publicar_automaticamente, intervalo_minutos: data.intervalo_minutos, gerar_texto:data.gerar_texto, gerar_imagem:data.gerar_imagem, gerar_video:data.gerar_video }));
    } else {
      setConfig(prev => ({ ...prev, ...mapa }));
    }
  }

  async function sincronizarCanais(c) {
    const canais = [
      ["instagram", "Instagram", !!c.instagram],
      ["youtube_shorts", "YouTube Shorts", !!c.youtube],
      ["whatsapp", "WhatsApp", !!c.whatsapp],
      ["tiktok", "TikTok", !!c.tiktok],
      ["kwai", "Kwai", !!c.kwai],
      ["facebook", "Facebook", !!c.facebook],
      ["pinterest", "Pinterest", !!c.pinterest]
    ];
    for (const [tipo, nome, ativo] of canais) {
      const { data: existentes, error: buscaErro } = await supabase
        .from("publication_channels")
        .select("id")
        .eq("user_id", usuario.id)
        .eq("tipo", tipo);
      if (buscaErro) throw buscaErro;
      if (existentes?.length) {
        const { error } = await supabase.from("publication_channels").update({ nome, ativo, updated_at: new Date().toISOString() }).eq("user_id", usuario.id).eq("tipo", tipo);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("publication_channels").insert({ user_id: usuario.id, tipo, nome, ativo, configuracao: {} });
        if (error) throw error;
      }
    }
  }

  async function salvarConfiguracao(next) {
    const c={...config,...next}; setConfig(c); setSalvandoConfig(true); setMensagemConfig("");
    const payload={ativo:!!c.ativo,busca_automatica:!!c.busca_automatica,publicar_automaticamente:!!c.publicar_automaticamente,intervalo_minutos:Number(c.intervalo_minutos||30),gerar_texto:c.gerar_texto!==false,gerar_imagem:c.gerar_imagem!==false,gerar_video:!!c.gerar_video,configuracao:{aprovacao_antes_publicar:!!c.aprovacao_antes_publicar,modo:c.busca_automatica?"automatico":"manual",instagram:!!c.instagram,youtube:!!c.youtube,whatsapp:!!c.whatsapp,tiktok:!!c.tiktok,kwai:!!c.kwai,facebook:!!c.facebook,pinterest:!!c.pinterest}};
    try {
      const {error}=await supabase.from("robot_settings").upsert({user_id:usuario.id,...payload},{onConflict:"user_id"});
      if (error) throw error;
      await sincronizarCanais(c);
      setMensagemConfig("Configurações salvas.");
    } catch (error) {
      console.error(error);
      setMensagemConfig("Não foi possível salvar as configurações.");
    } finally {
      setSalvandoConfig(false);
    }
  }

  async function carregarConteudos() {
    const { data, error } = await supabase.from("contents").select("*").eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(30);
    if (error) { console.error(error); setMensagemConteudo("Nao foi possivel carregar os conteudos."); return; }
    setConteudos(data || []);
  }

  async function aprovarConteudo(id) {
    setAprovandoConteudo(id); setMensagemConteudo("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessao expirada.");
      const response = await fetch(`${SUPABASE_URL}/functions/v1/approve-content`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ content_id: id })
      });
      const resultado = await response.json().catch(() => ({}));
      if (!response.ok || !resultado.ok) throw new Error(resultado.error || `Erro ${response.status}`);
      setMensagemConteudo(`Conteúdo aprovado e ${resultado.pendentes || 0} publicação(ões) enfileirada(s).`);
      await carregarConteudos();
    } catch (error) {
      console.error(error);
      setMensagemConteudo(error?.message || "Nao foi possivel aprovar o conteudo.");
    } finally { setAprovandoConteudo(null); }
  }

  async function carregarDados() {
    await Promise.all([carregarPlataformas(), carregarOfertas(), carregarContasAfiliadas(), carregarConfiguracao(), carregarConteudos()]);
  }

  async function carregarPlataformas() {
    const { data, error } = await supabase
      .from("platforms")
      .select("id, nome, tipo, ativo")
      .eq("ativo", true)
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
      setListaOfertas(data || []);
    }
    setCarregandoOfertas(false);
  }

  async function carregarContasAfiliadas() {
    setCarregandoAfiliadas(true);
    const { data, error } = await supabase
      .from("affiliate_accounts")
      .select("*, platforms(id, nome)")
      .eq("user_id", usuario.id)
      .order("nome_conta");

    if (error) {
      console.error(error);
      setMensagemAfiliadas("Nao foi possivel carregar as contas de afiliadas.");
    } else {
      setContasAfiliadas(data || []);
    }
    setCarregandoAfiliadas(false);
  }

  const redesSociais = [
    { key: "instagram", name: "Instagram", tipo: "instagram" },
    { key: "youtube", name: "YouTube Shorts", tipo: "youtube_shorts" },
    { key: "tiktok", name: "TikTok", tipo: "tiktok" },
    { key: "whatsapp", name: "WhatsApp", tipo: "whatsapp" },
    { key: "kwai", name: "Kwai", tipo: "kwai" },
    { key: "facebook", name: "Facebook", tipo: "facebook" },
    { key: "pinterest", name: "Pinterest", tipo: "pinterest" }
  ];

  async function desconectarSocial(tipo, nome) {
    setMensagemConfig("");
    try {
      await supabase.from("publication_channels").delete().eq("user_id", usuario.id).eq("tipo", tipo);
      await supabase.from("channel_accounts").delete().eq("user_id", usuario.id).eq("canal", tipo);
      if (tipo === "instagram") setInstagramConectado(false);
      setConfig(prev => ({ ...prev, [tipo === "youtube_shorts" ? "youtube" : tipo]: false }));
      setMensagemConfig(`${nome} desconectado.`);
      await carregarConfiguracao();
    } catch (error) {
      console.error(error);
      setMensagemConfig(`Nao foi possivel desconectar ${nome}.`);
    }
  }

  async function desconectarAfiliada(provider) {
    setMensagemAfiliadas(""); setDesconectandoAfiliada(provider.key);
    try { const platform=plataformas.find(p=>p.nome.toLowerCase().includes(provider.name.toLowerCase())); if(!platform) throw new Error(`Plataforma ${provider.name} nao cadastrada.`); const {error}=await supabase.from("affiliate_accounts").delete().eq("user_id",usuario.id).eq("platform_id",platform.id); if(error) throw error; setContasAfiliadas(atual=>atual.filter(a=>a.platform_id!==platform.id)); setMensagemAfiliadas(`${provider.name} desconectado.`); } catch(error) { console.error(error); setMensagemAfiliadas(error?.message||`Nao foi possivel desconectar ${provider.name}.`); } finally { setDesconectandoAfiliada(null); }
  }

  async function desconectarTodasRedes() {
    if (!window.confirm("Desconectar todas as redes sociais deste usuario?")) return;
    setMensagemConfig("");
    try {
      await supabase.from("publication_channels").delete().eq("user_id", usuario.id);
      await supabase.from("channel_accounts").delete().eq("user_id", usuario.id);
      setInstagramConectado(false);
      setConfig(prev => ({ ...prev, instagram:false, youtube:false, whatsapp:false, tiktok:false, kwai:false, facebook:false, pinterest:false }));
      setMensagemConfig("Todas as redes sociais foram desconectadas.");
      await carregarConfiguracao();
    } catch (error) {
      console.error(error);
      setMensagemConfig("Nao foi possivel desconectar todas as redes.");
    }
  }

  async function prepararConexaoSocial(rede) {
    setMensagemConfig("");
    try {
      if (rede.key === "instagram") {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          setMensagemConfig("Sua sessao expirou. Faca login novamente.");
          return;
        }

        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/instagram-oauth?action=start`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: SUPABASE_ANON_KEY
            }
          }
        );

        const resultado = await response.json().catch(() => ({}));
        if (!response.ok || !resultado.ok) {
          console.error("Erro OAuth Instagram:", resultado);
          setMensagemConfig(resultado?.error || `Nao foi possivel iniciar a conexao com o Instagram (HTTP ${response.status}).`);
          return;
        }

        if (!resultado.authorization_url) {
          setMensagemConfig("O Instagram nao retornou a URL de autorizacao.");
          return;
        }

        window.location.href = resultado.authorization_url;
        return;
      }

      const existente = await supabase
        .from("publication_channels")
        .select("id,ativo,nome,configuracao")
        .eq("user_id", usuario.id)
        .eq("tipo", rede.tipo)
        .maybeSingle();

      if (existente.error) throw existente.error;

      if (existente.data) {
        setMensagemConfig(`${rede.name}: canal já cadastrado. A autorização oficial será configurada na próxima etapa.`);
        return;
      }

      const { error } = await supabase.from("publication_channels").insert({
        user_id: usuario.id,
        tipo: rede.tipo,
        nome: rede.name,
        ativo: false,
        configuracao: { provider: rede.key, conectado: false, requires_official_oauth: true }
      });

      if (error) throw error;
      setMensagemConfig(`${rede.name} preparado para conexão.`);
      await carregarConfiguracao();
    } catch (error) {
      console.error(error);
      setMensagemConfig(`Não foi possível preparar o ${rede.name}.`);
    }
  }
  async function prepararConexao(provider) {
    setMensagemAfiliadas("");

    if (provider.key === "mercadolivre") {
      try {
        const {
          data: { session },
          error: sessionError
        } = await supabase.auth.getSession();

        if (sessionError || !session?.access_token) {
          setMensagemAfiliadas("Sua sessao expirou. Faca login novamente no sistema.");
          return;
        }

        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/mercadolivre-oauth?action=start`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: SUPABASE_ANON_KEY
            }
          }
        );

        const resultado = await response.json();

        if (!response.ok || !resultado.ok) {
          console.error("Erro OAuth Mercado Livre:", resultado);
          setMensagemAfiliadas(resultado?.error || "Nao foi possivel iniciar a conexao com o Mercado Livre.");
          return;
        }

        if (!resultado.authorization_url) {
          setMensagemAfiliadas("O Mercado Livre nao retornou a URL de autorizacao.");
          return;
        }

        window.location.href = resultado.authorization_url;
        return;
      } catch (error) {
        console.error(error);
        setMensagemAfiliadas("Erro ao iniciar a conexao com o Mercado Livre.");
        return;
      }
    }

    const platform = plataformas.find((p) =>
      p.nome.toLowerCase().includes(provider.name.toLowerCase())
    );

    if (!platform) {
      setMensagemAfiliadas(`A plataforma ${provider.name} ainda nao esta cadastrada no sistema.`);
      return;
    }

    const existente = contasAfiliadas.find((a) => a.platform_id === platform.id);

    if (existente) {
      setMensagemAfiliadas(`${provider.name}: conta ja cadastrada. A autorizacao oficial ainda precisa ser configurada.`);
      return;
    }

    const { data, error } = await supabase
      .from("affiliate_accounts")
      .insert({
        user_id: usuario.id,
        platform_id: platform.id,
        nome_conta: provider.name,
        ativo: false,
        status: "aguardando_autorizacao",
        configuracao: { provider: provider.key }
      })
      .select("*, platforms(id, nome)")
      .single();

    if (error) {
      console.error(error);
      setMensagemAfiliadas(`Nao foi possivel preparar a conta ${provider.name}: ${error.message}`);
      return;
    }

    setContasAfiliadas((atual) => [...atual, data]);
    setMensagemAfiliadas(`${provider.name} adicionada. A conexao oficial sera configurada quando a plataforma fornecer a autorizacao/API.`);
  }

  function numero(valor) {
    if (valor === "" || valor == null) return null;
    const n = Number(String(valor).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  async function buscarOfertasMercadoLivre() {
    setMensagemOferta("Buscando ofertas no Mercado Livre...");
    setCarregandoOfertas(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Sessao expirada.");

      const response = await fetch(`${SUPABASE_URL}/functions/v1/process-offers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ limit: 20, somente_descontos: false })
      });

      const resultado = await response.json().catch(() => ({}));
      if (!response.ok || !resultado.ok) {
        throw new Error(resultado?.error || resultado?.message || `Erro ${response.status}`);
      }

      await carregarOfertas();
      const diagnostico = Array.isArray(resultado.diagnostico) ? resultado.diagnostico.map((d) => `${d.term}: catálogo HTTP ${d.catalog_status ?? "—"}, ${d.catalog_results || 0} resultados | candidatos ${d.term_candidates || 0} | sem vencedor ${d.no_winner || 0} | vencedor sem preço ${d.winner_without_price || 0} | detalhes HTTP ${Array.isArray(d.detail_statuses) ? d.detail_statuses.join(",") : "—"} | erro detalhe ${d.detail_errors || 0}`).join(" | ") : "";
      setMensagemOferta(`Busca concluida: ${resultado.produtos_encontrados || 0} produtos encontrados e ${resultado.novas || 0} nova(s) oferta(s) adicionada(s).${diagnostico ? ` Diagnostico: ${diagnostico}` : ""}`);
    } catch (error) {
      console.error("Erro na busca de ofertas:", error);
      setMensagemOferta(error?.message || "Nao foi possivel buscar ofertas.");
    } finally {
      setCarregandoOfertas(false);
    }
  }

  async function buscarOfertasShopee() {
    setMensagemShopee("Buscando ofertas na Shopee...");
    setCarregandoShopee(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Sessao expirada.");

      // Cada nova busca da Shopee começa limpa: remove somente as ofertas
      // antigas da Shopee deste usuário antes de gravar os novos resultados.
      const { error: limparErro } = await supabase
        .from("offers")
        .delete()
        .eq("user_id", usuario.id)
        .eq("store_provider", "shopee");
      if (limparErro) throw limparErro;
      setListaOfertas((atual) => atual.filter((item) => item.store_provider !== "shopee"));

      const response = await fetch(`${SUPABASE_URL}/functions/v1/shopee-offers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 })
      });
      const resultado = await response.json().catch(() => ({}));
      if (!response.ok || !resultado.ok) throw new Error(resultado?.error || resultado?.message || `Erro ${response.status}`);
      await carregarOfertas();
      const diagnostico = Array.isArray(resultado.diagnostico) ? resultado.diagnostico.map((d) => `${d.keyword}: HTTP ${d.status ?? "—"}, ${d.resultados || 0} resultados${d.erro ? ` | erro: ${d.erro}` : ""}`).join(" | ") : "";
      setMensagemShopee(`Busca concluida: ${resultado.produtos || 0} produtos encontrados e ${resultado.novas_ofertas || 0} nova(s) oferta(s) adicionada(s).${diagnostico ? ` Diagnostico: ${diagnostico}` : ""}`);
    } catch (error) {
      console.error("Erro na busca de ofertas Shopee:", error);
      setMensagemShopee(error?.message || "Nao foi possivel buscar ofertas na Shopee.");
    } finally {
      setCarregandoShopee(false);
    }
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
    setListaOfertas((atual) => atual.filter((item) => item.id !== id));
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
    setListaOfertas((atual) => atual.map((item) => (item.id === id ? data : item)));
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
    setMensagemLogin(data.session ? "" : "Conta criada. Verifique seu e-mail para confirmar.");
  }

  async function sair() {
    await supabase.auth.signOut();
    setUsuario(null);
    setPagina("inicio");
    setEmail("");
    setSenha("");
    setListaOfertas([]);
    setContasAfiliadas([]);
  }

  function moeda(valor) {
    if (valor == null || valor === "") return "R$ 0,00";
    return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  const menu = [
    ["inicio", "Inicio"],
    ["ofertas-ml", "Ofertas Mercado Livre"],
    ["ofertas-shopee", "Ofertas Shopee"],
    ["conteudo", "Conteudo"],
    ["resultados", "Resultados"],
    ["config", "Config"]
  ];

  const emRevisao = conteudos.filter((c) => c.status === "aguardando_revisao").length;
  const interessantes = listaOfertas.filter((o) => o.classificacao === "interessante").length;

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
              <div className="card"><span>Ofertas cadastradas</span><strong>{listaOfertas.length}</strong></div>
              <div className="card"><span>Aguardando revisao</span><strong>{emRevisao}</strong></div>
              <div className="card"><span>Ofertas interessantes</span><strong>{interessantes}</strong></div>
              <div className="card"><span>Cliques</span><strong>0</strong></div>
            </div>
            <div className="panel">
              <h3>Ofertas em destaque</h3>
              {interessantes === 0 && <p>Nenhuma oferta interessante cadastrada ainda.</p>}
              {listaOfertas.filter((o) => o.classificacao === "interessante").slice(0, 5).map((o) => (
                <div className="offer" key={o.id}>
                  <div className="offer-image">Oferta</div>
                  <div className="offer-info"><h3>{o.titulo}</h3><p>{o.platforms?.nome || "Plataforma"}</p><strong>{moeda(o.preco_atual)}</strong></div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "ofertas-ml" && (
          <>
            <h2>Ofertas Mercado Livre</h2>
            <div className="panel"><button className="primary" onClick={buscarOfertasMercadoLivre} disabled={carregandoOfertas}>{carregandoOfertas ? "BUSCANDO..." : "🔎 BUSCAR OFERTAS DO MERCADO LIVRE"}</button></div>
            {mensagemOferta && <div className="panel"><p>{mensagemOferta}</p></div>}
            <div className="panel">
              <h3>Ofertas cadastradas — Mercado Livre</h3>
              {carregandoOfertas && <p>Carregando ofertas...</p>}
              {!carregandoOfertas && listaOfertas.filter((o) => o.store_provider === "mercadolivre" || o.platforms?.nome === "Mercado Livre").length === 0 && <p>Nenhuma oferta do Mercado Livre cadastrada ainda.</p>}
              {listaOfertas.filter((o) => o.store_provider === "mercadolivre" || o.platforms?.nome === "Mercado Livre").map((o) => (
                <div className="offer" key={o.id}>
                  <div className="offer-image">{o.imagem_url ? <img src={o.imagem_url} alt="" /> : "Oferta"}</div>
                  <div className="offer-info"><h3>{o.titulo}</h3><p>Mercado Livre</p><strong>{o.preco_atual == null ? "Preço não informado" : moeda(o.preco_atual)}</strong>{o.desconto_percentual != null && <span>{Number(o.desconto_percentual || 0)}% de desconto</span>}<small>Comissao estimada: {moeda(o.comissao_estimada)}</small><small>Status: {o.classificacao}</small><div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}><select value={o.classificacao} onChange={(e) => alterarClassificacao(o.id, e.target.value)}><option value="interessante">Interessante</option><option value="verificar">Verificar</option><option value="descartada">Descartada</option></select><button className="secondary" onClick={() => excluirOferta(o.id)}>Excluir</button></div></div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "ofertas-shopee" && (
          <>
            <h2>Ofertas Shopee</h2>
            <div className="panel"><button className="primary" onClick={buscarOfertasShopee} disabled={carregandoShopee}>{carregandoShopee ? "BUSCANDO..." : "🔎 BUSCAR OFERTAS DA SHOPEE"}</button></div>
            {mensagemShopee && <div className="panel"><p>{mensagemShopee}</p></div>}
            <div className="panel">
              <h3>Ofertas cadastradas — Shopee</h3>
              {carregandoShopee && <p>Carregando ofertas...</p>}
              {!carregandoShopee && listaOfertas.filter((o) => o.store_provider === "shopee" || o.platforms?.nome === "Shopee").length === 0 && <p>Nenhuma oferta da Shopee cadastrada ainda.</p>}
              {listaOfertas.filter((o) => o.store_provider === "shopee" || o.platforms?.nome === "Shopee").map((o) => (
                <div className="offer" key={o.id}>
                  <div className="offer-image">{o.imagem_url ? <img src={o.imagem_url} alt="" /> : "Oferta"}</div>
                  <div className="offer-info"><h3>{o.titulo}</h3><p>Shopee</p><strong>{o.preco_atual == null ? "Preço não informado" : moeda(o.preco_atual)}</strong>{o.desconto_percentual != null && <span>{Number(o.desconto_percentual || 0)}% de desconto</span>}<small>Comissao estimada: {moeda(o.comissao_estimada)}</small><small>Status: {o.classificacao}</small><div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}><select value={o.classificacao} onChange={(e) => alterarClassificacao(o.id, e.target.value)}><option value="interessante">Interessante</option><option value="verificar">Verificar</option><option value="descartada">Descartada</option></select><button className="secondary" onClick={() => excluirOferta(o.id)}>Excluir</button></div></div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "conteudo" && (
          <>
            <h2>Conteudo</h2>
            {mensagemConteudo && <div className="panel"><p>{mensagemConteudo}</p></div>}
            <div className="panel">
              <h3>Conteúdos gerados pelo robô</h3>
              {conteudos.length === 0 && <p>Nenhum conteúdo gerado ainda.</p>}
              {conteudos.map((c) => (
                <div className="offer" key={c.id}>
                  <div className="offer-info">
                    <h3>{c.titulo || "Conteúdo de oferta"}</h3>
                    <p>Status: {c.status || "rascunho"}</p>
                    <small>{c.legenda || c.texto || ""}</small>
                    {c.status === "aguardando_revisao" && <button className="primary" style={{ marginTop: "10px" }} disabled={aprovandoConteudo === c.id} onClick={() => aprovarConteudo(c.id)}>{aprovandoConteudo === c.id ? "APROVANDO..." : "APROVAR E PUBLICAR"}</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "resultados" && (
          <>
            <h2>Resultados</h2><div className="cards"><div className="card"><span>Visualizacoes</span><strong>0</strong></div><div className="card"><span>Cliques</span><strong>0</strong></div><div className="card"><span>Vendas</span><strong>0</strong></div><div className="card"><span>Comissao</span><strong>R$ 0,00</strong></div></div><div className="panel"><h3>Desempenho por canal</h3><p>Instagram: 0 cliques</p><p>YouTube Shorts: 0 cliques</p><p>TikTok: 0 cliques</p><p>Facebook: 0 cliques</p><p>WhatsApp: 0 cliques</p><p>Kwai: 0 cliques</p><p>Pinterest: 0 cliques</p></div>
          </>
        )}

        {pagina === "config" && (
          <>
            <h2>Configuracoes</h2>
            <div className="panel">
              <h3>Contas de afiliadas</h3>
              <p>Conecte suas contas pelos meios oficiais de cada plataforma.</p>
              {mensagemAfiliadas && <p className="status">{mensagemAfiliadas}</p>}
              {carregandoAfiliadas && <p>Carregando contas...</p>}
              <div style={{ display: "grid", gap: "12px" }}>
                {providers.map((provider) => {
                  const conta = contasAfiliadas.find((a) => a.platforms?.nome?.toLowerCase().includes(provider.name.toLowerCase()));
                  return (
                    <div className="offer" key={provider.key}>
                      <div className="offer-info">
                        <h3>{provider.name}</h3>
                        <p>Status: {conta?.status || "Nao conectada"}</p>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button className="primary" onClick={() => prepararConexao(provider)}>
                            {conta?.status === "conectada" ? "CONFIGURAR" : "CONECTAR"}
                          </button>
                          <button className="secondary" disabled={!conta || desconectandoAfiliada === provider.key} onClick={() => desconectarAfiliada(provider)}>
                            {desconectandoAfiliada === provider.key ? "DESCONECTANDO..." : "DESCONECTAR"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="panel">
              <h3>Redes sociais</h3>
              <p>Conecte aqui os canais onde o robô poderá publicar automaticamente.</p>
              {mensagemConfig && <p className="status">{mensagemConfig}</p>}
              <div style={{ display: "grid", gap: "12px" }}>
                {redesSociais.map((rede) => (
                  <div className="offer" key={rede.key}>
                    <div className="offer-info">
                      <h3>{rede.name}</h3>
                      <p>{config[rede.key] ? "Ativo para publicação" : "Não conectado"}</p>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button className="primary" onClick={() => prepararConexaoSocial(rede)}>
                          {((rede.key === "instagram" && instagramConectado) || (rede.key !== "instagram" && config[rede.key])) ? "CONFIGURAR" : "CONECTAR"}
                        </button>
                        <button className="secondary" disabled={!((rede.key === "instagram" && instagramConectado) || (rede.key !== "instagram" && config[rede.key]))} onClick={() => desconectarSocial(rede.tipo, rede.name)}>DESCONECTAR</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <h3>Desconectar redes</h3>
              <p>Remove as conexoes sociais salvas no Robô de Ofertas.</p>
              <button className="secondary" onClick={desconectarTodasRedes}>DESCONECTAR TODAS AS REDES</button>
            </div>
                        <div className="panel">
              <h3>Automacao</h3>
              <p>O robo busca ofertas, gera conteudo e prepara a divulgacao automaticamente.</p>
              {mensagemConfig && <p className="status">{mensagemConfig}</p>}
              <label><span>Modo automatico</span><input type="checkbox" checked={!!config.busca_automatica} onChange={e=>salvarConfiguracao({busca_automatica:e.target.checked,ativo:e.target.checked})} /></label>
              <label><span>Buscar ofertas automaticamente</span><input type="checkbox" checked={!!config.busca_automatica} onChange={e=>salvarConfiguracao({busca_automatica:e.target.checked})} /></label>
              <label><span>Publicar automaticamente</span><input type="checkbox" checked={!!config.publicar_automaticamente} onChange={e=>salvarConfiguracao({publicar_automaticamente:e.target.checked})} /></label>
              <label><span>Aprovacao antes de publicar</span><input type="checkbox" checked={!!config.aprovacao_antes_publicar} onChange={e=>salvarConfiguracao({aprovacao_antes_publicar:e.target.checked,publicar_automaticamente:!e.target.checked})} /></label>
              <label><span>Intervalo (minutos)</span><input type="number" min="5" step="5" value={Number(config.intervalo_minutos||30)} onChange={e=>salvarConfiguracao({intervalo_minutos:Number(e.target.value||30)})} /></label>
              <label><span>Gerar texto</span><input type="checkbox" checked={config.gerar_texto !== false} onChange={e=>salvarConfiguracao({gerar_texto:e.target.checked})} /></label>
              <label><span>Gerar imagem</span><input type="checkbox" checked={config.gerar_imagem !== false} onChange={e=>salvarConfiguracao({gerar_imagem:e.target.checked})} /></label>
              <label><span>Gerar video</span><input type="checkbox" checked={!!config.gerar_video} onChange={e=>salvarConfiguracao({gerar_video:e.target.checked})} /></label>
              <h4>Canais de divulgacao</h4>
              <label><span>Instagram</span><input type="checkbox" checked={!!config.instagram} onChange={e=>salvarConfiguracao({instagram:e.target.checked})} /></label>
              <label><span>YouTube Shorts</span><input type="checkbox" checked={!!config.youtube} onChange={e=>salvarConfiguracao({youtube:e.target.checked})} /></label>
              <label><span>WhatsApp</span><input type="checkbox" checked={!!config.whatsapp} onChange={e=>salvarConfiguracao({whatsapp:e.target.checked})} /></label>
              <label><span>TikTok</span><input type="checkbox" checked={!!config.tiktok} onChange={e=>salvarConfiguracao({tiktok:e.target.checked})} /></label>
              <label><span>Kwai</span><input type="checkbox" checked={!!config.kwai} onChange={e=>salvarConfiguracao({kwai:e.target.checked})} /></label>
              <label><span>Facebook</span><input type="checkbox" checked={!!config.facebook} onChange={e=>salvarConfiguracao({facebook:e.target.checked})} /></label>
              <label><span>Pinterest</span><input type="checkbox" checked={!!config.pinterest} onChange={e=>salvarConfiguracao({pinterest:e.target.checked})} /></label>
              {salvandoConfig && <p>Salvando...</p>}
            </div>
            <div className="panel"><h3>Conta</h3><p>{usuario.email}</p><button className="secondary" onClick={sair}>Sair da conta</button></div>
          </>
        )}
      </main>

      <nav>
        {menu.map(([id, nome]) => <button key={id} className={pagina === id ? "ativo" : ""} onClick={() => setPagina(id)}><span>{id === "inicio" && "🏠"}{id === "ofertas-ml" && "🔎"}{id === "ofertas-shopee" && "🔎"}{id === "conteudo" && "🎬"}{id === "resultados" && "📊"}{id === "config" && "⚙️"}</span><small>{nome}</small></button>)}
      </nav>
    </div>
  );
}
