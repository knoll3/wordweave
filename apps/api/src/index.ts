import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getDb } from "./db";
import recipesRouter from "./routes/recipes";
import elementsRouter from "./routes/elements";
import questsRouter from "./routes/quests";
import promptsRouter from "./routes/prompts";

// Load .env from the monorepo root
dotenv.config({
  path: path.resolve(__dirname, "..", "..", "..", ".env"),
});

const app = express();

const clientPort = process.env.CLIENT_PORT ? Number(process.env.CLIENT_PORT) : 5173;
const allowedOrigins = new Set([
  `http://localhost:${clientPort}`,
  `http://127.0.0.1:${clientPort}`,
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      try {
        const url = new URL(origin);
        const isLocalNetworkHost =
          url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "::1" ||
          /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
          /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
          /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(url.hostname);

        if (allowedOrigins.has(origin) || (isLocalNetworkHost && url.port === String(clientPort))) {
          callback(null, true);
          return;
        }
      } catch {
        // Fall through to the rejection path below.
      }

      callback(new Error(`CORS blocked for origin ${origin}`));
    },
  })
);
app.use(express.json());

app.use("/api/recipes", recipesRouter);
app.use("/api/elements", elementsRouter);
app.use("/api/quests", questsRouter);
app.use("/api/prompts", promptsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 4000;
const host = process.env.API_BIND_HOST || "0.0.0.0";

getDb()
  .then(() => {
    app.listen(port, host, () => {
      console.log(`API server listening on http://${host}:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
