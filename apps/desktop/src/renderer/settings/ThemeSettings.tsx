import { Monitor, Moon, Sun } from "lucide-react";

import type { AppConfig } from "@geistr/core";
import type { DesktopApi } from "../../shared/desktop-api";

interface ThemeSettingsProps {
  config: AppConfig;
  api: DesktopApi;
  onConfigChange: (config: AppConfig) => void;
}

export function ThemeSettings({ config, api, onConfigChange }: ThemeSettingsProps) {
  async function changeThemeMode(mode: AppConfig["appearance"]["themeMode"]) {
    if (!api || !config) return;
    const next = await api.updateAppConfig({ appearance: { themeMode: mode } });
    onConfigChange(next);
  }

  return (
    <div className="settingsCard themeSettings">
      <h2>Theme</h2>
      <p>Choose how Geistr looks. The design system supports dark and light themes with future custom theme support.</p>
      <fieldset className="themeModeGroup">
        <legend className="srOnly">Colour scheme</legend>
        <label className={config?.appearance.themeMode === "system" ? "themeModeOption selected" : "themeModeOption"}>
          <input type="radio" name="themeMode" value="system" checked={config?.appearance.themeMode === "system"} onChange={() => void changeThemeMode("system")} />
          <Monitor size={22} />
          <span>System</span>
        </label>
        <label className={config?.appearance.themeMode === "light" ? "themeModeOption selected" : "themeModeOption"}>
          <input type="radio" name="themeMode" value="light" checked={config?.appearance.themeMode === "light"} onChange={() => void changeThemeMode("light")} />
          <Sun size={22} />
          <span>Light</span>
        </label>
        <label className={config?.appearance.themeMode === "dark" ? "themeModeOption selected" : "themeModeOption"}>
          <input type="radio" name="themeMode" value="dark" checked={config?.appearance.themeMode === "dark"} onChange={() => void changeThemeMode("dark")} />
          <Moon size={22} />
          <span>Dark</span>
        </label>
      </fieldset>
      <p className="themeNote">System follows your OS colour scheme preference. Light and Dark override it.</p>
    </div>
  );
}
