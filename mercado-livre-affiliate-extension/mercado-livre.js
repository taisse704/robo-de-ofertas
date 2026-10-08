const SOURCE = "robo-de-ofertas";

chrome.runtime.sendMessage({ type: "ML_AFFILIATE_READY" });

chrome.runtime.onMessage.addListener(async (message) => {
  if (!message || message.type !== "ML_AFFILIATE_GENERATE_ON_TAB") return;

  const offer = message.offer || {};
  const productUrl = String(offer.product_url || "").trim();
  if (!productUrl) {
    chrome.runtime.sendMessage({
      type: "ML_AFFILIATE_RESULT",
      offer_id: offer.offer_id,
      error: "Oferta sem URL do produto."
    });
    return;
  }

  try {
    if (location.href.split("#")[0] !== productUrl.split("#")[0]) {
      location.href = productUrl;
      return;
    }

    const tagResponse = await fetch("/affiliate-program/api/v2/stripe/user/tags", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include"
    });

    const tagData = await tagResponse.json().catch(() => ({}));
    if (!tagResponse.ok) {
      throw new Error("Falha ao consultar etiqueta de afiliado (HTTP " + tagResponse.status + ").");
    }

    const tag = (tagData.tags || []).find((item) => item?.in_use)?.tag;
    if (!tag) throw new Error("Nenhuma etiqueta de afiliado ativa foi encontrada.");

    const linkResponse = await fetch("/affiliate-program/api/v2/stripe/user/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        url: productUrl,
        tag
      })
    });

    const linkData = await linkResponse.json().catch(() => ({}));
    if (!linkResponse.ok || !linkData?.short_url) {
      throw new Error(
        linkData?.message ||
        linkData?.error ||
        "Falha ao gerar link de afiliado (HTTP " + linkResponse.status + ")."
      );
    }

    chrome.runtime.sendMessage({
      type: "ML_AFFILIATE_RESULT",
      offer_id: offer.offer_id,
      affiliate_url: linkData.short_url,
      details: {
        id: linkData.id || null,
        tag: linkData.tag || tag,
        origin_url: linkData.origin_url || productUrl
      }
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: "ML_AFFILIATE_RESULT",
      offer_id: offer.offer_id,
      error: error?.message || "Erro desconhecido ao gerar link."
    });
  }
});
