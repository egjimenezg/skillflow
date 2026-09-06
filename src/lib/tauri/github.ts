import { invoke } from "@tauri-apps/api/core";

import type { ConnectionResponse, PullRequest } from "./types";

/**
 * The only module that calls `invoke`. Command names are stringly typed against
 * Rust, so keeping every call here means a rename in `src-tauri/src/lib.rs` has
 * exactly one place to follow it.
 *
 * The token is passed once, on connect, and is then owned by Rust. Every later
 * call addresses the account by id.
 */

export async function connectGitHubAccount(token: string): Promise<ConnectionResponse> {
  return invoke<ConnectionResponse>("connect_github_account", { token: token.trim() });
}

export async function disconnectGitHubAccount(accountId: number): Promise<void> {
  return invoke("disconnect_github_account", { accountId });
}

export async function listAuthoredPullRequests(params: {
  accountId: number;
  repositories: string[];
}): Promise<PullRequest[]> {
  return invoke<PullRequest[]>("list_authored_pull_requests", params);
}

/** Commands reject with a plain string; anything else is unexpected. */
export function commandErrorMessage(reason: unknown, fallback: string) {
  return typeof reason === "string" ? reason : fallback;
}
