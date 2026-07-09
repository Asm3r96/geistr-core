import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DesktopApi, DesktopSkillsState } from "../shared/desktop-api";

interface SkillsScreenProps {
  api: DesktopApi;
}

export function SkillsScreen({ api }: SkillsScreenProps) {
  const [skillsState, setSkillsState] = useState<DesktopSkillsState | null>(null);

  useEffect(() => {
    let mounted = true;
    void api.getSkillsState().then((next) => {
      if (mounted) setSkillsState(next);
    });
    return () => { mounted = false; };
  }, [api]);

  const builtins = skillsState?.builtinSkills ?? [];
  const userSkills = skillsState?.userSkills ?? [];

  return (
    <div className="settingsStack">
      <header>
        <h2>Skills</h2>
        <p>Skills are reusable instructions agents can load when a task needs focused guidance.</p>
      </header>

      <SkillGroup title="Built-in skills" empty="No built-in skills found." skills={builtins} api={api} onSkillsStateChange={setSkillsState} />
      <SkillGroup title="Installed skills" empty="No installed skills yet." skills={userSkills} api={api} onSkillsStateChange={setSkillsState} />
    </div>
  );
}

function SkillGroup({ title, empty, skills, api, onSkillsStateChange }: {
  title: string;
  empty: string;
  skills: DesktopSkillsState["builtinSkills"];
  api: DesktopApi;
  onSkillsStateChange: (state: DesktopSkillsState) => void;
}) {
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openMenuFor) return;
    function handlePointerDown(event: PointerEvent) {
      if (!sectionRef.current?.contains(event.target as Node)) setOpenMenuFor(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openMenuFor]);

  async function setActive(name: string, active: boolean) {
    onSkillsStateChange(await api.setSkillActive(name, active));
    setOpenMenuFor(null);
  }

  async function deleteSkill(name: string) {
    onSkillsStateChange(await api.deleteUserSkill(name));
    setOpenMenuFor(null);
  }

  return (
    <section className="skillSection" ref={sectionRef}>
      <h3>{title}</h3>
      {skills.length === 0 ? <div className="settingsEmpty">{empty}</div> : null}
      <div className="skillList">
        {skills.map((skill) => (
          <article className="skillCard" key={`${skill.source}:${skill.name}`}>
            <div className="skillCardHeader">
              <h4>{skill.name}{!skill.active ? <span className="skillStatusBadge">Deactivated</span> : null}</h4>
              <div className="skillMenuWrap">
                <button className="iconButton" type="button" aria-label={`Skill settings for ${skill.name}`} onClick={() => setOpenMenuFor(openMenuFor === skill.name ? null : skill.name)}><Settings size={14} /></button>
                {openMenuFor === skill.name ? (
                  <div className="skillMenu">
                    <button type="button" onClick={() => void setActive(skill.name, !skill.active)}>{skill.active ? "Deactivate" : "Activate"}</button>
                    {skill.source === "user" ? <button className="dangerMenuItem" type="button" onClick={() => void deleteSkill(skill.name)}>Delete skill</button> : null}
                  </div>
                ) : null}
              </div>
            </div>
            <p>{skill.description || "No description provided."}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
