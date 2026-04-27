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
import { getLatestRecipeContext } from "../latestRecipeLookup";
import { getOrCreateElementReference } from "../referenceLookup";
import { buildSemanticClusters } from "../semanticClusters";

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

router.get("/clusters", async (req, res) => {
  const rawMaxClusters = Number(req.query.maxClusters ?? 10);
  const maxClusters = Number.isFinite(rawMaxClusters)
    ? Math.max(1, Math.min(10, Math.floor(rawMaxClusters)))
    : 10;

  try {
    const db = await getDb();
    const clusters = await buildSemanticClusters(db, { maxClusters });
    persistDatabase(db);
    return res.json(clusters);
  } catch (err) {
    console.error("Error in GET /elements/clusters", err);
    return res.status(500).json({ error: "Failed to build semantic clusters" });
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

router.get("/:id/latest-recipe", async (req, res) => {
  const elementId = Number(req.params.id);
  if (!Number.isInteger(elementId) || elementId <= 0) {
    return res.status(400).json({ error: "Invalid element id" });
  }

  try {
    const db = await getDb();
    const latestRecipe = getLatestRecipeContext(db, elementId);
    if (!latestRecipe) {
      return res.status(404).json({ error: "Element not found" });
    }

    return res.json(latestRecipe);
  } catch (err) {
    console.error("Error in GET /elements/:id/latest-recipe", err);
    return res.status(500).json({ error: "Failed to load latest recipe" });
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
        (SELECT COUNT(*) FROM recipes) AS recipe_count
      `
    );
    let row: any = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();

    return res.json({
      recipeCount: Number(row?.recipe_count ?? 0),
    });
  } catch (err) {
    console.error("Error in GET /elements/cache-stats", err);
    return res.status(500).json({ error: "Failed to load cache stats" });
  }
});

router.get("/cache-recipes", async (req, res) => {
  const rawPage = Number(req.query.page ?? 1);
  const rawLimit = Number(req.query.limit ?? 25);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
    : 25;
  const offset = (page - 1) * limit;

  try {
    const db = await getDb();
    const countStmt = db.prepare("SELECT COUNT(*) AS total FROM recipes");
    countStmt.step();
    const countRow = countStmt.getAsObject() as Record<string, unknown>;
    countStmt.free();
    const total = Number(countRow.total ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    const stmt = db.prepare(
      `
      SELECT
        r.id,
        r.input_key,
        r.input_display_json,
        r.updated_at,
        r.result_element_id,
        e.id AS result_element_id_value,
        e.name AS result_element_name,
        e.normalized_name AS result_element_normalized_name,
        e.icon AS result_element_icon
      FROM recipes r
      LEFT JOIN elements e ON e.id = r.result_element_id
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT ? OFFSET ?
      `
    );
    stmt.bind([limit, offset]);

    const recipes: Array<{
      id: number;
      inputKey: string;
      inputs: { name: string; normalized: string }[];
      resultElement: {
        id: number;
        name: string;
        normalizedName: string;
        icon: string | null;
      } | null;
      updatedAt: string;
    }> = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      const recipeId = Number(row.id);
      recipes.push({
        id: recipeId,
        inputKey: String(row.input_key),
        inputs: JSON.parse(String(row.input_display_json)) as {
          name: string;
          normalized: string;
        }[],
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
        updatedAt: String(row.updated_at),
      });
    }
    stmt.free();

    return res.json({
      recipes,
      page,
      limit,
      total,
      totalPages,
    });
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
        (SELECT COUNT(*) FROM recipes) AS recipe_count
      `
    );
    let countRow: any = null;
    if (countStmt.step()) {
      countRow = countStmt.getAsObject();
    }
    countStmt.free();

    const recipeCount = Number(countRow?.recipe_count ?? 0);

    db.run("BEGIN");
    try {
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
    });
  } catch (err) {
    console.error("Error in POST /elements/reset-cache", err);
    return res.status(500).json({ error: "Failed to reset cache" });
  }
});

export default router;
