import { useState } from "react";

const ofertasExemplo = [
  {
    id: 1,
    produto: "Oferta de exemplo",
    plataforma: "Shopee",
    preco: "R$ 0,00",
    desconto: "0%",
    comissao: "R$ 0,00"
  }
];

export default function App() {
  const [pagina, setPagina] = useState("inicio");
  const [pausado, setPausado] = useState(false);

  const menu = [
    ["inicio", "🏠", "Início"],
    ["ofertas", "🔎", "Ofertas"],
    ["conteudo", "🎬", "Conteúdo"],
    ["resultados", "📊", "Resultados"],
    ["config", "⚙️", "Config"]
  ];

  return (
    <div className="app">
      <header>
        <div>
          <h1>ROBÔ DE OFERTAS</h1>
          <p className={pausado ? "status pausado" : "status"}>
            ● {pausado ? "Robô pausado" : "Robô ativo"}
          </p>
        </div>

        <button
          className="pause"
          onClick={() => setPausado(!pausado)}
        >
          {pausado ? "▶ CONTINUAR" : "🛑 PAUSAR ROBÔ"}
        </button>
      </header>

      <main>
        {pagina === "inicio" && (
          <>
            <h2>Início</h2>

            <div className="cards">
              <div className="card">
                <span>Ofertas encontradas</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Aguardando revisão</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Publicações</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Cliques</span>
                <strong>0</strong>
              </div>
            </div>

            <div className="panel">
              <h3>Ofertas em destaque</h3>
              <p>Nenhuma oferta encontrada ainda.</p>
            </div>
          </>
        )}

        {pagina === "ofertas" && (
          <>
            <h2>Ofertas</h2>

            <div className="filters">
              <input placeholder="🔎 Procurar produto" />
              <select>
                <option>Todas as plataformas</option>
                <option>Shopee</option>
                <option>Mercado Livre</option>
                <option>Magalu</option>
                <option>TikTok Shop</option>
              </select>
            </div>

            {ofertasExemplo.map((oferta) => (
              <div className="offer" key={oferta.id}>
                <div className="offer-image">🛍️</div>

                <div className="offer-info">
                  <h3>{oferta.produto}</h3>
                  <p>{oferta.plataforma}</p>
                  <strong>{oferta.preco}</strong>
                  <span>{oferta.desconto} de desconto</span>
                  <small>Comissão estimada: {oferta.comissao}</small>
                </div>

                <button className="secondary">
                  Criar conteúdo
                </button>
              </div>
            ))}
          </>
        )}

        {pagina === "conteudo" && (
          <>
            <h2>Conteúdo</h2>

            <div className="panel">
              <h3>Criar conteúdo</h3>

              <label>
                Tipo de vídeo
                <select>
                  <option>Oferta rápida</option>
                  <option>Oferta + cupom</option>
                  <option>Problema → solução</option>
                  <option>Benefícios</option>
                  <option>Lista</option>
                </select>
              </label>

              <label>
                Duração
                <select>
                  <option>15 segundos</option>
                  <option>20 segundos</option>
                  <option>30 segundos</option>
                </select>
              </label>

              <label>
                Narração
                <select>
                  <option>Sem voz</option>
                  <option>Voz feminina</option>
                  <option>Voz masculina</option>
                </select>
              </label>

              <button className="primary">
                🎬 Criar conteúdo
              </button>
            </div>
          </>
        )}

        {pagina === "resultados" && (
          <>
            <h2>Resultados</h2>

            <div className="cards">
              <div className="card">
                <span>Visualizações</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Cliques</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Vendas</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Comissão</span>
                <strong>R$ 0,00</strong>
              </div>
            </div>

            <div className="panel">
              <h3>Desempenho por canal</h3>
              <p>Instagram: 0 cliques</p>
              <p>YouTube Shorts: 0 cliques</p>
              <p>WhatsApp: 0 cliques</p>
              <p>TikTok: 0 cliques</p>
            </div>
          </>
        )}

        {pagina === "config" && (
          <>
            <h2>Configurações</h2>

            <div className="panel">
              <h3>Automação</h3>

              <label>
                <span>Aprovação antes de publicar</span>
                <input type="checkbox" defaultChecked />
              </label>

              <label>
                <span>Modo automático</span>
                <input type="checkbox" />
              </label>

              <label>
                <span>Instagram</span>
                <input type="checkbox" />
              </label>

              <label>
                <span>YouTube Shorts</span>
                <input type="checkbox" />
              </label>

              <label>
                <span>WhatsApp</span>
                <input type="checkbox" />
              </label>

              <label>
                <span>TikTok</span>
                <input type="checkbox" />
              </label>
            </div>
          </>
        )}
      </main>

      <nav>
        {menu.map(([id, icone, nome]) => (
          <button
            key={id}
            className={pagina === id ? "ativo" : ""}
            onClick={() => setPagina(id)}
          >
            <span>{icone}</span>
            <small>{nome}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
