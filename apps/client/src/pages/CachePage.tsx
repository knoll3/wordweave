import React, { useEffect, useState } from "react";
import { fetchCacheRecipes, generateCacheRecipes } from "../lib/api";
import type { CacheRecipe } from "../types";

const PAGE_SIZE = 25;

const CachePage: React.FC = () => {
  const [recipes, setRecipes] = useState<CacheRecipe[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecipes, setTotalRecipes] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRecipes(page = currentPage) {
    const data = await fetchCacheRecipes({ page, limit: PAGE_SIZE });
    setRecipes(data.recipes);
    setCurrentPage(data.page);
    setTotalRecipes(data.total);
    setTotalPages(data.totalPages);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const data = await fetchCacheRecipes({ page: currentPage, limit: PAGE_SIZE });
        if (!cancelled) {
          setRecipes(data.recipes);
          setCurrentPage(data.page);
          setTotalRecipes(data.total);
          setTotalPages(data.totalPages);
          setError(null);
        }
      } catch {
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
  }, [currentPage]);

  async function handleGenerateRecipes() {
    if (isGenerating) return;
    try {
      setIsGenerating(true);
      setError(null);
      await generateCacheRecipes();
      await loadRecipes(1);
    } catch {
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
          <a className="button" href="/clusters">
            View Clusters
          </a>
          <a className="button" href="/prompts">
            Prompt Lab
          </a>
          <a className="button" href="/feedback">
            Feedback
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
        <>
          <div className="cache-table-toolbar">
            <div className="cache-table-meta">
              Showing {recipes.length} of {totalRecipes} cached recipes
            </div>
            <div className="cache-pagination">
              <button
                type="button"
                className="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </button>
              <span className="cache-pagination-status">
                Page {currentPage} of {Math.max(totalPages, 1)}
              </span>
              <button
                type="button"
                className="button"
                onClick={() =>
                  setCurrentPage((page) =>
                    totalPages > 0 ? Math.min(totalPages, page + 1) : page
                  )
                }
                disabled={totalPages === 0 || currentPage >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
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
        </>
      )}
    </div>
  );
};

export default CachePage;
