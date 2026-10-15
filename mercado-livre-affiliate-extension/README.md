# Robô de Ofertas — Extensão única Shopee + Mercado Livre

A extensão reúne em um só pacote:
- captura de vídeos originais em anúncios da Shopee e do Mercado Livre;
- geração de links oficiais de afiliado do Mercado Livre pelo portal autenticado;
- comunicação com o aplicativo Robô de Ofertas.

## Instalação / atualização no Edge

1. Baixe o ZIP do repositório: https://github.com/taisse704/robo-de-ofertas/archive/refs/heads/main.zip
2. Extraia o ZIP em uma pasta permanente no computador.
3. Abra `edge://extensions`.
4. Ative **Modo do desenvolvedor**.
5. Se já existe uma versão desta extensão, remova a versão antiga ou use **Recarregar** depois de substituir os arquivos. Não mantenha duas cópias ativas ao mesmo tempo.
6. Clique em **Carregar sem compactação** e selecione a pasta `mercado-livre-affiliate-extension` que está dentro da pasta extraída.
7. Deixe a conta de afiliado do Mercado Livre conectada no Edge para a geração de links.
8. Abra/atualize o Robô de Ofertas.

## Como a captura funciona

A extensão reutiliza uma aba da Shopee ou do Mercado Livre que já esteja aberta e não cria abas automaticamente. Durante a captura, essa aba é navegada entre os anúncios selecionados e, ao terminar ou cancelar, a extensão tenta restaurar o endereço que estava aberto antes. A extensão nunca cria nem fecha abas. Se não houver uma aba de marketplace aberta, informa isso e interrompe a captura.

A captura procura vídeos nos elementos de vídeo, fontes de mídia e dados estruturados do anúncio, tanto na Shopee quanto no Mercado Livre. Players encontrados dentro de áreas identificadas como comentários, avaliações, feedback ou conteúdo UGC são ignorados. Dá preferência a arquivos de vídeo diretos. Fotos nunca são convertidas em vídeo. Um endereço `blob:` ou um manifesto HLS/DASH não é tratado como arquivo pronto para publicação no Instagram.

Alguns anúncios não expõem um arquivo direto: podem não ter vídeo, carregar a mídia por um player protegido, ou disponibilizar apenas uma transmissão temporária. Nesses casos, a extensão registra o motivo em vez de fingir que encontrou um vídeo válido. Isso evita publicar imagens ou URLs incompatíveis como se fossem vídeos.

## Links afiliados do Mercado Livre

O robô envia a oferta para a extensão, que usa uma aba do Mercado Livre com sessão já autenticada para chamar os endpoints internos do portal e devolver o link. A extensão não grava nem lê cookies e não salva senha.

O endpoint usado é interno do portal, não uma API pública documentada. Se o Mercado Livre alterar o portal, a geração de links pode precisar de manutenção.

## Limite importante

A versão reúne os dois marketplaces, mas a captura final depende de cada anúncio disponibilizar uma URL de vídeo acessível. Não é possível prometer que todos os anúncios tenham um arquivo extraível. A confirmação definitiva exige testar pelo menos um anúncio com vídeo de cada marketplace no navegador em que a extensão será usada.
