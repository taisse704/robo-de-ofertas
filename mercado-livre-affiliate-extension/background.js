const APP_MATCH = "https://taisse704.github.io/robo-de-ofertas/";
let mlTabId = null;
let fila = [];
let processando = false;
let timeoutProcessamento = null;
const abasCapturaVideo = new Set();
let capturaVideoAtual = null;
let capturaTabIdPersistente = null;
const CAPTURE_TAB_KEY = "roboVideoCaptureTabId";
const CAPTURE_LOCK_KEY = "roboVideoCaptureLock";

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
    url: ["https://*.mercadolivre.com.br/*", "https://mercadolivre.com.br/*"]
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
    if (!sender.tab?.id || abasCapturaVideo.has(sender.tab.id)) return;
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


async function aguardarPaginaCompleta(tabId, urlEsperada, estado, navegar = false) {
  if (estado.cancelada) throw new Error("Captura cancelada.");
  const atual = await chrome.tabs.get(tabId).catch(() => null);
  if (!navegar && atual?.status === "complete") return;
  if (navegar && atual?.status === "complete" && atual.url === urlEsperada) return;
  const urlAnterior = atual?.url || "";
  let listener = null;
  let removidoListener = null;
  let timeout = null;
  let finalizar;
  const carregamento = new Promise((resolve, reject) => {
    let concluido = false;
    finalizar = (erro) => {
      if (concluido) return;
      concluido = true;
      if (listener) chrome.tabs.onUpdated.removeListener(listener);
      if (removidoListener) chrome.tabs.onRemoved.removeListener(removidoListener);
      if (timeout) clearTimeout(timeout);
      erro ? reject(erro) : resolve(true);
    };
    listener = (id, info, tab) => {
      if (id !== tabId) return;
      if (estado.cancelada) return finalizar(new Error("Captura cancelada."));
      if (info.status === "complete" && (!navegar || (tab?.url && tab.url !== urlAnterior))) finalizar();
    };
    chrome.tabs.onUpdated.addListener(listener);
    removidoListener = (id) => { if (id === tabId) finalizar(new Error("Captura cancelada.")); };
    chrome.tabs.onRemoved.addListener(removidoListener);
    timeout = setTimeout(() => finalizar(new Error("Tempo esgotado ao carregar a página do anúncio.")), 15000);
  });
  try {
    if (navegar) await chrome.tabs.update(tabId, { url: urlEsperada });
    const depois = await chrome.tabs.get(tabId).catch(() => null);
    if (depois?.status === "complete" && (!navegar || (depois.url && depois.url !== urlAnterior))) {
      if (listener) chrome.tabs.onUpdated.removeListener(listener);
      if (removidoListener) chrome.tabs.onRemoved.removeListener(removidoListener);
      if (timeout) clearTimeout(timeout);
      return true;
    }
    await carregamento;
  } finally {
    if (listener) chrome.tabs.onUpdated.removeListener(listener);
    if (removidoListener) chrome.tabs.onRemoved.removeListener(removidoListener);
    if (timeout) clearTimeout(timeout);
  }
}

async function capturarVideosOriginais(offers, estado) {
  const resultados = [];
  const vistos = new Set();
  const lista = (Array.isArray(offers) ? offers : []).filter((offer) => {
    const id = String(offer?.offer_id || "").trim();
    if (!id || vistos.has(id)) return false;
    vistos.add(id);
    return true;
  }).slice(0, 12);
  let tabId = null;
  try {
    // Reutiliza a mesma aba de captura entre tentativas e entre reinícios do service worker.
    const armazenado = await chrome.storage.local.get(CAPTURE_TAB_KEY).catch(() => ({}));
    const idArmazenado = Number(armazenado?.[CAPTURE_TAB_KEY] || capturaTabIdPersistente || 0);
    let tab = idArmazenado ? await chrome.tabs.get(idArmazenado).catch(() => null) : null;
    if (!tab?.id) {
      tab = await chrome.tabs.create({ url: "about:blank", active: false });
      if (!tab?.id) throw new Error("Não foi possível criar a aba de captura.");
      await chrome.storage.local.set({ [CAPTURE_TAB_KEY]: tab.id }).catch(() => {});
    }
    tabId = tab.id;
    capturaTabIdPersistente = tabId;
    estado.tabId = tabId;
    abasCapturaVideo.add(tabId);
    for (const offer of lista) {
      if (estado.cancelada) break;
      const offerId = String(offer?.offer_id || "").trim();
      const productUrl = String(offer?.product_url || "").trim();
      try {
        if (!offerId || !productUrl) throw new Error("Oferta sem ID ou URL de produto.");
        const url = new URL(productUrl);
        const host = url.hostname.toLowerCase();
        const hostPermitido = host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br") || host === "shopee.com.br" || host.endsWith(".shopee.com.br");
        if (url.protocol !== "https:" || !hostPermitido) throw new Error("URL do produto fora dos domínios permitidos.");
        await aguardarPaginaCompleta(tabId, url.href, estado, true);
        if (estado.cancelada) break;
        let scan = null;
        for (let attempt = 0; attempt < 4 && !estado.cancelada; attempt++) {
          try {
            scan = await chrome.tabs.sendMessage(tabId, { type: "ROBO_VIDEO_CAPTURE_SCAN", offer_id: offerId, request_id: offerId + "-" + Date.now() });
            if (scan) break;
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        const candidates = Array.isArray(scan?.videos) ? scan.videos : [];
        const valid = candidates.find((v) => typeof v?.video_url === "string" && v.video_url.startsWith("https://"));
        resultados.push(valid ? { offer_id: offerId, video_url: valid.video_url, method: valid.method || "page_media", title: offer.title || "" } : { offer_id: offerId, status: "not_found", title: offer.title || "", reason: "A página carregou, mas nenhum URL de vídeo reconhecível foi exposto." });
      } catch (error) {
        resultados.push({ offer_id: offerId, status: "scan_error", title: offer?.title || "", reason: String(error?.message || error) });
      }
    }
  } finally {
    if (tabId !== null) {
      abasCapturaVideo.delete(tabId);
      if (estado.cancelada) {
        await chrome.tabs.remove(tabId).catch(() => {});
        if (capturaTabIdPersistente === tabId) capturaTabIdPersistente = null;
        await chrome.storage.local.remove(CAPTURE_TAB_KEY).catch(() => {});
      } else {
        await chrome.tabs.update(tabId, { url: "about:blank", active: false }).catch(() => {});
      }
    }
    await chrome.storage.local.remove(CAPTURE_LOCK_KEY).catch(() => {});
    if (capturaVideoAtual === estado) capturaVideoAtual = null;
    enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_RESULT", results: resultados, cancelled: !!estado.cancelada, error: estado.cancelada ? "Captura interrompida." : null });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.url?.startsWith(APP_MATCH) || !message) return;
  if (message.type === "ROBO_VIDEO_CAPTURE_CANCEL") {
    if (capturaVideoAtual) {
      capturaVideoAtual.cancelada = true;
      if (capturaVideoAtual.tabId !== null) chrome.tabs.remove(capturaVideoAtual.tabId).catch(() => {});
    }
    return;
  }
  if (message.type !== "ROBO_VIDEO_CAPTURE_REQUEST") return;
  if (capturaVideoAtual) {
    enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_RESULT", results: [], error: "Já existe uma captura em andamento. Aguarde o encerramento antes de iniciar outra." });
    return;
  }
  const estado = { cancelada: false, tabId: null };
  // A trava fica em storage.session para impedir uma segunda captura se o service worker reiniciar.
  capturaVideoAtual = estado;
  (async () => {
    const stored = await chrome.storage.local.get(CAPTURE_LOCK_KEY).catch(() => ({}));
    const lock = stored?.[CAPTURE_LOCK_KEY];
    if (lock?.active && Date.now() - Number(lock.startedAt || 0) < 10 * 60 * 1000) {
      if (capturaVideoAtual === estado) capturaVideoAtual = null;
      enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_RESULT", results: [], error: "Já existe uma captura ativa. Aguarde ela terminar; nenhuma nova aba será aberta." });
      return;
    }
    await chrome.storage.local.set({ [CAPTURE_LOCK_KEY]: { active: true, startedAt: Date.now() } }).catch(() => {});
    enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_STARTED" });
    await capturarVideosOriginais(message.offers, estado);
  })().catch(async (error) => {
    await chrome.storage.local.remove(CAPTURE_LOCK_KEY).catch(() => {});
    if (capturaVideoAtual === estado) capturaVideoAtual = null;
    enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_RESULT", error: String(error?.message || error), results: [] });
  });
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
