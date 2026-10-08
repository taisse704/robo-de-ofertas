import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SOURCE = "robo-de-ofertas";
const RETRY_AFTER_MS = 20000;

function isMercadoLivreAffiliateUrl(value) {
  try {
    const u = new URL(String(value || ""));
    const h = u.hostname.toLowerCase();
    return u.protocol === "https:" && (
      h === "meli.la" ||
      h === "mercadolivre.com.br" ||
      h.endsWith(".mercadolivre.com.br") ||
      h === "mercadolivre.com" ||
      h.endsWith(".mercadolivre.com")
    );
  } catch {
    return false;
  }
}

export default function MercadoLivreAffiliateBridge() {
  const processando = useRef(new Set());
  const timeouts = useRef(new Map());

  useEffect(() => {
    let ativo = true;

    const liberarOferta = (offerId) => {
      const id = String(offerId || "").trim();
      if (!id) return;
      const timer = timeouts.current.get(id);
      if (timer) window.clearTimeout(timer);
      timeouts.current.delete(id);
      processando.current.delete(id);
    };

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

    const anexarLink = async (payload) => {
      const offerId = String(payload?.offer_id || "").trim();
      const affiliateUrl = String(payload?.affiliate_url || "").trim();

      if (!offerId) return;

      if (!isMercadoLivreAffiliateUrl(affiliateUrl)) {
        console.warn(
          "Mercado Livre: a extensão respondeu sem um link de afiliado válido.",
          payload?.error || "Resposta sem affiliate_url."
        );
        liberarOferta(offerId);
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        if (!token) {
          liberarOferta(offerId);
          return;
        }

        const response = await fetch(SUPABASE_URL + "/functions/v1/affiliate-link", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            offer_id: offerId,
            affiliate_url: affiliateUrl
          })
        });

        const result = await response.json().catch(() => ({}));

        if (response.ok && result?.ok) {
          liberarOferta(offerId);

          // Só gera o conteúdo depois que o link oficial foi salvo.
          try {
            const contentResponse = await fetch(SUPABASE_URL + "/functions/v1/generate-content", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
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
            }
          } catch (error) {
            console.warn("Mercado Livre: erro ao gerar conteúdo após salvar o link.", error);
          }

          window.postMessage({
            source: SOURCE,
            type: "ML_AFFILIATE_SAVED",
            offer_id: offerId,
            affiliate_url: affiliateUrl
          }, "*");
          return;
        }

        console.warn(
          "Mercado Livre: não foi possível salvar o link.",
          result
        );
        liberarOferta(offerId);
        programarRetry(offerId);
      } catch (error) {
        console.warn("Mercado Livre bridge:", error);
        liberarOferta(offerId);
        programarRetry(offerId);
      }
    };

    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.source !== SOURCE) return;

      if (data.type === "ML_AFFILIATE_RESULT") {
        anexarLink(data);
        return;
      }

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
