import type { AppConfig } from "@geistr/core";
import type { DesktopApi } from "../../shared/desktop-api";

interface GeneralSettingsProps {
  config: AppConfig;
  api: DesktopApi;
  onConfigChange: (config: AppConfig) => void;
}

export function GeneralSettings({ config, api, onConfigChange }: GeneralSettingsProps) {
  async function setWebAccess(enabled: boolean) {
    if (!api || !config) return;
    const next = await api.updateAppConfig({ webAccess: { enabled } });
    onConfigChange(next);
  }

  async function setSessionCompaction(enabled: boolean) {
    if (!api || !config) return;
    const next = await api.updateAppConfig({ sessions: { compaction: { enabled } } });
    onConfigChange(next);
  }

  async function setMemory(enabled: boolean) {
    if (!api || !config) return;
    const next = await api.updateAppConfig({ memory: { enabled } });
    onConfigChange(next);
  }

  return (
    <div className="settingsStack">
      <header><h2>General</h2><p>Configure non‑secret app behaviour such as session handling, web access, and memory.</p></header>

      <div className="settingsCard">
        <h3>Web access</h3>
        <p>Allow the agent to search the web and fetch URLs using the built‑in web provider. When disabled, the agent loses <code>web_search</code> and <code>web_fetch</code> tools.</p>
        <label className="toggleRow">
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable web access"
            checked={config?.webAccess?.enabled ?? true}
            onChange={(e) => void setWebAccess(e.target.checked)}
          />
          <span>{config?.webAccess?.enabled ?? true ? "On" : "Off"}</span>
        </label>
      </div>

      <div className="settingsCard">
        <h3>Session history compaction</h3>
        <p>Automatically compact long conversation histories to reduce token usage.</p>
        <label className="toggleRow">
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable session compaction"
            checked={config?.sessions?.compaction?.enabled ?? true}
            onChange={(e) => void setSessionCompaction(e.target.checked)}
          />
          <span>{config?.sessions?.compaction?.enabled ?? true ? "On" : "Off"}</span>
        </label>
      </div>

      <div className="settingsCard">
        <h3>Cross‑session memory</h3>
        <p>Allow Geistr to remember information across conversations when enabled.</p>
        <label className="toggleRow">
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable memory"
            checked={config?.memory?.enabled ?? false}
            onChange={(e) => void setMemory(e.target.checked)}
          />
          <span>{config?.memory?.enabled ?? false ? "On" : "Off"}</span>
        </label>
      </div>
    </div>
  );
}
