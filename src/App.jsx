import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const FRONTEND_BUILD_VERSION = "2026-10-09-ml-affiliate-save-fix";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const COUPON_PAGE_FUNCTION = `${SUPABASE_URL}/functions/v1/coupon-page`;

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
  const [config, setConfig] = useState({ativo:true,busca_automatica:true,publicar_automaticamente:true,aprovacao_antes_publicar:false,instagram:false,youtube:false,whatsapp:false,tiktok:false,kwai:false,facebook:false,pinterest:false,intervalo_minutos:30,modo_conteudo:"post"});
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [mensagemConfig, setMensagemConfig] = useState("");
  const [conteudos, setConteudos] = useState([]);
  const [publicacoes, setPublicacoes] = useState([]);
  const [mensagemConteudo, setMensagemConteudo] = useState("");
  const [aprovandoConteudo, setAprovandoConteudo] = useState(null);
  const [instagramConectado, setInstagramConectado] = useState(false);
  const [desconectandoAfiliada, setDesconectandoAfiliada] = useState(null);
  const [abaOfertas, setAbaOfertas] = useState("cadastradas");
  const [ofertasPublicadas, setOfertasPublicadas] = useState(new Set());
  const [ofertasSelecionadas, setOfertasSelecionadas] = useState(new Set());
  const [novasShopeeIds, setNovasShopeeIds] = useState(new Set());
  const [enfileirandoOfertas, setEnfileirandoOfertas] = useState(false);
  const [abaConteudo, setAbaConteudo] = useState("fila");
  const [processandoConteudo, setProcessandoConteudo] = useState(null);
  const [cupons, setCupons] = useState([]);
  const [carregandoCupons, setCarregandoCupons] = useState(false);
  const [mensagemCupons, setMensagemCupons] = useState("");

  useEffect(() => {
    verificarSessao();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUsuario(session?.user || null);
      setCarregando(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!usuario) return;
    carregarDados();
    const params = new URLSearchParams(window.location.search);
    const tiktok = params.get("tiktok");
    const kwai = params.get("kwai");
    const pinterest = params.get("pinterest");
    const youtube = params.get("youtube");
    const message = params.get("message");
    if (tiktok === "success") {
      setMensagemConfig("TikTok conectado com sucesso.");
      window.history.replaceState({}, document.title, window.location.pathname);
      carregarConfiguracao();
    } else if (tiktok === "error") {
      setMensagemConfig(message || "Não foi possível conectar o TikTok.");
      window.history.replaceState({}, document.title, window.location.pathname);
      carregarConfiguracao();
    } else if (kwai === "success") {
      setMensagemConfig("Kwai conectado com sucesso.");
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    } else if (kwai === "error") {
      setMensagemConfig(message || "Não foi possível conectar o Kwai.");
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    } else if (pinterest === "success") {
      setMensagemConfig("Pinterest conectado com sucesso.");
      window.history.replaceState({}, document.title, window.location.pathname);
      carregarConfiguracao();
    } else if (pinterest === "error") {
      setMensagemConfig(message || "Não foi possível conectar o Pinterest.");
      window.history.replaceState({}, document.title, window.location.pathname);
      carregarConfiguracao();
    } else if (youtube === "success") {
      setMensagemConfig("YouTube conectado com sucesso.");
      window.history.replaceState({}, document.title, window.location.pathname);
      carregarConfiguracao();
    } else if (youtube === "error") {
      setMensagemConfig(message || "Não foi possível conectar o YouTube.");
      window.history.replaceState({}, document.title, window.location.pathname);
      carregarConfiguracao();
    }
  }, [usuario]);

  useEffect(() => {
    if (!usuario) return;
    const timer = setInterval(() => {
      carregarOfertas();
      carregarOfertasPublicadas();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [usuario]);

  useEffect(() => {
    if (!usuario) return;
    let mounted = true;
    const ofertasEmAndamento = new Set();
    const ofertasConcluidas = new Set();

    const processarResultadoAfiliado = async (event) => {
      const data = event?.data;
      if (
        event.source !== window ||
        !data ||
        data.source !== "robo-de-ofertas" ||
        data.type !== "ML_AFFILIATE_RESULT"
      ) return;

      const offerId = String(data.offer_id || "").trim();
      const affiliateUrl = String(data.affiliate_url || "").trim();
      if (!offerId || ofertasEmAndamento.has(offerId) || ofertasConcluidas.has(offerId)) return;

      if (data.ok !== true || !affiliateUrl) {
        setMensagemOferta(
          "Não foi possível gerar o link do Mercado Livre: " +
          String(data.error || "a extensão não retornou um link oficial.")
        );
        return;
      }

      ofertasEmAndamento.add(offerId);
      try {
        setMensagemOferta("Link oficial recebido. Salvando no Robô de Ofertas...");

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error("Sua sessão expirou. Entre novamente no Robô de Ofertas.");

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error("A configuração de conexão com o Supabase está incompleta.");
        }

        // Usamos fetch diretamente para exibir a resposta real da Edge Function
        // em vez da mensagem genérica do cliente Supabase.
        const response = await fetch(`${SUPABASE_URL}/functions/v1/affiliate-link`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            offer_id: offerId,
            affiliate_url: affiliateUrl
          })
        });
        const saved = await response.json().catch(() => ({}));

        if (!response.ok || !saved?.ok || saved?.status !== "gerado") {
          throw new Error(
            saved?.error ||
            saved?.proxima_acao ||
            `A função affiliate-link respondeu HTTP ${response.status} sem confirmar o salvamento.`
          );
        }

        ofertasConcluidas.add(offerId);
        if (!mounted) return;

        await carregarOfertas();
        setMensagemOferta("Link de afiliado oficial salvo. Preparando o conteúdo...");

        // O conteúdo só é solicitado depois de confirmar que o link foi salvo.
        try {
          const contentResponse = await fetch(`${SUPABASE_URL}/functions/v1/generate-content`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: SUPABASE_ANON_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              user_id: sessionData.session.user.id,
              offer_ids: [offerId]
            })
          });
          const contentResult = await contentResponse.json().catch(() => ({}));
          if (!contentResponse.ok || contentResult?.ok === false) {
            console.warn("Mercado Livre: link salvo, mas o conteúdo não foi gerado.", contentResult);
            if (mounted) {
              setMensagemOferta("Link de afiliado salvo. O conteúdo não foi gerado automaticamente: " +
                String(contentResult?.error || `HTTP ${contentResponse.status}`));
            }
            return;
          }
        } catch (contentError) {
          console.warn("Mercado Livre: erro ao gerar conteúdo após salvar o link.", contentError);
          if (mounted) {
            setMensagemOferta("Link de afiliado salvo, mas houve uma falha ao gerar o conteúdo: " +
              String(contentError?.message || contentError));
          }
          return;
        }

        if (mounted) setMensagemOferta("Link de afiliado oficial gerado e salvo. O conteúdo foi encaminhado para geração.");
      } catch (error) {
        console.error("SALVAR LINK AFILIADO MERCADO LIVRE:", error);
        if (mounted) {
          setMensagemOferta(
            "O link foi recebido, mas não foi possível salvá-lo: " +
            String(error?.message || error)
          );
        }
      } finally {
        ofertasEmAndamento.delete(offerId);
      }
    };

    window.addEventListener("message", processarResultadoAfiliado);
    return () => {
      mounted = false;
      window.removeEventListener("message", processarResultadoAfiliado);
    };
  }, [usuario]);

  useEffect(() => {
    if (!usuario || pagina !== "cupons") return;
    carregarCupons();
  }, [usuario, pagina]);

  useEffect(() => {
    if (!usuario || pagina !== "conteudo") return;
    const timer = setInterval(() => {
      carregarConteudos();
    }, 15000);
    return () => clearInterval(timer);
  }, [usuario, pagina]);

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
      setConfig(prev => ({ ...prev, ...(data.configuracao || {}), ...mapa, ativo: data.ativo, busca_automatica: data.busca_automatica, publicar_automaticamente: data.publicar_automaticamente, intervalo_minutos: data.intervalo_minutos, gerar_texto:data.gerar_texto, gerar_imagem:data.gerar_imagem, gerar_video:data.gerar_video, modo_conteudo:(data.configuracao || {}).modo_conteudo || (data.gerar_video ? "video" : "post") }));
      setPausado(!data.ativo);
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
    const modoConteudo=["video","post","automatico"].includes(c.modo_conteudo)?c.modo_conteudo:"post";
    const payload={ativo:!!c.ativo,busca_automatica:!!c.busca_automatica,publicar_automaticamente:!!c.publicar_automaticamente,intervalo_minutos:Number(c.intervalo_minutos||30),gerar_texto:c.gerar_texto!==false,gerar_imagem:c.gerar_imagem!==false,gerar_video:modoConteudo==="video",configuracao:{aprovacao_antes_publicar:!!c.aprovacao_antes_publicar,modo:c.busca_automatica?"automatico":"manual",modo_conteudo:modoConteudo,instagram:!!c.instagram,youtube:!!c.youtube,whatsapp:!!c.whatsapp,tiktok:!!c.tiktok,kwai:!!c.kwai,facebook:!!c.facebook,pinterest:!!c.pinterest}};
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

  async function carregarCupons() {
    if (!usuario?.id) return;
    setCarregandoCupons(true);
    setMensagemCupons("");
    try {
      const { data, error } = await supabase
        .from("coupons")
        .select("*, offers(id,titulo,imagem_url,affiliate_url,url_produto)")
        .eq("user_id", usuario.id)
        .eq("ativo", true)
        .eq("verificado", true)
        .order("prioridade", { ascending: false })
        .order("validade_fim", { ascending: true, nullsFirst: false });
      if (error) throw error;
      setCupons(data || []);
    } catch (error) {
      console.error("CARREGAR CUPONS:", error);
      setMensagemCupons("Não foi possível carregar os cupons.");
      setCupons([]);
    } finally {
      setCarregandoCupons(false);
    }
  }

  async function copiarPaginaCupons() {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}cupons/`;
    try {
      await navigator.clipboard.writeText(url);
      setMensagemCupons("Link da página de cupons copiado.");
    } catch {
      setMensagemCupons(url);
    }
  }

  async function carregarConteudos() {
    const [
      { data, error },
      { data: pubs, error: pubsError },
      { data: canais, error: canaisError }
    ] = await Promise.all([
      supabase.from("contents").select("*").eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(500),
      supabase.from("offer_publications").select("id,content_id,offer_id,status,published_at,created_at,external_post_id,erro,channel_id").eq("user_id", usuario.id).order("created_at", { ascending: false }).limit(1000),
      supabase.from("publication_channels").select("id,tipo,nome,ativo").eq("user_id", usuario.id)
    ]);
    if (error) {
      console.error(error);
      setMensagemConteudo("Nao foi possivel carregar os conteudos.");
      return;
    }
    if (pubsError) console.error("CARREGAR PUBLICACOES:", pubsError);
    if (canaisError) console.error("CARREGAR CANAIS:", canaisError);

    const canalPorId = new Map((canais || []).map((canal) => [String(canal.id), canal]));
    const publicacoesComRede = (pubs || []).map((pub) => ({
      ...pub,
      publication_channels: canalPorId.get(String(pub.channel_id)) || null
    }));

    setConteudos(data || []);
    setPublicacoes(publicacoesComRede);
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
    await Promise.all([carregarPlataformas(), carregarOfertas(), carregarOfertasPublicadas(), carregarContasAfiliadas(), carregarConfiguracao(), carregarConteudos()]);
  }

  async function alterarStatusConteudo(id, status) {
    setProcessandoConteudo(id);
    setMensagemConteudo("");
    try {
      if (!usuario?.id) throw new Error("Usuário não identificado.");
      const { data, error } = await supabase
        .from("contents")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", usuario.id)
        .select("id,status")
        .single();
      if (error) throw error;
      if (!data) throw new Error("O conteúdo não foi alterado. Verifique as permissões da tabela contents.");
      setMensagemConteudo(status === "descartado" ? "Conteúdo descartado." : "Conteúdo colocado na fila de publicação.");
      await carregarConteudos();
    } catch (error) {
      console.error("ALTERAR CONTEUDO:", error);
      setMensagemConteudo(error?.message || "Não foi possível alterar o conteúdo.");
    } finally {
      setProcessandoConteudo(null);
    }
  }

  async function alterarModoConteudo(id, modo) {
    setProcessandoConteudo(id);
    setMensagemConteudo("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

      const response = await fetch(`${SUPABASE_URL}/functions/v1/set-content-mode`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content_id: id, modo })
      });

      const resultado = await response.json().catch(() => ({}));
      if (!response.ok || !resultado.ok) {
        throw new Error(resultado?.error || `Erro HTTP ${response.status}`);
      }

      setMensagemConteudo(
        modo === "video"
          ? (resultado.video_status === "original_disponivel"
              ? "Vídeo original selecionado e pronto para publicação."
              : "Vídeo solicitado. O gerador vai criar o vídeo automaticamente.")
          : "Conteúdo alterado para post com imagem, sem vídeo."
      );
      await carregarConteudos();
    } catch (error) {
      console.error("ALTERAR MODO CONTEUDO:", error);
      setMensagemConteudo(error?.message || "Não foi possível alterar o formato do conteúdo.");
    } finally {
      setProcessandoConteudo(null);
    }
  }

  async function publicarAgora(id, rede) {
    setProcessandoConteudo(id);
    setMensagemConteudo("");
    try {
      if (!usuario?.id) throw new Error("Usuário não identificado.");
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

      const tipo = rede === "youtube" ? "youtube_shorts" : rede;
      const { data: canal, error: canalError } = await supabase
        .from("publication_channels")
        .select("id,ativo,nome")
        .eq("user_id", usuario.id)
        .eq("tipo", tipo)
        .eq("ativo", true)
        .maybeSingle();

      if (canalError) throw canalError;
      if (!canal) throw new Error(`O canal ${rede === "youtube" ? "YouTube Shorts" : rede} não está ativo.`);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-content`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content_id: id, channel_ids: [canal.id], modo: "manual" })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        const detalhes =
          data?.error ||
          data?.message ||
          data?.resultados?.find?.(r => r.error)?.error ||
          `Erro HTTP ${response.status}`;
        throw new Error(detalhes);
      }

      const resultadoRede = data?.resultados?.find?.(r => r.channel === tipo);
      setMensagemConteudo(
        resultadoRede?.status === "publicando"
          ? `Publicação enviada para o ${rede === "youtube" ? "YouTube Shorts" : rede}. A plataforma está processando o vídeo.`
          : data?.message || `Publicado no ${rede === "youtube" ? "YouTube Shorts" : rede}.`
      );
      await carregarConteudos();
    } catch (error) {
      console.error("PUBLICAR AGORA:", error);
      setMensagemConteudo(error?.message || "Não foi possível publicar agora.");
      await carregarConteudos();
    } finally {
      setProcessandoConteudo(null);
    }
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

  async function limparOfertasManualmente() {
    if (!usuario?.id) return;
    const confirmar = window.confirm(
      "Limpar os produtos/ofertas desta conta agora?\n\nIsso remove as ofertas, conteúdos gerados, publicações relacionadas, links afiliados, histórico de preços e tarefas derivados das ofertas. Suas conexões e configurações NÃO serão removidas."
    );
    if (!confirmar) return;

    setCarregandoOfertas(true);
    setMensagemOferta("Limpando ofertas...");
    try {
      const { data, error } = await supabase.rpc("limpar_minhas_ofertas");
      if (error) throw error;
      setListaOfertas([]);
      setOfertasPublicadas(new Set());
      setOfertasSelecionadas(new Set());
      setNovasShopeeIds(new Set());
      setMensagemOferta(
        `Limpeza concluída: ${Number(data?.offers || 0)} oferta(s), ${Number(data?.products || 0)} produto(s) e ${Number(data?.contents || 0)} conteúdo(s) removidos.`
      );
      await Promise.all([carregarOfertas(), carregarOfertasPublicadas(), carregarConteudos()]);
    } catch (error) {
      console.error("LIMPAR OFERTAS:", error);
      setMensagemOferta(error?.message || "Não foi possível limpar as ofertas.");
    } finally {
      setCarregandoOfertas(false);
    }
  }

  async function carregarOfertasPublicadas() {
    const { data, error } = await supabase
      .from("offer_publications")
      .select("offer_id,status,published_at")
      .eq("user_id", usuario.id);
    if (error) {
      console.error(error);
      setOfertasPublicadas(new Set());
      return;
    }
    const ids = new Set(
      (data || [])
        .filter((p) => p.published_at || ["publicado", "publicada", "published", "sucesso"].includes(String(p.status || "").toLowerCase()))
        .map((p) => p.offer_id)
        .filter(Boolean)
    );
    setOfertasPublicadas(ids);
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
      if (rede.key === "instagram" || rede.key === "tiktok" || rede.key === "kwai" || rede.key === "pinterest" || rede.key === "youtube") {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          setMensagemConfig("Sua sessao expirou. Faca login novamente.");
          return;
        }
        const oauthFunction = rede.key === "instagram"
          ? "instagram-oauth"
          : rede.key === "tiktok"
            ? "tiktok-oauth"
            : rede.key === "kwai"
              ? "kwai-oauth"
              : rede.key === "pinterest"
                ? "pinterest-oauth"
                : "youtube-oauth";
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/${oauthFunction}?action=start`,
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
          console.error(`Erro OAuth ${rede.name}:`, resultado);
          setMensagemConfig(resultado?.error || `Nao foi possivel iniciar a conexao com o ${rede.name} (HTTP ${response.status}).`);
          return;
        }
        if (!resultado.authorization_url) {
          setMensagemConfig(`O ${rede.name} nao retornou a URL de autorizacao.`);
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
      if (provider.key === "shopee") {
        if (existente.status === "conectada" && existente.ativo) {
          setMensagemAfiliadas("Shopee conectada pela API oficial. A conta está pronta para buscar ofertas.");
        } else {
          const { data: atualizada, error: updateError } = await supabase
            .from("affiliate_accounts")
            .update({
              ativo: true,
              status: "conectada",
              connected_at: existente.connected_at || new Date().toISOString(),
              configuracao: {
                ...(existente.configuracao || {}),
                provider: "shopee",
                modo: "api_oficial",
                conectado: true
              }
            })
            .eq("id", existente.id)
            .select("*, platforms(id, nome)")
            .single();
          if (updateError) throw updateError;
          setContasAfiliadas((atual) => atual.map((a) => a.id === atualizada.id ? atualizada : a));
          setMensagemAfiliadas("Shopee conectada pela API oficial. A conta está pronta para buscar ofertas.");
        }
        return;
      }
      setMensagemAfiliadas(`${provider.name}: conta ja cadastrada e pronta para configuracao.`);
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
      const {
        data: { session },
        error: sessionError
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/process-offers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            user_id: usuario.id,
            limit: 20,
            somente_descontos: false
          })
        }
      );

      const resultado = await response.json().catch(() => ({}));

      if (!response.ok || resultado?.ok === false) {
        throw new Error(
          resultado?.error ||
          resultado?.message ||
          `Erro HTTP ${response.status}`
        );
      }

      await carregarOfertas();

      const encontrados = Number(
        resultado?.found ??
        resultado?.produtos_encontrados ??
        resultado?.total ??
        0
      );

      // "novas" vem somente da resposta da função; usamos um nome explícito
      // para evitar qualquer conflito de escopo no frontend.
      const novasEncontradas = Number(
        resultado?.inserted ??
        resultado?.novas ??
        resultado?.new_offers ??
        0
      );

      const atualizadas = Number(
        resultado?.updated ??
        resultado?.atualizadas ??
        0
      );

      const selecionadas = Number(
        resultado?.selected ??
        0
      );

      const diagnosticos = resultado?.diagnostics ?? resultado?.diagnostico ?? null;

      // process-offers retorna um objeto de diagnóstico (não uma lista).
      // Exibimos os contadores e os status por categoria para distinguir
      // ranking vazio, falha de conversão, ausência de preço ou duplicatas.
      let diagnosticoTexto = "";
      if (Array.isArray(diagnosticos)) {
        diagnosticoTexto = diagnosticos.map((d) => {
          if (typeof d === "string") return d;
          const term = d?.term || d?.termo || d?.categoria || "Mercado Livre";
          const status = d?.search_status ?? d?.catalog_status ?? d?.status ?? "—";
          const results = d?.search_results ?? d?.catalog_results ?? d?.results ?? d?.encontrados ?? 0;
          const err = d?.erro ? `, erro: ${d.erro}` : "";
          return `${term}: HTTP ${status}, ${results} resultados${err}`;
        }).join(" | ");
      } else if (diagnosticos && typeof diagnosticos === "object") {
        const counts = [
          ["destaques", diagnosticos.destaques_recebidos],
          ["resolvidos", diagnosticos.destaques_resolvidos],
          ["itens consultados", diagnosticos.itens_consultados],
          ["itens com detalhes", diagnosticos.itens_com_detalhes],
          ["candidatos com preço", diagnosticos.candidatos_com_preco],
          ["duplicados ignorados", diagnosticos.duplicados_ignorados],
          ["ofertas existentes ignoradas", diagnosticos.existentes_ignorados],
          ["produtos em promoção", diagnosticos.em_promocao]
        ].filter(([, value]) => value !== undefined && value !== null)
          .map(([label, value]) => `${label}: ${value}`);

        const categories = Array.isArray(diagnosticos.categorias_consultadas)
          ? diagnosticos.categorias_consultadas.map((d) => {
              const category = d?.categoria || d?.categoria_nome || d?.categoria_id || "categoria";
              const status = d?.status ?? "—";
              const count = d?.encontrados ?? 0;
              const err = d?.erro ? `, erro: ${d.erro}` : "";
              return `${category}: HTTP ${status}, ${count} destaques${err}`;
            })
          : [];

        const errors = Array.isArray(diagnosticos.erros_resolucao)
          ? diagnosticos.erros_resolucao.slice(0, 3).map((e) =>
              `erro ${e?.tipo || "resultado"} ${e?.id || ""}: HTTP ${e?.status ?? "—"} ${e?.erro || e?.message || ""}`
            )
          : [];

        diagnosticoTexto = [...counts, ...categories, ...errors].join(" | ");
      }

      let mensagem =
        `Busca concluida: ${encontrados} produtos encontrados e ${novasEncontradas} nova(s) oferta(s) adicionada(s).`;

      if (atualizadas > 0) {
        mensagem += ` ${atualizadas} oferta(s) atualizada(s).`;
      }

      if (selecionadas > 0) {
        mensagem += ` ${selecionadas} oferta(s) processada(s).`;
      }

      if (diagnosticoTexto) {
        mensagem += ` Diagnostico: ${diagnosticoTexto}`;
      }

      setMensagemOferta(mensagem);
    } catch (error) {
      console.error("Erro na busca de ofertas:", error);
      setMensagemOferta(
        error?.message ||
        "Nao foi possivel buscar ofertas do Mercado Livre."
      );
    } finally {
      setCarregandoOfertas(false);
    }
  }

  async function buscarOfertasShopee() {
    setMensagemShopee("Buscando ofertas na Shopee...");
    setCarregandoShopee(true);
    try {
      const idsAntes = new Set(
        listaOfertas
          .filter((o) => o.store_provider === "shopee" || o.platforms?.nome === "Shopee")
          .map((o) => String(o.product_external_id || ""))
          .filter(Boolean)
      );

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Sessao expirada.");

      const response = await fetch(`${SUPABASE_URL}/functions/v1/shopee-offers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 })
      });
      const resultado = await response.json().catch(() => ({}));
      if (!response.ok || !resultado.ok) throw new Error(resultado?.error || resultado?.message || `Erro ${response.status}`);

      const { data: ofertasAtualizadas, error: ofertasError } = await supabase
        .from("offers")
        .select("*, platforms(id, nome)")
        .eq("user_id", usuario.id)
        .order("created_at", { ascending: false });

      if (ofertasError) throw ofertasError;
      const listaDepois = ofertasAtualizadas || [];
      setListaOfertas(listaDepois);
      await carregarOfertasPublicadas();

      // Descobre as ofertas realmente novas comparando o banco antes/depois.
      // Não dependemos do formato variável de resultado.ofertas.
      const novasIds = new Set(
        listaDepois
          .filter((o) => (o.store_provider === "shopee" || o.platforms?.nome === "Shopee"))
          .filter((o) => !idsAntes.has(String(o.product_external_id || "")))
          .map((o) => String(o.id))
          .filter(Boolean)
      );

      if (novasIds.size) {
        setNovasShopeeIds((atual) => new Set([...atual, ...novasIds]));
      }

      const novas = novasIds.size || Number(resultado.novas_ofertas ?? resultado.novas ?? 0);
      const atualizadas = Number(resultado.atualizadas ?? 0);
      const diagnostico = Array.isArray(resultado.diagnostico)
        ? resultado.diagnostico.map((d) => `${d.keyword || d.tipo || "(geral)"}: HTTP ${d.status ?? "—"}, ${d.resultados || 0} resultados${d.erro ? ` | erro: ${d.erro}` : ""}`).join(" | ")
        : "";

      setMensagemShopee(
        `Busca concluida: ${resultado.produtos || 0} produtos encontrados • ${novas} novos • ${atualizadas} atualizados.${diagnostico ? ` Diagnostico: ${diagnostico}` : ""}`
      );
    } catch (error) {
      console.error("Erro na busca de ofertas Shopee:", error);
      setMensagemShopee(error?.message || "Nao foi possivel buscar ofertas na Shopee.");
    } finally {
      setCarregandoShopee(false);
    }
  }


  function alternarOfertaSelecionada(id) {
    setOfertasSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
      return proximo;
    });
  }

  function limparSelecaoOfertas() {
    setOfertasSelecionadas(new Set());
  }

  async function marcarOfertasComoCadastradas(ids) {
    const idsValidos = [...new Set((ids || []).filter(Boolean))];
    if (!idsValidos.length) return;

    const { error } = await supabase
      .from("offers")
      .update({ nova: false, atualizada_em: new Date().toISOString() })
      .eq("user_id", usuario.id)
      .in("id", idsValidos);

    if (error) throw error;

    setListaOfertas((atual) =>
      atual.map((item) =>
        idsValidos.includes(item.id)
          ? { ...item, nova: false, atualizada_em: new Date().toISOString() }
          : item
      )
    );
  }

  async function colocarOfertasSelecionadasNaFila() {
    const ids = Array.from(ofertasSelecionadas);
    if (!ids.length) {
      setMensagemOferta("Selecione pelo menos uma oferta.");
      return;
    }
    setEnfileirandoOfertas(true);
    setMensagemOferta("");
    try {
      const ofertas = ids.map((id) => listaOfertas.find((item) => String(item.id) === String(id))).filter(Boolean);
      const pendentesML = ofertas.filter((o) =>
        String(o.store_provider || "").toLowerCase() === "mercadolivre" &&
        !String(o.affiliate_url || "").trim()
      );
      const idsGeracaoDireta = ofertas
        .filter((o) => !pendentesML.some((p) => String(p.id) === String(o.id)))
        .map((o) => o.id);

      for (const oferta of pendentesML) {
        const productUrl = String(oferta.store_product_url || oferta.url_produto || "").trim();
        if (!productUrl) continue;
        window.postMessage({
          source: "robo-de-ofertas",
          type: "ML_AFFILIATE_GENERATE",
          offer: {
            offer_id: String(oferta.id),
            title: oferta.titulo || "Produto Mercado Livre",
            product_url: productUrl,
            product_external_id: oferta.product_external_id || null
          }
        }, "*");
      }

      if (pendentesML.length) {
        setMensagemOferta(
          pendentesML.length === 1
            ? "Gerando o link de afiliado oficial do Mercado Livre..."
            : "Gerando os links de afiliado oficiais do Mercado Livre para as ofertas selecionadas..."
        );
      }

      if (idsGeracaoDireta.length) {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) throw new Error("Sessao expirada. Faca login novamente.");
        const response = await fetch(SUPABASE_URL + "/functions/v1/generate-content", {
          method: "POST",
          headers: { Authorization: "Bearer " + session.access_token, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: usuario.id, offer_ids: idsGeracaoDireta })
        });
        const resultado = await response.json().catch(() => ({}));
        if (!response.ok || resultado?.ok === false) throw new Error(resultado?.error || resultado?.message || ("Erro HTTP " + response.status));
        const count = Number(resultado.count || 0);
        if (count > 0) await marcarOfertasComoCadastradas(idsGeracaoDireta);
        if (!pendentesML.length) {
          setMensagemOferta(count > 0 ? count + " oferta(s) colocada(s) na fila de publicação e transferida(s) para Cadastradas." : (resultado.message || "Nenhuma oferta nova foi colocada na fila."));
        }
      }

      limparSelecaoOfertas();
      await carregarConteudos();
    } catch (error) {
      console.error("ENFILEIRAR OFERTAS:", error);
      setMensagemOferta(error?.message || "Nao foi possivel colocar as ofertas na fila.");
    } finally {
      setEnfileirandoOfertas(false);
    }
  }

  async function colocarOfertaNaFila(id) {
    setEnfileirandoOfertas(true);
    setMensagemOferta("");
    try {
      const oferta = listaOfertas.find((item) => String(item.id) === String(id));
      if (!oferta) throw new Error("Oferta não encontrada.");

      const provider = String(oferta.store_provider || "").toLowerCase();
      const productUrl = String(oferta.store_product_url || oferta.url_produto || "").trim();

      if (provider === "mercadolivre" && !String(oferta.affiliate_url || "").trim()) {
        if (!productUrl) throw new Error("Esta oferta do Mercado Livre não possui URL do produto.");

        window.postMessage({
          source: "robo-de-ofertas",
          type: "ML_AFFILIATE_GENERATE",
          offer: {
            offer_id: String(oferta.id),
            title: oferta.titulo || "Produto Mercado Livre",
            product_url: productUrl,
            product_external_id: oferta.product_external_id || null
          }
        }, "*");

        setMensagemOferta("Gerando o link de afiliado oficial do Mercado Livre...");
        return;
      }

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Sessao expirada. Faca login novamente.");
      const response = await fetch(SUPABASE_URL + "/functions/v1/generate-content", {
        method: "POST",
        headers: { Authorization: "Bearer " + session.access_token, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: usuario.id, offer_ids: [id] })
      });
      const resultado = await response.json().catch(() => ({}));
      if (!response.ok || resultado?.ok === false) throw new Error(resultado?.error || resultado?.message || ("Erro HTTP " + response.status));
      const quantidadeCriada = Number(resultado.count || 0);
      if (quantidadeCriada > 0) {
        await marcarOfertasComoCadastradas([id]);
      }
      setMensagemOferta(quantidadeCriada > 0 ? "Oferta colocada na fila de publicação e transferida para Cadastradas." : (resultado.message || "Esta oferta já possui conteúdo na fila ou foi descartada."));
      await carregarConteudos();
    } catch (error) {
      console.error("ENFILEIRAR OFERTA:", error);
      setMensagemOferta(error?.message || "Nao foi possivel colocar a oferta na fila.");
    } finally {
      setEnfileirandoOfertas(false);
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
    ["cupons", "Cupons"],
    ["conteudo", "Conteudo"],
    ["resultados", "Resultados"],
    ["config", "Config"]
  ];

  function ofertaEhPublicada(o) {
    return ofertasPublicadas.has(o.id);
  }

  function ofertaEhNova(o) {
    // A aba Novas considera tanto a marca persistida pelo backend quanto
    // as ofertas realmente inseridas nesta busca. Isso evita perder as novas
    // quando a busca atualiza ofertas antigas e o backend devolve nova=false.
    return !ofertaEhPublicada(o) && (o?.nova === true || novasShopeeIds.has(String(o?.id)));
  }

  function ordenarOfertasParaExibicao(lista, provider = null) {
    return [...lista].sort((a, b) => {
      if (provider === "shopee") {
        const vendasA = Number(a?.dados_origem?.ranking?.sales ?? a?.dados_origem?.sales ?? a?.vendas ?? 0);
        const vendasB = Number(b?.dados_origem?.ranking?.sales ?? b?.dados_origem?.sales ?? b?.vendas ?? 0);
        if (vendasB !== vendasA) return vendasB - vendasA;
        const ca = Number(a.comissao_estimada || 0);
        const cb = Number(b.comissao_estimada || 0);
        if (cb !== ca) return cb - ca;
      }
      const ca = Number(a.comissao_estimada || 0);
      const cb = Number(b.comissao_estimada || 0);
      if (cb !== ca) return cb - ca;
      const da = Number(a.desconto_percentual || 0);
      const db = Number(b.desconto_percentual || 0);
      if (db !== da) return db - da;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
  }

  function ofertasDaAba(provider) {
    const base = listaOfertas
      .filter((o) => o.store_provider === provider || o.platforms?.nome === (provider === "shopee" ? "Shopee" : "Mercado Livre"))
      .filter((o) => provider !== "mercadolivre" || Number(o.preco_atual) > 0);
    if (abaOfertas === "publicadas") return ordenarOfertasParaExibicao(base.filter(ofertaEhPublicada), provider).slice(0, 50);
    if (abaOfertas === "novas") return ordenarOfertasParaExibicao(base.filter(ofertaEhNova), provider).slice(0, 20);
    return ordenarOfertasParaExibicao(base.filter((o) => !ofertaEhPublicada(o) && !ofertaEhNova(o)), provider).slice(0, 50);
  }

  function conteudoEhVideo(c) {
    return c.tipo === "video_oferta" || !!c.video_url || !!c.video_source;
  }

  function conteudoNaFila(c) {
    return ["pronto", "aguardando_revisao", "publicando"].includes(c.status);
  }

  const redesPublicacao = [
    { key: "instagram", label: "Instagram", tipo: "instagram", emoji: "📸" },
    { key: "tiktok", label: "TikTok", tipo: "tiktok", emoji: "🎵" },
    { key: "youtube", label: "YouTube Shorts", tipo: "youtube_shorts", emoji: "▶️" },
    { key: "whatsapp", label: "WhatsApp", tipo: "whatsapp", emoji: "💬" },
    { key: "kwai", label: "Kwai", tipo: "kwai", emoji: "🎬" },
    { key: "facebook", label: "Facebook", tipo: "facebook", emoji: "🔵" },
    { key: "pinterest", label: "Pinterest", tipo: "pinterest", emoji: "📌" }
  ];

  function publicacaoFoiConcluida(p) {
    return !!p?.published_at || ["publicado", "publicada", "published", "sucesso"].includes(String(p?.status || "").toLowerCase());
  }

  function conteudosPublicadosNaRede(lista, tipo) {
    const ids = new Set(
      publicacoes
        .filter((p) => publicacaoFoiConcluida(p) && p?.publication_channels?.tipo === tipo && p?.content_id)
        .map((p) => String(p.content_id))
    );
    return lista.filter((c) => ids.has(String(c.id)));
  }

  function filtrarConteudosGestao(lista, aba) {
    if (aba === "controle") return lista;
    if (aba === "posts") return lista.filter((c) => conteudoNaFila(c) && !conteudoEhVideo(c));
    if (aba === "videos") return lista.filter((c) => conteudoNaFila(c) && conteudoEhVideo(c));
    if (aba === "publicados") return lista.filter((c) => ["publicado", "publicada"].includes(c.status));
    if (aba === "descartados") return lista.filter((c) => c.status === "descartado");
    const rede = redesPublicacao.find((r) => r.key === aba);
    if (rede) return conteudosPublicadosNaRede(lista, rede.tipo);
    return lista;
  }

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
        <button className="pause" onClick={() => salvarConfiguracao({ ativo: pausado })} disabled={salvandoConfig}>{pausado ? "CONTINUAR" : "PAUSAR ROBO"}</button>
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
            <div className="panel" style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}><button className="primary" onClick={buscarOfertasMercadoLivre} disabled={carregandoOfertas || carregandoShopee}>{carregandoOfertas ? "BUSCANDO..." : "🔎 BUSCAR OFERTAS DO MERCADO LIVRE"}</button><button className="secondary danger" onClick={limparOfertasManualmente} disabled={carregandoOfertas || carregandoShopee}>🗑️ LIMPAR OFERTAS</button></div>
            {mensagemOferta && <div className="panel"><p>{mensagemOferta}</p></div>}
            <div className="offer-tabs">
              <button className={abaOfertas === "novas" ? "tab-ativo" : ""} onClick={() => setAbaOfertas("novas")}>🆕 Novas <span>{listaOfertas.filter((o) => (o.store_provider === "mercadolivre" || o.platforms?.nome === "Mercado Livre") && ofertaEhNova(o)).length}</span></button>
              <button className={abaOfertas === "cadastradas" ? "tab-ativo" : ""} onClick={() => setAbaOfertas("cadastradas")}>📦 Cadastradas <span>{listaOfertas.filter((o) => (o.store_provider === "mercadolivre" || o.platforms?.nome === "Mercado Livre") && !ofertaEhPublicada(o) && !ofertaEhNova(o)).length}</span></button>
              <button className={abaOfertas === "publicadas" ? "tab-ativo" : ""} onClick={() => setAbaOfertas("publicadas")}>📢 Publicadas <span>{listaOfertas.filter((o) => (o.store_provider === "mercadolivre" || o.platforms?.nome === "Mercado Livre") && ofertaEhPublicada(o)).length}</span></button>
            </div>
            <div className="panel" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",flexWrap:"wrap"}}><div><strong>{ofertasSelecionadas.size}</strong> oferta(s) selecionada(s)</div><div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}><button className="primary" disabled={!ofertasSelecionadas.size || enfileirandoOfertas} onClick={colocarOfertasSelecionadasNaFila}>📥 COLOCAR SELECIONADAS NA FILA</button><button className="secondary" disabled={!ofertasSelecionadas.size || enfileirandoOfertas} onClick={limparSelecaoOfertas}>LIMPAR SELEÇÃO</button></div></div>
            <div className="panel">
              <h3>{abaOfertas === "novas" ? "Novas ofertas — Mercado Livre" : abaOfertas === "publicadas" ? "Ofertas já publicadas — Mercado Livre" : "Ofertas já cadastradas — Mercado Livre"}</h3>
              {carregandoOfertas && <p>Carregando ofertas...</p>}
              {!carregandoOfertas && ofertasDaAba("mercadolivre").length === 0 && <p>{abaOfertas === "novas" ? "Nenhuma oferta nova na última hora." : abaOfertas === "publicadas" ? "Nenhuma oferta publicada ainda." : "Nenhuma oferta cadastrada nesta aba."}</p>}
              {ofertasDaAba("mercadolivre").map((o) => (
                <div className="offer" key={o.id}>
                  <div className="offer-image">{o.imagem_url ? <img src={o.imagem_url} alt="" /> : "Oferta"}</div>
                  <div className="offer-info"><label style={{display:"flex",alignItems:"center",gap:"8px",fontWeight:700}}><input type="checkbox" checked={ofertasSelecionadas.has(o.id)} onChange={() => alternarOfertaSelecionada(o.id)} /> Selecionar para publicação</label><h3>{o.titulo}</h3><p>Mercado Livre</p><strong>{o.preco_atual == null ? "Preço não informado" : moeda(o.preco_atual)}</strong>{o.desconto_percentual != null && <span>{Number(o.desconto_percentual || 0)}% de desconto</span>}<small>Comissao estimada: {moeda(o.comissao_estimada)}</small><small>Status: {o.classificacao}</small><div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}><select value={o.classificacao} onChange={(e) => alterarClassificacao(o.id, e.target.value)}><option value="interessante">Interessante</option><option value="verificar">Verificar</option><option value="descartada">Descartada</option></select><button className="primary" disabled={enfileirandoOfertas} onClick={() => colocarOfertaNaFila(o.id)}>📥 COLOCAR NA FILA</button><button className="secondary" onClick={() => excluirOferta(o.id)}>Excluir</button></div></div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "ofertas-shopee" && (
          <>
            <h2>Ofertas Shopee</h2>
            <div className="panel" style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}><button className="primary" onClick={buscarOfertasShopee} disabled={carregandoShopee || carregandoOfertas}>{carregandoShopee ? "BUSCANDO..." : "🔎 BUSCAR OFERTAS DA SHOPEE"}</button><button className="secondary danger" onClick={limparOfertasManualmente} disabled={carregandoShopee || carregandoOfertas}>🗑️ LIMPAR OFERTAS</button></div>
            {mensagemShopee && <div className="panel"><p>{mensagemShopee}</p></div>}
            <div className="offer-tabs">
              <button className={abaOfertas === "novas" ? "tab-ativo" : ""} onClick={() => setAbaOfertas("novas")}>🆕 Novas <span>{listaOfertas.filter((o) => (o.store_provider === "shopee" || o.platforms?.nome === "Shopee") && ofertaEhNova(o)).length}</span></button>
              <button className={abaOfertas === "cadastradas" ? "tab-ativo" : ""} onClick={() => setAbaOfertas("cadastradas")}>📦 Cadastradas <span>{listaOfertas.filter((o) => (o.store_provider === "shopee" || o.platforms?.nome === "Shopee") && !ofertaEhPublicada(o) && !ofertaEhNova(o)).length}</span></button>
              <button className={abaOfertas === "publicadas" ? "tab-ativo" : ""} onClick={() => setAbaOfertas("publicadas")}>📢 Publicadas <span>{listaOfertas.filter((o) => (o.store_provider === "shopee" || o.platforms?.nome === "Shopee") && ofertaEhPublicada(o)).length}</span></button>
            </div>
            <div className="panel" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",flexWrap:"wrap"}}><div><strong>{ofertasSelecionadas.size}</strong> oferta(s) selecionada(s)</div><div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}><button className="primary" disabled={!ofertasSelecionadas.size || enfileirandoOfertas} onClick={colocarOfertasSelecionadasNaFila}>📥 COLOCAR SELECIONADAS NA FILA</button><button className="secondary" disabled={!ofertasSelecionadas.size || enfileirandoOfertas} onClick={limparSelecaoOfertas}>LIMPAR SELEÇÃO</button></div></div>
            <div className="panel">
              <h3>{abaOfertas === "novas" ? "Novas ofertas — Shopee" : abaOfertas === "publicadas" ? "Ofertas já publicadas — Shopee" : "Ofertas já cadastradas — Shopee"}</h3>
              {carregandoShopee && <p>Carregando ofertas...</p>}
              {!carregandoShopee && ofertasDaAba("shopee").length === 0 && <p>{abaOfertas === "novas" ? "Nenhuma oferta nova nesta busca." : abaOfertas === "publicadas" ? "Nenhuma oferta publicada ainda." : "Nenhuma oferta cadastrada nesta aba."}</p>}
              {ofertasDaAba("shopee").map((o) => (
                <div className="offer" key={o.id}>
                  <div className="offer-image">{o.imagem_url ? <img src={o.imagem_url} alt="" /> : "Oferta"}</div>
                  <div className="offer-info"><label style={{display:"flex",alignItems:"center",gap:"8px",fontWeight:700}}><input type="checkbox" checked={ofertasSelecionadas.has(o.id)} onChange={() => alternarOfertaSelecionada(o.id)} /> Selecionar para publicação</label><h3>{o.titulo}</h3><p>Shopee</p><strong>{o.preco_atual == null ? "Preço não informado" : moeda(o.preco_atual)}</strong>{o.desconto_percentual != null && <span>{Number(o.desconto_percentual || 0)}% de desconto</span>}<small>Comissao estimada: {moeda(o.comissao_estimada)}</small><small>Status: {o.classificacao}</small><div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}><select value={o.classificacao} onChange={(e) => alterarClassificacao(o.id, e.target.value)}><option value="interessante">Interessante</option><option value="verificar">Verificar</option><option value="descartada">Descartada</option></select><button className="primary" disabled={enfileirandoOfertas} onClick={() => colocarOfertaNaFila(o.id)}>📥 COLOCAR NA FILA</button><button className="secondary" onClick={() => excluirOferta(o.id)}>Excluir</button></div></div>
                </div>
              ))}
            </div>
          </>
        )}

        {pagina === "cupons" && (
          <>
            <h2>Cupons Shopee</h2>
            <div className="panel coupon-admin-hero">
              <h3>🎟️ Página pública de cupons</h3>
              <p>Os cupons verificados aparecem aqui e podem ser divulgados em uma única página. A página pública só mostra cupons ativos, dentro da validade e marcados como verificados.</p>
              <div className="coupon-public-link">
                <code>{window.location.origin}{import.meta.env.BASE_URL}cupons/</code>
                <button className="secondary" onClick={copiarPaginaCupons}>COPIAR LINK</button>
              </div>
              {mensagemCupons && <p className="status">{mensagemCupons}</p>}
            </div>
            <div className="panel">
              <h3>Cupons disponíveis</h3>
              {carregandoCupons && <p>Carregando cupons...</p>}
              {!carregandoCupons && cupons.length === 0 && (
                <div className="coupon-empty">
                  <strong>Nenhum cupom verificado ainda.</strong>
                  <p>A estrutura já está pronta. O próximo passo é alimentar esta lista somente com cupons oficiais/verificados da sua conta Shopee.</p>
                </div>
              )}
              {!carregandoCupons && cupons.map((c) => (
                <div className="coupon-card" key={c.id}>
                  <div className="coupon-badge">🎟️</div>
                  <div className="offer-info">
                    <h3>{c.codigo || "Cupom"}</h3>
                    <p>{c.descricao || "Cupom Shopee"}</p>
                    {c.percentual != null && <strong>{Number(c.percentual)}% OFF</strong>}
                    {c.valor != null && <strong>{moeda(c.valor)} OFF</strong>}
                    {c.compra_minima != null && <small>Compra mínima: {moeda(c.compra_minima)}</small>}
                    {c.validade_fim && <small>Válido até: {new Date(c.validade_fim).toLocaleString("pt-BR")}</small>}
                    <small>{c.offer_id ? "Vinculado a uma oferta" : "Cupom geral"}</small>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {pagina === "conteudo" && (
          <>
            <h2>Gestão de Conteúdo</h2>
            {mensagemConteudo && <div className="panel"><p>{mensagemConteudo}</p></div>}

            <div className="content-tabs">
              <button className={abaConteudo === "controle" ? "tab-ativo" : ""} onClick={() => setAbaConteudo("controle")}>
                🗂️ Controle <span>{conteudos.length}</span>
              </button>
              <button className={abaConteudo === "posts" ? "tab-ativo" : ""} onClick={() => setAbaConteudo("posts")}>
                🖼️ Fila de Posts <span>{conteudos.filter((c) => conteudoNaFila(c) && !conteudoEhVideo(c)).length}</span>
              </button>
              <button className={abaConteudo === "videos" ? "tab-ativo" : ""} onClick={() => setAbaConteudo("videos")}>
                🎬 Fila de Vídeos <span>{conteudos.filter((c) => conteudoNaFila(c) && conteudoEhVideo(c)).length}</span>
              </button>
              <button className={abaConteudo === "publicados" ? "tab-ativo" : ""} onClick={() => setAbaConteudo("publicados")}>
                📢 Publicados <span>{conteudos.filter((c) => ["publicado","publicada"].includes(c.status)).length}</span>
              </button>
              <button className={abaConteudo === "descartados" ? "tab-ativo" : ""} onClick={() => setAbaConteudo("descartados")}>
                🗑️ Descartados <span>{conteudos.filter((c) => c.status === "descartado").length}</span>
              </button>
              {redesPublicacao.map((rede) => {
                const publicadosNaRede = conteudosPublicadosNaRede(conteudos, rede.tipo);
                return (
                  <button key={rede.key} className={abaConteudo === rede.key ? "tab-ativo" : ""} onClick={() => setAbaConteudo(rede.key)}>
                    {rede.emoji} {rede.label} <span>{publicadosNaRede.length}</span>
                  </button>
                );
              })}
            </div>

            <div className="panel">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",flexWrap:"wrap"}}>
                <div>
                  <h3 style={{marginBottom:"4px"}}>
                    {abaConteudo === "controle" ? "Controle geral" :
                     abaConteudo === "posts" ? "Fila de Posts" :
                     abaConteudo === "videos" ? "Fila de Vídeos" :
                     abaConteudo === "publicados" ? "Conteúdos publicados" :
                     abaConteudo === "descartados" ? "Conteúdos descartados" :
                     (redesPublicacao.find((r) => r.key === abaConteudo)?.label || "Publicações")}
                  </h3>
                  <p style={{marginTop:0}}>
                    {abaConteudo === "controle"
                      ? "Aqui fica tudo: posts, vídeos, aguardando revisão, na fila, publicando, publicados e descartados."
                      : abaConteudo === "posts"
                      ? "Somente conteúdos em fila que serão publicados como post com imagem."
                      : abaConteudo === "videos"
                      ? "Somente conteúdos em fila que serão publicados como vídeo/Reels."
                      : abaConteudo === "publicados"
                      ? "Histórico geral dos conteúdos que já foram publicados."
                      : abaConteudo === "descartados"
                      ? "Histórico dos conteúdos que você descartou."
                      : "Somente conteúdos publicados na rede selecionada."}
                  </p>
                </div>
                <button className="secondary" onClick={carregarConteudos}>🔄 ATUALIZAR</button>
              </div>

              {filtrarConteudosGestao(conteudos, abaConteudo).length === 0 && (
                <p>Nenhum conteúdo nesta categoria.</p>
              )}

              {filtrarConteudosGestao(conteudos, abaConteudo).map((c) => (
                <div className="content-card" key={c.id}>
                  <div className="content-preview">
                    {c.thumbnail_url
                      ? <img src={c.thumbnail_url} alt="" loading="lazy" />
                      : <span>{conteudoEhVideo(c) ? "🎬" : "🖼️"}</span>}
                  </div>

                  <div className="offer-info">
                    <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                      <h3 style={{margin:0}}>{c.titulo || "Conteúdo de oferta"}</h3>
                      <span className="status" style={{margin:0}}>
                        {conteudoEhVideo(c) ? "🎬 VÍDEO" : "🖼️ POST"}
                      </span>
                    </div>

                    <p>
                      Status: <strong>{c.status || "rascunho"}</strong>
                      {c.video_status ? <> · Vídeo: <strong>{c.video_status}</strong></> : null}
                    </p>

                    <small>{c.legenda || c.texto || ""}</small>

                    {c.video_url && (
                      <small style={{display:"block",marginTop:"6px"}}>
                        Vídeo pronto para publicação.
                      </small>
                    )}

                    {c.status === "aguardando_revisao" && (
                      <button
                        className="primary"
                        style={{marginTop:"10px"}}
                        disabled={aprovandoConteudo === c.id}
                        onClick={() => aprovarConteudo(c.id)}
                      >
                        {aprovandoConteudo === c.id ? "APROVANDO..." : "APROVAR E COLOCAR NA FILA"}
                      </button>
                    )}

                    {conteudoNaFila(c) && (
                      <div className="content-actions">
                        <div style={{width:"100%",padding:"10px 0 4px",borderTop:"1px solid #eee",marginTop:"8px"}}>
                          <strong style={{display:"block",marginBottom:"8px"}}>📢 PUBLICAÇÕES</strong>
                          <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                            <button type="button" className="primary action-button" disabled={processandoConteudo === c.id} onClick={(e) => { e.preventDefault(); publicarAgora(c.id,"instagram"); }}>📸 PUBLICAR INSTAGRAM</button>
                            <button type="button" className="primary action-button" disabled={processandoConteudo === c.id || !conteudoEhVideo(c)} title={!conteudoEhVideo(c) ? "TikTok exige vídeo." : ""} onClick={(e) => { e.preventDefault(); publicarAgora(c.id,"tiktok"); }}>🎵 PUBLICAR TIKTOK</button>
                            <button type="button" className="primary action-button" disabled={processandoConteudo === c.id || !conteudoEhVideo(c)} title={!conteudoEhVideo(c) ? "YouTube Shorts exige vídeo." : ""} onClick={(e) => { e.preventDefault(); publicarAgora(c.id,"youtube"); }}>▶️ PUBLICAR YOUTUBE</button>
                          </div>
                        </div>

                        {c.status !== "publicando" && (
                          <button type="button" className="secondary action-button" disabled={processandoConteudo === c.id} onClick={(e) => { e.preventDefault(); alterarStatusConteudo(c.id,"pronto"); }}>
                            📥 COLOCAR NA FILA
                          </button>
                        )}

                        {c.status !== "publicando" && !conteudoEhVideo(c) && (
                          <button type="button" className="secondary action-button" disabled={processandoConteudo === c.id} onClick={(e) => { e.preventDefault(); alterarModoConteudo(c.id,"video"); }}>
                            🎬 GERAR VÍDEO
                          </button>
                        )}

                        {c.status !== "publicando" && conteudoEhVideo(c) && (
                          <button type="button" className="secondary action-button" disabled={processandoConteudo === c.id} onClick={(e) => { e.preventDefault(); alterarModoConteudo(c.id,"post"); }}>
                            🖼️ USAR APENAS POST
                          </button>
                        )}

                        <button type="button" className="secondary action-button danger" disabled={processandoConteudo === c.id} onClick={(e) => { e.preventDefault(); alterarStatusConteudo(c.id,"descartado"); }}>
                          🗑️ DESCARTAR
                        </button>
                      </div>
                    )}
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
                        <p>Status: {provider.key === "shopee" && conta ? "conectada" : (conta?.status || "Nao conectada")}</p>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button className="primary" onClick={() => prepararConexao(provider)}>
                            {(provider.key === "shopee" && conta) || conta?.status === "conectada" ? "CONFIGURAR" : "CONECTAR"}
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
              <label><span>Formato padrão dos conteúdos</span>
                <select value={config.modo_conteudo || "post"} onChange={e=>salvarConfiguracao({modo_conteudo:e.target.value})}>
                  <option value="post">🖼️ Post com imagem</option>
                  <option value="video">🎬 Vídeo</option>
                  <option value="automatico">🤖 Automático (vídeo original; senão post)</option>
                </select>
              </label>
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