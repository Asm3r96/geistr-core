import { app } from "electron";
import path from "node:path";

export function getSessionDatabasePath(userDataPath = app.getPath("userData")): string {
  return path.join(userDataPath, "geistr-sessions.sqlite");
}
