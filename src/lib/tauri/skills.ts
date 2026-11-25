import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { Skill } from "./types";

/** Opens the native folder picker. Resolves to null when the user cancels. */
export async function pickSkillDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose a folder containing skills",
  });
  return typeof selected === "string" ? selected : null;
}

export async function scanSkillDirectory(root: string): Promise<Skill[]> {
  return invoke<Skill[]>("scan_skill_directory", { root });
}
