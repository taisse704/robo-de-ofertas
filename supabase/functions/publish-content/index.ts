import { corsHeaders } from '../_shared/cors.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: pendingContents } = await supabase
      .from('contents')
      .select('*')
      .eq('status', 'pending')
      .limit(5);

    if (!pendingContents || pendingContents.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhum conteúdo pendente para publicação." }), { status: 200 });
    }

    const publishedItems = [];

    for (const item of pendingContents) {
      const { data: pub } = await supabase
        .from('publications')
        .insert({
          content_id: item.id,
          status: 'published',
          published_at: new Date().toISOString()
        })
        .select()
        .single();

      await supabase
        .from('contents')
        .update({ status: 'published' })
        .eq('id', item.id);

      publishedItems.push(pub);
    }

    return new Response(JSON.stringify({ success: true, count: publishedItems.length }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
});
