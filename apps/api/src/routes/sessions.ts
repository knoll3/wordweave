import express from "express";
import { z } from "zod";
import { getDb, persistDatabase } from "../db";
import {
  createSession,
  getSession,
  isValidSessionId,
  listSessionsById,
  updateSessionName,
} from "../sessions";

const router = express.Router();

const createSessionRequestSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

const updateSessionRequestSchema = z.object({
  name: z.string().min(1).max(80),
});

const lookupSessionsRequestSchema = z.object({
  ids: z.array(z.string().min(1).max(80)).max(50),
});

router.post("/", async (req, res) => {
  const parsed = createSessionRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session request" });
  }

  try {
    const db = await getDb();
    const session = createSession(db, parsed.data.name);
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
    const session = updateSessionName(db, sessionId, parsed.data.name);
    persistDatabase(db);
    return res.json(session);
  } catch (err) {
    console.error("Error in PATCH /sessions/:id", err);
    return res.status(500).json({ error: "Failed to update session" });
  }
});

export default router;
