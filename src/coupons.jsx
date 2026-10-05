import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./coupons.css";

const API = "https://ytymdncyaynmypiodhfc.supabase.co/functions/v1/coupon-page";
const PAGE_SLUG = "cupons-shopee";

function money(value) {
  if (value == null || value === "") return "";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function CouponPage() {
  const [page, setPage] = useState({ titulo: "Cupons Shopee de Hoje", subtitulo: "Cupons e descontos verificados." });
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(API + "?action=list&slug=" + encodeURIComponent(PAGE_SLUG))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Não foi possível carregar os cupons.");
        setPage(data.page || {});
        setCoupons(data.coupons || []);
      })
      .catch((err) => setError(err.message || "Erro ao carregar os cupons."))
      .finally(() => setLoading(false));
  }, []);

  function usarCupom(coupon) {
    const params = new URLSearchParams({
      action: "click",
      slug: PAGE_SLUG,
      coupon_id: coupon.id,
      origem: "pagina_cupons",
      sub_id: "pagina_cupons"
    });
    window.location.href = API + "?" + params.toString();
  }

  return (
    <div className="coupon-page">
      <header className="coupon-header">
        <div className="coupon-logo">🎟️</div>
        <div>
          <h1>{page.titulo}</h1>
          <p>{page.subtitulo}</p>
        </div>
      </header>
      <main className="coupon-main">
        <div className="coupon-intro">
          <span>🔥 ATUALIZADOS</span>
          <h2>Economize nas suas compras</h2>
          <p>Confira os cupons disponíveis e aproveite antes que expirem ou atinjam o limite de uso.</p>
        </div>
        {loading && <div className="coupon-message">Carregando cupons...</div>}
        {error && <div className="coupon-message error">{error}</div>}
        {!loading && !error && coupons.length === 0 && (
          <div className="coupon-message">
            <strong>Nenhum cupom disponível neste momento.</strong>
            <p>Volte em breve. A página é atualizada pelo Robô de Ofertas.</p>
          </div>
        )}
        <section className="coupon-grid">
          {coupons.map((coupon) => (
            <article className="public-coupon" key={coupon.id}>
              {coupon.imagem_url && <img src={coupon.imagem_url} alt="" loading="lazy" />}
              <div className="public-coupon-body">
                <div className="coupon-label">🎟️ CUPOM</div>
                <h3>{coupon.codigo || "Cupom Shopee"}</h3>
                <p>{coupon.descricao || "Use este cupom na Shopee."}</p>
                <div className="coupon-value">
                  {coupon.percentual != null ? `${Number(coupon.percentual)}% OFF` : ""}
                  {coupon.valor != null ? `${money(coupon.valor)} OFF` : ""}
                  {!coupon.percentual && !coupon.valor ? "DESCONTO" : ""}
                </div>
                {coupon.compra_minima != null && <small>Compra mínima: {money(coupon.compra_minima)}</small>}
                {coupon.validade_fim && <small>Válido até {new Date(coupon.validade_fim).toLocaleString("pt-BR")}</small>}
                {coupon.regras?.texto && <small>{coupon.regras.texto}</small>}
                {coupon.disponivel_para_clique ? (
                  <button onClick={() => usarCupom(coupon)}>PEGAR CUPOM →</button>
                ) : (
                  <button disabled>LINK INDISPONÍVEL</button>
                )}
              </div>
            </article>
          ))}
        </section>
        <div className="coupon-disclaimer">
          <strong>Publicidade / link de afiliado</strong>
          <p>Esta página pode conter links de afiliado. Podemos receber comissão quando uma compra é realizada através de nossos links, sem custo adicional para você.</p>
          <p>Confira sempre as condições, validade, elegibilidade e limite de uso do cupom antes de finalizar a compra.</p>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<CouponPage />);
