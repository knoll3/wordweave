import express from "express";
import { z } from "zod";
import { getDb } from "../db";
import { createPlayer, getPlayer, isValidSessionId, listPlayers } from "../sessions";

const router = express.Router();
const profileSchema = z.object({
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(12),
});
router.get("/", async (_req, res) => {
  try { return res.json({ players: listPlayers(await getDb()) }); }
  catch { return res.status(500).json({ error: "Failed to load players" }); }
});
router.post("/", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a name and choose an avatar" });
  try { return res.status(201).json(createPlayer(await getDb(), parsed.data.name, parsed.data.emoji)); }
  catch { return res.status(500).json({ error: "Failed to create player" }); }
});
router.patch("/:id", async (req, res) => {
  const id = String(req.params.id);
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success || !isValidSessionId(id)) return res.status(400).json({ error: "Invalid player" });
  try {
    const db = await getDb();
    if (!getPlayer(db, id)) return res.status(404).json({ error: "Player not found" });
    const stmt = db.prepare("UPDATE players SET name = ?, emoji = ? WHERE id = ?");
    stmt.run([parsed.data.name, parsed.data.emoji, id]); stmt.free();
    return res.json(getPlayer(db, id));
  } catch { return res.status(500).json({ error: "Failed to update player" }); }
});
export default router;
