import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getDb } from "./db";
import recipesRouter from "./routes/recipes";
import elementsRouter from "./routes/elements";

// Load .env from the monorepo root
dotenv.config({
  path: path.resolve(__dirname, "..", "..", "..", ".env"),
});

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);
app.use(express.json());

app.use("/api/recipes", recipesRouter);
app.use("/api/elements", elementsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 4000;

getDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`API server listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
