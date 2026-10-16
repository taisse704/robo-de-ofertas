const APP_MATCH = "https://taisse704.github.io/";
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
  chrome.tabs.query({ url: ["https://taisse704.github.io/*"] })
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
  const tentarEnviar = async (quantidade) => {
    for (let tentativa = 0; tentativa < quantidade; tentativa++) {
      try {
        await chrome.tabs.sendMessage(tabId, message);
        return true;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    return false;
  };

  if (await tentarEnviar(4)) return;

  // Abas abertas antes de instalar/atualizar a extensão podem estar sem o script.
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = String(tab?.url || "");
    const hostPermitido = [
      "mercadolivre.com.br", "mercadolivre.com", "mercadolibre.com"
    ].some((host) => {
      try {
        const atual = new URL(url);
        return atual.protocol === "https:" &&
          (atual.hostname === host || atual.hostname.endsWith("." + host));
      } catch { return false; }
    });
    if (!hostPermitido) throw new Error("A aba aberta não está em um domínio compatível do Mercado Livre.");

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["mercado-livre.js"]
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await tentarEnviar(8)) return;
  } catch (error) {
    lastError = error;
  }

  throw new Error(
    "A extensão não conseguiu ativar o gerador na aba do Mercado Livre. " +
    "Recarregue a extensão em edge://extensions, atualize a aba do Mercado Livre e tente novamente. " +
    String(lastError?.message || lastError || "")
  );
}

async function encontrarAbaMercadoLivreExistente() {
  // A extensão nunca abre uma aba de produto durante buscas ou solicitações de link.
  // Reutiliza somente uma aba do Mercado Livre que a usuária já deixou aberta.
  const tabs = await chrome.tabs.query({
    url: [
      "https://*.mercadolivre.com.br/*", "https://mercadolivre.com.br/*",
      "https://*.mercadolivre.com/*", "https://mercadolivre.com/*",
      "https://*.mercadolibre.com/*", "https://mercadolibre.com/*"
    ]
  });
  const existing = tabs.find((tab) => tab?.id && !abasCapturaVideo.has(tab.id));
  if (existing?.id) {
    mlTabId = existing.id;
    return existing.id;
  }
  mlTabId = null;
  throw new Error("Para gerar o link oficial, abra o Mercado Livre em outra aba e entre na sua conta de afiliada. A extensão não abrirá abas automaticamente.");
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
    const tabId = await encontrarAbaMercadoLivreExistente();
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
    // A injeção de recuperação pode emitir READY enquanto a fila já está
    // processando o item atual. Não reinicie a fila nesse caso para evitar
    // enviar o mesmo produto duas vezes.
    if (fila.length && !processando) {
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
  }).slice(0, 100);
  let tabId = null;
  let originalTabUrl = null;
  let erroCaptura = null;
  try {
    // Não cria abas automaticamente. Usa uma aba de marketplace que já esteja aberta.
    // Guarda a URL original para restaurar a aba ao terminar ou cancelar.
    const tabs = await chrome.tabs.query({
      url: [
        "https://*.mercadolivre.com.br/*",
        "https://mercadolivre.com.br/*",
        "https://*.shopee.com.br/*",
        "https://shopee.com.br/*"
      ]
    });
    const tab = tabs.find((item) => item?.id && !abasCapturaVideo.has(item.id));
    if (!tab?.id) {
      throw new Error("Nenhuma aba da Shopee ou do Mercado Livre está aberta. Abra um dos marketplaces primeiro; a extensão não abrirá abas automaticamente.");
    }
    tabId = tab.id;
    originalTabUrl = typeof tab.url === "string" ? tab.url : null;
    estado.originalTabUrl = originalTabUrl;
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
        const hostPermitido = host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br") || host === "shopee.com.br" || host.endsWith(".shopee.com.br") || host === "meli.la";
        if (url.protocol !== "https:" || !hostPermitido) throw new Error("URL do produto fora dos domínios permitidos.");
        await aguardarPaginaCompleta(tabId, url.href, estado, true);
        if (estado.cancelada) break;
        // Links afiliados do Mercado Livre podem usar o encurtador meli.la.
        // Após a navegação, confirme o destino real antes de tentar ler a galeria.
        const paginaFinal = await chrome.tabs.get(tabId).catch(() => null);
        let hostFinal = "";
        try { hostFinal = new URL(paginaFinal?.url || "").hostname.toLowerCase(); } catch {}
        const destinoMercadoLivre = hostFinal === "mercadolivre.com.br" || hostFinal.endsWith(".mercadolivre.com.br");
        const destinoShopee = hostFinal === "shopee.com.br" || hostFinal.endsWith(".shopee.com.br");
        if (!destinoMercadoLivre && !destinoShopee) {
          throw new Error("O link do anúncio não redirecionou para uma página de produto da Shopee ou do Mercado Livre.");
        }
        let scan = null;
        // O player da Shopee pode carregar a mídia depois do carregamento inicial.
        // Repetimos a varredura quando a resposta existe, mas ainda não há vídeo.
        for (let attempt = 0; attempt < 5 && !estado.cancelada; attempt++) {
          try {
            scan = await chrome.tabs.sendMessage(tabId, { type: "ROBO_VIDEO_CAPTURE_SCAN", offer_id: offerId, request_id: offerId + "-" + Date.now() });
            if (Array.isArray(scan?.videos) && scan.videos.length) break;
          } catch {}
          if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 900));
        }
        const candidates = Array.isArray(scan?.videos) ? scan.videos : [];
        // Preferimos arquivo de vídeo direto ou URL estruturada de vídeo.
        // Manifestos HLS/DASH não são tratados como arquivo pronto para publicação no Instagram.
        const valid = candidates.find((v) => {
          if (typeof v?.video_url !== "string" || !v.video_url.startsWith("https://")) return false;
          try {
            const media = new URL(v.video_url);
            if (/\/(preview|thumbnail|thumb|poster|sprite|cover)(?:\/|$)/i.test(media.pathname)) return false;
            if (/\.(m3u8|mpd)(?:$|[?#])/i.test(media.href)) return false;
            if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|json|js|css|html|htm)(?:$|[?#])/i.test(media.pathname)) return false;
            if (/\.(mp4|m4v|webm|mov)(?:$|[?#])/i.test(media.href)) return v.media_type === "file";
            // CDNs can serve signed video URLs without a visible file extension.
            // Only trust explicit player/source or product video fields, never generic inline resources.
            const trustedMethod = ["video_element", "video_source", "structured_video_field"].includes(String(v.method || "")) ||
              (/^page_json_response:/i.test(String(v.method || "")) && /video|playback|play_url|playable|vod|media/i.test(String(v.method || "")));
            const cdnHost = /(^|\.)((mlstatic\.com)|(susercontent\.com)|(shopeemobile\.com))$/i.test(media.hostname);
            return v.media_type === "unknown" && trustedMethod && cdnHost;
          } catch { return false; }
        });
        const onlyStream = candidates.some((v) => v?.media_type === "stream");
        const hasPreview = candidates.some((v) => {
          try { return /\/(preview|thumbnail|thumb|poster|sprite|cover)(?:\/|$)/i.test(new URL(v.video_url).pathname); }
          catch { return false; }
        });
        const reason = hasPreview
          ? "Só foram encontrados previews/miniaturas; eles não serão salvos como vídeo original da publicação."
          : scan?.blob_player_detected
            ? "O player da galeria do produto usa um endereço blob temporário; não foi possível confirmar um arquivo original direto."
            : onlyStream
              ? "A galeria expôs apenas transmissão HLS/DASH, não um arquivo de vídeo direto pronto para publicação."
              : scan?.player_detected
                ? "Foi detectado um player na galeria, mas não foi exposto um arquivo MP4/WebM/MOV direto."
                : "Não foi confirmado vídeo direto na galeria principal do produto. Vídeos de comentários, avaliações e módulos externos são ignorados.";
        resultados.push(valid
          ? { offer_id: offerId, video_url: valid.video_url, method: valid.method || "page_media", media_type: valid.media_type || "unknown", platform: scan?.platform || (host.includes("shopee") ? "shopee" : "mercado_livre"), title: offer.title || "" }
          : { offer_id: offerId, status: "not_found", platform: host.includes("shopee") ? "shopee" : "mercado_livre", title: offer.title || "", reason });
      } catch (error) {
        resultados.push({ offer_id: offerId, status: "scan_error", title: offer?.title || "", reason: String(error?.message || error) });
      }
    }
  } catch (error) {
    erroCaptura = String(error?.message || error || "Falha inesperada durante a captura dos anúncios.");
  } finally {
    if (tabId !== null) {
      abasCapturaVideo.delete(tabId);
      // A aba pertence à usuária: nunca fechá-la, nem mesmo ao cancelar.
      // Restauramos a página que estava aberta antes da captura.
      if (originalTabUrl) {
        const current = await chrome.tabs.get(tabId).catch(() => null);
        if (current?.id && current.url !== originalTabUrl) {
          await chrome.tabs.update(tabId, { url: originalTabUrl }).catch(() => {});
        }
      }
      if (capturaTabIdPersistente === tabId) capturaTabIdPersistente = null;
    }
    await chrome.storage.local.remove([CAPTURE_LOCK_KEY, CAPTURE_TAB_KEY]).catch(() => {});
    if (capturaVideoAtual === estado) capturaVideoAtual = null;
    enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_RESULT", results: resultados, cancelled: !!estado.cancelada, error: erroCaptura || (estado.cancelada ? "Captura interrompida." : null) });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.url?.startsWith(APP_MATCH) || !message) return;
  if (message.type === "ROBO_VIDEO_CAPTURE_CANCEL") {
    if (capturaVideoAtual) {
      // Cancelar interrompe a fila, mas nunca fecha a aba que já era da usuária.
      capturaVideoAtual.cancelada = true;
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
    if (lock?.active && Date.now() - Number(lock.startedAt || 0) < 60 * 60 * 1000) {
      if (capturaVideoAtual === estado) capturaVideoAtual = null;
      enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_RESULT", results: [], error: "Já existe uma captura ativa. Aguarde ela terminar; nenhuma nova aba será aberta." });
      return;
    }
    await chrome.storage.local.set({ [CAPTURE_LOCK_KEY]: { active: true, startedAt: Date.now() } }).catch(() => {});
    // Confirma diretamente à aba que pediu a captura. Evita depender da consulta
    // global de abas para o ACK inicial que o app espera receber em 5 segundos.
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, { type: "ROBO_VIDEO_CAPTURE_STARTED" }).catch(() => {});
    } else {
      enviarResultadoParaApp({ type: "ROBO_VIDEO_CAPTURE_STARTED" });
    }
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
