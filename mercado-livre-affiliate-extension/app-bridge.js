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
    data.type !== "ML_AFFILIATE_GENERATE" ||
    !data.offer
  ) {
    return;
  }

  enviarParaBackground({
    type: "ML_AFFILIATE_GENERATE",
    offer: data.offer
  });
});

if (contextoValido()) {
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== "ML_AFFILIATE_RESULT") return;

      window.postMessage(
        {
          source: SOURCE,
          type: "ML_AFFILIATE_RESULT",
          offer_id: message.offer_id || null,
          affiliate_url: message.affiliate_url || null,
          error: message.error || null,
          ok: message.ok !== false
        },
        "*"
      );
    });
  } catch {
    // O contexto pode ter sido invalidado durante um reload da extensão.
  }
}
