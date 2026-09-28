import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchMercadoLivre } from "../_shared/mlClient.ts";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const keywords = ["smartwatch", "celular", "notebook", "air fryer", "fone bluetooth"];
    const allProcessedOffers = [];

    for (const term of keywords) {
      try {
        const data = await fetchMercadoLivre(`/sites/MLB/search?q=${encodeURIComponent(term)}&limit=5`);
        const results = data.results || [];

        for (const item of results) {
          const originalPrice = item.original_price || item.price;
          const currentPrice = item.price;
          const discount = originalPrice > currentPrice 
            ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) 
            : 0;

          const offerData = {
            platform_code: 'mercadolivre',
            external_id: item.id,
            title: item.title,
            original_price: originalPrice,
            current_price: currentPrice,
            discount_percentage: discount,
            image_url: item.thumbnail?.replace('I.jpg', 'O.jpg') || item.thumbnail,
            original_url: item.permalink,
            category: item.category_id,
            is_selected: discount >= 10
          };

          const { data: savedOffer } = await supabase
            .from('offers')
            .upsert(offerData, { onConflict: 'platform_code,external_id' })
            .select()
            .single();

          if (savedOffer) allProcessedOffers.push(savedOffer);
        }
      } catch (err) {
        console.error(`Erro ao buscar palavra-chave ${term}:`, err.message);
      }
    }

    if (allProcessedOffers.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "Nenhum produto foi retornado pelo Mercado Livre." 
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      count: allProcessedOffers.length, 
      offers: allProcessedOffers 
    }), { headers: { "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
