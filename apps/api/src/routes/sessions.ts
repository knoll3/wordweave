import express from "express";
import { z } from "zod";
import { getDb, persistDatabase } from "../db";
import {
  createSession,
  getSession,
  isValidSessionId,
  listSessionsById,
  updateWorld,
  visitWorld,
  listWorlds,
  getPlayer,
} from "../sessions";

const router = express.Router();

const createSessionRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  playerId: z.string().uuid().optional(),
});

const updateSessionRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  playerId: z.string().uuid().optional(),
  archived: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0);

const lookupSessionsRequestSchema = z.object({
  ids: z.array(z.string().min(1).max(80)).max(50),
});

router.get("/", async (req, res) => {
  const playerId = typeof req.query.playerId === "string" ? req.query.playerId : "";
  if (!isValidSessionId(playerId)) return res.status(400).json({ error: "Player id required" });
  try {
    const db = await getDb();
    if (!getPlayer(db, playerId)) return res.status(404).json({ error: "Player not found" });
    return res.json({ worlds: listWorlds(db, playerId, req.query.archived === "true") });
  } catch {
    return res.status(500).json({ error: "Failed to load worlds" });
  }
});

router.post("/:id/visit", async (req, res) => {
  const id = String(req.params.id);
  if (!isValidSessionId(id)) return res.status(400).json({ error: "Invalid world id" });
  try {
    const world = visitWorld(await getDb(), id);
    if (!world) return res.status(404).json({ error: "World not found" });
    return res.json(world);
  } catch {
    return res.status(500).json({ error: "Failed to open world" });
  }
});

router.post("/", async (req, res) => {
  const parsed = createSessionRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session request" });
  }

  try {
    const db = await getDb();
    if (parsed.data.playerId && !getPlayer(db, parsed.data.playerId)) return res.status(404).json({ error: "Player not found" });
    const session = createSession(db, parsed.data.name, parsed.data.playerId);
    persistDatabase(db);
    return res.json(session);
  } catch (err) {
    console.error("Error in POST /sessions", err);
    return res.status(500).json({ error: "Failed to create session" });
  }
});

router.post("/lookup", async (req, res) => {
  const parsed = lookupSessionsRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session lookup request" });
  }

  try {
    const db = await getDb();
    const sessions = listSessionsById(db, parsed.data.ids);
    persistDatabase(db);
    return res.json({ sessions });
  } catch (err) {
    console.error("Error in POST /sessions/lookup", err);
    return res.status(500).json({ error: "Failed to load sessions" });
  }
});

router.get("/:id", async (req, res) => {
  const sessionId = String(req.params.id ?? "");
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Invalid session id" });
  }

  try {
    const db = await getDb();
    const session = getSession(db, sessionId);
    persistDatabase(db);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    return res.json(session);
  } catch (err) {
    console.error("Error in GET /sessions/:id", err);
    return res.status(500).json({ error: "Failed to load session" });
  }
});

router.patch("/:id", async (req, res) => {
  const sessionId = String(req.params.id ?? "");
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Invalid session id" });
  }
  const parsed = updateSessionRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session update request" });
  }

  try {
    const db = await getDb();
    if (parsed.data.playerId && !getPlayer(db, parsed.data.playerId)) return res.status(404).json({ error: "Player not found" });
    const session = updateWorld(db, sessionId, parsed.data);
    if (!session) return res.status(404).json({ error: "World not found" });
    persistDatabase(db);
    return res.json(session);
  } catch (err) {
    console.error("Error in PATCH /sessions/:id", err);
    return res.status(500).json({ error: "Failed to update session" });
  }
});

export default router;
