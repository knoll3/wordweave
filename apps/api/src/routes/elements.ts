import express from "express";
import {
  BASE_ELEMENT_NORMALIZED_NAMES,
  getDb,
  persistDatabase,
} from "../db";
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

router.get("/cache-stats", async (_req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM recipes) AS recipe_count,
        (SELECT COUNT(*) FROM recipe_candidates) AS candidate_count
      `
    );
    let row: any = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();

    return res.json({
      recipeCount: Number(row?.recipe_count ?? 0),
      candidateCount: Number(row?.candidate_count ?? 0),
    });
  } catch (err) {
    console.error("Error in GET /elements/cache-stats", err);
    return res.status(500).json({ error: "Failed to load cache stats" });
  }
});

router.post("/reset-library", async (_req, res) => {
  try {
    const db = await getDb();

    db.run("BEGIN");
    try {
      const placeholders = BASE_ELEMENT_NORMALIZED_NAMES.map(() => "?").join(", ");
      const deleteStmt = db.prepare(
        `DELETE FROM elements WHERE normalized_name NOT IN (${placeholders})`
      );
      deleteStmt.run(BASE_ELEMENT_NORMALIZED_NAMES);
      deleteStmt.free();
      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }

    persistDatabase(db);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /elements/reset-library", err);
    return res.status(500).json({ error: "Failed to reset library" });
  }
});

router.post("/reset-cache", async (_req, res) => {
  try {
    const db = await getDb();

    const countStmt = db.prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM recipes) AS recipe_count,
        (SELECT COUNT(*) FROM recipe_candidates) AS candidate_count
      `
    );
    let countRow: any = null;
    if (countStmt.step()) {
      countRow = countStmt.getAsObject();
    }
    countStmt.free();

    const recipeCount = Number(countRow?.recipe_count ?? 0);
    const candidateCount = Number(countRow?.candidate_count ?? 0);

    db.run("BEGIN");
    try {
      db.run("DELETE FROM recipe_candidates");
      db.run("DELETE FROM recipes");
      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }

    persistDatabase(db);
    return res.json({
      ok: true,
      clearedRecipeCount: recipeCount,
      clearedCandidateCount: candidateCount,
    });
  } catch (err) {
    console.error("Error in POST /elements/reset-cache", err);
    return res.status(500).json({ error: "Failed to reset cache" });
  }
});

export default router;
