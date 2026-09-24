import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
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
          {pausado ? "▶ CONTINUAR" : "🛑 PAUSAR"}
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
            <div className="panel">
              <p>As ofertas das plataformas aparecerão aqui.</p>
            </div>
          </>
        )}

        {pagina === "conteudo" && (
          <>
            <h2>Conteúdo</h2>
            <div className="panel">
              <p>Aqui serão criados os vídeos e legendas.</p>
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
          </>
        )}

        {pagina === "config" && (
          <>
            <h2>Configurações</h2>
            <div className="panel">
              <h3>Automação</h3>

              <label>
                <span>Exigir aprovação antes de publicar</span>
                <input type="checkbox" defaultChecked />
              </label>

              <label>
                <span>Modo automático</span>
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

createRoot(document.getElementById("root")).render(<App />);
