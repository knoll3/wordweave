import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import AdminPage from "./pages/AdminPage";
import CachePage from "./pages/CachePage";
import ClustersPage from "./pages/ClustersPage";
import FeedbackPage from "./pages/FeedbackPage";
import PromptsPage from "./pages/PromptsPage";
import "./styles/core.css";
import "./styles/graph.css";
import "./styles/journal.css";
import "./styles/layout.css";
import "./styles/pages.css";

const pathname = window.location.pathname;
const Page =
  pathname === "/admin"
    ? AdminPage
    : pathname === "/cache"
    ? CachePage
    : pathname === "/clusters"
      ? ClustersPage
      : pathname === "/feedback"
        ? FeedbackPage
      : pathname === "/prompts"
        ? PromptsPage
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
