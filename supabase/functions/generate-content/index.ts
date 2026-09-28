import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: offers } = await supabase
      .from('offers')
      .select('*')
      .eq('is_selected', true)
      .limit(10);

    if (!offers || offers.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhuma oferta selecionada pendente." }), { status: 200 });
    }

    const generatedContents = [];

    for (const offer of offers) {
      const affiliateUrl = `${offer.original_url}?p_tag=VENDASROBI`;

      const headline = `🔥 OFERTA: ${offer.title}`;
      const caption = `${headline}\n\n De: R$ ${offer.original_price}\n Por apenas: R$ ${offer.current_price} (${offer.discount_percentage}% OFF!)\n\n Link do produto: ${affiliateUrl}`;

      const { data: content } = await supabase
        .from('contents')
        .insert({
          offer_id: offer.id,
          headline,
          caption,
          image_generated_url: offer.image_url,
          status: 'pending'
        })
        .select()
        .single();

      if (content) generatedContents.push(content);
    }

    return new Response(JSON.stringify({ success: true, count: generatedContents.length }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
});
