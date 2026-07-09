import { useCallback, useEffect, useState } from "react";

import type { DesktopApi, DesktopAssistantProfile } from "../../shared/desktop-api";

interface AgentSettingsProps {
  api: DesktopApi;
}

/**
 * Agent settings page for editing the assistant's identity profile.
 *
 * The primary editable field is Soul — the assistant's deep identity,
 * emotional posture, and backbone.
 *
 * Other fields (Name, Role, Style, Boundaries, Memory guidance) are
 * secondary edits. Persona summary is an optional internal summary
 * field shown under an "Advanced" toggle.
 */
export function AgentSettings({ api }: AgentSettingsProps) {
  const [profile, setProfile] = useState<DesktopAssistantProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);

  // Local draft state
  const [soul, setSoul] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [style, setStyle] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [memoryGuidance, setMemoryGuidance] = useState("");
  const [personaSummary, setPersonaSummary] = useState("");

  useEffect(() => {
    void api.getAssistantProfile().then((next) => {
      setProfile(next);
      setSoul(next.soulPrompt);
      setName(next.assistantName);
      setRole(next.rolePrompt);
      setStyle(next.stylePrompt);
      setBoundaries(next.boundaryPrompt);
      setMemoryGuidance(next.memoryPrompt);
      setPersonaSummary(next.personaSummary);
    });
  }, [api]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaved(false);
  }, []);

  async function save() {
    if (!api || saving) return;
    setSaving(true);
    try {
      const next = await api.updateAssistantProfile({
        soulPrompt: soul,
        assistantName: name,
        rolePrompt: role,
        stylePrompt: style,
        boundaryPrompt: boundaries,
        memoryPrompt: memoryGuidance,
        personaSummary,
      });
      setProfile(next);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="settingsStack">
        <header><h2>Agent</h2><p>Loading profile…</p></header>
      </div>
    );
  }

  return (
    <div className="settingsStack">
      <header>
        <h2>Agent</h2>
        <p>Configure the assistant's identity, voice, and behavioural boundaries.</p>
      </header>

      <div className="settingsCard">
        <h3>Soul</h3>
        <p>The assistant's deep identity — emotional posture, backbone, taste, and relationship stance. This is the core definition of who the assistant is.</p>
        <textarea
          className="settingsTextarea"
          aria-label="Soul"
          rows={6}
          value={soul}
          onChange={(e) => { setSoul(e.target.value); markDirty(); }}
        />
      </div>

      <div className="settingsCard">
        <h3>Name</h3>
        <p>What the assistant calls itself. Leave empty to use the default "no confirmed name" identity.</p>
        <input
          className="settingsInput"
          type="text"
          aria-label="Assistant name"
          placeholder="e.g. Aria"
          value={name}
          onChange={(e) => { setName(e.target.value); markDirty(); }}
        />
      </div>

      <div className="settingsCard">
        <h3>Role</h3>
        <p>The assistant's core job, purpose, and relationship to the user.</p>
        <textarea
          className="settingsTextarea"
          aria-label="Role"
          rows={4}
          value={role}
          onChange={(e) => { setRole(e.target.value); markDirty(); }}
        />
      </div>

      <div className="settingsCard">
        <h3>Style</h3>
        <p>How the assistant communicates — tone, cadence, and verbal approach.</p>
        <textarea
          className="settingsTextarea"
          aria-label="Style"
          rows={4}
          value={style}
          onChange={(e) => { setStyle(e.target.value); markDirty(); }}
        />
      </div>

      <div className="settingsCard">
        <h3>Boundaries</h3>
        <p>What the assistant will and will not do — safety, permissions, and scope guardrails.</p>
        <textarea
          className="settingsTextarea"
          aria-label="Boundaries"
          rows={4}
          value={boundaries}
          onChange={(e) => { setBoundaries(e.target.value); markDirty(); }}
        />
      </div>

      <div className="settingsCard">
        <h3>Memory guidance</h3>
        <p>How the assistant should treat durable memory — what to store and what to keep out.</p>
        <textarea
          className="settingsTextarea"
          aria-label="Memory guidance"
          rows={3}
          value={memoryGuidance}
          onChange={(e) => { setMemoryGuidance(e.target.value); markDirty(); }}
        />
      </div>

      <details className="settingsAdvancedToggle" onToggle={(e) => setShowAdvanced(e.currentTarget.open)}>
        <summary>Advanced</summary>
        {showAdvanced && (
          <div className="settingsCard">
            <h3>Persona summary</h3>
            <p>Internal summary/fallback field used when role, soul, or style are not explicitly set.</p>
            <textarea
              className="settingsTextarea"
              aria-label="Persona summary"
              rows={3}
              value={personaSummary}
              onChange={(e) => { setPersonaSummary(e.target.value); markDirty(); }}
            />
          </div>
        )}
      </details>

      <div className="settingsActions">
        <button
          className="primaryButton"
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
