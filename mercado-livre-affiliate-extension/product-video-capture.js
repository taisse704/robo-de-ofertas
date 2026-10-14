(() => {
  const HOSTS = /(^|\.)?(shopee\.com\.br|mercadolivre\.com\.br)$/i;
  const isProductSite = HOSTS.test(location.hostname);
  if (!isProductSite) return;

  function canonicalVideo(raw) {
    if (typeof raw !== "string" || raw.length > 4096) return null;
    let url;
    try { url = new URL(raw, location.href); } catch { return null; }
    if (url.protocol !== "https:") return null;
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)(?:$|[?#])/i.test(url.pathname)) return null;
    if (/^(data:|blob:)/i.test(raw)) return null;
    return url.href;
  }

  function scanVideos() {
    const candidates = new Map();
    const add = (raw, method) => {
      const url = canonicalVideo(raw);
      if (!url) return;
      const path = new URL(url).pathname;
      const looksVideo = ["video_element", "video_source"].includes(method) || /\.(mp4|m3u8|webm|mov|m4v|mpd)(?:$|[?#])/i.test(url) ||
        /video|vod|playback|media.*stream/i.test(url);
      if (!looksVideo) return;
      if (!candidates.has(url)) candidates.set(url, method);
    };

    document.querySelectorAll("video").forEach((video) => {
      add(video.currentSrc, "video_element");
      add(video.src, "video_element");
      video.querySelectorAll("source").forEach((source) => add(source.src, "video_source"));
    });

    // Examina apenas campos de vídeo explicitamente nomeados nos dados estruturados.
    const walk = (node, depth = 0) => {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) { node.slice(0, 200).forEach((v) => walk(v, depth + 1)); return; }
      if (typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (/^(video|video_url|videoUrl|play_url|playUrl|playable_url|media_url|mediaUrl|download_url)$/i.test(key)) {
          if (typeof value === "string") add(value, "structured_video_field");
          else if (value && typeof value === "object") {
            add(value.url, "structured_video_field");
            add(value.play_url, "structured_video_field");
            add(value.video_url, "structured_video_field");
          }
        } else if (value && typeof value === "object") walk(value, depth + 1);
      }
    };
    document.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]').forEach((script) => {
      try { walk(JSON.parse(script.textContent || "")); } catch {}
    });

    // Recursos de rede só são aceitos quando a URL parece ser mídia de vídeo.
    try {
      performance.getEntriesByType("resource").forEach((entry) => add(entry.name, "video_resource"));
    } catch {}

    return [...candidates.entries()].slice(0, 8).map(([video_url, method]) => ({ video_url, method }));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "ROBO_VIDEO_CAPTURE_SCAN") return;
    const waitMs = 1800;
    setTimeout(() => {
      sendResponse({
        type: "ROBO_VIDEO_CAPTURE_RESULT",
        request_id: message.request_id,
        offer_id: String(message.offer_id || ""),
        videos: scanVideos(),
        page_url: location.href
      });
    }, waitMs);
    return true;
  });
})();