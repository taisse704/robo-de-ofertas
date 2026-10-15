(() => {
  const HOSTS = /(^|\.)?(shopee\.com\.br|mercadolivre\.com\.br)$/i;
  if (!HOSTS.test(location.hostname)) return;

  const discoveredPageUrls = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "ROBO_OFERTAS_PAGE_VIDEO_HOOK" || data.type !== "VIDEO_URL") return;
    if (typeof data.url !== "string" || !data.url.startsWith("https://")) return;
    discoveredPageUrls.set(data.url, { url: data.url, key: String(data.key || "") });
    if (discoveredPageUrls.size > 500) discoveredPageUrls.delete(discoveredPageUrls.keys().next().value);
  });

  const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)(?:$|[?#])/i;
  const VIDEO_EXT = /\.(mp4|m4v|webm|mov|m3u8|mpd)(?:$|[?#])/i;
  const VIDEO_KEYS = /^(video|videos|video_url|videoUrl|video_urls|videoUrls|video_play_url|videoPlayUrl|video_stream_url|videoStreamUrl|play_url|playUrl|playable_url|playableUrl|playback_url|playbackUrl|media_url|mediaUrl|download_url|downloadUrl|video_info|videoInfo|video_info_list|videoInfoList|video_list|videoList|video_model|videoModel|video_data|videoData)$/i;

  function canonicalVideo(raw) {
    if (typeof raw !== "string" || raw.length > 8192) return null;
    const value = raw.trim().replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    let url;
    try { url = new URL(value, location.href); } catch { return null; }
    if (url.protocol !== "https:" || IMAGE_EXT.test(url.pathname)) return null;
    return url.href;
  }

  function isCommentOrReviewVideo(video) {
    const excluded = [
      '[class*="comment" i]', '[id*="comment" i]', '[data-testid*="comment" i]',
      '[class*="review" i]', '[id*="review" i]', '[data-testid*="review" i]',
      '[class*="feedback" i]', '[class*="rating" i]', '[class*="ugc" i]',
      '[class*="buyer" i]', '[class*="customer" i]'
    ].join(",");
    try { return !!video.closest(excluded); } catch { return true; }
  }

  // O player precisa pertencer à galeria/mídia principal do produto.
  function isProductGalleryVideo(video) {
    const gallerySelectors = [
      '[data-testid*="gallery" i]', '[class*="gallery" i]', '[id*="gallery" i]',
      '[class*="media-gallery" i]', '[class*="product-media" i]',
      '[class*="ui-pdp-gallery" i]', '[class*="product-detail" i]',
      '[class*="product-briefing" i]', '[class*="image-list" i]'
    ].join(",");
    try {
      if (isCommentOrReviewVideo(video)) return false;
      return !!video.closest(gallerySelectors);
    } catch { return false; }
  }

  function isPreviewOrThumbnail(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return /\/(preview|thumbnail|thumb|poster|sprite|cover)(?:\/|$)/i.test(url.pathname);
    } catch { return true; }
  }

  function scanVideos() {
    const candidates = new Map();
    let playerDetected = false;
    let blobPlayerDetected = false;

    const add = (raw, method, forceVideoContext = false) => {
      if (typeof raw !== "string") return;
      const value = raw.trim();
      if (/^blob:/i.test(value)) {
        blobPlayerDetected = true;
        return;
      }
      const url = canonicalVideo(value);
      if (!url || isPreviewOrThumbnail(url)) return;
      const parsed = new URL(url);
      const looksVideo = forceVideoContext ||
        VIDEO_EXT.test(parsed.pathname) ||
        /(^|[._/-])(video|videos|vod|playback|media-stream|stream-media)([._/?-]|$)/i.test(parsed.hostname + parsed.pathname);
      if (!looksVideo) return;
      const type = /\.m3u8(?:$|[?#])|\.mpd(?:$|[?#])/i.test(parsed.href) ? "stream" :
        /\.(mp4|m4v|webm|mov)(?:$|[?#])/i.test(parsed.href) ? "file" : "unknown";
      const previous = candidates.get(url);
      if (!previous || (previous.type !== "file" && type === "file")) {
        candidates.set(url, { video_url: url, method, media_type: type });
      }
    };

    document.querySelectorAll("video").forEach((video) => {
      // Aceita apenas o player da galeria principal do produto.
      if (!isProductGalleryVideo(video)) return;
      playerDetected = true;
      add(video.currentSrc, "video_element", true);
      add(video.src, "video_element", true);
      video.querySelectorAll("source").forEach((source) => add(source.src, "video_source", true));
    });

    const BLOCKED_KEYS = /comment|review|feedback|rating|ugc|customer_review|buyer_review|user_content|buyer_video/i;
    const BLOCKED_INLINE_CONTEXT = /\b(comments?|reviews?|feedback|ugc|customer_review|buyer_review|user_content|buyer_video)\b\s*:/i;

    const walk = (node, depth = 0, inVideoContext = false, blocked = false) => {
      if (!node || depth > 14 || blocked) return;
      if (Array.isArray(node)) {
        node.slice(0, 500).forEach((value) => {
          if (typeof value === "string" && inVideoContext) add(value, "structured_video_field", true);
          else walk(value, depth + 1, inVideoContext, false);
        });
        return;
      }
      if (typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        // Exclui ramos inteiros de comentários/avaliações, não apenas elementos <video>.
        if (BLOCKED_KEYS.test(key)) continue;
        const context = inVideoContext || VIDEO_KEYS.test(key) || /video|playback/i.test(key);
        if (typeof value === "string") {
          if (VIDEO_KEYS.test(key) || inVideoContext) add(value, "structured_video_field", context);
        } else if (value && typeof value === "object") {
          walk(value, depth + 1, context, false);
        }
      }
    };

    document.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]').forEach((script) => {
      try { walk(JSON.parse(script.textContent || "")); } catch {}
    });

    // Os dados de produto às vezes estão em scripts inline que não são JSON puro.
    document.querySelectorAll("script:not([src])").forEach((script) => {
      const raw = script.textContent || "";
      if (raw.length > 2_000_000 || !/(video|playback|play_url|video_info)/i.test(raw)) return;
      const matches = [...raw.matchAll(/https?:[^"'\s<>]+/g)];
      for (const match of matches.slice(0, 250)) {
        const value = match[0];
        // Scripts inline podem conter mídia de avaliações. Ignora URLs cujo contexto
        // próximo identifica comentários, reviews, UGC ou vídeos enviados por compradores.
        const around = raw.slice(Math.max(0, match.index - 900), Math.min(raw.length, match.index + value.length + 900));
        if (BLOCKED_INLINE_CONTEXT.test(around)) continue;
        const cleaned = value.replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/[),;]+$/g, "");
        add(cleaned, "inline_video_data", false);
      }
    });

    // Não varre recursos de rede globalmente: isso pode capturar vídeos de avaliações,
    // recomendações ou outros módulos sem vínculo confirmado com a galeria do produto.

    for (const item of discoveredPageUrls.values()) {
      add(item.url, "page_json_response:" + item.key, true);
    }

    const videos = [...candidates.values()].sort((a, b) =>
      (a.media_type === "file" ? 0 : a.media_type === "unknown" ? 1 : 2) -
      (b.media_type === "file" ? 0 : b.media_type === "unknown" ? 1 : 2)
    ).slice(0, 20);

    return { videos, player_detected: playerDetected, blob_player_detected: blobPlayerDetected };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "ROBO_VIDEO_CAPTURE_SCAN") return;
    setTimeout(() => {
      const result = scanVideos();
      sendResponse({
        type: "ROBO_VIDEO_CAPTURE_RESULT",
        request_id: message.request_id,
        offer_id: String(message.offer_id || ""),
        videos: result.videos,
        player_detected: result.player_detected,
        blob_player_detected: result.blob_player_detected,
        page_url: location.href,
        platform: /shopee\.com\.br$/i.test(location.hostname) ? "shopee" : "mercado_livre"
      });
    }, 1800);
    return true;
  });
})();