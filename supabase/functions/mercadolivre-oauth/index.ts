import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_PUBLIC_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ML_CLIENT_ID =
  Deno.env.get("MERCADOLIVRE_CLIENT_ID") ??
  Deno.env.get("ML_CLIENT_ID") ??
  "";

const ML_CLIENT_SECRET =
  Deno.env.get("MERCADOLIVRE_CLIENT_SECRET") ??
  Deno.env.get("ML_CLIENT_SECRET") ??
  "";

const REDIRECT_URI =
  `${SUPABASE_URL}/functions/v1/mercadolivre-oauth`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const admin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function html(message: string, ok = true) {
  const safe = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return new Response(
    `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mercado Livre</title>
<style>
body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:40px;color:#222}
.box{max-width:560px;margin:auto;background:white;border-radius:16px;padding:28px;box-shadow:0 4px 20px #0001}
h1{font-size:22px}
.ok{color:#087f23}.err{color:#b00020}
</style>
</head>
<body>
<div class="box">
<h1>Mercado Livre</h1>
<p class="${ok ? "ok" : "err"}">${safe}</p>
<p>Você pode fechar esta janela e voltar ao Robô de Ofertas.</p>
</div>
</body>
</html>`,
    {
      status: ok ? 200 : 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

/*
 * IMPORTANTE:
 * O Supabase já validou o JWT da requisição antes de executar
 * esta função. Aqui usamos o cliente com a ANON KEY para validar
 * o mesmo token, em vez de usar service-role em auth.getUser().
 */
async function getAuthenticatedUser(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error(
      "SUPABASE_URL ou chave pública do Supabase não configurada.",
    );
  }

  const authorization =
    req.headers.get("Authorization") ?? "";

  if (!authorization) {
    return null;
  }

  const token = authorization
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) {
    return null;
  }

  const userClient = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLIC_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );

  const result = await userClient.auth.getUser();

  if (result.error || !result.data.user) {
    console.error(
      "OAUTH AUTH ERROR:",
      result.error?.message ?? "usuário não encontrado",
    );
    return null;
  }

  return result.data.user;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomString(length = 64) {
  return base64Url(randomBytes(length)).slice(0, length);
}

async function createPkce() {
  const codeVerifier = randomString(64);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );

  const codeChallenge = base64Url(
    new Uint8Array(digest),
  );

  return {
    codeVerifier,
    codeChallenge,
  };
}

async function startAuthorization(req: Request) {
  if (!ML_CLIENT_ID) {
    return json(
      {
        ok: false,
        error:
          "MERCADOLIVRE_CLIENT_ID não configurado no Supabase.",
      },
      500,
    );
  }

  const user = await getAuthenticatedUser(req);

  if (!user) {
    return json(
      {
        ok: false,
        error:
          "Usuário não autenticado ou sessão inválida.",
      },
      401,
    );
  }

  const { codeVerifier, codeChallenge } =
    await createPkce();

  const state = randomString(48);

  const expiresAt = new Date(
    Date.now() + 10 * 60 * 1000,
  ).toISOString();

  const inserted = await admin
    .from("oauth_states")
    .insert({
      user_id: user.id,
      provider: "mercadolivre",
      state,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (inserted.error) {
    console.error(
      "OAUTH STATE INSERT ERROR:",
      inserted.error,
    );

    return json(
      {
        ok: false,
        error:
          "Não foi possível preparar a autorização do Mercado Livre.",
        detalhe: inserted.error.message,
      },
      500,
    );
  }

  const authorizationUrl =
    new URL(
      "https://auth.mercadolivre.com.br/authorization",
    );

  authorizationUrl.searchParams.set(
    "response_type",
    "code",
  );
  authorizationUrl.searchParams.set(
    "client_id",
    ML_CLIENT_ID,
  );
  authorizationUrl.searchParams.set(
    "redirect_uri",
    REDIRECT_URI,
  );
  authorizationUrl.searchParams.set(
    "state",
    state,
  );
  authorizationUrl.searchParams.set(
    "code_challenge",
    codeChallenge,
  );
  authorizationUrl.searchParams.set(
    "code_challenge_method",
    "S256",
  );

  return json({
    ok: true,
    provider: "mercadolivre",
    authorization_url: authorizationUrl.toString(),
    url_autorizacao: authorizationUrl.toString(),
  });
}

async function exchangeCode(
  req: Request,
  code: string,
  state: string,
) {
  if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
    return html(
      "As credenciais do Mercado Livre não estão configuradas no Supabase.",
      false,
    );
  }

  const stateResult = await admin
    .from("oauth_states")
    .select("*")
    .eq("state", state)
    .eq("provider", "mercadolivre")
    .maybeSingle();

  if (stateResult.error) {
    console.error(
      "OAUTH STATE READ ERROR:",
      stateResult.error,
    );

    return html(
      "Não foi possível validar o estado da autorização.",
      false,
    );
  }

  const oauthState = stateResult.data;

  if (!oauthState) {
    return html(
      "A autorização expirou ou o estado não é válido. Tente conectar novamente.",
      false,
    );
  }

  if (
    oauthState.expires_at &&
    new Date(oauthState.expires_at).getTime() <
      Date.now()
  ) {
    await admin
      .from("oauth_states")
      .delete()
      .eq("id", oauthState.id);

    return html(
      "A autorização expirou. Tente conectar novamente.",
      false,
    );
  }

  const body = new URLSearchParams();

  body.set("grant_type", "authorization_code");
  body.set("client_id", ML_CLIENT_ID);
  body.set("client_secret", ML_CLIENT_SECRET);
  body.set("code", code);
  body.set("redirect_uri", oauthState.redirect_uri);
  body.set("code_verifier", oauthState.code_verifier);

  const tokenResponse = await fetch(
    "https://api.mercadolibre.com/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    },
  );

  const tokenData = await tokenResponse
    .json()
    .catch(() => ({}));

  if (
    !tokenResponse.ok ||
    !tokenData?.access_token
  ) {
    console.error(
      "MERCADO LIVRE TOKEN ERROR:",
      tokenResponse.status,
      tokenData,
    );

    return html(
      "O Mercado Livre recusou a autorização. Verifique as configurações do aplicativo e tente novamente.",
      false,
    );
  }

  const accessToken =
    tokenData.access_token as string;

  const meResponse = await fetch(
    "https://api.mercadolibre.com/users/me",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  const me = await meResponse
    .json()
    .catch(() => ({}));

  if (!meResponse.ok || !me?.id) {
    console.error(
      "MERCADO LIVRE USER ERROR:",
      meResponse.status,
      me,
    );

    return html(
      "A autorização foi recebida, mas não foi possível identificar a conta do Mercado Livre.",
      false,
    );
  }

  const platformResult = await admin
    .from("platforms")
    .select("id")
    .eq("nome", "Mercado Livre")
    .maybeSingle();

  if (platformResult.error || !platformResult.data) {
    console.error(
      "PLATFORM ERROR:",
      platformResult.error,
    );

    return html(
      "A plataforma Mercado Livre não está cadastrada no sistema.",
      false,
    );
  }

  const platformId = platformResult.data.id;

  const configuracao = {
    provider: "mercadolivre",
    access_token: accessToken,
    refresh_token:
      tokenData.refresh_token ?? null,
    token_type:
      tokenData.token_type ?? "Bearer",
    expires_in:
      Number(tokenData.expires_in ?? 21600),
    token_obtido_em:
      new Date().toISOString(),
    scope:
      tokenData.scope ?? null,
    ml_user_id:
      String(me.id),
    nickname:
      me.nickname ?? null,
  };

  const existing = await admin
    .from("affiliate_accounts")
    .select("id")
    .eq("user_id", oauthState.user_id)
    .eq("platform_id", platformId)
    .maybeSingle();

  let saveResult;

  if (existing.data?.id) {
    saveResult = await admin
      .from("affiliate_accounts")
      .update({
        nome_conta:
          me.nickname ||
          me.first_name ||
          "Mercado Livre",
        status: "conectada",
        ativo: true,
        account_external_id:
          String(me.id),
        metadata: {
          provider: "mercadolivre",
          ml_user_id:
            String(me.id),
          nickname:
            me.nickname ?? null,
        },
        configuracao,
        connected_at:
          new Date().toISOString(),
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", existing.data.id);
  } else {
    saveResult = await admin
      .from("affiliate_accounts")
      .insert({
        user_id: oauthState.user_id,
        platform_id: platformId,
        nome_conta:
          me.nickname ||
          me.first_name ||
          "Mercado Livre",
        status: "conectada",
        ativo: true,
        account_external_id:
          String(me.id),
        metadata: {
          provider: "mercadolivre",
          ml_user_id:
            String(me.id),
          nickname:
            me.nickname ?? null,
        },
        configuracao,
        connected_at:
          new Date().toISOString(),
      });
  }

  if (saveResult.error) {
    console.error(
      "AFFILIATE ACCOUNT SAVE ERROR:",
      saveResult.error,
    );

    return html(
      "O Mercado Livre autorizou a conta, mas o sistema não conseguiu salvar a conexão.",
      false,
    );
  }

  await admin
    .from("oauth_states")
    .delete()
    .eq("id", oauthState.id);

  return html(
    "Mercado Livre conectado com sucesso! A conta foi autorizada e registrada no sistema.",
    true,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return json({});
  }

  const url = new URL(req.url);
  const code =
    url.searchParams.get("code");
  const state =
    url.searchParams.get("state");
  const action =
    url.searchParams.get("action");

  try {
    /*
     * O painel inicia a autorização usando:
     * GET?action=start
     */
    if (
      req.method === "GET" &&
      action === "start"
    ) {
      return await startAuthorization(req);
    }

    /*
     * Callback do Mercado Livre.
     */
    if (code && state) {
      return await exchangeCode(
        req,
        code,
        state,
      );
    }

    if (req.method === "GET") {
      return json({
        ok: true,
        mensagem:
          "Função OAuth do Mercado Livre ativa.",
        provider: "mercadolivre",
        pkce: true,
        redirect_uri: REDIRECT_URI,
      });
    }

    if (req.method === "POST") {
      return await startAuthorization(req);
    }

    return json(
      {
        ok: false,
        error: "Método não permitido.",
      },
      405,
    );
  } catch (error) {
    console.error(
      "ERRO GERAL MERCADOLIVRE OAUTH:",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno no OAuth do Mercado Livre.",
      },
      500,
    );
  }
});
