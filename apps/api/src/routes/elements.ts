import express from "express";
import {
  BASE_ELEMENT_NORMALIZED_NAMES,
  getDb,
  persistDatabase,
} from "../db";
import { searchDiscoveredElements } from "../search";
import {
  clearFeatureUnlocks,
  getFeatureUnlockStatuses,
  isKnownUnlockKey,
  markFeatureUnlockIntroSeen,
  syncFeatureUnlocks,
} from "../unlocks";
import {
  mapRecentRecipeRow,
} from "../models";
import { getOrCreateElementReference } from "../referenceLookup";

const router = express.Router();

router.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  try {
    const db = await getDb();
    const items = await searchDiscoveredElements(db, q);
    persistDatabase(db);
    return res.json(items);
  } catch (err) {
    console.error("Error in GET /elements", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/reference", async (req, res) => {
  const elementId = Number(req.params.id);
  if (!Number.isInteger(elementId) || elementId <= 0) {
    return res.status(400).json({ error: "Invalid element id" });
  }

  try {
    const db = await getDb();
    const reference = await getOrCreateElementReference(db, elementId);
    persistDatabase(db);

    if (!reference) {
      return res.status(404).json({ error: "Element not found" });
    }

    return res.json(reference);
  } catch (err) {
    console.error("Error in GET /elements/:id/reference", err);
    return res.status(500).json({ error: "Failed to load item reference" });
  }
});

router.get("/unlocks", async (_req, res) => {
  try {
    const db = await getDb();
    await syncFeatureUnlocks(db);
    persistDatabase(db);
    return res.json(getFeatureUnlockStatuses(db));
  } catch (err) {
    console.error("Error in GET /elements/unlocks", err);
    return res.status(500).json({ error: "Failed to load unlocks" });
  }
});

router.post("/unlocks/:key/mark-seen", async (req, res) => {
  const key = String(req.params.key ?? "");
  if (!isKnownUnlockKey(key)) {
    return res.status(404).json({ error: "Unknown unlock key" });
  }

  try {
    const db = await getDb();
    markFeatureUnlockIntroSeen(db, key);
    persistDatabase(db);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /elements/unlocks/:key/mark-seen", err);
    return res.status(500).json({ error: "Failed to mark unlock intro as seen" });
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

router.get("/cache-recipes", async (_req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare(
      `
      SELECT
        r.id,
        r.input_key,
        r.input_display_json,
        r.updated_at,
        r.chosen_candidate_id,
        r.result_element_id,
        e.id AS result_element_id_value,
        e.name AS result_element_name,
        e.normalized_name AS result_element_normalized_name,
        e.icon AS result_element_icon
      FROM recipes r
      LEFT JOIN elements e ON e.id = r.result_element_id
      ORDER BY r.updated_at DESC, r.id DESC
      `
    );

    const recipes: Array<{
      id: number;
      inputKey: string;
      inputs: { name: string; normalized: string }[];
      chosenCandidateId: number | null;
      resultElement: {
        id: number;
        name: string;
        normalizedName: string;
        icon: string | null;
      } | null;
      candidates: Array<{
        id: number;
        name: string;
        icon: string;
        orderIndex: number;
      }>;
      updatedAt: string;
    }> = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const recipeId = Number(row.id);
      const candidateStmt = db.prepare(
        `
        SELECT id, name, icon, order_index
        FROM recipe_candidates
        WHERE recipe_id = ?
        ORDER BY order_index ASC, id ASC
        `
      );
      const candidates: Array<{
        id: number;
        name: string;
        icon: string;
        orderIndex: number;
      }> = [];
      while (candidateStmt.step()) {
        const candidateRow = candidateStmt.getAsObject() as Record<string, unknown>;
        candidates.push({
          id: Number(candidateRow.id),
          name: String(candidateRow.name),
          icon: String(candidateRow.icon),
          orderIndex: Number(candidateRow.order_index),
        });
      }
      candidateStmt.free();

      recipes.push({
        id: recipeId,
        inputKey: String(row.input_key),
        inputs: JSON.parse(String(row.input_display_json)) as {
          name: string;
          normalized: string;
        }[],
        chosenCandidateId:
          row.chosen_candidate_id == null ? null : Number(row.chosen_candidate_id),
        resultElement:
          row.result_element_id_value == null
            ? null
            : {
                id: Number(row.result_element_id_value),
                name: String(row.result_element_name),
                normalizedName: String(row.result_element_normalized_name),
                icon:
                  row.result_element_icon == null
                    ? null
                    : String(row.result_element_icon),
              },
        candidates,
        updatedAt: String(row.updated_at),
      });
    }
    stmt.free();

    return res.json(recipes);
  } catch (err) {
    console.error("Error in GET /elements/cache-recipes", err);
    return res.status(500).json({ error: "Failed to load recipe cache" });
  }
});

router.post("/reset-library", async (_req, res) => {
  try {
    const db = await getDb();

    db.run("BEGIN");
    try {
      db.run("DELETE FROM discoveries");
      clearFeatureUnlocks(db);
      const seedStmt = db.prepare(
        `
        INSERT OR IGNORE INTO discoveries (element_id)
        SELECT id FROM elements WHERE normalized_name = ?
        `
      );
      for (const normalizedName of BASE_ELEMENT_NORMALIZED_NAMES) {
        seedStmt.run([normalizedName]);
      }
      seedStmt.free();
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
