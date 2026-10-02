import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function getUserId(req: Request): string | null {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function callShopee(query: string, variables: Record<string, unknown> = {}) {
  const appId = Deno.env.get("SHOPEE_APP_ID") || "";
  const secret = Deno.env.get("SHOPEE_APP_SECRET") || "";
  if (!appId || !secret) return { ok: false, status: 503, error: "Credenciais da Shopee ainda não configuradas. Cadastre SHOPEE_APP_ID e SHOPEE_APP_SECRET nos Secrets." };

  const body = JSON.stringify({ query, variables });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await sha256Hex(appId + timestamp + body + secret);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && !data?.errors?.length, status: response.status, data, error: data?.errors?.[0]?.message || null };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const userId = getUserId(req);
  if (!userId) return json({ ok: false, error: "Usuário não autenticado." }, 401);

  const body = await req.json().catch(() => ({}));
  const originUrl = typeof body.originUrl === "string" ? body.originUrl.trim() : "";
  const subIds = Array.isArray(body.subIds) ? body.subIds.filter((x: unknown) => typeof x === "string").slice(0, 5) : [];

  if (!originUrl) return json({ ok: false, error: "Informe originUrl." }, 400);
  if (!/^https?:\/\/(www\.)?shopee\.com\.br\//i.test(originUrl)) return json({ ok: false, error: "originUrl precisa ser um link da Shopee Brasil." }, 400);

  const escapedUrl = JSON.stringify(originUrl).slice(1, -1);
  const escapedSubs = subIds.map((x: string) => JSON.stringify(x)).join(",");
  const query = `mutation { generateShortLink(input: { originUrl: "${escapedUrl}", subIds: [${escapedSubs}] }) { shortLink } }`;
  const result = await callShopee(query);

  return json({
    ok: result.ok,
    user_id: userId,
    provider: "shopee",
    affiliate_url: result.data?.data?.generateShortLink?.shortLink || null,
    status: result.status,
    error: result.error,
    raw: result.ok ? undefined : result.data,
  }, result.ok ? 200 : (result.status >= 400 ? result.status : 502));
});
