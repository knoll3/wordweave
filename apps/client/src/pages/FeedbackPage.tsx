import React, { useEffect, useState } from "react";
import { fetchRecipeFeedbackList } from "../lib/api";
import type { RecipeFeedbackListEntry } from "../types";

const FeedbackPage: React.FC = () => {
  const [entries, setEntries] = useState<RecipeFeedbackListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const feedback = await fetchRecipeFeedbackList(150);
        if (!cancelled) {
          setEntries(feedback);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load feedback.");
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

  return (
    <div className="cache-page">
      <header className="cache-page-header">
        <div>
          <div className="cache-page-label">Admin</div>
          <h1 className="cache-page-title">Recipe Feedback</h1>
          <p className="clusters-page-copy">
            Barebones feedback viewer for recipe outcomes, expected replacements, and stored
            generation traces.
          </p>
        </div>
        <div className="cache-page-actions">
          <a className="button" href="/">
            Back To Workspace
          </a>
          <a className="button" href="/cache">
            Recipe Cache
          </a>
          <a className="button" href="/prompts">
            Prompt Lab
          </a>
        </div>
      </header>

      {isLoading ? (
        <div className="cache-page-empty">Loading feedback…</div>
      ) : error ? (
        <div className="cache-page-empty">{error}</div>
      ) : entries.length === 0 ? (
        <div className="cache-page-empty">No feedback has been recorded yet.</div>
      ) : (
        <div className="feedback-list">
          {entries.map((entry, index) => (
            <article key={`${entry.runInputKey}-${index}`} className="feedback-card">
              <div className="feedback-card-header">
                <div>
                  <div className="feedback-sentiment-row">
                    <span
                      className={`feedback-sentiment-pill ${
                        entry.feedback.sentiment === "up" ? "is-positive" : "is-negative"
                      }`}
                    >
                      {entry.feedback.sentiment === "up" ? "Thumbs Up" : "Thumbs Down"}
                    </span>
                    <span className="feedback-card-time">
                      {new Date(entry.feedback.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <h2 className="feedback-card-title">
                    {entry.runSummaryLine ?? entry.runInputKey}
                  </h2>
                </div>
              </div>

              {entry.feedback.expectedResultText ? (
                <div className="feedback-card-block">
                  <div className="feedback-card-label">Expected Result</div>
                  <div className="feedback-card-value">{entry.feedback.expectedResultText}</div>
                </div>
              ) : null}

              {entry.trace ? (
                <>
                  <div className="feedback-card-block">
                    <div className="feedback-card-label">Generation Trace</div>
                    <div className="feedback-trace-grid">
                      <div>
                        <strong>Provider</strong>
                        <span>{entry.trace.providerType}</span>
                      </div>
                      <div>
                        <strong>Model</strong>
                        <span>{entry.trace.model}</span>
                      </div>
                      <div>
                        <strong>Family</strong>
                        <span>{entry.trace.actionPromptFamily ?? "default"}</span>
                      </div>
                      <div>
                        <strong>Search Query</strong>
                        <span>{entry.trace.searchQuery ?? "None"}</span>
                      </div>
                    </div>
                  </div>

                  {entry.trace.searchResults?.length ? (
                    <div className="feedback-card-block">
                      <div className="feedback-card-label">Top Search Results</div>
                      <div className="feedback-search-results">
                        {entry.trace.searchResults.map((result) => (
                          <div key={`${result.position}-${result.url}`} className="feedback-search-result">
                            <div className="feedback-search-result-title">
                              {result.position}. {result.title}
                            </div>
                            <div className="feedback-search-result-url">{result.url}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default FeedbackPage;
