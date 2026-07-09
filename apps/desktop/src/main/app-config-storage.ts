import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_APP_CONFIG, sanitizeAppConfig } from "@geistr/core";
import type { AppConfig } from "@geistr/core";

/**
 * Resolve the canonical app config file path inside Electron's userData directory.
 *
 * On macOS:   ~/Library/Application Support/Geistr/geistr-config.json
 * On Windows: %APPDATA%/Geistr/geistr-config.json
 * On Linux:   ~/.config/Geistr/geistr-config.json
 */
export function getAppConfigPath(): string {
  return path.join(app.getPath("userData"), "geistr-config.json");
}

/**
 * Read and sanitize the persisted app config.
 * Returns default config if the file is missing or corrupt.
 */
export async function readAppConfig(): Promise<AppConfig> {
  const filePath = getAppConfigPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return sanitizeAppConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APP_CONFIG };
  }
}

/**
 * Persist a (sanitized) app config to disk.
 * Creates the userData directory if it does not exist.
 */
export async function writeAppConfig(config: AppConfig): Promise<void> {
  const filePath = getAppConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
}
