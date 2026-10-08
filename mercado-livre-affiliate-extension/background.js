const APP_MATCH = "https://taisse704.github.io/robo-de-ofertas/";
let mlTabId = null;
let fila = [];
let processando = false;
let aguardandoNavegacao = false;

function enviarResultadoParaApp(message) {
  chrome.tabs.query({
    url: ["https://taisse704.github.io/robo-de-ofertas/*"]
  }).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }).catch(() => {});
}

async function encontrarOuCriarAbaMercadoLivre() {
  if (mlTabId !== null) {
    try {
      const tab = await chrome.tabs.get(mlTabId);
      if (tab?.id) return tab.id;
    } catch {
      mlTabId = null;
    }
  }

  const tabs = await chrome.tabs.query({
    url: [
      "https://www.mercadolivre.com.br/*",
      "https://mercadolivre.com.br/*"
    ]
  });

  if (tabs.length && tabs[0]?.id) {
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

  const item = fila[0];
  const destino = String(item.offer?.product_url || "").trim();

  if (!item.offer?.offer_id || !destino) {
    fila.shift();
    enviarResultadoParaApp({
      type: "ML_AFFILIATE_RESULT",
      offer_id: item.offer?.offer_id || null,
      error: "Oferta sem ID ou URL do produto."
    });
    setTimeout(enviarItemAtual, 100);
    return;
  }

  processando = true;

  try {
    const tabId = await encontrarOuCriarAbaMercadoLivre();
    const tab = await chrome.tabs.get(tabId);
    const atual = String(tab.url || "").split("#")[0];
    const alvo = destino.split("#")[0];

    if (atual !== alvo) {
      aguardandoNavegacao = true;
      await chrome.tabs.update(tabId, {
        url: destino,
        active: false
      });
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: "ML_AFFILIATE_GENERATE_ON_TAB",
      offer: item.offer
    });
  } catch (error) {
    processando = false;

    // A página pode ainda estar recriando o content script.
    // Mantém a oferta na fila e tenta novamente.
    setTimeout(() => {
      enviarItemAtual().catch(() => {});
    }, 1000);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message) return;

  if (
    sender.tab?.url?.startsWith(APP_MATCH) &&
    message.type === "ML_AFFILIATE_GENERATE"
  ) {
    const offerId = message.offer?.offer_id;

    if (
      offerId &&
      !fila.some((item) => item.offer?.offer_id === offerId)
    ) {
      fila.push(message);
    }

    enviarItemAtual().catch(() => {});
    return;
  }

  if (message.type === "ML_AFFILIATE_READY") {
    if (sender.tab?.id) {
      mlTabId = sender.tab.id;
      aguardandoNavegacao = false;

      // O content script acabou de ficar pronto.
      // Se houver oferta aguardando, entrega imediatamente.
      if (fila.length) {
        processando = false;
        setTimeout(() => {
          enviarItemAtual().catch(() => {});
        }, 150);
      }
    }
    return;
  }

  if (message.type === "ML_AFFILIATE_RESULT") {
    fila.shift();
    processando = false;
    aguardandoNavegacao = false;

    enviarResultadoParaApp({
      type: "ML_AFFILIATE_RESULT",
      offer_id: message.offer_id,
      affiliate_url: message.affiliate_url || null,
      error: message.error || null
    });

    setTimeout(() => {
      enviarItemAtual().catch(() => {});
    }, 250);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== mlTabId) return;

  if (changeInfo.status === "complete" && fila.length) {
    aguardandoNavegacao = false;
    processando = false;

    setTimeout(() => {
      enviarItemAtual().catch(() => {});
    }, 500);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === mlTabId) {
    mlTabId = null;
    processando = false;
    aguardandoNavegacao = false;

    if (fila.length) {
      setTimeout(() => {
        enviarItemAtual().catch(() => {});
      }, 500);
    }
  }
});
