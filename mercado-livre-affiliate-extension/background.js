const APP_MATCH = "https://taisse704.github.io/robo-de-ofertas/";
let mlTabId = null;
let fila = [];
let processando = false;
let timeoutProcessamento = null;

function enviarResultadoParaApp(message) {
  chrome.tabs.query({ url: ["https://taisse704.github.io/robo-de-ofertas/*"] })
    .then((tabs) => {
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    })
    .catch(() => {});
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
    const item = fila.shift();
    processando = false;
    if (item) {
      enviarResultadoParaApp({
        type: "ML_AFFILIATE_RESULT",
        offer_id: String(item.offer?.offer_id || "") || null,
        ok: false,
        error: "Tempo esgotado aguardando o Mercado Livre gerar o link. Tente novamente com a aba do Mercado Livre aberta e conectada."
      });
    }
    enviarItemAtual().catch(() => {});
  }, 30000);
}

async function enviarMensagemComTentativas(tabId, message) {
  let lastError = null;
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error("A extensão não conseguiu comunicar com a página do Mercado Livre.");
}

async function encontrarOuCriarAbaMercadoLivre(destino) {
  if (mlTabId !== null) {
    try {
      const tab = await chrome.tabs.get(mlTabId);
      if (tab?.id) return tab.id;
    } catch {
      mlTabId = null;
    }
  }

  const tabs = await chrome.tabs.query({
    url: ["https://www.mercadolivre.com.br/*", "https://mercadolivre.com.br/*"]
  });

  if (tabs.length && tabs[0]?.id) {
    mlTabId = tabs[0].id;
    return mlTabId;
  }

  const urlProduto = String(destino || "").trim();
  if (!urlProduto) throw new Error("Oferta sem URL do produto do Mercado Livre.");

  const tab = await chrome.tabs.create({ url: urlProduto, active: false });
  if (!tab?.id) throw new Error("Não foi possível abrir a página do produto do Mercado Livre.");

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
      ok: false,
      error: "Oferta sem ID ou URL do produto."
    });
    setTimeout(() => enviarItemAtual().catch(() => {}), 100);
    return;
  }

  processando = true;

  try {
    const tabId = await encontrarOuCriarAbaMercadoLivre(destino);
    // A geração usa a sessão autenticada da aba do Mercado Livre e envia
    // a URL do produto no payload. Não exigimos que a aba esteja exatamente
    // na mesma URL, porque o Mercado Livre pode redirecionar /p/MLB... para
    // uma URL canônica diferente.
    await enviarMensagemComTentativas(tabId, {
      type: "ML_AFFILIATE_GENERATE_ON_TAB",
      offer: item.offer
    });

    agendarTimeoutProcessamento();
  } catch (error) {
    processando = false;
    enviarResultadoParaApp({
      type: "ML_AFFILIATE_RESULT",
      offer_id: offerId,
      ok: false,
      error: String(error?.message || error || "Não foi possível comunicar com a aba do Mercado Livre.")
    });
    fila.shift();
    setTimeout(() => enviarItemAtual().catch(() => {}), 500);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message) return;

  if (sender.tab?.url?.startsWith(APP_MATCH) && message.type === "ML_AFFILIATE_GENERATE") {
    const offerId = String(message.offer?.offer_id || "").trim();
    if (offerId && !fila.some((item) => String(item.offer?.offer_id || "") === offerId)) {
      fila.push(message);
    }
    enviarItemAtual().catch(() => {});
    return;
  }

  if (message.type === "ML_AFFILIATE_READY") {
    if (!sender.tab?.id) return;
    mlTabId = sender.tab.id;
    if (fila.length) {
      processando = false;
      limparTimeoutProcessamento();
      setTimeout(() => enviarItemAtual().catch(() => {}), 300);
    }
    return;
  }

  if (message.type === "ML_AFFILIATE_RESULT") {
    const resultOfferId = String(message.offer_id || "").trim();
    const index = fila.findIndex((item) => String(item.offer?.offer_id || "") === resultOfferId);
    if (index >= 0) fila.splice(index, 1);

    limparTimeoutProcessamento();
    processando = false;

    enviarResultadoParaApp({
      type: "ML_AFFILIATE_RESULT",
      offer_id: resultOfferId || null,
      affiliate_url: message.affiliate_url || null,
      error: message.error || null,
      ok: message.ok !== false
    });

    setTimeout(() => enviarItemAtual().catch(() => {}), 250);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== mlTabId) return;
  if (changeInfo.status === "complete" && fila.length && !processando) {
    processando = false;
    limparTimeoutProcessamento();
    setTimeout(() => enviarItemAtual().catch(() => {}), 700);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== mlTabId) return;
  mlTabId = null;
  processando = false;
  limparTimeoutProcessamento();
  if (fila.length) setTimeout(() => enviarItemAtual().catch(() => {}), 500);
});
