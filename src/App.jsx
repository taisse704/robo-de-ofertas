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
      setMensagemLogin("Não foi possível criar a conta.");
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
          <
