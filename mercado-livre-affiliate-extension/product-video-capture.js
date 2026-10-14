(() => {
  const HOSTS = /(^|\\.)?(shopee\\.com\\.br|mercadolivre\\.com\\.br)$/i;
  if (!HOSTS.test(location.hostname)) return;

  function canonicalVideo(raw) {
    if (typeof raw !== "string" || raw.length > 4096) return null;
    let url;
    try { url = new URL(raw, location.href); } catch { return null; }
    if (url.protocol !== "https:") return null;
    if (/\\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)(?:$|[?#])/i.test(url.pathname)) return null;
    return url.href;
  }

  function scanVideos() {
    const candidates = new Map();
    let playerDetected = false;
    let blobPlayerDetected = false;

    const add = (raw, method, forceVideoContext = false) => {
      if (typeof raw !== "string") return;
      if (/^blob:/i.test(raw)) {
        blobPlayerDetected = true;
        return;
      }
      const url = canonicalVideo(raw);
      if (!url) return;
      const looksVideo = forceVideoContext ||
        /\\.(mp4|m3u8|webm|mov|m4v|mpd)(?:$|[?#])/i.test(new URL(url).pathname) ||
        /video|vod|playback|media.*stream|stream.*media/i.test(url);
      if (!looksVideo) return;
      if (!candidates.has(url)) candidates.set(url, method);
    };

    document.querySelectorAll("video").forEach((video) => {
      playerDetected = true;
      add(video.currentSrc, "video_element");
      add(video.src, "video_element");
      video.querySelectorAll("source").forEach((source) => add(source.src, "video_source"));
    });

    // Os nomes abaixo são campos de mídia de vídeo conhecidos; não varremos
    // recursos de rede genéricos para evitar confundir imagens com vídeos.
    const videoKey = /^(video|videos|video_url|videoUrl|video_urls|videoUrls|video_play_url|videoPlayUrl|video_stream_url|videoStreamUrl|play_url|playUrl|playable_url|playableUrl|playback_url|playbackUrl|media_url|mediaUrl|download_url|downloadUrl|video_info|videoInfo|video_info_list|videoInfoList|video_list|videoList|video_model|videoModel|video_data|videoData|main_url|mainUrl|default_url|defaultUrl|backup_url|backupUrl|url_list|urlList)$/i;

    const walk = (node, depth = 0, inVideoContext = false) => {
      if (!node || depth > 12) return;
      if (Array.isArray(node)) {
        node.slice(0, 300).forEach((v) => {
          if (typeof v === "string" && inVideoContext) add(v, "structured_video_field", true);
          else walk(v, depth + 1, inVideoContext);
        });
        return;
      }
      if (typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        const videoContext = inVideoContext || videoKey.test(key);
        if (typeof value === "string") {
          if (videoKey.test(key) || inVideoContext) add(value, "structured_video_field", videoContext);
        } else if (value && typeof value === "object") {
          walk(value, depth + 1, videoContext);
        }
      }
    };

    document.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]').forEach((script) => {
      try { walk(JSON.parse(script.textContent || "")); } catch {}
    });

    // Alguns dados de anúncio são serializados em scripts sem type JSON.
    // Só tentamos analisar blocos que claramente mencionam campos de vídeo.
    document.querySelectorAll("script:not([src])").forEach((script) => {
      const raw = script.textContent || "";
      if (raw.length > 2_000_000 || !/(video_url|videoUrl|play_url|playUrl|video_info|videoInfo|playback_url)/i.test(raw)) return;
      const matches = raw.match(/https?:[^"'\\s<>]+/g) || [];
      for (const value of matches.slice(0, 100)) {
        const cleaned = value.replace(/\\\\u0026/g, "&").replace(/\\\\\\//g, "/").replace(/[),;]+$/g, "");
        add(cleaned, "structured_video_field");
      }
    });

    return {
      videos: [...candidates.entries()].slice(0, 12).map(([video_url, method]) => ({ video_url, method })),
      player_detected: playerDetected,
      blob_player_detected: blobPlayerDetected
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "ROBO_VIDEO_CAPTURE_SCAN") return;
    const waitMs = 2800;
    setTimeout(() => {
      const result = scanVideos();
      sendResponse({
        type: "ROBO_VIDEO_CAPTURE_RESULT",
        request_id: message.request_id,
        offer_id: String(message.offer_id || ""),
        videos: result.videos,
        player_detected: result.player_detected,
        blob_player_detected: result.blob_player_detected,
        page_url: location.href
      });
    }, waitMs);
    return true;
  });
})();