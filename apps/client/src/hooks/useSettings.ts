import { useEffect, useState } from "react";
import type { AiModel } from "../types";

export function useSettings({
  modelStorageKey,
  forceUnlocksStorageKey,
  supportedModels,
  defaultModel,
}: {
  modelStorageKey: string;
  forceUnlocksStorageKey: string;
  supportedModels: AiModel[];
  defaultModel: AiModel;
}) {
  const [selectedModel, setSelectedModel] = useState<AiModel>(defaultModel);
  const [forceUnlocks, setForceUnlocks] = useState(false);

  useEffect(() => {
    const storedModel = window.localStorage.getItem(modelStorageKey);
    if (storedModel && supportedModels.includes(storedModel as AiModel)) {
      setSelectedModel(storedModel as AiModel);
    }
    setForceUnlocks(window.localStorage.getItem(forceUnlocksStorageKey) === "true");
  }, [forceUnlocksStorageKey, modelStorageKey, supportedModels]);

  useEffect(() => {
    window.localStorage.setItem(modelStorageKey, selectedModel);
  }, [modelStorageKey, selectedModel]);

  useEffect(() => {
    window.localStorage.setItem(
      forceUnlocksStorageKey,
      forceUnlocks ? "true" : "false"
    );
  }, [forceUnlocks, forceUnlocksStorageKey]);

  return {
    selectedModel,
    setSelectedModel,
    forceUnlocks,
    setForceUnlocks,
  };
}
