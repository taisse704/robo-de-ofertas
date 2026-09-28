import { corsHeaders } from '../_shared/cors.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  // Trata a requisição OPTIONS para o CORS funcionar no navegador
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const keywords = ["smartwatch", "celular", "notebook", "air fryer", "fone bluetooth"];
    const allProcessedOffers = [];

    for (const term of keywords) {
      try {
        // Usa o fetch direto sem passar token de autorização e adiciona User-Agent de navegador
        const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(term)}&limit=5`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!response.ok) {
          console.error(`Erro na requisição ML (${term}): Status ${response.status}`);
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
      }), { 
        status: 400, 
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
