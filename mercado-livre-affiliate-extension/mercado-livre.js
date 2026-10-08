const SOURCE = "robo-de-ofertas";

chrome.runtime.sendMessage({ type: "ML_AFFILIATE_READY" });

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "ML_AFFILIATE_GENERATE_ON_TAB") return;

  (async () => {
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

      const tagResponse = await fetch(
        "/affiliate-program/api/v2/stripe/user/tags",
        {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include"
        }
      );

      const tagData = await tagResponse.json().catch(() => ({}));

      if (!tagResponse.ok) {
        throw new Error(
          "Falha ao consultar etiquetas de afiliado (HTTP " +
          tagResponse.status +
          ")."
        );
      }

      const tags = Array.isArray(tagData)
        ? tagData
        : Array.isArray(tagData?.tags)
          ? tagData.tags
          : Array.isArray(tagData?.data)
            ? tagData.data
            : [];

      const active =
        tags.find((item) =>
          item &&
          (
            item.in_use === true ||
            item.inUse === true ||
            item.status === "active" ||
            item.status === "ACTIVE"
          )
        ) || tags[0];

      const tag = String(
        active?.tag ||
        active?.id ||
        active?.name ||
        ""
      ).trim();

      if (!tag) {
        throw new Error("Nenhuma etiqueta de afiliado ativa foi encontrada.");
      }

      const linkResponse = await fetch(
        "/affiliate-program/api/v2/stripe/user/links",
        {
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
        }
      );

      const linkData = await linkResponse.json().catch(() => ({}));

      if (!linkResponse.ok) {
        throw new Error(
          linkData?.message ||
          linkData?.error ||
          "Falha ao gerar link de afiliado (HTTP " +
          linkResponse.status +
          ")."
        );
      }

      const affiliateUrl = String(
        linkData?.short_url ||
        linkData?.shortUrl ||
        linkData?.affiliate_url ||
        linkData?.affiliateUrl ||
        linkData?.url ||
        ""
      ).trim();

      if (!affiliateUrl) {
        throw new Error(
          "O Mercado Livre respondeu, mas não informou o link curto de afiliado."
        );
      }

      const hostname = (() => {
        try {
          return new URL(affiliateUrl).hostname.toLowerCase();
        } catch {
          return "";
        }
      })();

      if (
        !(
          hostname === "meli.la" ||
          hostname === "mercadolivre.com.br" ||
          hostname.endsWith(".mercadolivre.com.br") ||
          hostname === "mercadolivre.com" ||
          hostname.endsWith(".mercadolivre.com")
        )
      ) {
        throw new Error(
          "O Mercado Livre retornou um endereço que não foi reconhecido como link oficial de afiliado."
        );
      }

      chrome.runtime.sendMessage({
        type: "ML_AFFILIATE_RESULT",
        offer_id: offer.offer_id,
        affiliate_url: affiliateUrl,
        ok: true,
        details: {
          id: linkData?.id || null,
          tag: linkData?.tag || tag,
          origin_url: linkData?.origin_url || productUrl
        }
      });
    } catch (error) {
      chrome.runtime.sendMessage({
        type: "ML_AFFILIATE_RESULT",
        offer_id: offer.offer_id,
        ok: false,
        error: String(error?.message || error)
      });
    }
  })();
});