import React, { useEffect, useState } from "react";
import type { CacheRecipe } from "../types";
import { fetchCacheRecipes, generateCacheRecipes } from "../lib/api";

const CachePage: React.FC = () => {
  const [recipes, setRecipes] = useState<CacheRecipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRecipes() {
    const data = await fetchCacheRecipes();
    setRecipes(data);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const data = await fetchCacheRecipes();
        if (!cancelled) {
          setRecipes(data);
          setError(null);
        }
      } catch (err) {
        console.error("[cache] failed to load recipes", err);
        if (!cancelled) {
          setError("Failed to load recipe cache.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerateRecipes() {
    if (isGenerating) return;
    try {
      setIsGenerating(true);
      setError(null);
      const result = await generateCacheRecipes();
      console.log("[cache] generated recipes", result);
      await loadRecipes();
    } catch (err) {
      console.error("[cache] failed to generate recipes", err);
      setError("Failed to generate cached recipes.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="cache-page">
      <header className="cache-page-header">
        <div>
          <div className="cache-page-label">Recipe Cache</div>
          <h1 className="cache-page-title">Cached Recipes</h1>
        </div>
        <div className="cache-page-actions">
          <button
            type="button"
            className="button primary"
            onClick={() => void handleGenerateRecipes()}
            disabled={isGenerating}
          >
            {isGenerating ? "Generating..." : "Generate Recipes"}
          </button>
          <a className="button" href="/">
            Back To Workspace
          </a>
        </div>
      </header>

      {isLoading ? (
        <div className="cache-page-empty">Loading recipe cache...</div>
      ) : error ? (
        <div className="cache-page-empty">{error}</div>
      ) : recipes.length === 0 ? (
        <div className="cache-page-empty">No cached recipes yet.</div>
      ) : (
        <div className="cache-table">
          <div className="cache-table-head">
            <span>Inputs</span>
            <span>Chosen Result</span>
            <span>Candidates</span>
            <span>Updated</span>
          </div>
          {recipes.map((recipe) => {
            const chosenCandidate =
              recipe.candidates.find(
                (candidate) => candidate.id === recipe.chosenCandidateId
              ) ?? null;
            return (
              <div key={recipe.id} className="cache-table-row">
                <div className="cache-cell cache-inputs">
                  {recipe.inputs.map((input) => input.name).join(" + ")}
                </div>
                <div className="cache-cell">
                  {recipe.resultElement
                    ? `${recipe.resultElement.icon ?? ""} ${recipe.resultElement.name}`.trim()
                    : chosenCandidate
                      ? `${chosenCandidate.icon} ${chosenCandidate.name}`
                      : "Unresolved"}
                </div>
                <div className="cache-cell cache-candidates">
                  {recipe.candidates.map((candidate) => (
                    <span
                      key={candidate.id}
                      className={`cache-candidate-chip ${
                        candidate.id === recipe.chosenCandidateId ? "active" : ""
                      }`}
                    >
                      {candidate.icon} {candidate.name}
                    </span>
                  ))}
                </div>
                <div className="cache-cell cache-updated">
                  {new Date(recipe.updatedAt).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CachePage;
