# Robô de Ofertas — Gerador automático de links Mercado Livre

Esta extensão é a ponte entre o Robô de Ofertas e o Portal de Afiliados do Mercado Livre.

## Como funciona

1. O Robô identifica ofertas do Mercado Livre sem `affiliate_url`.
2. A página do Robô envia a fila para a extensão.
3. A extensão usa uma aba do Mercado Livre em que a conta de afiliado já está logada.
4. A chamada interna do próprio Portal gera/reaproveita o `https://meli.la/...`.
5. O link volta para o Robô.
6. O Robô chama a Edge Function `affiliate-link`, grava o link e libera a oferta para publicação.

A extensão não lê nem armazena cookies. O navegador envia a sessão automaticamente para o Mercado Livre na chamada feita dentro da página do próprio domínio.

## Instalação

No Chrome/Edge:

1. Abra `chrome://extensions` (Chrome) ou `edge://extensions`.
2. Ative Modo do desenvolvedor.
3. Clique em Carregar sem compactação.
4. Selecione esta pasta `mercado-livre-affiliate-extension`.
5. Abra/atualize o Robô de Ofertas.
6. Mantenha a conta de afiliado do Mercado Livre logada no navegador.

Depois disso, o fluxo é automático. Não é necessário copiar links individualmente.

## Segurança

- Nenhuma senha ou cookie é salvo pela extensão.
- A extensão só conversa com o Robô de Ofertas e com mercadolivre.com.br.
- A geração usa a mesma sessão já autenticada no Portal de Afiliados.
- O endpoint de geração é interno do Portal do Mercado Livre, não uma API pública documentada. Se o Mercado Livre alterar esse endpoint, a ponte precisará ser atualizada.
