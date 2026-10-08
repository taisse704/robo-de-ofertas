const SOURCE = "robo-de-ofertas";
const LINKS_ENDPOINT = "/affiliate-program/api/v2/stripe/user/links";
const TAGS_ENDPOINT = "/affiliate-program/api/v2/stripe/user/tags";

function enviarResultado(offerId, data = {}) {
  chrome.runtime.sendMessage({
    type: "ML_AFFILIATE_RESULT",
    offer_id: offerId || null,
    ...data
  });
}

function normalizarUrlProduto(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

async function lerResposta(response) {
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { json, text };
}

chrome.runtime.sendMessage({ type: "ML_AFFILIATE_READY" });

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "ML_AFFILIATE_GENERATE_ON_TAB") return;

  (async () => {
    const offer = message.offer || {};
    const offerId = String(offer.offer_id || "").trim();
    const productUrl = normalizarUrlProduto(offer.product_url);

    if (!offerId || !productUrl) {
      enviarResultado(offerId, {
        ok: false,
        error: "Oferta sem ID ou URL do produto."
      });
      return;
    }

    try {
      if (location.href.split("#")[0] !== productUrl.split("#")[0]) {
        location.href = productUrl;
        return;
      }

      const tagResponse = await fetch(TAGS_ENDPOINT, {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*"
        },
        credentials: "include",
        cache: "no-store"
      });

      const tagResult = await lerResposta(tagResponse);
      const tagData = tagResult.json;

      if (!tagResponse.ok) {
        throw new Error(
          "Mercado Livre recusou a consulta das etiquetas: HTTP " +
          tagResponse.status +
          (tagData?.message ? " - " + tagData.message : "")
        );
      }

      const tags = Array.isArray(tagData)
        ? tagData
        : Array.isArray(tagData?.tags)
          ? tagData.tags
          : Array.isArray(tagData?.data)
            ? tagData.data
            : [];

      const active =
        tags.find((item) => item?.in_use === true) ||
        tags.find((item) => item?.inUse === true) ||
        tags.find((item) =>
          String(item?.status || "").toLowerCase() === "active"
        ) ||
        null;

      const tag = String(
        active?.tag ||
        active?.id ||
        active?.name ||
        ""
      ).trim();

      if (!tag) {
        throw new Error(
          "O Mercado Livre não informou uma etiqueta de afiliado ativa. " +
          "Quantidade de etiquetas retornadas: " + tags.length + "."
        );
      }

      const linkResponse = await fetch(LINKS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*"
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          url: productUrl,
          tag
        })
      });

      const linkResult = await lerResposta(linkResponse);
      const linkData = linkResult.json;

      if (!linkResponse.ok) {
        const detail =
          linkData?.message ||
          linkData?.error ||
          linkData?.errors?.[0]?.message ||
          "";

        throw new Error(
          "Mercado Livre recusou a geração do link: HTTP " +
          linkResponse.status +
          (detail ? " - " + detail : "")
        );
      }

      const affiliateUrl = String(
        linkData?.short_url ||
        linkData?.shortUrl ||
        linkData?.affiliate_url ||
        linkData?.affiliateUrl ||
        ""
      ).trim();

      if (!affiliateUrl) {
        throw new Error(
          "O Mercado Livre respondeu HTTP 200, mas não retornou short_url. " +
          "Resposta: " + linkResult.text.slice(0, 500)
        );
      }

      let hostname = "";
      try {
        hostname = new URL(affiliateUrl).hostname.toLowerCase();
      } catch {}

      const oficial =
        hostname === "meli.la" ||
        hostname === "mercadolivre.com.br" ||
        hostname.endsWith(".mercadolivre.com.br") ||
        hostname === "mercadolivre.com" ||
        hostname.endsWith(".mercadolivre.com");

      if (!oficial) {
        throw new Error(
          "O Mercado Livre retornou um link que não foi reconhecido como oficial: " +
          affiliateUrl
        );
      }

      enviarResultado(offerId, {
        ok: true,
        affiliate_url: affiliateUrl,
        details: {
          id: linkData?.id || null,
          tag: linkData?.tag || tag,
          origin_url: linkData?.origin_url || productUrl
        }
      });
    } catch (error) {
      enviarResultado(offerId, {
        ok: false,
        error: String(error?.message || error)
      });
    }
  })();
});
