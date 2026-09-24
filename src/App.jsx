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
  const [pagina, setPagina] = useState("inicio");
  const [pausado, setPausado] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState("testando");
  const [mensagemSupabase, setMensagemSupabase] = useState("");

  async function testarSupabase() {
    setSupabaseStatus("testando");
    setMensagemSupabase("");

    try {
      const { error } = await supabase.auth.getSession();

      if (error) {
        throw error;
      }

      setSupabaseStatus("conectado");
      setMensagemSupabase("Supabase conectado corretamente.");
    } catch (error) {
      console.error(error);
      setSupabaseStatus("
