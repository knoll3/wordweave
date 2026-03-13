import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CachePage from "./pages/CachePage";
import "./styles.css";

const pathname = window.location.pathname;
const Page = pathname === "/cache" ? CachePage : App;

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
);
