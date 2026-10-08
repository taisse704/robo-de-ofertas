import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SOURCE = "robo-de-ofertas";

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
  const enviados = useRef(new Set());
  const processando = useRef(new Set());

  useEffect(() => {
    let ativo = true;

    const anexarLink = async (payload) => {
      const offerId = String(payload?.offer_id || "").trim();
      const affiliateUrl = String(payload?.affiliate_url || "").trim();
      if (!offerId || !isMercadoLivreAffiliateUrl(affiliateUrl)) return;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

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
          enviados.current.delete(offerId);
          processando.current.delete(offerId);
          window.postMessage({
            source: SOURCE,
            type: "ML_AFFILIATE_SAVED",
            offer_id: offerId,
            affiliate_url: affiliateUrl
          }, "*");
        } else {
          processando.current.delete(offerId);
          console.warn("Mercado Livre: não foi possível salvar o link.", result);
        }
      } catch (error) {
        processando.current.delete(offerId);
        console.warn("Mercado Livre bridge:", error);
      }
    };

    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.source !== SOURCE) return;
      if (data.type === "ML_AFFILIATE_RESULT") anexarLink(data);
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
          const productUrl = String(offer.store_product_url || offer.url_produto || "").trim();
          if (!productUrl || enviados.current.has(offerId) || processando.current.has(offerId)) continue;

          enviados.current.add(offerId);
          processando.current.add(offerId);

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
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
