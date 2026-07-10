import { useEffect, useState } from "react";

import type { DesktopApi, DesktopChatState, DesktopProviderSettingsState } from "../../shared/desktop-api";

interface ProvidersSettingsProps {
  state: DesktopChatState;
  api: DesktopApi;
  onStateChange: (state: DesktopChatState) => void;
}

export function ProvidersSettings({ state, api, onStateChange }: ProvidersSettingsProps) {
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [editingApiKeyProvider, setEditingApiKeyProvider] = useState<string | null>(null);

  // Google OAuth client config
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleConfigSaved, setGoogleConfigSaved] = useState(false);
  const [showGoogleConfig, setShowGoogleConfig] = useState(false);

  // Load saved Google OAuth config on mount
  useEffect(() => {
    if (!api) return;
    void api.getGoogleOAuthConfig().then((config) => {
      if (config.clientId || config.clientSecret) {
        setGoogleClientId(config.clientId);
        setGoogleClientSecret(config.clientSecret);
        setGoogleConfigSaved(true);
      }
      setShowGoogleConfig(false);
    });
  }, [api]);

  const providerQuery = providerSearch.trim().toLowerCase();
  const visibleLoginProviders = state.settings.providers.loginProviders
    .filter((provider) => {
      if (!providerQuery) return true;
      return `${provider.name} ${provider.id}`.toLowerCase().includes(providerQuery);
    })
    .sort(compareConfiguredFirst((provider) => provider.name));
  const visibleApiKeyProviders = state.settings.providers.apiKeyProviders
    .filter((provider) => {
      if (!providerQuery) return true;
      return `${provider.providerName} ${provider.provider}`.toLowerCase().includes(providerQuery);
    })
    .sort(compareConfiguredFirst((provider) => provider.providerName));

  async function saveApiKey(provider: string) {
    if (!api) return;
    onStateChange(await api.saveProviderApiKey(provider, apiKeyDrafts[provider] ?? ""));
    setApiKeyDrafts((drafts) => ({ ...drafts, [provider]: "" }));
    setEditingApiKeyProvider(null);
  }

  async function saveGoogleConfig() {
    if (!api) return;
    await api.saveGoogleOAuthConfig({ clientId: googleClientId.trim(), clientSecret: googleClientSecret.trim() });
    setGoogleConfigSaved(true);
    setShowGoogleConfig(false);
  }

  async function connectLoginProvider(provider: string) {
    if (!api || connectingProvider) return;
    setConnectingProvider(provider);
    try {
      onStateChange(await api.connectLoginProvider(provider));
    } finally {
      setConnectingProvider(null);
    }
  }

  async function removeProviderAuth(provider: string) {
    if (!api || connectingProvider) return;
    onStateChange(await api.removeProviderAuth(provider));
    setApiKeyDrafts((drafts) => ({ ...drafts, [provider]: "" }));
    if (editingApiKeyProvider === provider) setEditingApiKeyProvider(null);
  }

  function cancelApiKeyEdit(provider: string) {
    setApiKeyDrafts((drafts) => ({ ...drafts, [provider]: "" }));
    setEditingApiKeyProvider(null);
  }

  return (
    <div className="settingsStack">
      <header><h2>Providers</h2><p>Connect subscription providers or save API keys through Geistr's Pi-backed auth layer.</p></header>
      <input className="providerSearchInput" aria-label="Search providers" placeholder="Search providers…" value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} />
      {state.settings.providers.lastAuthEvent ? <div className="authNotice">{state.settings.providers.lastAuthEvent}</div> : null}
      <div className="settingsCard">
        <h3>Subscription / login providers</h3>
        {visibleLoginProviders.length === 0 ? <div className="settingsEmpty">No matching login providers</div> : null}
        {visibleLoginProviders.map((provider) => {
          const shouldShowGoogleConfig = provider.id === "google-oauth" && (showGoogleConfig || (!googleConfigSaved && !provider.configured));
          return (
          <div className={provider.configured ? "providerRow connected" : "providerRow"} key={provider.id}>
            <div>
              <strong>{provider.name}</strong>
              <small>{provider.configured ? "Connected" : provider.usesCallbackServer ? "Browser/callback login" : "Login available"}</small>
            </div>
            {provider.configured ? <span className="connectedBadge">Connected</span> : null}
            <div className="providerActions">
              {provider.id === "google-oauth" && !shouldShowGoogleConfig ? (
                <button className="secondaryButton" type="button" onClick={() => setShowGoogleConfig(true)}>Update config</button>
              ) : null}
              <button type="button" disabled={Boolean(connectingProvider)} onClick={() => void connectLoginProvider(provider.id)}>
                {connectingProvider === provider.id ? "Connecting…" : provider.configured ? "Reconnect" : "Connect"}
              </button>
              {provider.configured ? (
                <button className="secondaryButton" type="button" disabled={Boolean(connectingProvider)} onClick={() => void removeProviderAuth(provider.id)}>
                  Disconnect
                </button>
              ) : null}
            </div>
            {shouldShowGoogleConfig ? (
              <div className="googleOAuthConfig">
                <input
                  aria-label="Google OAuth Client ID"
                  type="text"
                  placeholder="Client ID (e.g. ...apps.googleusercontent.com)"
                  value={googleClientId}
                  onChange={(event) => { setGoogleClientId(event.target.value); setGoogleConfigSaved(false); }}
                />
                <input
                  aria-label="Google OAuth Client Secret"
                  type="password"
                  placeholder="Client Secret (e.g. GOCSPX-...)"
                  value={googleClientSecret}
                  onChange={(event) => { setGoogleClientSecret(event.target.value); setGoogleConfigSaved(false); }}
                />
                <div className="providerActions">
                  <button type="button" onClick={() => void saveGoogleConfig()}>Save config</button>
                  {googleConfigSaved ? (
                    <button className="secondaryButton" type="button" onClick={() => setShowGoogleConfig(false)}>Cancel</button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          );
        })}
      </div>
      <div className="settingsCard">
        <h3>API key providers</h3>
        {visibleApiKeyProviders.length === 0 ? <div className="settingsEmpty">No matching API key providers</div> : null}
        {visibleApiKeyProviders.map((provider) => {
          const isEditingKey = !provider.configured || editingApiKeyProvider === provider.provider;
          return (
            <div className={provider.configured ? "providerRow apiKeyRow connected" : "providerRow apiKeyRow"} key={provider.provider}>
              <div>
                <strong>{provider.providerName}</strong>
                <small>{provider.configured ? `Configured${provider.source ? ` via ${provider.source}` : ""}` : "Not configured"}</small>
              </div>
              {provider.configured ? <span className="connectedBadge">Connected</span> : null}
              {isEditingKey ? (
                <input
                  aria-label={`${provider.providerName} API key`}
                  type="password"
                  placeholder={provider.configured ? "Paste new API key" : "Paste API key"}
                  value={apiKeyDrafts[provider.provider] ?? ""}
                  onChange={(event) => setApiKeyDrafts((drafts) => ({ ...drafts, [provider.provider]: event.target.value }))}
                />
              ) : null}
              {isEditingKey ? (
                <div className="providerActions">
                  <button type="button" onClick={() => void saveApiKey(provider.provider)}>{provider.configured ? "Update key" : "Save key"}</button>
                  {provider.configured ? (
                    <button className="secondaryButton" type="button" aria-label={`Cancel ${provider.providerName} API key update`} onClick={() => cancelApiKeyEdit(provider.provider)}>Cancel</button>
                  ) : null}
                  {provider.configured ? (
                    <button className="secondaryButton" type="button" aria-label={`Remove ${provider.providerName} API key`} onClick={() => void removeProviderAuth(provider.provider)}>Remove key</button>
                  ) : null}
                </div>
              ) : (
                <div className="providerActions">
                  <button type="button" onClick={() => setEditingApiKeyProvider(provider.provider)}>Update key</button>
                  <button className="secondaryButton" type="button" aria-label={`Remove ${provider.providerName} API key`} onClick={() => void removeProviderAuth(provider.provider)}>Remove key</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function compareConfiguredFirst<T extends { configured: boolean }>(getLabel: (item: T) => string) {
  return (left: T, right: T) => {
    if (left.configured !== right.configured) return left.configured ? -1 : 1;
    return getLabel(left).localeCompare(getLabel(right));
  };
}
