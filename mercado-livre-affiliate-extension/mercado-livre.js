if (globalThis.__ROBO_ML_AFFILIATE_INSTALLED__) {
  chrome.runtime.sendMessage({ type: "ML_AFFILIATE_READY" });
} else {
const SOURCE = "robo-de-ofertas";
const LINKS_ENDPOINT = "/affiliate-program/api/v2/stripe/user/links";
const TAGS_ENDPOINT = "/affiliate-program/api/v2/stripe/user/tags";
const TAG_CACHE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

async function requisicaoComTimeout(url, options = {}) {
  const controller = new AbortController();
  let timer;

  try {
    const operacao = (async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      return { response, text };
    })();

    const limite = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("O Mercado Livre demorou mais de 12 segundos para responder, incluindo a leitura da resposta. Verifique se a conta está conectada e tente novamente."));
      }, FETCH_TIMEOUT_MS);
    });

    return await Promise.race([operacao, limite]);
  } catch (error) {
    if (controller.signal.aborted && !String(error?.message || "").includes("12 segundos")) {
      throw new Error("A solicitação ao Mercado Livre foi interrompida após o limite de 12 segundos.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

let tagCache = "";
let tagCacheAt = 0;

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

function interpretarResposta(text) {
  let json = {};

  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  return { json, text };
}

async function obterTagAtiva() {
  const agora = Date.now();

  if (tagCache && agora - tagCacheAt < TAG_CACHE_MS) {
    return tagCache;
  }

  const tagRequest = await requisicaoComTimeout(TAGS_ENDPOINT, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*"
    },
    credentials: "include",
    cache: "no-store"
  });

  const tagResponse = tagRequest.response;
  const tagResult = interpretarResposta(tagRequest.text);
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

  tagCache = tag;
  tagCacheAt = agora;

  return tag;
}


chrome.runtime.sendMessage({
  type: "ML_AFFILIATE_READY"
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "ML_AFFILIATE_GENERATE_ON_TAB") {
    return;
  }

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
      // Não navegamos até o produto a cada oferta.
      // O endpoint oficial aceita a URL do produto diretamente,
      // então mantemos a mesma aba autenticada do Mercado Livre.
      const tag = await obterTagAtiva();

      const linkRequest = await requisicaoComTimeout(LINKS_ENDPOINT, {
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

      const linkResponse = linkRequest.response;
      const linkResult = interpretarResposta(linkRequest.text);
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

  globalThis.__ROBO_ML_AFFILIATE_INSTALLED__ = true;
}

// Listener de captura separado do inicializador de afiliados, para funcionar
// também quando o script já estava instalado na aba antes do pedido.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "ML_OFFERS_PAGE_CAPTURE_ON_TAB") return;
  try {
    const currentUrl = new URL(location.href);
    if (!/mercadolivre\.com\.br$/i.test(currentUrl.hostname) || !/^\/ofertas\/?$/i.test(currentUrl.pathname)) {
      chrome.runtime.sendMessage({ type: "ML_OFFERS_PAGE_CAPTURE_RESULT", ok: false, offers: [], source_url: location.href, error: "Abra exatamente https://www.mercadolivre.com.br/ofertas e tente novamente." });
      return;
    }
    const money = (text) => {
      const raw = String(text || "").replace(/[^0-9.,]/g, "").trim();
      if (!raw) return null;
      const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/\./g, "");
      const value = Number(normalized);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const nodes = Array.from(document.querySelectorAll("li.ui-search-layout__item, .poly-card, .ui-search-result, .andes-card"));
    const found = [], seen = new Set();
    for (const node of nodes) {
      const link = node.querySelector('a[href*="/MLB"], a[href*="/p/MLB"], a.poly-component__title, a.ui-search-link, a[href*="mercadolivre.com.br/"]');
      const href = String(link?.href || "").trim();
      if (!href) continue;
      let url; try { url = new URL(href, location.href); } catch { continue; }
      if (!/(^|\.)mercadolivre\.com\.br$/i.test(url.hostname)) continue;
      const productId = (url.href.match(/\bMLB\d{6,}\b/i) || [])[0];
      if (!productId || seen.has(productId)) continue;
      const titleNode = node.querySelector(".poly-component__title, .ui-search-item__title, h2, h3, a[aria-label]");
      const title = String(titleNode?.textContent || titleNode?.getAttribute("aria-label") || link?.textContent || "").replace(/\s+/g, " ").trim();
      if (!title || title.length < 5) continue;
      const currentNode = node.querySelector(".andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction, .poly-price__current .andes-money-amount__fraction, .ui-search-price__second-line .andes-money-amount__fraction");
      const current = money(currentNode?.textContent);
      if (!current) continue;
      const previousNode = node.querySelector(".andes-money-amount--previous .andes-money-amount__fraction, s .andes-money-amount__fraction, .andes-money-amount--previous");
      const original = money(previousNode?.textContent);
      const discount = original && original > current ? Math.round((original - current) / original * 100) : 0;
      const img = node.querySelector("img");
      const image = String(img?.currentSrc || img?.src || img?.getAttribute("data-src") || img?.getAttribute("data-lazy") || "").trim();
      const canonical = new URL(url.href); canonical.hash = ""; canonical.search = "";
      seen.add(productId);
      found.push({ external_id: productId, product_external_id: productId, title, current, original: original && original > current ? original : null, discount, image: /^https?:\/\//i.test(image) ? image.replace(/^http:\/\//i, "https://") : null, permalink: canonical.href, position: found.length + 1, source: "mercadolivre-ofertas-page" });
      if (found.length >= 100) break;
    }
    chrome.runtime.sendMessage({ type: "ML_OFFERS_PAGE_CAPTURE_RESULT", ok: found.length > 0, offers: found, source_url: location.href, error: found.length ? null : "Não consegui ler produtos nesta página. Confira se os cards carregaram e role a página um pouco para baixo." });
  } catch (error) {
    chrome.runtime.sendMessage({ type: "ML_OFFERS_PAGE_CAPTURE_RESULT", ok: false, offers: [], source_url: location.href, error: String(error?.message || error) });
  }
});

