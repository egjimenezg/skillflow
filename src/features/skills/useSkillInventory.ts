import { useCallback, useMemo, useState } from "react";

import { commandErrorMessage } from "../../lib/tauri/github";
import { pickSkillDirectory, scanSkillDirectory } from "../../lib/tauri/skills";
import type { Skill } from "../../lib/tauri/types";

/** Owns the chosen skills directory and the inventory read from it. */
export function useSkillInventory() {
  const [root, setRoot] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [hasScanned, setHasScanned] = useState(false);

  const scan = useCallback(async (directory: string) => {
    setScanning(true);
    setError("");
    try {
      setSkills(await scanSkillDirectory(directory));
      setRoot(directory);
      setHasScanned(true);
    } catch (reason) {
      setSkills([]);
      setHasScanned(false);
      setError(commandErrorMessage(reason, "Could not read that directory."));
    } finally {
      setScanning(false);
    }
  }, []);

  const chooseDirectory = useCallback(async () => {
    try {
      const directory = await pickSkillDirectory();
      if (directory) await scan(directory);
    } catch (reason) {
      setError(commandErrorMessage(reason, "Could not open the folder picker."));
    }
  }, [scan]);

  const rescan = useCallback(() => (root ? scan(root) : undefined), [root, scan]);

  const visibleSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(normalized)
        || skill.description.toLowerCase().includes(normalized),
    );
  }, [query, skills]);

  return {
    root, skills, visibleSkills, query, setQuery,
    scanning, error, hasScanned, chooseDirectory, rescan,
  };
}
