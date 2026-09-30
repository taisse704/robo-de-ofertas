import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const FRONTEND_BUILD_VERSION = "2026-09-30-ml-affiliate-link";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const providers = [
  { key: "shopee", name: "Shopee" },
  { key: "mercadolivre", name: "Mercado Livre" },
  { key: "magalu", name: "Magalu" },
  { key: "amazon", name: "Amazon" }
];

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [pagina, setPagina] = useState("inicio");
  const [listaOfertas, setListaOfertas] = useState([]);
  const [carregandoOfertas, setCarregandoOfertas] = useState(false);
  const [mensagemOferta, setMensagemOferta] = useState("");
  const [linkEditando, setLinkEditando] = useState(null);
  const [linkAfiliado, setLinkAfiliado] = useState("");
  const [salvandoLink, setSalvandoLink] = useState(false);

  useEffect(() => {
    verificarSessao();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUsuario(session?.user || null);
      setCarregando(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (usuario) carregarOfertas();
  }, [usuario]);

  async function verificarSessao() {
    try {
      const { data } = await supabase.auth.getSession();
      setUsuario(data.session?.user || null);
    } finally {
      setCarregando(false);
    }
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
      setMensagemOferta("Não foi possível carregar as ofertas.");
    } else {
      setListaOfertas(data || []);
    }
    setCarregandoOfertas(false);
  }

  function abrirLink(offer) {
    setLinkEditando(offer);
    setLinkAfiliado(offer?.link_afiliado || offer?.url_afiliado || "");
    setMensagemOferta("");
  }

  async function salvarLinkAfiliado() {
    if (!linkEditando) return;
    const link = linkAfiliado.trim();
    if (!/^https:\/\//i.test(link)) {
      setMensagemOferta("O link precisa começar com https://");
      return;
    }
    if (!/mercadolivre\.com\.br|mercadolibre\.com/i.test(link)) {
      setMensagemOferta("Informe um link oficial do Mercado Livre.");
      return;
    }

    setSalvandoLink(true);
    setMensagemOferta("");
    try {
      const payload = {
        link_afiliado: link,
        url_afiliado: link,
        permitido_afiliado: true,
        permitido_divulgacao: true,
        atualizada_em: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("offers")
        .update(payload)
        .eq("id", linkEditando.id)
        .eq("user_id", usuario.id);
      if (error) throw error;
      setMensagemOferta("Link de afiliado salvo e oferta liberada para divulgação.");
      setLinkEditando(null);
      setLinkAfiliado("");
      await carregarOfertas();
    } catch (error) {
      console.error(error);
      setMensagemOferta(error?.message || "Não foi possível salvar o link.");
    } finally {
      setSalvandoLink(false);
    }
  }

  function cancelarLink() {
    setLinkEditando(null);
    setLinkAfiliado("");
  }

  if (carregando) return <div style={{ padding: 24 }}>Carregando...</div>;
  if (!usuario) return <div style={{ padding: 24 }}>Faça login para acessar o Robô de Ofertas.</div>;

  return (
    <div style={{ minHeight: "100vh", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>ROBO DE OFERTAS</h1>
      <div style={{ marginBottom: 20 }}>Versão: {FRONTEND_BUILD_VERSION}</div>

      <nav style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <button onClick={() => setPagina("inicio")}>🏠 Início</button>
        <button onClick={() => { setPagina("ofertas"); carregarOfertas(); }}>🔎 Ofertas</button>
        <button onClick={() => setPagina("conteudo")}>🎬 Conteúdo</button>
        <button onClick={() => setPagina("resultados")}>📊 Resultados</button>
        <button onClick={() => setPagina("config")}>⚙️</button>
      </nav>

      {pagina === "ofertas" && (
        <section>
          <h2>Ofertas</h2>
          {mensagemOferta && <div style={{ padding: 12, marginBottom: 15, border: "1px solid #ccc", borderRadius: 8 }}>{mensagemOferta}</div>}

          {linkEditando && (
            <div style={{ padding: 16, marginBottom: 20, border: "1px solid #aaa", borderRadius: 10 }}>
              <h3>🔗 Link de afiliado — {linkEditando.titulo || "Produto Mercado Livre"}</h3>
              <p>Use somente o link oficial gerado pelo Programa de Afiliados do Mercado Livre.</p>
              <input
                value={linkAfiliado}
                onChange={(e) => setLinkAfiliado(e.target.value)}
                placeholder="https://..."
                style={{ width: "100%", padding: 12, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button onClick={salvarLinkAfiliado} disabled={salvandoLink}>{salvandoLink ? "Salvando..." : "Salvar link"}</button>
                <button onClick={cancelarLink}>Cancelar</button>
              </div>
            </div>
          )}

          {carregandoOfertas ? <p>Carregando ofertas...</p> : listaOfertas.length === 0 ? <p>Nenhuma oferta cadastrada ainda.</p> : (
            <div>
              {listaOfertas.map((offer) => {
                const afiliado = offer.link_afiliado || offer.url_afiliado || "";
                const liberada = !!afiliado && offer.permitido_afiliado !== false && offer.permitido_divulgacao !== false;
                return (
                  <article key={offer.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 15, marginBottom: 12 }}>
                    <strong>{offer.titulo || "Produto Mercado Livre"}</strong>
                    <div>Preço: {offer.preco_atual != null ? `R$ ${Number(offer.preco_atual).toFixed(2)}` : "—"}</div>
                    <div style={{ marginTop: 8 }}>{liberada ? "🟢 Link de afiliado validado" : "🔒 Aguardando link oficial de afiliado"}</div>
                    <button style={{ marginTop: 10 }} onClick={() => abrirLink(offer)}>
                      {liberada ? "✏️ Editar link afiliado" : "🔗 Adicionar link de afiliado"}
                    </button>
                    {liberada && <a href={afiliado} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8 }}>Abrir link afiliado</a>}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {pagina === "inicio" && <h2>Início</h2>}
      {pagina === "conteudo" && <h2>Conteúdo</h2>}
      {pagina === "resultados" && <h2>Resultados</h2>}
      {pagina === "config" && <h2>Configurações</h2>}
    </div>
  );
}
