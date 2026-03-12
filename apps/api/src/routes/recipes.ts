import express from "express";
import { getDb, persistDatabase } from "../db";
import { generateResult } from "../openaiClient";
import {
  combineRequestSchema,
  selectRequestSchema,
} from "../validation";
import {
  buildCombineResponse,
  getElementById,
  normalizeInputs,
  toTitleCaseWords,
} from "../models";

const router = express.Router();

router.post("/combine", async (req, res) => {
  console.log("[api][combine] request body", req.body);
  const parsedBody = combineRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const creative = parsedBody.data.creative ?? false;
  const subtractive = parsedBody.data.subtractive ?? false;

  if (creative && subtractive) {
    return res.status(400).json({
      error: "Creative and subtraction modes cannot be used together",
    });
  }

  const { normalizedInputs, inputKey } = normalizeInputs(
    parsedBody.data.inputs
  );
  const recipeInputKey = creative
    ? `creative|${inputKey}`
    : subtractive
      ? `subtract|${inputKey}`
      : inputKey;

  if (normalizedInputs.length === 0) {
    return res.status(400).json({ error: "No valid inputs provided" });
  }

  try {
    const db = await getDb();

    if (creative) {
      console.log("[api][combine] creative mode bypassing cache", {
        inputs: normalizedInputs.map((i) => i.name),
      });

      let llmResult;
      try {
        llmResult = await generateResult(
          normalizedInputs.map((i) => i.name),
          { creative: true }
        );
        console.log("[api][combine] creative OpenAI result", llmResult);
      } catch (err) {
        console.error("Error generating creative result", err);
        const message =
          err instanceof Error ? err.message : "Failed to generate creative result from model";
        return res.status(502).json({ error: message });
      }

      const createdResultName = toTitleCaseWords(llmResult.name);
      const normalizedName = createdResultName.trim().toLowerCase();

      let elementStmt = db.prepare(
        "SELECT id, name, normalized_name, icon FROM elements WHERE normalized_name = ?"
      );
      let elementRow = elementStmt.getAsObject([normalizedName]);
      elementStmt.free();

      if (!elementRow || elementRow.id === undefined) {
        const insertElementStmt = db.prepare(
          "INSERT INTO elements (name, normalized_name, icon) VALUES (?, ?, ?)"
        );
        insertElementStmt.run([
          createdResultName,
          normalizedName,
          llmResult.icon,
        ]);
        insertElementStmt.free();

        const lastElementStmt = db.prepare(
          "SELECT last_insert_rowid() as id"
        );
        let lastElementId: number | null = null;
        if (lastElementStmt.step()) {
          const row = lastElementStmt.getAsObject() as any;
          lastElementId = Number(row.id);
        }
        lastElementStmt.free();

        if (!lastElementId || Number.isNaN(lastElementId)) {
          throw new Error("Failed to obtain creative element id");
        }

        elementRow = {
          id: lastElementId,
          name: createdResultName,
          normalized_name: normalizedName,
          icon: llmResult.icon,
        };

        persistDatabase(db);
      }

      return res.json({
        recipeId: 0,
        inputKey: recipeInputKey,
        inputs: normalizedInputs,
        candidates: [
          {
            id: 0,
            name: createdResultName,
            icon: llmResult.icon,
            orderIndex: 0,
          },
        ],
        chosenCandidateId: null,
        resultElement: {
          id: Number(elementRow.id),
          name: String(elementRow.name),
          normalizedName: String(elementRow.normalized_name),
          icon: elementRow.icon ? String(elementRow.icon) : null,
        },
      });
    }

    // Look up existing recipe
    let stmt = db.prepare("SELECT * FROM recipes WHERE input_key = ?");
    let recipeRow = stmt.getAsObject([recipeInputKey]);
    stmt.free();

    if (recipeRow && recipeRow.id !== undefined) {
      console.log("[api][combine] cache hit", {
        inputKey: recipeInputKey,
        creative,
        subtractive,
        recipeId: recipeRow.id,
        resultElementId: recipeRow.result_element_id ?? null,
      });
      // Load candidates
      const candidatesStmt = db.prepare(
        "SELECT * FROM recipe_candidates WHERE recipe_id = ? ORDER BY order_index ASC"
      );
      const candidatesRows: any[] = [];
      while (candidatesStmt.step()) {
        candidatesRows.push(candidatesStmt.getAsObject());
      }
      candidatesStmt.free();

      let resultElement =
        recipeRow.result_element_id != null
          ? getElementById(db, Number(recipeRow.result_element_id))
          : undefined;

      // Backfill legacy recipes that were cached without a canonical result.
      if (!resultElement) {
        console.warn("[api][combine] cache hit with null result; backfilling", {
          inputKey,
          recipeId: recipeRow.id,
          candidateCount: candidatesRows.length,
        });

        let chosenCandidateId: number | null = null;
        let chosenName: string;
        let chosenIcon: string;

        if (candidatesRows.length > 0) {
          const first = candidatesRows[0] as any;
          chosenCandidateId = Number(first.id);
          chosenName = toTitleCaseWords(String(first.name));
          chosenIcon = String(first.icon ?? "✨");
        } else {
          // If no candidates exist, regenerate one now.
          const generated = await generateResult(
            normalizedInputs.map((i) => i.name),
            { creative, subtractive }
          );
          console.log("[api][combine] backfill generated result", generated);

          const insertCandidateStmt = db.prepare(
            "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
          );
          const generatedName = toTitleCaseWords(generated.name);
          insertCandidateStmt.run([
            Number(recipeRow.id),
            generatedName,
            generated.icon,
            0,
          ]);
          insertCandidateStmt.free();

          const lastCandidateStmt = db.prepare(
            "SELECT last_insert_rowid() as id"
          );
          if (lastCandidateStmt.step()) {
            const row = lastCandidateStmt.getAsObject() as any;
            chosenCandidateId = Number(row.id);
          }
          lastCandidateStmt.free();

          chosenName = generatedName;
          chosenIcon = generated.icon;
          candidatesRows.push({
            id: chosenCandidateId,
            recipe_id: Number(recipeRow.id),
            name: chosenName,
            icon: chosenIcon,
            order_index: 0,
          });
        }

        const normalizedName = chosenName.trim().toLowerCase();
        let elementStmt = db.prepare(
          "SELECT id FROM elements WHERE normalized_name = ?"
        );
        let elementRow = elementStmt.getAsObject([normalizedName]);
        elementStmt.free();

        let elementId: number;
        if (!elementRow || elementRow.id === undefined) {
          const insertElementStmt = db.prepare(
            "INSERT INTO elements (name, normalized_name, icon) VALUES (?, ?, ?)"
          );
          insertElementStmt.run([
            chosenName,
            normalizedName,
            chosenIcon,
          ]);
          insertElementStmt.free();

          const lastElementStmt = db.prepare(
            "SELECT last_insert_rowid() as id"
          );
          let lastElementId: number | null = null;
          if (lastElementStmt.step()) {
            const row = lastElementStmt.getAsObject() as any;
            lastElementId = Number(row.id);
          }
          lastElementStmt.free();
          if (!lastElementId || Number.isNaN(lastElementId)) {
            throw new Error("Failed to obtain element id during backfill");
          }
          elementId = lastElementId;
        } else {
          elementId = Number(elementRow.id);
        }

        const updateRecipeStmt = db.prepare(
          "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
        updateRecipeStmt.run([
          chosenCandidateId,
          elementId,
          Number(recipeRow.id),
        ]);
        updateRecipeStmt.free();

        persistDatabase(db);

        recipeRow.chosen_candidate_id = chosenCandidateId;
        recipeRow.result_element_id = elementId;
        resultElement = getElementById(db, elementId);
      }

      return res.json(
        buildCombineResponse({
          recipeRow,
          candidates: candidatesRows,
          resultElement,
        })
      );
    }

    // Not found: generate a single result via OpenAI
    console.log("[api][combine] cache miss; generating via OpenAI", {
      inputKey: recipeInputKey,
      creative,
      subtractive,
      inputs: normalizedInputs.map((i) => i.name),
    });
    let llmResult;
    try {
      llmResult = await generateResult(
        normalizedInputs.map((i) => i.name),
        { creative, subtractive }
      );
      console.log("[api][combine] OpenAI result", llmResult);
    } catch (err) {
      console.error("Error generating result", err);
      const message =
        err instanceof Error ? err.message : "Failed to generate result from model";
      return res.status(502).json({ error: message });
    }

    const inputDisplayJson = JSON.stringify(normalizedInputs);
    const createdResultName = toTitleCaseWords(llmResult.name);

    // Insert recipe, generated result candidate, and canonical selection
    db.run("BEGIN");
    try {
      const insertRecipeStmt = db.prepare(
        "INSERT INTO recipes (input_key, input_display_json) VALUES (?, ?)"
      );
      insertRecipeStmt.run([recipeInputKey, inputDisplayJson]);
      insertRecipeStmt.free();

      const lastIdStmt = db.prepare(
        "SELECT last_insert_rowid() as id"
      );
      let recipeId: number | null = null;
      if (lastIdStmt.step()) {
        const lastIdRow = lastIdStmt.getAsObject() as any;
        recipeId = Number(lastIdRow.id);
      }
      lastIdStmt.free();
      if (!recipeId || Number.isNaN(recipeId)) {
        throw new Error("Failed to obtain recipe id");
      }

      const insertCandidateStmt = db.prepare(
        "INSERT INTO recipe_candidates (recipe_id, name, icon, order_index) VALUES (?, ?, ?, ?)"
      );
      insertCandidateStmt.run([
        recipeId,
        createdResultName,
        llmResult.icon,
        0,
      ]);
      insertCandidateStmt.free();

      const lastCandidateStmt = db.prepare(
        "SELECT last_insert_rowid() as id"
      );
      let chosenCandidateId: number | null = null;
      if (lastCandidateStmt.step()) {
        const lastCandidateRow = lastCandidateStmt.getAsObject() as any;
        chosenCandidateId = Number(lastCandidateRow.id);
      }
      lastCandidateStmt.free();
      if (!chosenCandidateId || Number.isNaN(chosenCandidateId)) {
        throw new Error("Failed to obtain candidate id");
      }

      const normalizedName = createdResultName.trim().toLowerCase();
      let elementStmt = db.prepare(
        "SELECT id FROM elements WHERE normalized_name = ?"
      );
      let elementRow = elementStmt.getAsObject([normalizedName]);
      elementStmt.free();

      let elementId: number;
      if (!elementRow || elementRow.id === undefined) {
        const insertElementStmt = db.prepare(
          "INSERT INTO elements (name, normalized_name, icon) VALUES (?, ?, ?)"
        );
        insertElementStmt.run([
          createdResultName,
          normalizedName,
          llmResult.icon,
        ]);
        insertElementStmt.free();

        const lastElementStmt = db.prepare(
          "SELECT last_insert_rowid() as id"
        );
        let lastElementId: number | null = null;
        if (lastElementStmt.step()) {
          const lastElementRow = lastElementStmt.getAsObject() as any;
          lastElementId = Number(lastElementRow.id);
        }
        lastElementStmt.free();
        if (!lastElementId || Number.isNaN(lastElementId)) {
          throw new Error("Failed to obtain element id");
        }
        elementId = lastElementId;
      } else {
        elementId = Number(elementRow.id);
      }

      const updateRecipeStmt = db.prepare(
        "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      updateRecipeStmt.run([chosenCandidateId, elementId, recipeId]);
      updateRecipeStmt.free();

      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      console.error("Error inserting recipe", err);
      return res
        .status(500)
        .json({ error: "Failed to save generated result" });
    }

    persistDatabase(db);

    // Load back inserted data
    stmt = db.prepare("SELECT * FROM recipes WHERE input_key = ?");
    recipeRow = stmt.getAsObject([recipeInputKey]);
    stmt.free();

    const candidatesStmt = db.prepare(
      "SELECT * FROM recipe_candidates WHERE recipe_id = ? ORDER BY order_index ASC"
    );
    const candidatesRows: any[] = [];
    while (candidatesStmt.step()) {
      candidatesRows.push(candidatesStmt.getAsObject());
    }
    candidatesStmt.free();

    const resultElement =
      recipeRow.result_element_id != null
        ? getElementById(db, Number(recipeRow.result_element_id))
        : undefined;

    return res.json(
      buildCombineResponse({
        recipeRow,
        candidates: candidatesRows,
        resultElement,
      })
    );
  } catch (err) {
    console.error("Unexpected error in /recipes/combine", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/select", async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    return res.status(400).json({ error: "Invalid recipe id" });
  }

  const parsedBody = selectRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { candidateId } = parsedBody.data;

  try {
    const db = await getDb();

    // Ensure recipe exists
    let stmt = db.prepare("SELECT * FROM recipes WHERE id = ?");
    const recipeRow = stmt.getAsObject([recipeId]);
    stmt.free();
    if (!recipeRow || recipeRow.id === undefined) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Ensure candidate belongs to recipe
    stmt = db.prepare(
      "SELECT * FROM recipe_candidates WHERE id = ? AND recipe_id = ?"
    );
    const candidateRow = stmt.getAsObject([candidateId, recipeId]);
    stmt.free();
    if (!candidateRow || candidateRow.id === undefined) {
      return res
        .status(404)
        .json({ error: "Candidate not found for this recipe" });
    }

    const candidateName = toTitleCaseWords(String(candidateRow.name));
    const candidateIcon = String(candidateRow.icon ?? "✨");
    const normalizedName = candidateName.trim().toLowerCase();

    db.run("BEGIN");
    try {
      // Upsert element
      let elementStmt = db.prepare(
        "SELECT id, name, normalized_name, icon FROM elements WHERE normalized_name = ?"
      );
      let elementRow = elementStmt.getAsObject([normalizedName]);
      elementStmt.free();

      let elementId: number;
      if (!elementRow || elementRow.id === undefined) {
        const insertElementStmt = db.prepare(
          "INSERT INTO elements (name, normalized_name, icon) VALUES (?, ?, ?)"
        );
        insertElementStmt.run([
          candidateName,
          normalizedName,
          candidateIcon,
        ]);
        insertElementStmt.free();

        const lastIdStmt = db.prepare(
          "SELECT last_insert_rowid() as id"
        );
        let lastElementId: number | null = null;
        if (lastIdStmt.step()) {
          const lastIdRow = lastIdStmt.getAsObject() as any;
          lastElementId = Number(lastIdRow.id);
        }
        lastIdStmt.free();
        if (!lastElementId || Number.isNaN(lastElementId)) {
          throw new Error("Failed to obtain element id");
        }
        elementId = lastElementId;
      } else {
        elementId = Number(elementRow.id);
      }

      const updateRecipeStmt = db.prepare(
        "UPDATE recipes SET chosen_candidate_id = ?, result_element_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      updateRecipeStmt.run([candidateId, elementId, recipeId]);
      updateRecipeStmt.free();

      db.run("COMMIT");

      // Fetch the resulting element for response
      elementStmt = db.prepare(
        "SELECT id, name, normalized_name, icon FROM elements WHERE id = ?"
      );
      elementRow = elementStmt.getAsObject([elementId]);
      elementStmt.free();

      persistDatabase(db);

      return res.json({
        recipeId,
        chosenCandidateId: candidateId,
        resultElement: elementRow
          ? {
              id: elementRow.id,
              name: elementRow.name,
              normalizedName: elementRow.normalized_name,
              icon: elementRow.icon ?? null,
            }
          : null,
      });
    } catch (err) {
      db.run("ROLLBACK");
      console.error("Error selecting candidate", err);
      return res
        .status(500)
        .json({ error: "Failed to select candidate" });
    }
  } catch (err) {
    console.error("Unexpected error in /recipes/:id/select", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
