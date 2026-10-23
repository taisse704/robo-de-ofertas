(() => {
const SOURCE = "robo-de-ofertas";
const BRIDGE_STATE_KEY = "__ROBO_OFERTAS_APP_BRIDGE_V2__";

function contextoValido() {
  try { return !!chrome?.runtime?.id; } catch { return false; }
}

function notificarFalha(message, error) {
  const detail = String(error?.message || error || "Falha desconhecida na comunicação com a extensão.");
  const type = message?.type;
  if (type === "ML_OFFERS_PAGE_CAPTURE_REQUEST") {
    window.postMessage({ source: SOURCE, type: "ML_OFFERS_PAGE_CAPTURE_RESULT", ok: false, offers: [], error: "A extensão não conseguiu comunicar com o serviço de segundo plano. A reconexão automática está tentando recuperar a comunicação. Detalhe: " + detail }, "*");
  } else if (type === "ML_AFFILIATE_GENERATE") {
    window.postMessage({ source: SOURCE, type: "ML_AFFILIATE_RESULT", ok: false, offer_id: String(message?.offer?.offer_id || "") || null, error: "A extensão não conseguiu iniciar a geração do link. A reconexão automática está tentando recuperar a comunicação. Detalhe: " + detail }, "*");
  } else if (type === "ROBO_VIDEO_CAPTURE_REQUEST") {
    window.postMessage({ source: SOURCE, type: "ROBO_VIDEO_CAPTURE_RESULT", ok: false, results: [], error: "A extensão não conseguiu iniciar a captura de vídeos. A reconexão automática está tentando recuperar a comunicação. Detalhe: " + detail }, "*");
  }
}

function enviarParaBackground(message) {
  if (!contextoValido()) {
    notificarFalha(message, "O contexto da extensão está indisponível ou foi atualizado.");
    return;
  }
  try {
    chrome.runtime.sendMessage(message).catch((error) => notificarFalha(message, error));
  } catch (error) {
    notificarFalha(message, error);
  }
}

// O background pode reinjetar este arquivo sem recarregar a página.
// Remova os listeners anteriores antes de registrar os novos, evitando duplicações.
try {
  const anterior = window[BRIDGE_STATE_KEY];
  if (anterior?.onWindowMessage) window.removeEventListener("message", anterior.onWindowMessage);
  if (anterior?.onRuntimeMessage && contextoValido()) {
    try { chrome.runtime.onMessage.removeListener(anterior.onRuntimeMessage); } catch {}
  }
} catch {}

const onWindowMessage = (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== SOURCE ||
      !["ML_AFFILIATE_GENERATE", "ROBO_VIDEO_CAPTURE_REQUEST", "ROBO_VIDEO_CAPTURE_CANCEL", "ML_OFFERS_PAGE_CAPTURE_REQUEST"].includes(data.type) ||
      (data.type === "ML_AFFILIATE_GENERATE" && !data.offer) ||
      (data.type === "ROBO_VIDEO_CAPTURE_REQUEST" && !Array.isArray(data.offers))) return;
  enviarParaBackground({ type: data.type, offer: data.offer, offers: data.offers });
};

const onRuntimeMessage = (message) => {
  if (!message || !["ML_AFFILIATE_RESULT", "ROBO_VIDEO_CAPTURE_RESULT", "ROBO_VIDEO_CAPTURE_STARTED", "ML_OFFERS_PAGE_CAPTURE_RESULT"].includes(message.type)) return;
  window.postMessage({
    source: SOURCE, type: message.type, offer_id: message.offer_id || null,
    affiliate_url: message.affiliate_url || null, error: message.error || null,
    ok: message.ok !== false, results: message.results || [], offers: message.offers || [],
    source_url: message.source_url || null
  }, "*");
};

window.addEventListener("message", onWindowMessage);
if (contextoValido()) {
  try { chrome.runtime.onMessage.addListener(onRuntimeMessage); } catch {}
}
try {
  window[BRIDGE_STATE_KEY] = { onWindowMessage, onRuntimeMessage, runtimeId: chrome?.runtime?.id || null, connectedAt: Date.now() };
} catch {}

})();
