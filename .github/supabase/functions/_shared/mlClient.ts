export async function fetchMercadoLivre(endpoint: string, accessToken?: string) {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'VendasrobiApp/1.0 (suporte@vendasrobi.com.br)',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`https://api.mercadolibre.com${endpoint}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[Mercado Livre Error ${response.status}]: ${errorText}`);
  }

  return await response.json();
}
