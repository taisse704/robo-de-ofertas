import { useEffect, useRef } from "react";

const SOURCE = "robo-de-ofertas";
const RETRY_AFTER_MS = 45000;

// Este bridge só atende solicitações explícitas feitas pelo aplicativo.
// Não varre ofertas pendentes em segundo plano: isso abria abas do Mercado Livre
// durante buscas normais, sem a usuária pedir geração de link.
export default function MercadoLivreAffiliateBridge() {
  const processando = useRef(new Set());
  const timeouts = useRef(new Map());

  useEffect(() => {
    const programarRetry = (offerId) => {
      const id = String(offerId || "").trim();
      if (!id) return;
      const anterior = timeouts.current.get(id);
      if (anterior) window.clearTimeout(anterior);
      const timer = window.setTimeout(() => {
        timeouts.current.delete(id);
        processando.current.delete(id);
        window.postMessage({
          source: SOURCE,
          type: "ML_AFFILIATE_RESULT",
          offer_id: id,
          ok: false,
          error: "A extensão não respondeu. Confira se a extensão única Shopee + Mercado Livre está instalada e ativada. A geração automática em segundo plano foi desativada; tente gerar o link novamente pela oferta."
        }, "*");
      }, RETRY_AFTER_MS);
      timeouts.current.set(id, timer);
    };

    const onMessage = (event) => {
      const data = event?.data;
      if (event.source !== window || !data || data.source !== SOURCE) return;
      if (data.type === "ML_AFFILIATE_RESULT") {
        const id = String(data.offer_id || "").trim();
        if (id) {
          const timer = timeouts.current.get(id);
          if (timer) window.clearTimeout(timer);
          timeouts.current.delete(id);
          processando.current.delete(id);
        }
        return;
      }
      if (data.type !== "ML_AFFILIATE_REQUEST") return;
      const offer = data.offer || {};
      const offerId = String(offer.offer_id || "").trim();
      const productUrl = String(offer.product_url || "").trim();
      if (!offerId || !productUrl || processando.current.has(offerId)) return;
      processando.current.add(offerId);
      programarRetry(offerId);
      window.postMessage({
        source: SOURCE,
        type: "ML_AFFILIATE_GENERATE",
        offer: {
          offer_id: offerId,
          title: offer.title || "Produto Mercado Livre",
          product_url: productUrl,
          product_external_id: offer.product_external_id || null
        }
      }, "*");
    };

    window.addEventListener("message", onMessage);
    return () => {
      for (const timeout of timeouts.current.values()) window.clearTimeout(timeout);
      timeouts.current.clear();
      processando.current.clear();
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
