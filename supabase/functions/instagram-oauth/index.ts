import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_PUBLIC_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const INSTAGRAM_APP_ID =
  Deno.env.get("INSTAGRAM_APP_ID") ??
  Deno.env.get("META_INSTAGRAM_APP_ID") ??
  Deno.env.get("META_APP_ID") ??
  Deno.env.get("FACEBOOK_APP_ID") ??
  "";
const INSTAGRAM_APP_SECRET =
  Deno.env.get("INSTAGRAM_APP_SECRET") ??
  Deno.env.get("META_INSTAGRAM_APP_SECRET") ??
  Deno.env.get("META_APP_SECRET") ??
  Deno.env.get("FACEBOOK_APP_SECRET") ??
  "";

const REDIRECT_URI = SUPABASE_URL + "/functions/v1/instagram-oauth";
const INSTAGRAM_SCOPES =
  "instagram_business_basic,instagram_business_content_publish";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function html(message: string, ok = true) {
  const safe = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const page =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Instagram</title><style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:40px;color:#222}.box{max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 20px #0001}h1{font-size:22px}.ok{color:#087f23}.err{color:#b00020}</style></head>' +
    '<body><div class="box"><h1>Instagram</h1><p class="' +
    (ok ? "ok" : "err") +
    '">' +
    safe +
    '</p><p>Você pode fechar esta janela e voltar ao Robô de Ofertas.</p></div></body></html>';

  return new Response(page, {
    status: ok ? 200 : 400,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

async function getAuthenticatedUser(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) return null;
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const client = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const result = await client.auth.getUser();
  return result.error || !result.data.user ? null : result.data.user;
}

function randomString(length = 48) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
    .slice(0, length);
}

async function startAuthorization(req: Request) {
  if (!INSTAGRAM_APP_ID || !INSTAGRAM_APP_SECRET) {
    return json(
      {
        ok: false,
        error:
          "Configure INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET nos Secrets do Supabase.",
        redirect_uri: REDIRECT_URI,
      },
      500,
    );
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return json({ ok: false, error: "Usuário não autenticado." }, 401);

  const state = randomString(48);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const saved = await admin.from("oauth_states").insert({
    user_id: user.id,
    provider: "instagram",
    state,
    code_verifier: randomString(64),
    redirect_uri: REDIRECT_URI,
    expires_at: expiresAt,
  });

  if (saved.error) {
    console.error("INSTAGRAM STATE ERROR:", saved.error);
    return json(
      {
        ok: false,
        error: "Não foi possível preparar a conexão do Instagram.",
        detalhe: saved.error.message,
      },
      500,
    );
  }

  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", INSTAGRAM_APP_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", INSTAGRAM_SCOPES);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  return json({
    ok: true,
    provider: "instagram",
    authorization_url: authUrl.toString(),
    redirect_uri: REDIRECT_URI,
  });
}

async function exchangeCode(code: string) {
  const body = new URLSearchParams();
  body.set("client_id", INSTAGRAM_APP_ID);
  body.set("client_secret", INSTAGRAM_APP_SECRET);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", REDIRECT_URI);
  body.set("code", code);

  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function exchangeLongLived(shortToken: string) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", INSTAGRAM_APP_SECRET);
  url.searchParams.set("access_token", shortToken);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function getInstagramProfile(accessToken: string) {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "user_id,username");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function callback(code: string, state: string) {
  if (!INSTAGRAM_APP_ID || !INSTAGRAM_APP_SECRET) {
    return html(
      "As credenciais do Instagram ainda não estão configuradas no Supabase.",
      false,
    );
  }

  const stateResult = await admin
    .from("oauth_states")
    .select("*")
    .eq("state", state)
    .eq("provider", "instagram")
    .maybeSingle();

  if (stateResult.error || !stateResult.data) {
    return html(
      "A autorização expirou ou o estado não é válido. Tente conectar novamente.",
      false,
    );
  }

  const oauthState = stateResult.data;

  if (
    oauthState.expires_at &&
    new Date(oauthState.expires_at).getTime() < Date.now()
  ) {
    await admin.from("oauth_states").delete().eq("id", oauthState.id);
    return html("A autorização expirou. Tente conectar novamente.", false);
  }

  const tokenResult = await exchangeCode(code);

  if (!tokenResult.response.ok || !tokenResult.data?.access_token) {
    console.error("INSTAGRAM TOKEN ERROR:", tokenResult.data);
    await admin.from("oauth_states").delete().eq("id", oauthState.id);
    return html(
      "O Instagram recusou a autorização. Verifique o Instagram Login e a URI de redirecionamento.",
      false,
    );
  }

  const shortToken = String(tokenResult.data.access_token);
  const longResult = await exchangeLongLived(shortToken);

  const accessToken =
    longResult.response.ok && longResult.data?.access_token
      ? String(longResult.data.access_token)
      : shortToken;

  const profileResult = await getInstagramProfile(accessToken);

  if (!profileResult.response.ok || !profileResult.data?.user_id) {
    console.error("INSTAGRAM PROFILE ERROR:", profileResult.data);
    return html(
      "A autorização funcionou, mas não foi possível obter os dados da conta do Instagram.",
      false,
    );
  }

  const instagramId = String(profileResult.data.user_id);
  const username = profileResult.data.username
    ? String(profileResult.data.username)
    : null;

  const config = {
    provider: "instagram",
    login_mode: "instagram_business_login",
    instagram_user_id: instagramId,
    instagram_username: username,
    access_token: accessToken,
    token_obtido_em: new Date().toISOString(),
  };

  const existing = await admin
    .from("channel_accounts")
    .select("id")
    .eq("user_id", oauthState.user_id)
    .eq("canal", "instagram")
    .maybeSingle();

  let save;
  if (existing.data?.id) {
    save = await admin
      .from("channel_accounts")
      .update({
        status: "conectada",
        configuracao: config,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.data.id);
  } else {
    save = await admin.from("channel_accounts").insert({
      user_id: oauthState.user_id,
      canal: "instagram",
      status: "conectada",
      configuracao: config,
    });
  }

  if (save.error) {
    console.error("CHANNEL ACCOUNT SAVE ERROR:", save.error);
    return html(
      "O Instagram foi autorizado, mas não foi possível salvar a conexão no sistema.",
      false,
    );
  }

  const pubExisting = await admin
    .from("publication_channels")
    .select("id")
    .eq("user_id", oauthState.user_id)
    .eq("tipo", "instagram")
    .maybeSingle();

  if (pubExisting.data?.id) {
    await admin
      .from("publication_channels")
      .update({
        nome: username ? "Instagram @" + username : "Instagram",
        identificador: instagramId,
        ativo: true,
        configuracao: config,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pubExisting.data.id);
  } else {
    await admin.from("publication_channels").insert({
      user_id: oauthState.user_id,
      tipo: "instagram",
      nome: username ? "Instagram @" + username : "Instagram",
      identificador: instagramId,
      ativo: true,
      configuracao: config,
    });
  }

  await admin.from("oauth_states").delete().eq("id", oauthState.id);

  return html(
    username
      ? "Instagram @" + username + " conectado com sucesso!"
      : "Instagram conectado com sucesso!",
    true,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  try {
    if (error) return html("A autorização do Instagram foi cancelada.", false);

    if (req.method === "GET" && action === "start") {
      return await startAuthorization(req);
    }

    if (code && state) return await callback(code, state);

    if (req.method === "GET") {
      return json({
        ok: true,
        provider: "instagram",
        message: "Função OAuth do Instagram Business Login ativa.",
        redirect_uri: REDIRECT_URI,
        scopes: INSTAGRAM_SCOPES,
      });
    }

    return json({ ok: false, error: "Método não permitido." }, 405);
  } catch (error) {
    console.error("INSTAGRAM OAUTH ERROR:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro interno.",
      },
      500,
    );
  }
});
