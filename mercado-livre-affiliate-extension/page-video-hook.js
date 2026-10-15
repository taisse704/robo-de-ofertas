(() => {
  "use strict";
  const ALLOWED = /(^|\.)(shopee\.com\.br|mercadolivre\.com\.br|mercadolibre\.com|mlstatic\.com|susercontent\.com|shopee\.com)$/i;
  const VIDEO_KEY = /video|playback|play_url|playable|media_url|download_url|vod/i;
  const SENT = new Set();

  function safeUrl(value) {
    if (typeof value !== "string" || value.length > 8192) return null;
    const cleaned = value.trim().replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    try {
      const url = new URL(cleaned, location.href);
      if (url.protocol !== "https:") return null;
      if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)(?:$|[?#])/i.test(url.pathname)) return null;
      return url.href;
    } catch { return null; }
  }

  function report(value, key) {
    const url = safeUrl(value);
    if (!url || SENT.has(url)) return;
    const parsed = new URL(url);
    const likelyVideo = /\.(mp4|m4v|webm|mov|m3u8|mpd)(?:$|[?#])/i.test(parsed.href) ||
      /video|vod|playback|media-stream|stream-media/i.test(parsed.hostname + parsed.pathname) ||
      VIDEO_KEY.test(String(key || ""));
    if (!likelyVideo) return;
    SENT.add(url);
    if (SENT.size > 500) SENT.clear();
    window.postMessage({
      source: "ROBO_OFERTAS_PAGE_VIDEO_HOOK",
      type: "VIDEO_URL",
      url,
      key: String(key || "").slice(0, 100),
      platform: /shopee\.com\.br$/i.test(location.hostname) ? "shopee" : "mercado_livre"
    }, location.origin);
  }

  function walk(value, depth = 0, context = false, keyName = "", blocked = false) {
    if (depth > 12 || value == null || blocked) return;
    if (typeof value === "string") {
      if (context) report(value, keyName);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 300).forEach((item) => walk(item, depth + 1, context, keyName, blocked));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value).slice(0, 500)) {
      // Evita coletar URLs que pertençam a payloads de comentários, avaliações ou conteúdo UGC.
      const blockedBranch = blocked || /comment|review|feedback|rating|ugc|customer_review|buyer_review/i.test(key);
      if (blockedBranch) continue;
      const nextContext = context || VIDEO_KEY.test(key);
      if (typeof child === "string") {
        if (nextContext) report(child, key);
      } else if (child && typeof child === "object") {
        walk(child, depth + 1, nextContext, key, blockedBranch);
      }
    }
  }

  function inspectJson(text) {
    if (typeof text !== "string" || text.length > 2_000_000) return;
    const trimmed = text.trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) return;
    try { walk(JSON.parse(trimmed)); } catch {}
  }

  function allowedRequest(rawUrl) {
    try { return ALLOWED.test(new URL(rawUrl, location.href).hostname); } catch { return false; }
  }

  // Observe JSON responses without consuming or changing the response used by the site.
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function(...args) {
      const result = originalFetch.apply(this, args);
      try {
        const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
        if (allowedRequest(requestUrl)) {
          result.then((response) => {
            const type = response.headers?.get("content-type") || "";
            if (/json|javascript|text\/plain/i.test(type)) response.clone().text().then(inspectJson).catch(() => {});
          }).catch(() => {});
        }
      } catch {}
      return result;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function(method, url, ...rest) {
      this.__roboVideoUrl = String(url || "");
      return originalOpen.call(this, method, url, ...rest);
    };
    OriginalXHR.prototype.send = function(...args) {
      try {
        if (allowedRequest(this.__roboVideoUrl)) {
          this.addEventListener("load", () => {
            try {
              const type = this.getResponseHeader("content-type") || "";
              if (/json|javascript|text\/plain/i.test(type) || /^[\[{]/.test(String(this.responseText || "").trim())) {
                inspectJson(String(this.responseText || ""));
              }
            } catch {}
          }, { once: true });
        }
      } catch {}
      return originalSend.apply(this, args);
    };
  }

  // Catch structured data already embedded in the page at injection time.
  const scanEmbedded = () => {
    document.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]').forEach((script) => inspectJson(script.textContent || ""));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scanEmbedded, { once: true });
  else scanEmbedded();
})();