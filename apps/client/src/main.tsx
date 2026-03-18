import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CachePage from "./pages/CachePage";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

const pathname = window.location.pathname;
const Page = pathname === "/cache" ? CachePage : App;
const LAST_CLIENT_ERROR_STORAGE_KEY = "wordweave.last-client-error";

function persistClientError(error: unknown, extra?: Record<string, unknown>) {
  const normalized =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack ?? null,
        }
      : {
          name: typeof error,
          message: String(error),
          stack: null,
        };

  const payload = {
    ...normalized,
    extra: extra ?? null,
    capturedAt: new Date().toISOString(),
    pathname: window.location.pathname,
  };

  console.error("[client][crash]", payload);
  try {
    window.localStorage.setItem(
      LAST_CLIENT_ERROR_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // ignore storage failures
  }
}

window.addEventListener("error", (event) => {
  persistClientError(event.error ?? event.message, {
    type: "error",
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  persistClientError(event.reason, {
    type: "unhandledrejection",
  });
});

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <React.StrictMode>
    <ErrorBoundary
      onError={(error, errorInfo) =>
        persistClientError(error, {
          type: "react-error-boundary",
          componentStack: errorInfo.componentStack,
        })
      }
    >
      <Page />
    </ErrorBoundary>
  </React.StrictMode>
);
