/**
 * Wire types for the payloads exchanged with the Rust backend.
 *
 * These mirror what `src-tauri/src/lib.rs` returns. The commands currently
 * answer with `serde_json::Value`, so these shapes are a contract we maintain
 * by hand — keep them in sync when a command's response changes.
 */

export type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
};

export type Repository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
  owner: { login: string; avatar_url: string };
};

export type ConnectionResponse = {
  account: GitHubUser;
  repositories: Repository[];
};

export type PullRequest = {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  repository_full_name: string;
  user: { login: string; avatar_url: string };
  head: { ref: string };
  base: { ref: string };
};

/** A skill discovered by scanning a directory for `SKILL.md` files. */
export type Skill = {
  /** Absolute path to the SKILL.md; unique within an inventory. */
  id: string;
  name: string;
  description: string;
  /** Directory holding the skill — disambiguates same-named skills. */
  source: string;
  user_invocable: boolean;
  allowed_tools: string[];
};
