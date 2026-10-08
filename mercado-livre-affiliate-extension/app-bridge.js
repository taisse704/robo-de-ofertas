const SOURCE = "robo-de-ofertas";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== SOURCE || data.type !== "ML_AFFILIATE_GENERATE") return;

  chrome.runtime.sendMessage({
    type: "ML_AFFILIATE_GENERATE",
    offer: data.offer
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "ML_AFFILIATE_RESULT") return;
  window.postMessage({
    source: SOURCE,
    type: "ML_AFFILIATE_RESULT",
    offer_id: message.offer_id,
    affiliate_url: message.affiliate_url,
    error: message.error || null
  }, "*");
});
