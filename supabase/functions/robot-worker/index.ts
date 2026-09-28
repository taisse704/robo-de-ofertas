import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  try {
    const baseUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1`;
    const headers = { 
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json' 
    };

    const processRes = await fetch(`${baseUrl}/process-offers`, { method: 'POST', headers });
    const processData = await processRes.json();

    const contentRes = await fetch(`${baseUrl}/generate-content`, { method: 'POST', headers });
    const contentData = await contentRes.json();

    const publishRes = await fetch(`${baseUrl}/publish-content`, { method: 'POST', headers });
    const publishData = await publishRes.json();

    return new Response(JSON.stringify({
      success: true,
      cycle: {
        offers: processData,
        content: contentData,
        publishing: publishData
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
});
