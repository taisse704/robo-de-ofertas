const SOURCE = "robo-de-ofertas";

function contextoValido() {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

function enviarParaBackground(message) {
  if (!contextoValido()) return false;

  try {
    chrome.runtime.sendMessage(message).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const data = event.data;

  if (
    !data ||
    data.source !== SOURCE ||
    !["ML_AFFILIATE_GENERATE", "ROBO_VIDEO_CAPTURE_REQUEST", "ROBO_VIDEO_CAPTURE_CANCEL"].includes(data.type) ||
    (data.type === "ML_AFFILIATE_GENERATE" && !data.offer) ||
    (data.type === "ROBO_VIDEO_CAPTURE_REQUEST" && !Array.isArray(data.offers))
  ) {
    return;
  }

  enviarParaBackground({
    type: data.type,
    offer: data.offer,
    offers: data.offers
  });
});

if (contextoValido()) {
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || !["ML_AFFILIATE_RESULT", "ROBO_VIDEO_CAPTURE_RESULT", "ROBO_VIDEO_CAPTURE_STARTED"].includes(message.type)) return;

      window.postMessage(
        {
          source: SOURCE,
          type: message.type,
          offer_id: message.offer_id || null,
          affiliate_url: message.affiliate_url || null,
          error: message.error || null,
          ok: message.ok !== false,
          results: message.results || []
        },
        "*"
      );
    });
  } catch {
    // O contexto pode ter sido invalidado durante um reload da extensão.
  }
}
