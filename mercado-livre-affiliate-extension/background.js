const APP_MATCH = "https://taisse704.github.io/robo-de-ofertas/";
let mlTabId = null;
let fila = [];
let processando = false;
let aguardandoNavegacao = null;

function enviarResultadoParaApp(message) {
  chrome.tabs.query({ url: ["https://taisse704.github.io/robo-de-ofertas/*"] }).then((tabs) => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  });
}

async function encontrarOuCriarAbaMercadoLivre() {
  if (mlTabId !== null) {
    try {
      const tab = await chrome.tabs.get(mlTabId);
      if (tab?.id) return tab.id;
    } catch {}
    mlTabId = null;
  }

  const tabs = await chrome.tabs.query({
    url: ["https://www.mercadolivre.com.br/*", "https://mercadolivre.com.br/*"]
  });
  if (tabs.length) {
    mlTabId = tabs[0].id;
    return mlTabId;
  }

  const tab = await chrome.tabs.create({
    url: "https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true",
    active: false
  });
  mlTabId = tab.id;
  return tab.id;
}

async function enviarItemAtual() {
  if (processando || !fila.length) return;
  processando = true;
  const item = fila[0];

  try {
    const tabId = await encontrarOuCriarAbaMercadoLivre();
    const tab = await chrome.tabs.get(tabId);
    const destino = String(item.offer?.product_url || "").trim();

    if (destino && String(tab.url || "").split("#")[0] !== destino.split("#")[0]) {
      aguardandoNavegacao = item;
      await chrome.tabs.update(tabId, { url: destino, active: false });
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: "ML_AFFILIATE_GENERATE_ON_TAB",
      offer: item.offer
    });
  } catch (error) {
    fila.shift();
    processando = false;
    enviarResultadoParaApp({
      type: "ML_AFFILIATE_RESULT",
      offer_id: item.offer?.offer_id,
      error: error?.message || "Não foi possível usar a aba do Mercado Livre."
    });
    setTimeout(enviarItemAtual, 250);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message) return;

  if (sender.tab?.url?.startsWith(APP_MATCH) && message.type === "ML_AFFILIATE_GENERATE") {
    if (message.offer?.offer_id && !fila.some((x) => x.offer?.offer_id === message.offer.offer_id)) {
      fila.push(message);
      enviarItemAtual();
    }
    return;
  }

  if (message.type === "ML_AFFILIATE_READY") {
    if (sender.tab?.id) {
      mlTabId = sender.tab.id;
      if (aguardandoNavegacao) {
        aguardandoNavegacao = null;
      }
      enviarItemAtual();
    }
    return;
  }

  if (message.type === "ML_AFFILIATE_RESULT") {
    fila.shift();
    processando = false;
    aguardandoNavegacao = null;
    enviarResultadoParaApp(message);
    setTimeout(enviarItemAtual, 250);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== mlTabId || changeInfo.status !== "complete") return;
  if (fila.length) setTimeout(enviarItemAtual, 350);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === mlTabId) {
    mlTabId = null;
    processando = false;
    setTimeout(enviarItemAtual, 500);
  }
});
