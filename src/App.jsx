import { useEffect, useState } from "react";
import { supabase } from "./supabase";

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

  const [ofertas, setOfertas] = useState([]);
  const [plataformas, setPlataformas] = useState([]);
  const [carregandoOfertas, setCarregandoOfertas] = useState(false);
  const [mensagemOferta, setMensagemOferta] = useState("");

  const [mostrarNovaOferta, setMostrarNovaOferta] = useState(false);

  const [novaOferta, setNovaOferta] = useState({
    titulo: "",
    plataforma: "",
    precoAtual: "",
    precoAnterior: "",
    desconto: "",
    comissaoPercentual: "",
    comissaoEstimada: "",
    urlProduto: "",
    imagemUrl: "",
    classificacao: "verificar"
  });

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

  useEffect(() => {
    if (usuario) {
      carregarDados();
    }
  }, [usuario]);

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

  async function carregarDados() {
    await Promise.all([
      carregarPlataformas(),
      carregarOfertas()
    ]);
  }

  async function carregarPlataformas() {
    const resultado = await supabase
      .from("platforms")
      .select("id, nome, tipo, ativo")
      .eq("ativo", true)
      .order("nome");

    if (resultado.error) {
      console.error(resultado.error);
      return;
    }

    setPlataformas(resultado.data || []);
  }

  async function carregarOfertas() {
    setCarregandoOfertas(true);
    setMensagemOferta("");

    const resultado = await supabase
      .from("offers")
      .select(`
        id,
        titulo,
        product_external_id,
        url_produto,
        preco_atual,
        preco_anterior,
        desconto_percentual,
        comissao_percentual,
        comissao_estimada,
        moeda,
        disponibilidade,
        classificacao,
        permitido_afiliado,
        permitido_divulgacao,
        imagem_url,
        encontrada_em,
        atualizada_em,
        created_at,
        platform_id,
        platforms (
          id,
          nome
        )
      `)
      .order("created_at", { ascending: false });

    if (resultado.error) {
      console.error(resultado.error);
      setMensagemOferta(
        "Nao foi possivel carregar as ofertas."
      );
      setCarregandoOfertas(false);
      return;
    }

    setOfertas(resultado.data || []);
    setCarregandoOfertas(false);
  }

  function atualizarNovaOferta(campo, valor) {
    setNovaOferta((anterior) => ({
      ...anterior,
      [campo]: valor
    }));
  }

  function converterNumero(valor) {
    if (valor === "" || valor === null || valor === undefined) {
      return null;
    }

    const numero = Number(
      String(valor)
        .replace(/\./g, "")
        .replace(",", ".")
    );

    return Number.isFinite(numero) ? numero : null;
  }

  async function salvarOferta(event) {
    event.preventDefault();
    setMensagemOferta("");

    if (!novaOferta.titulo.trim()) {
      setMensagemOferta("Digite o nome da oferta.");
      return;
    }

    if (!novaOferta.plataforma) {
      setMensagemOferta("Selecione a plataforma.");
      return;
    }

    const precoAtual = converterNumero(
      novaOferta.precoAtual
    );

    const precoAnterior = converterNumero(
      novaOferta.precoAnterior
    );

    const desconto = converterNumero(
      novaOferta.desconto
    );

    const comissaoPercentual = converterNumero(
      novaOferta.comissaoPercentual
    );

    const comissaoEstimada = converterNumero(
      novaOferta.comissaoEstimada
    );

    const plataformaSelecionada = plataformas.find(
      (plataforma) =>
        plataforma.id === novaOferta.plataforma
    );

    const dadosOferta = {
      user_id: usuario.id,
      platform_id: plataformaSelecionada.id,
      titulo: novaOferta.titulo.trim(),
      url_produto:
        novaOferta.urlProduto.trim() || null,
      preco_atual: precoAtual,
      preco_anterior: precoAnterior,
      desconto_percentual: desconto,
      comissao_percentual: comissaoPercentual,
      comissao_estimada: comissaoEstimada,
      moeda: "BRL",
      disponibilidade: true,
      classificacao: novaOferta.classificacao,
      permitido_afiliado: true,
      permitido_divulgacao: false,
      imagem_url:
        novaOferta.imagemUrl.trim() || null,
      encontrada_em: new Date().toISOString(),
      atualizada_em: new Date().toISOString()
    };

    const resultado = await supabase
      .from("offers")
      .insert(dadosOferta)
      .select(`
        id,
        titulo,
        product_external_id,
        url_produto,
        preco_atual,
        preco_anterior,
        desconto_percentual,
        comissao_percentual,
        comissao_estimada,
        moeda,
        disponibilidade,
        classificacao,
        permitido_afiliado,
        permitido_divulgacao,
        imagem_url,
        encontrada_em,
        atualizada_em,
        created_at,
        platform_id,
        platforms (
          id,
          nome
        )
      `)
      .single();

    if (resultado.error) {
      console.error(resultado.error);
      setMensagemOferta(
        "Nao foi possivel salvar a oferta."
      );
      return;
    }

    setOfertas((anteriores) => [
      resultado.data,
      ...anteriores
    ]);

    setNovaOferta({
      titulo: "",
      plataforma: "",
      precoAtual: "",
      precoAnterior: "",
      desconto: "",
      comissaoPercentual: "",
      comissaoEstimada: "",
      urlProduto: "",
      imagemUrl: "",
      classificacao: "verificar"
    });

    setMostrarNovaOferta(false);
    setMensagemOferta("Oferta salva com sucesso.");
  }

  async function excluirOferta(id) {
    const confirmar = window.confirm(
      "Deseja excluir esta oferta?"
    );

    if (!confirmar) {
      return;
    }

    const resultado = await supabase
      .from("offers")
      .delete()
      .eq("id", id)
      .eq("user_id", usuario.id);

    if (resultado.error) {
      console.error(resultado.error);
      setMensagemOferta(
        "Nao foi possivel excluir a oferta."
      );
      return;
    }

    setOfertas((anteriores) =>
      anteriores.filter(
        (oferta) => oferta.id !== id
      )
    );

    setMensagemOferta("Oferta excluida.");
  }

  async function alterarClassificacao(
    id,
    classificacao
  ) {
    const resultado = await supabase
      .from("offers")
      .update({
        classificacao,
        atualizada_em: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", usuario.id)
      .select(`
        id,
        titulo,
        product_external_id,
        url_produto,
        preco_atual,
        preco_anterior,
        desconto_percentual,
        comissao_percentual,
        comissao_estimada,
        moeda,
        disponibilidade,
        classificacao,
        permitido_afiliado,
        permitido_divulgacao,
        imagem_url,
        encontrada_em,
        atualizada_em,
        created_at,
        platform_id,
        platforms (
          id,
          nome
        )
      `)
      .single();

    if (resultado.error) {
      console.error(resultado.error);
      return;
    }

    setOfertas((anteriores) =>
      anteriores.map((oferta) =>
        oferta.id === id
          ? resultado.data
          : oferta
      )
    );
  }

  async function entrar(event) {
    event.preventDefault();
    setMensagemLogin("");

    if (!email.trim() || !senha) {
      setMensagemLogin(
        "Digite seu e-mail e sua senha."
      );
      return;
    }

    const resultado =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha
      });

    if (resultado.error) {
      console.error(resultado.error);
      setMensagemLogin(
        "E-mail ou senha incorretos."
      );
      return;
    }

    setMensagemLogin("");
  }

  async function criarConta(event) {
    event.preventDefault();
    setMensagemLogin("");

    if (!email.trim() || !senha) {
      setMensagemLogin(
        "Digite seu e-mail e crie uma senha."
      );
      return;
    }

    if (senha.length < 6) {
      setMensagemLogin(
        "A senha precisa ter pelo menos 6 caracteres."
      );
      return;
    }

    const resultado =
      await supabase.auth.signUp({
        email: email.trim(),
        password: senha
      });

    if (resultado.error) {
      console.error(resultado.error);
      setMensagemLogin(
        "Nao foi possivel criar a conta."
      );
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
    setOfertas([]);
  }

  function formatarMoeda(valor) {
    if (
      valor === null ||
      valor === undefined ||
      valor === ""
    ) {
      return "R$ 0,00";
    }

    return Number(valor).toLocaleString(
      "pt-BR",
      {
        style: "currency",
        currency: "BRL"
      }
    );
  }

  const menu = [
    ["inicio", "Inicio"],
    ["ofertas", "Ofertas"],
    ["conteudo", "Conteudo"],
    ["resultados", "Resultados"],
    ["config", "Config"]
  ];

  const ofertasInteressantes =
    ofertas.filter(
      (oferta) =>
        oferta.classificacao === "interessante"
    ).length;

  const ofertasRevisao =
    ofertas.filter(
      (oferta) =>
        oferta.classificacao === "verificar"
    ).length;

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
                    setEmail(
                      event.target.value
                    )
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
                    setSenha(
                      event.target.value
                    )
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

              {supabaseStatus ===
                "conectado" && (
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
                <span>
                  Ofertas cadastradas
                </span>
                <strong>
                  {ofertas.length}
                </strong>
              </div>

              <div className="card">
                <span>
                  Aguardando revisao
                </span>
                <strong>
                  {ofertasRevisao}
                </strong>
              </div>

              <div className="card">
                <span>
                  Ofertas interessantes
                </span>
                <strong>
                  {ofertasInteressantes}
                </strong>
              </div>

              <div className="card">
                <span>Cliques</span>
                <strong>0</strong>
              </div>
            </div>

            <div className="panel">
              <h3>
                Ofertas em destaque
              </h3>

              {ofertasInteressantes ===
                0 && (
                <p>
                  Nenhuma oferta interessante
                  cadastrada ainda.
                </p>
              )}

              {ofertas
                .filter(
                  (oferta) =>
                    oferta.classificacao ===
                    "interessante"
                )
                .slice(0, 5)
                .map((oferta) => (
                  <div
                    className="offer"
                    key={oferta.id}
                  >
                    <div className="offer-image">
                      {oferta.imagem_url
                        ? "IMG"
                        : "Oferta"}
                    </div>

                    <div className="offer-info">
                      <h3>
                        {oferta.titulo}
                      </h3>

                      <p>
                        {oferta.platforms?.nome ||
                          "Plataforma"}
                      </p>

                      <strong>
                        {formatarMoeda(
                          oferta.preco_atual
                        )}
                      </strong>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}

        {pagina === "ofertas" && (
          <>
            <h2>Ofertas</h2>

            <div className="panel">
              <button
                className="primary"
                onClick={() => {
                  setMostrarNovaOferta(
                    !mostrarNovaOferta
                  );
                  setMensagemOferta("");
                }}
              >
                {mostrarNovaOferta
                  ? "FECHAR"
                  : "+ NOVA OFERTA"}
              </button>
            </div>

            {mensagemOferta && (
              <div className="panel">
                <p>{mensagemOferta}</p>
              </div>
            )}

            {mostrarNovaOferta && (
              <div className="panel">
                <h3>
                  Cadastrar nova oferta
                </h3>

                <form
                  onSubmit={salvarOferta}
                >
                  <label>
                    Produto / titulo

                    <input
                      value={
                        novaOferta.titulo
                      }
                      onChange={(event) =>
                        atualizarNovaOferta(
                          "titulo",
                          event.target.value
                        )
                      }
                      placeholder="Ex.: Fritadeira Air Fryer"
                    />
                  </label>

                  <label>
                    Plataforma

                    <select
                      value={
                        novaOferta.plataforma
                      }
                      onChange={(event) =>
                        atualizarNovaOferta(
                          "plataforma",
                          event.target.value
                        )
                      }
                    >
                      <option value="">
                        Selecione
                      </option>

                      {plataformas
                        .filter(
                          (plataforma) =>
                            plataforma.tipo ===
                              "afiliado" ||
                            plataforma.tipo ===
                              "ambos"
                        )
                        .map(
                          (plataforma) => (
                            <option
                              key={
                                plataforma.id
                              }
                              value={
                                plataforma.id
                              }
                            >
                              {
                                plataforma.nome
                              }
                            </option>
                          )
                        )}
                    </select>
                  </label>

                  <label>
                    Preco atual

                    <input
                      inputMode="decimal"
                      value={
                        novaOferta.precoAtual
                      }
                      onChange={(event) =>
                        atualizarNovaOferta(
                          "precoAtual",
                          event.target.value
                        )
                      }
