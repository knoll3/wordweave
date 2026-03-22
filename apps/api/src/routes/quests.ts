import express from "express";
import { getDb, persistDatabase } from "../db";
import { getOrCreateReferenceByName } from "../referenceLookup";

const router = express.Router();

router.get("/reference", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    return res.status(400).json({ error: "Missing quest target query" });
  }

  try {
    const db = await getDb();
    const reference = await getOrCreateReferenceByName(db, q);
    persistDatabase(db);
    if (!reference) {
      return res.status(404).json({ error: "Reference not found" });
    }
    return res.json(reference);
  } catch (err) {
    console.error("[api][target-reference] failed to load target reference", err);
    return res.status(500).json({ error: "Failed to load target reference" });
  }
});

export default router;
