import { useEffect, useMemo, useState } from "react";

import type { AppConfig, McpServerConfig, McpTransportType } from "@geistr/core";
import type { DesktopApi } from "../shared/desktop-api";

export function McpServersScreen({ api }: { api: DesktopApi }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [editingServer, setEditingServer] = useState<McpServerConfig | "new" | null>(null);

  useEffect(() => {
    void api.getAppConfig().then(setConfig);
  }, [api]);

  const servers = config?.mcp.servers ?? [];

  async function saveServers(nextServers: McpServerConfig[]) {
    const next = await api.updateAppConfig({ mcp: { servers: nextServers } });
    setConfig(next);
  }

  async function toggleServer(id: string) {
    await saveServers(servers.map((server) => server.id === id ? { ...server, enabled: !server.enabled, updatedAt: Date.now() } : server));
  }

  async function deleteServer(id: string) {
    await saveServers(servers.filter((server) => server.id !== id));
  }

  async function upsertServer(server: McpServerConfig) {
    const exists = servers.some((current) => current.id === server.id);
    await saveServers(exists ? servers.map((current) => current.id === server.id ? server : current) : [...servers, server]);
    setEditingServer(null);
  }

  return (
    <div className="settingsStack">
      <header className="settingsHeaderRow">
        <div>
          <h2>MCP Servers</h2>
          <p>Add custom MCP servers. Enabled servers connect to the agent runtime and expose their tools while active.</p>
        </div>
        <button className="settingsPrimaryButton compact" type="button" onClick={() => setEditingServer("new")}>Add server</button>
      </header>

      {servers.length === 0 ? (
        <div className="settingsCard mcpEmptyCard">MCP servers are not configured yet.</div>
      ) : (
        <div className="settingsList">
          {servers.map((server) => (
            <article className="settingsCard settingsListItem" key={server.id}>
              <div>
                <h3>{server.name}</h3>
                <p>{server.transport === "stdio" ? `STDIO · ${server.stdio?.command ?? ""}` : `Streamable HTTP · ${server.http?.url ?? ""}`}</p>
                <small>{server.enabled ? "Enabled · reconnects on next runtime refresh" : "Disabled"}</small>
              </div>
              <div className="settingsRowActions">
                <button type="button" onClick={() => setEditingServer(server)}>Configure</button>
                <button type="button" onClick={() => void toggleServer(server.id)}>{server.enabled ? "Disable" : "Enable"}</button>
                <button className="dangerInlineButton" type="button" onClick={() => void deleteServer(server.id)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editingServer ? (
        <AddMcpServerDialog
          {...(editingServer === "new" ? {} : { server: editingServer })}
          existingNames={servers.filter((server) => server.id !== (editingServer === "new" ? "" : editingServer.id)).map((server) => server.name)}
          onCancel={() => setEditingServer(null)}
          onSave={(server) => void upsertServer(server)}
        />
      ) : null}
    </div>
  );
}

function AddMcpServerDialog({ server, existingNames, onCancel, onSave }: { server?: McpServerConfig; existingNames: string[]; onCancel: () => void; onSave: (server: McpServerConfig) => void }) {
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<McpTransportType>(server?.transport ?? "stdio");
  const [command, setCommand] = useState(server?.stdio?.command ?? "");
  const [argsText, setArgsText] = useState(server?.stdio?.args.join("\n") ?? "");
  const [cwd, setCwd] = useState(server?.stdio?.cwd ?? "");
  const [envText, setEnvText] = useState(server?.stdio?.env.map((row) => `${row.key}=${row.value ?? ""}`).join("\n") ?? "");
  const [passthroughText, setPassthroughText] = useState(server?.stdio?.envPassthrough.join("\n") ?? "");
  const [url, setUrl] = useState(server?.http?.url ?? "");
  const [auth, setAuth] = useState<"none" | "api-key">(server?.http?.auth === "api-key" ? "api-key" : "none");
  const [headerName, setHeaderName] = useState(server?.http?.headers?.[0]?.key ?? "Authorization");
  const [apiKey, setApiKey] = useState(server?.http?.headers?.[0]?.value ?? "");

  const error = useMemo(() => validate(), [name, transport, command, url, existingNames]);

  function validate(): string | null {
    if (!name.trim()) return "Name is required.";
    if (existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase())) return "A server with this name already exists.";
    if (transport === "stdio" && !command.trim()) return "Command is required.";
    if (transport === "streamable-http" && !url.trim()) return "Server URL is required.";
    return null;
  }

  function handleSave(enable: boolean) {
    if (error) return;
    const now = Date.now();
    const id = server?.id ?? `mcp_${now.toString(36)}`;
    const nextServer: McpServerConfig = transport === "stdio" ? {
      id,
      name: name.trim(),
      enabled: enable,
      transport,
      stdio: {
        command: command.trim(),
        args: splitLines(argsText),
        cwd: cwd.trim() || null,
        env: parseEnvRows(envText, id),
        envPassthrough: splitLines(passthroughText),
      },
      createdAt: server?.createdAt ?? now,
      updatedAt: now,
    } : {
      id,
      name: name.trim(),
      enabled: enable,
      transport,
      http: {
        url: url.trim(),
        auth,
        headers: auth === "api-key" ? [{ key: headerName.trim() || "Authorization", value: apiKey, secretRef: `mcp:${id}:header:${headerName.trim() || "Authorization"}` }] : [],
      },
      createdAt: server?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(nextServer);
  }

  return (
    <div className="dialogOverlay" role="presentation">
      <section className="confirmDialog mcpDialog" role="dialog" aria-modal="true" aria-labelledby="mcp-add-title">
        <button className="dialogClose" type="button" aria-label="Close dialog" onClick={onCancel}>×</button>
        <h2 id="mcp-add-title">{server ? "Configure MCP server" : "Add MCP server"}</h2>
        <label className="settingsField"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="settingsSegmented" role="tablist" aria-label="Transport">
          <button type="button" className={transport === "stdio" ? "selected" : ""} onClick={() => setTransport("stdio")}>STDIO</button>
          <button type="button" className={transport === "streamable-http" ? "selected" : ""} onClick={() => setTransport("streamable-http")}>Streamable HTTP</button>
        </div>
        {transport === "stdio" ? (
          <>
            <label className="settingsField"><span>Command to launch</span><input placeholder="npx" value={command} onChange={(event) => setCommand(event.target.value)} /></label>
            <label className="settingsField"><span>Arguments (one per line)</span><textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} /></label>
            <label className="settingsField"><span>Environment variables (KEY=value, one per line)</span><textarea value={envText} onChange={(event) => setEnvText(event.target.value)} /></label>
            <label className="settingsField"><span>Environment passthrough keys</span><textarea value={passthroughText} onChange={(event) => setPassthroughText(event.target.value)} /></label>
            <label className="settingsField"><span>Working directory</span><input value={cwd} onChange={(event) => setCwd(event.target.value)} /></label>
          </>
        ) : (
          <>
            <label className="settingsField"><span>Server URL</span><input placeholder="https://mcp.exa.ai/mcp" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
            <label className="settingsField"><span>Auth mode</span><select value={auth} onChange={(event) => setAuth(event.target.value as "none" | "api-key")}><option value="none">None</option><option value="api-key">API key / bearer token</option></select></label>
            {auth === "api-key" ? <><label className="settingsField"><span>Header name</span><input value={headerName} onChange={(event) => setHeaderName(event.target.value)} /></label><label className="settingsField"><span>Secret value</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label></> : null}
          </>
        )}
        {error ? <p className="settingsError">{error}</p> : null}
        <div className="dialogActions"><button className="dialogSecondary" type="button" onClick={onCancel}>Cancel</button><button className="dialogSecondary" type="button" disabled={Boolean(error)} onClick={() => handleSave(server?.enabled ?? false)}>Save</button><button className="dialogPrimary" type="button" disabled={Boolean(error)} onClick={() => handleSave(true)}>Save & Enable</button></div>
      </section>
    </div>
  );
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseEnvRows(text: string, serverId: string): Array<{ key: string; secretRef: string; value?: string }> {
  return splitLines(text).flatMap((line) => {
    const [rawKey, ...valueParts] = line.split("=");
    const key = rawKey?.trim();
    const value = valueParts.join("=");
    return key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? [{ key, value, secretRef: `mcp:${serverId}:env:${key}` }] : [];
  });
}
