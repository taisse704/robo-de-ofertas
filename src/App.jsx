import { useEffect, useState } from "react";
import { supabase } from "./supabase";

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
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const [modoLogin, setModoLogin] = useState("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagemLogin, setMensagemLogin] = useState("");

  const [pagina, setPagina] = useState("inicio");
  const [pausado, setPausado] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState("testando");

  useEffect(() => {
    verificarSessao();

    const authListener = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUsuario(session?.user || null);
        setCarregando(false);
      }
    );

    return () => {
      authListener.data.subscription.unsubscribe();
    };
  }, []);

  async function verificarSessao() {
    try {
      const resultado = await supabase.auth.getSession();

      if (resultado.error) {
        throw resultado.error;
      }

      setUsuario(resultado.data.session?.user || null);
      setSupabaseStatus("conectado");
    } catch (error) {
      console.error(error);
      setSupabaseStatus("erro");
    } finally {
      setCarregando(false);
    }
  }

  async function entrar(event) {
    event.preventDefault();
    setMensagemLogin("");

    if (!email.trim() || !senha) {
      setMensagemLogin("Digite seu e-mail e sua senha.");
      return;
    }

    const resultado = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha
    });

    if (resultado.error) {
      console.error(resultado.error);
      setMensagemLogin("E-mail ou senha incorretos.");
      return;
    }

    setMensagemLogin("");
  }

  async function criarConta(event) {
    event.preventDefault();
    setMensagemLogin("");

    if (!email.trim() || !senha) {
      setMensagemLogin("Digite seu e-mail e crie uma senha.");
      return;
    }

    if (senha.length < 6) {
      setMensagemLogin("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    const resultado = await supabase.auth.signUp({
      email: email.trim(),
      password: senha
    });

    if (resultado.error) {
      console.error(resultado.error);
      setMensagemLogin("Nao foi possivel criar a conta.");
      return;
    }

    if (resultado.data.session) {
      setMensagemLogin("");
    } else {
      setMensagemLogin(
        "Conta criada. Verifique seu e-mail para confirmar."
      );
    }
  }

  async function sair() {
    await supabase.auth.signOut();
    setUsuario(null);
    setPagina("inicio");
    setEmail("");
    setSenha("");
  }

  const menu = [
    ["inicio", "Inicio"],
    ["ofertas", "Ofertas"],
    ["conteudo", "Conteudo"],
    ["resultados", "Resultados"],
    ["config", "Config"]
  ];

  if (carregando) {
    return (
      <div className="app">
        <main>
          <div className="panel">
            <h1>ROBO DE OFERTAS</h1>
            <p>Carregando...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!usuario) {
    return (
      <div className="app">
        <main>
          <div className="panel login">
            <h1>ROBO DE OFERTAS</h1>

            <p>
              {modoLogin === "entrar"
                ? "Entre na sua conta"
                : "Crie sua conta"}
            </p>

            <form
              onSubmit={
                modoLogin === "entrar"
                  ? entrar
                  : criarConta
              }
            >
              <label>
                E-mail

                <input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  placeholder="seu@email.com"
                />
              </label>

              <label>
                Senha

                <input
                  type="password"
                  value={senha}
                  onChange={(event) =>
                    setSenha(event.target.value)
                  }
                  placeholder="Minimo 6 caracteres"
                />
              </label>

              {mensagemLogin && (
                <p>{mensagemLogin}</p>
              )}

              <button
                className="primary"
                type="submit"
              >
                {modoLogin === "entrar"
                  ? "ENTRAR"
                  : "CRIAR CONTA"}
              </button>
            </form>

            <button
              className="secondary"
              onClick={() => {
                setMensagemLogin("");

                setModoLogin(
                  modoLogin === "entrar"
                    ? "criar"
                    : "entrar"
                );
              }}
            >
              {modoLogin === "entrar"
                ? "Criar uma conta"
                : "Ja tenho uma conta"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>ROBO DE OFERTAS</h1>

          <p
            className={
              pausado
                ? "status pausado"
                : "status"
            }
          >
            {pausado
              ? "Robo pausado"
              : "Robo ativo"}
          </p>
        </div>

        <button
          className="pause"
          onClick={() =>
            setPausado(!pausado)
          }
        >
          {pausado
            ? "CONTINUAR"
            : "PAUSAR ROBO"}
        </button>
      </header>

      <main>
        {pagina === "inicio" && (
          <>
            <h2>Inicio</h2>

            <div className="panel">
              <h3>Conta</h3>
              <p>{usuario.email}</p>

              <button
                className="secondary"
                onClick={sair}
              >
                Sair
              </button>
            </div>

            <div className="panel">
              <h3>Conexao com a nuvem</h3>

              {supabaseStatus === "conectado" && (
                <p className="status">
                  Supabase conectado
                </p>
              )}

              {supabaseStatus === "erro" && (
                <p className="status pausado">
                  Erro na conexao
                </p>
              )}
            </div>

            <div className="cards">
              <div className="card">
                <span>Ofertas encontradas</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Aguardando revisao</span>
                <strong>0</strong>
              </div>

              <div className="card">
                <span>Publicacoes</span>
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
              <input
                placeholder="Procurar produto"
              />

              <select>
                <option>
                  Todas as plataformas
                </option>
                <option>Shopee</option>
                <option>Mercado Livre</option>
                <option>Magalu</option>
                <option>TikTok Shop</option>
              </select>
            </div>

            {ofertasExemplo.map((oferta) => (
              <div
                className="offer"
                key={oferta.id}
              >
                <div className="offer-image">
                  Oferta
                </div>

                <div className="offer-info">
                  <h3>{oferta.produto}</h3>
                  <p>{oferta.plataforma}</p>
                  <strong>{oferta.preco}</strong>

                  <span>
                    {oferta.desconto} de desconto
                  </span>

                  <small>
                    Comissao estimada:{" "}
                    {oferta.comissao}
                  </small>
                </div>

                <button className="secondary">
                  Criar conteudo
                </button>
              </div>
            ))}
          </>
        )}

        {pagina === "conteudo" && (
          <>
            <h2>Conteudo</h2>

            <div className="panel">
              <h3>Criar conteudo</h3>

              <label>
                Tipo de video

                <select>
                  <option>Oferta rapida</option>
                  <option>Oferta + cupom</option>
                  <option>
                    Problema para solucao
                  </option>
                  <option>Beneficios</option>
                  <option>Lista</option>
                </select>
              </label>

              <label>
                Duracao

                <select>
                  <option>15 segundos</option>
                  <option>20 segundos</option>
                  <option>30 segundos</option>
                </select>
              </label>

              <label>
                Narracao

                <select>
                  <option>Sem voz</option>
                  <option>Voz feminina</option>
                  <option>Voz masculina</option>
                </select>
              </label>

              <button className="primary">
                Criar conteudo
              </button>
            </div>
          </>
        )}

        {pagina === "resultados" && (
          <>
            <h2>Resultados</h2>

            <div className="cards">
              <div className="card">
                <span>Visualizacoes</span>
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
                <span>Comissao</span>
                <strong>R$ 0,00</strong>
              </div>
            </div>

            <div className="panel">
              <h3>Desempenho por canal</h3>

              <p>
                Instagram: 0 cliques
              </p>

              <p>
                YouTube Shorts: 0 cliques
              </p>

              <p>
                WhatsApp: 0 cliques
              </p>

              <p>
                TikTok: 0 cliques
              </p>
            </div>
          </>
        )}

        {pagina === "config" && (
          <>
            <h2>Configuracoes</h2>

            <div className="panel">
              <h3>Automacao</h3>

              <label>
                <span>
                  Aprovacao antes de publicar
                </span>

                <input
                  type="checkbox"
                  defaultChecked
                />
              </label>

              <label>
                <span>Modo automatico</span>

                <input
                  type="checkbox"
                />
              </label>

              <label>
                <span>Instagram</span>

                <input
                  type="checkbox"
                />
              </label>

              <label>
                <span>YouTube Shorts</span>

                <input
                  type="checkbox"
                />
              </label>

              <label>
                <span>WhatsApp</span>

                <input
                  type="checkbox"
                />
              </label>

              <label>
                <span>TikTok</span>

                <input
                  type="checkbox"
                />
              </label>
            </div>

            <div className="panel">
              <h3>Conta</h3>

              <p>{usuario.email}</p>

              <button
                className="secondary"
                onClick={sair}
              >
                Sair da conta
              </button>
            </div>
          </>
        )}
      </main>

      <nav>
        {menu.map(([id, nome]) => (
          <button
            key={id}
            className={
              pagina === id
                ? "ativo"
                : ""
            }
            onClick={() =>
              setPagina(id)
            }
          >
            <span>
              {id === "inicio" && "🏠"}
              {id === "ofertas" && "🔎"}
              {id === "conteudo" && "🎬"}
              {id === "resultados" && "📊"}
              {id === "config" && "⚙️"}
            </span>

            <small>{nome}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
