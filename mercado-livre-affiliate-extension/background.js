const APP_MATCH = "https://taisse704.github.io/robo-de-ofertas/";
let mlTabId = null;
let fila = [];
let processando = false;
let aguardandoNavegacao = false;
let timeoutProcessamento = null;

function enviarResultadoParaApp(message) {
  chrome.tabs.query({
    url: ["https://taisse704.github.io/robo-de-ofertas/*"]
  }).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }).catch(() => {});
}

function limparTimeoutProcessamento() {
  if (timeoutProcessamento) {
    clearTimeout(timeoutProcessamento);
    timeoutProcessamento = null;
  }
}

function agendarTimeoutProcessamento() {
  limparTimeoutProcessamento();
  timeoutProcessamento = setTimeout(() => {
    processando = false;
    aguardandoNavegacao = false;
    enviarItemAtual().catch(() => {});
  }, 30000);
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
  const offerId = String(item.offer?.offer_id || "").trim();
  const destino = String(item.offer?.product_url || "").trim();

  if (!offerId || !destino) {
    fila.shift();
    enviarResultadoParaApp({
      type: "ML_AFFILIATE_RESULT",
      offer_id: offerId || null,
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
      agendarTimeoutProcessamento();
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: "ML_AFFILIATE_GENERATE_ON_TAB",
      offer: item.offer
    });

    agendarTimeoutProcessamento();
  } catch (error) {
    processando = false;
    aguardandoNavegacao = false;

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
    const offerId = String(message.offer?.offer_id || "").trim();

    if (
      offerId &&
      !fila.some((item) => String(item.offer?.offer_id || "") === offerId)
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

      if (fila.length) {
        processando = false;
        limparTimeoutProcessamento();
        setTimeout(() => {
          enviarItemAtual().catch(() => {});
        }, 300);
      }
    }
    return;
  }

  if (message.type === "ML_AFFILIATE_RESULT") {
    const resultOfferId = String(message.offer_id || "").trim();
    const index = fila.findIndex(
      (item) => String(item.offer?.offer_id || "") === resultOfferId
    );

    if (index >= 0) fila.splice(index, 1);

    limparTimeoutProcessamento();
    processando = false;
    aguardandoNavegacao = false;

    enviarResultadoParaApp({
      type: "ML_AFFILIATE_RESULT",
      offer_id: resultOfferId || null,
      affiliate_url: message.affiliate_url || null,
      error: message.error || null,
      ok: message.ok !== false
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
    limparTimeoutProcessamento();

    setTimeout(() => {
      enviarItemAtual().catch(() => {});
    }, 700);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === mlTabId) {
    mlTabId = null;
    processando = false;
    aguardandoNavegacao = false;
    limparTimeoutProcessamento();

    if (fila.length) {
      setTimeout(() => {
        enviarItemAtual().catch(() => {});
      }, 500);
    }
  }
});
