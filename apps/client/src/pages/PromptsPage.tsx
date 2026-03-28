import React, { useEffect, useMemo, useState } from "react";
import { fetchPromptCatalog, testPrompt } from "../lib/api";
import type {
  AiModel,
  PromptBatchPair,
  PromptCatalogResponse,
  PromptDefinition,
  PromptTestResponse,
} from "../types";

const AI_MODEL_STORAGE_KEY = "wordweave.ai-model";

function parseInputLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseBatchPairs(value: string): PromptBatchPair[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [left, right] = line.split("|").map((part) => part.trim());
      if (!left || !right) {
        return [];
      }
      return [{ left, right }];
    });
}

const PromptsPage: React.FC = () => {
  const [catalog, setCatalog] = useState<PromptCatalogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPromptKey, setSelectedPromptKey] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<AiModel>("gpt-5-mini");
  const [inputsText, setInputsText] = useState("Fire\nWater");
  const [batchPairsText, setBatchPairsText] = useState("Fire | Water\nBird | Metal");
  const [actionConstraint, setActionConstraint] = useState("");
  const [categoryConstraint, setCategoryConstraint] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PromptTestResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("page-scrollable");

    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const next = await fetchPromptCatalog();
        if (cancelled) {
          return;
        }
        setCatalog(next);
        const storedModel = window.localStorage.getItem(AI_MODEL_STORAGE_KEY);
        setSelectedModel(
          storedModel && next.models.includes(storedModel as AiModel)
            ? (storedModel as AiModel)
            : "gpt-5-mini"
        );
        setSelectedPromptKey(next.prompts[0]?.key ?? "");
        setError(null);
      } catch {
        if (!cancelled) {
          setError("Failed to load prompt catalog.");
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
      document.body.classList.remove("page-scrollable");
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AI_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  const selectedPrompt = useMemo<PromptDefinition | null>(
    () => catalog?.prompts.find((prompt) => prompt.key === selectedPromptKey) ?? null,
    [catalog, selectedPromptKey]
  );

  useEffect(() => {
    if (!selectedPrompt) {
      return;
    }
    setRunError(null);
    setResult(null);
    setActionConstraint(selectedPrompt.defaultActionConstraint ?? "");
    setCategoryConstraint("");
    if (selectedPrompt.kind === "recipe_batch") {
      setInputsText("");
    } else if (!inputsText.trim()) {
      setInputsText("Fire\nWater");
    }
  }, [selectedPromptKey]);

  async function handleRunPrompt() {
    if (!selectedPrompt) {
      return;
    }

    try {
      setIsRunning(true);
      setRunError(null);

      const next = await testPrompt({
        promptKey: selectedPrompt.key,
        model: selectedModel,
        inputs:
          selectedPrompt.kind === "combine" ? parseInputLines(inputsText) : undefined,
        actionConstraint:
          selectedPrompt.requiresActionConstraint ? actionConstraint.trim() : null,
        categoryConstraint:
          selectedPrompt.requiresCategoryConstraint ? categoryConstraint.trim() : null,
        pairs:
          selectedPrompt.kind === "recipe_batch"
            ? parseBatchPairs(batchPairsText)
            : undefined,
      });

      setResult(next);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to run prompt.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="prompts-page">
      <header className="prompts-page-header">
        <div>
          <div className="prompts-page-label">Prompt Admin</div>
          <h1 className="prompts-page-title">Prompt Lab</h1>
          <p className="prompts-page-copy">
            Test any live OpenAI prompt with custom inputs, inspect the exact rendered
            prompt, and compare outputs across models.
          </p>
        </div>
        <div className="prompts-page-actions">
          <a className="button" href="/">
            Back To Workspace
          </a>
          <a className="button" href="/cache">
            View Cache
          </a>
          <a className="button" href="/clusters">
            View Clusters
          </a>
        </div>
      </header>

      {isLoading ? (
        <div className="prompts-page-empty">Loading prompt catalog...</div>
      ) : error ? (
        <div className="prompts-page-empty">{error}</div>
      ) : !catalog || catalog.prompts.length === 0 ? (
        <div className="prompts-page-empty">No prompts available.</div>
      ) : (
        <div className="prompts-layout">
          <aside className="prompts-sidebar">
            <div className="prompts-sidebar-title">Available Prompts</div>
            <div className="prompts-sidebar-list">
              {catalog.prompts.map((prompt) => (
                <button
                  key={prompt.key}
                  type="button"
                  className={`prompts-sidebar-card${
                    selectedPromptKey === prompt.key ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedPromptKey(prompt.key)}
                >
                  <div className="prompts-sidebar-card-title">{prompt.title}</div>
                  <div className="prompts-sidebar-card-copy">{prompt.description}</div>
                </button>
              ))}
            </div>
          </aside>

          <section className="prompts-workbench">
            <div className="prompts-panel">
              <div className="prompts-panel-header">
                <div>
                  <div className="prompts-panel-label">Prompt Setup</div>
                  <h2 className="prompts-panel-title">{selectedPrompt?.title}</h2>
                </div>
                <label className="prompts-field prompts-model-field">
                  <span className="prompts-field-label">Model</span>
                  <select
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value as AiModel)}
                  >
                    {catalog.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedPrompt?.kind === "combine" ? (
                <label className="prompts-field">
                  <span className="prompts-field-label">Inputs</span>
                  <textarea
                    value={inputsText}
                    onChange={(event) => setInputsText(event.target.value)}
                    rows={7}
                    placeholder={"One input per line"}
                  />
                </label>
              ) : (
                <label className="prompts-field">
                  <span className="prompts-field-label">Pairs</span>
                  <textarea
                    value={batchPairsText}
                    onChange={(event) => setBatchPairsText(event.target.value)}
                    rows={7}
                    placeholder={"Left | Right"}
                  />
                </label>
              )}

              {selectedPrompt?.showsActionConstraint ? (
                <label className="prompts-field">
                  <span className="prompts-field-label">Action Anchor</span>
                  <input
                    type="text"
                    value={actionConstraint}
                    onChange={(event) => setActionConstraint(event.target.value)}
                    placeholder="split"
                  />
                </label>
              ) : null}

              {selectedPrompt?.showsCategoryConstraint ? (
                <label className="prompts-field">
                  <span className="prompts-field-label">Category Anchor</span>
                  <input
                    type="text"
                    value={categoryConstraint}
                    onChange={(event) => setCategoryConstraint(event.target.value)}
                    placeholder="pokemon"
                  />
                </label>
              ) : null}

              <div className="prompts-run-row">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void handleRunPrompt()}
                  disabled={isRunning}
                >
                  {isRunning ? "Running..." : "Run Prompt"}
                </button>
                {runError ? <div className="prompts-run-error">{runError}</div> : null}
              </div>
            </div>

            <div className="prompts-results-grid">
              <section className="prompts-panel">
                <div className="prompts-panel-label">Rendered Prompt</div>
                <pre className="prompts-code-block">
                  {result?.renderedPrompt ??
                    "Run a prompt to inspect the exact rendered text sent to OpenAI."}
                </pre>
              </section>

              <section className="prompts-panel">
                <div className="prompts-panel-label">Output</div>
                {result ? (
                  <>
                    <div className="prompts-result-meta">
                      <span>{result.promptTitle}</span>
                      <span>{result.model}</span>
                      {result.resolvedActionFamilyKey ? (
                        <span>Resolved family: {result.resolvedActionFamilyKey}</span>
                      ) : null}
                    </div>
                    <pre className="prompts-code-block">
                      {JSON.stringify(result.result, null, 2)}
                    </pre>
                  </>
                ) : (
                  <div className="prompts-page-empty prompts-inline-empty">
                    No output yet.
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default PromptsPage;
