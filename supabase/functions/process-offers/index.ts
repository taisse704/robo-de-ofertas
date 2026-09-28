import { corsHeaders } from '../_shared/cors.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const keywords = ["celular", "smartwatch", "notebook", "fone bluetooth"];
    const allProcessedOffers = [];

    for (const term of keywords) {
      try {
        const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(term)}&sort=relevance&limit=10`;
        
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          }
        });

        if (!response.ok) {
          console.error(`Erro status ${response.status} para ${term}`);
          continue;
        }

        const data = await response.json();
        const results = data.results || [];

        for (const item of results) {
          const originalPrice = item.original_price || item.price;
          const currentPrice = item.price;
          const discount = originalPrice > currentPrice 
            ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) 
            : 0;

          const offerData = {
            platform_code: 'mercadolivre',
            external_id: String(item.id),
            title: item.title,
            original_price: Number(originalPrice),
            current_price: Number(currentPrice),
            discount_percentage: Number(discount),
            image_url: item.thumbnail ? item.thumbnail.replace('http://', 'https://').replace('I.jpg', 'O.jpg') : '',
            original_url: item.permalink,
            category: item.category_id || 'geral',
            is_selected: discount >= 5
          };

          const { data: savedOffer } = await supabase
            .from('offers')
            .upsert(offerData, { onConflict: 'platform_code,external_id' })
            .select()
            .single();

          if (savedOffer) allProcessedOffers.push(savedOffer);
        }
      } catch (err) {
        console.error(`Erro no termo ${term}:`, err.message);
      }
    }

    if (allProcessedOffers.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "Nenhum produto foi retornado pelo Mercado Livre." 
      }), { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      count: allProcessedOffers.length, 
      offers: allProcessedOffers 
    }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
