import type { ReactNode } from "react";

import type { Skill } from "../../lib/tauri/types";
import { useSkillInventory } from "./useSkillInventory";

/** Shortens a long absolute path for display, keeping the meaningful tail. */
function shortPath(path: string, home = "") {
  const withoutHome = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  const segments = withoutHome.split("/");
  return segments.length > 4 ? `…/${segments.slice(-3).join("/")}` : withoutHome;
}

function SkillRow({ skill }: { skill: Skill }) {
  return (
    <div className="skill-row">
      <div className="skill-info">
        <div className="skill-title-line">
          <strong>{skill.name}</strong>
          {skill.user_invocable && <span className="invocable-badge">/{skill.name}</span>}
        </div>
        <p>{skill.description || "No description"}</p>
        <code className="skill-path">{shortPath(skill.source)}</code>
      </div>
      {skill.allowed_tools.length > 0 && (
        <span className="tool-count" title={skill.allowed_tools.join(", ")}>
          {skill.allowed_tools.length} tool{skill.allowed_tools.length === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

export function SkillInventory({ searchIcon }: { searchIcon: ReactNode }) {
  const {
    root, skills, visibleSkills, query, setQuery,
    scanning, error, hasScanned, chooseDirectory, rescan,
  } = useSkillInventory();

  return (
    <section className="repository-card" aria-labelledby="skills-title">
      <div className="repository-header">
        <div>
          <p className="section-kicker">SKILLS</p>
          <h2 id="skills-title">Skill inventory</h2>
          <p>
            {root
              ? <>Reading <code className="skill-path">{shortPath(root)}</code></>
              : "Choose a folder to read the skills it contains."}
          </p>
        </div>
        <div className="skill-header-actions">
          {root && (
            <button className="select-all-button" disabled={scanning} onClick={rescan} type="button">
              Rescan
            </button>
          )}
          <button className="load-button" disabled={scanning} onClick={chooseDirectory} type="button">
            {scanning ? <><span className="spinner" />Reading…</> : root ? "Change folder" : "Choose folder"}
          </button>
        </div>
      </div>

      {error && <div className="error-message" role="alert">{error}</div>}

      {hasScanned && skills.length > 0 && (
        <div className="repository-toolbar">
          <div className="repo-search">
            {searchIcon}
            <input
              aria-label="Search skills"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills…"
              value={query}
            />
          </div>
          <span className="selection-count">
            {visibleSkills.length} of {skills.length} skill{skills.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {hasScanned && (
        <div className="repository-list" aria-live="polite">
          {visibleSkills.length ? (
            visibleSkills.map((skill) => <SkillRow key={skill.id} skill={skill} />)
          ) : (
            <div className="no-repositories">
              <h3>{skills.length ? "No matching skills" : "No skills found"}</h3>
              <p>
                {skills.length
                  ? "Try a different search term."
                  : "This folder contains no SKILL.md files. Pick the folder that holds your skill directories."}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
