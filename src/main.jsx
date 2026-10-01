import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

function OfferDedupGuard() {
  useEffect(() => {
    const normalize = (value) => String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const clean = () => {
      document.querySelectorAll(".panel").forEach((panel) => {
        const heading = panel.querySelector("h3")?.textContent || "";
        const isOffersPanel = /Ofertas cadastradas — (Shopee|Mercado Livre)/i.test(heading);
        if (!isOffersPanel) return;

        const seen = new Set();
        panel.querySelectorAll(":scope > .offer").forEach((card) => {
          const title = normalize(card.querySelector(".offer-info h3")?.textContent);
          const image = card.querySelector(".offer-image img")?.getAttribute("src") || "";
          const price = normalize(card.querySelector(".offer-info strong")?.textContent);
          const key = `${title}|${image}|${price}`;
          if (!title || seen.has(key)) {
            if (seen.has(key)) card.remove();
            return;
          }
          seen.add(key);
        });
      });
    };

    clean();
    const observer = new MutationObserver(clean);
    observer.observe(document.getElementById("root"), { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

function Root() {
  return (
    <React.StrictMode>
      <App />
      <OfferDedupGuard />
    </React.StrictMode>
  );
}

createRoot(document.getElementById("root")).render(<Root />);
