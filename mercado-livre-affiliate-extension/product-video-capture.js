(() => {
  const HOSTS = /(^|\.)?(shopee\.com\.br|mercadolivre\.com\.br)$/i;
  if (!HOSTS.test(location.hostname)) return;

  const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)(?:$|[?#])/i;
  const VIDEO_EXT = /\.(mp4|m4v|webm|mov|m3u8|mpd)(?:$|[?#])/i;
  const VIDEO_KEYS = /^(video|videos|video_url|videoUrl|video_urls|videoUrls|video_play_url|videoPlayUrl|video_stream_url|videoStreamUrl|play_url|playUrl|playable_url|playableUrl|playback_url|playbackUrl|media_url|mediaUrl|download_url|downloadUrl|video_info|videoInfo|video_info_list|videoInfoList|video_list|videoList|video_model|videoModel|video_data|videoData|main_url|mainUrl|default_url|defaultUrl|backup_url|backupUrl|url_list|urlList|video_id|videoId)$/i;

  function canonicalVideo(raw) {
    if (typeof raw !== "string" || raw.length > 8192) return null;
    const value = raw.trim().replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    let url;
    try { url = new URL(value, location.href); } catch { return null; }
    if (url.protocol !== "https:" || IMAGE_EXT.test(url.pathname)) return null;
    return url.href;
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
      if (!url) return;
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
      playerDetected = true;
      add(video.currentSrc, "video_element", true);
      add(video.src, "video_element", true);
      video.querySelectorAll("source").forEach((source) => add(source.src, "video_source", true));
    });

    const walk = (node, depth = 0, inVideoContext = false) => {
      if (!node || depth > 14) return;
      if (Array.isArray(node)) {
        node.slice(0, 500).forEach((value) => {
          if (typeof value === "string" && inVideoContext) add(value, "structured_video_field", true);
          else walk(value, depth + 1, inVideoContext);
        });
        return;
      }
      if (typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        const context = inVideoContext || VIDEO_KEYS.test(key) || /video|playback/i.test(key);
        if (typeof value === "string") {
          if (VIDEO_KEYS.test(key) || inVideoContext || /video|playback/i.test(key)) {
            add(value, "structured_video_field", context);
          }
        } else if (value && typeof value === "object") {
          walk(value, depth + 1, context);
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
      const matches = raw.match(/https?:[^"'\s<>]+/g) || [];
      for (const value of matches.slice(0, 250)) {
        const cleaned = value.replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/[),;]+$/g, "");
        add(cleaned, "inline_video_data", false);
      }
    });

    // Recurso de rede somente quando o próprio endereço identifica claramente vídeo.
    try {
      performance.getEntriesByType("resource").slice(-1500).forEach((entry) => {
        if (VIDEO_EXT.test(entry.name) || /video|vod|playback/i.test(entry.name)) {
          add(entry.name, "video_resource", false);
        }
      });
    } catch {}

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