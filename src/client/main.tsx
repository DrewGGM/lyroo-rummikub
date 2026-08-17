import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/archivo";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/tile.css";
import "./styles/table.css";
import "./styles/home.css";

import { App } from "./App";

const mount = document.getElementById("mesa");
if (!mount) throw new Error("Falta el contenedor #mesa en el documento.");

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
