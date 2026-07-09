import type { AppConfig, GeistrThinkingLevel } from "@geistr/core";
import type { DesktopApi, DesktopModelOption } from "../../shared/desktop-api";
import { SelectDropdown } from "../SelectDropdown";

interface ModelSettingsProps {
  config: AppConfig;
  api: DesktopApi;
  onConfigChange: (config: AppConfig) => void;
  connectedModelOptions: DesktopModelOption[];
}

export function ModelSettings({ config, api, onConfigChange, connectedModelOptions }: ModelSettingsProps) {
  const savedProvider = config?.model?.defaultProvider ?? "";
  const savedModelId = config?.model?.defaultModelId ?? "";
  const savedThinkingLevel = config?.model?.defaultThinkingLevel ?? "";

  // Derive unique providers from connected model options
  const providers = deriveUniqueProviders(connectedModelOptions);
  const selectedProvider = savedProvider && providers.includes(savedProvider) ? savedProvider : providers[0] ?? "";

  // Models for the selected provider
  const modelsForProvider = connectedModelOptions.filter((o) => o.provider === selectedProvider);
  const selectedModelId = savedModelId && modelsForProvider.some((o) => o.modelId === savedModelId) ? savedModelId : modelsForProvider[0]?.modelId ?? "";

  // Thinking levels for the selected model
  const selectedModel = modelsForProvider.find((o) => o.modelId === selectedModelId);
  const thinkingLevels = selectedModel?.thinkingLevels ?? [];
  const selectedThinkingLevel = savedThinkingLevel && thinkingLevels.includes(savedThinkingLevel as GeistrThinkingLevel) ? savedThinkingLevel : thinkingLevels.at(-1) ?? "";

  if (connectedModelOptions.length === 0) {
    return (
      <div className="settingsCard">
        <h2>Default Model</h2>
        <p>Connect a provider in Settings to choose a default model.</p>
      </div>
    );
  }

  /** Save default provider+model+thinking to config. */
  function saveProvider(p: string) {
    const models = connectedModelOptions.filter((o) => o.provider === p);
    const first = models[0];
    const levels = first?.thinkingLevels ?? [];
    void api?.updateAppConfig({
      model: {
        defaultProvider: p || null,
        defaultModelId: first?.modelId ?? null,
        defaultThinkingLevel: (levels.at(-1) as GeistrThinkingLevel) || null,
      },
    }).then(onConfigChange);
  }

  function saveModel(id: string) {
    const model = modelsForProvider.find((o) => o.modelId === id);
    const levels = model?.thinkingLevels ?? [];
    void api?.updateAppConfig({
      model: {
        defaultProvider: selectedProvider || null,
        defaultModelId: id || null,
        defaultThinkingLevel: (levels.at(-1) as GeistrThinkingLevel) || null,
      },
    }).then(onConfigChange);
  }

  function saveThinking(level: string) {
    void api?.updateAppConfig({
      model: {
        defaultProvider: selectedProvider || null,
        defaultModelId: selectedModelId || null,
        defaultThinkingLevel: (level as GeistrThinkingLevel) || null,
      },
    }).then(onConfigChange);
  }

  return (
    <div className="settingsCard">
      <h2>Default Model</h2>
      <p>Choose the fallback model. The model selected in the chat composer is remembered across restarts and used preferentially. This default only applies when no prior chat selection exists.</p>

      <div className="defaultModelControls">
        <label className="defaultModelField">
          <span>Provider</span>
          <SelectDropdown
            label="Default provider"
            value={selectedProvider}
            options={providers.map((p) => ({
              value: p,
              label: connectedModelOptions.find((o) => o.provider === p)?.providerName ?? p,
            }))}
            onChange={saveProvider}
          />
        </label>

        <label className="defaultModelField">
          <span>Model</span>
          <SelectDropdown
            label="Default model"
            value={selectedModelId}
            options={modelsForProvider.map((o) => ({
              value: o.modelId,
              label: o.modelName,
            }))}
            onChange={saveModel}
          />
        </label>

        {thinkingLevels.length > 0 ? (
          <label className="defaultModelField">
            <span>Thinking</span>
            <SelectDropdown
              label="Default thinking level"
              value={selectedThinkingLevel}
              options={thinkingLevels.map((level) => ({
                value: level,
                label: level,
              }))}
              onChange={saveThinking}
            />
          </label>
        ) : null}
      </div>

      <p className="themeNote">Composer picker choices are saved and used after reload. These defaults are only the fallback when nothing has been chosen in chat yet.</p>
    </div>
  );
}

function deriveUniqueProviders(options: DesktopModelOption[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const option of options) {
    if (!seen.has(option.provider)) {
      seen.add(option.provider);
      result.push(option.provider);
    }
  }
  return result;
}
