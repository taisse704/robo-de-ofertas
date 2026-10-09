import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

const SOURCE = "robo-de-ofertas";
const RETRY_AFTER_MS = 20000;


export default function MercadoLivreAffiliateBridge() {
  const processando = useRef(new Set());
  const timeouts = useRef(new Map());

  useEffect(() => {
    let ativo = true;

    const programarRetry = (offerId) => {
      const id = String(offerId || "").trim();
      if (!id) return;
      const anterior = timeouts.current.get(id);
      if (anterior) window.clearTimeout(anterior);

      const timer = window.setTimeout(() => {
        timeouts.current.delete(id);
        processando.current.delete(id);
      }, RETRY_AFTER_MS);

      timeouts.current.set(id, timer);
    };

    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.source !== SOURCE) return;

      if (data.type === "ML_AFFILIATE_REQUEST") {
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
      }
    };

    window.addEventListener("message", onMessage);

    const enviarPendentes = async () => {
      if (!ativo) return;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session?.user?.id) return;

        const { data, error } = await supabase
          .from("offers")
          .select("id,titulo,store_product_url,url_produto,product_external_id")
          .eq("user_id", sessionData.session.user.id)
          .eq("store_provider", "mercadolivre")
          .is("affiliate_url", null)
          .not("store_product_url", "is", null)
          .order("created_at", { ascending: true })
          .limit(20);

        if (error) {
          console.warn("Mercado Livre bridge - ofertas pendentes:", error);
          return;
        }

        for (const offer of data || []) {
          const offerId = String(offer.id);
          const productUrl = String(
            offer.store_product_url || offer.url_produto || ""
          ).trim();

          if (
            !productUrl ||
            processando.current.has(offerId)
          ) {
            continue;
          }

          processando.current.add(offerId);
          programarRetry(offerId);

          window.postMessage({
            source: SOURCE,
            type: "ML_AFFILIATE_GENERATE",
            offer: {
              offer_id: offerId,
              title: offer.titulo || "Produto Mercado Livre",
              product_url: productUrl,
              product_external_id: offer.product_external_id || null
            }
          }, "*");
        }
      } catch (error) {
        console.warn("Mercado Livre bridge - fila:", error);
      }
    };

    enviarPendentes();
    const timer = window.setInterval(enviarPendentes, 15000);

    return () => {
      ativo = false;
      window.clearInterval(timer);
      for (const timeout of timeouts.current.values()) {
        window.clearTimeout(timeout);
      }
      timeouts.current.clear();
      processando.current.clear();
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
