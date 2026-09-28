import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'start') {
    const appId = Deno.env.get('MERCADOLIVRE_APP_ID');
    const redirectUri = Deno.env.get('MERCADOLIVRE_REDIRECT_URI');
    
    const authUrl = `https://auth.mercadolibre.com.br/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    return new Response(
      JSON.stringify({ ok: true, authorization_url: authUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ ok: false, error: 'Ação inválida' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
