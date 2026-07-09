import type { ThemeMode } from "@geistr/core";

export interface DesktopWindowTheme {
  backgroundColor: string;
  titleBarSymbolColor: string;
  titleBarHeight: number;
  trafficLightPosition: { x: number; y: number };
}

const DARK_WINDOW_THEME: DesktopWindowTheme = {
  backgroundColor: "#101312",
  titleBarSymbolColor: "#c9cec7",
  titleBarHeight: 38,
  trafficLightPosition: { x: 12, y: 11 },
};

const LIGHT_WINDOW_THEME: DesktopWindowTheme = {
  backgroundColor: "#f5f4ef",
  titleBarSymbolColor: "#4f574f",
  titleBarHeight: 38,
  trafficLightPosition: { x: 12, y: 11 },
};

export function getDesktopWindowTheme(themeMode: ThemeMode, systemPrefersDark: boolean): DesktopWindowTheme {
  if (themeMode === "dark") return DARK_WINDOW_THEME;
  if (themeMode === "light") return LIGHT_WINDOW_THEME;
  return systemPrefersDark ? DARK_WINDOW_THEME : LIGHT_WINDOW_THEME;
}
