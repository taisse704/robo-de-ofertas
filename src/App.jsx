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

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUsuario(session?.user ?? null);
      setCarregando(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function verificarSessao() {
    try {
      const {
        data: { session },
        error
      } = await supabase.auth.getSession();

      if (error) {
        throw error;
      }

      setUsuario(session?.user ?? null);
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

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha
    });

    if (error) {
      setMensagemLogin(
        "Não foi possível entrar. Verifique o e-mail e a senha."
      );
      console.error(error);
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

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha
    });

    if (error) {
      setMensagemLogin(
        "Não foi possível criar a conta. Verifique os dados."
      );
      console.error(error);
      return;
    }

    if (data.session) {
      setMensagemLogin("");
    } else {
      setMensagemLogin(
        "Conta criada. Verifique seu e-mail para confirmar a conta."
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
    ["inicio", "🏠", "Início"],
    ["ofertas", "🔎", "Ofertas"],
    ["conteudo", "🎬", "Conteúdo"],
    ["resultados", "📊", "Resultados"],
    ["config", "⚙️", "Config"]
  ];

  if (carregando) {
    return (
      <div className="app">
        <main>
          <div className="panel">
            <h1>ROBÔ DE OFERTAS</h1>
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
            <h1>ROBÔ DE OFERTAS</h1>

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
                  autoComplete="email"
                />
              </label>

              <label>
                Senha

                <input
                  type="password"
                  value={
