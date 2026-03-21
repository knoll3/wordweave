import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CachePage from "./pages/CachePage";
import ClustersPage from "./pages/ClustersPage";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

const pathname = window.location.pathname;
const Page =
  pathname === "/cache"
    ? CachePage
    : pathname === "/clusters"
      ? ClustersPage
      : App;

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Page />
    </ErrorBoundary>
  </React.StrictMode>
);
