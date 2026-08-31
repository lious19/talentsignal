import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
// Self-hosted via @fontsource/inter (bundled woff2, zero external network
// request at runtime) rather than a Google Fonts <link> — approved for demo
// reliability. Only the weights theme.css actually uses.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
