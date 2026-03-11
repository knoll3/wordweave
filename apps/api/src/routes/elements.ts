import express from "express";
import { getDb } from "../db";
import { mapElementRow, mapRecentRecipeRow } from "../models";

const router = express.Router();

router.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  try {
    const db = await getDb();

    let stmt;
    if (q) {
      stmt = db.prepare(
        "SELECT id, name, normalized_name, icon FROM elements WHERE name LIKE ? ORDER BY created_at ASC"
      );
      stmt.bind([`%${q}%`]);
    } else {
      stmt = db.prepare(
        "SELECT id, name, normalized_name, icon FROM elements ORDER BY created_at ASC"
      );
    }

    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();

    return res.json(rows.map(mapElementRow));
  } catch (err) {
    console.error("Error in GET /elements", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/recent-recipes", async (_req, res) => {
  try {
    const db = await getDb();

    const stmt = db.prepare(
      `
      SELECT
        r.id,
        r.input_key,
        r.input_display_json,
        r.updated_at,
        e.id AS element_id,
        e.name AS element_name,
        e.normalized_name AS element_normalized_name,
        e.icon AS element_icon
      FROM recipes r
      JOIN elements e ON r.result_element_id = e.id
      WHERE r.result_element_id IS NOT NULL
      ORDER BY r.updated_at DESC
      LIMIT 20
      `
    );

    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();

    return res.json(rows.map(mapRecentRecipeRow));
  } catch (err) {
    console.error("Error in GET /elements/recent-recipes", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

