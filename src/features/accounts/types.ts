import type { GitHubUser, Repository } from "../../lib/tauri/types";

/**
 * A connected account plus the local state Skillflow keeps alongside it.
 *
 * Deliberately holds no token: credentials live in Rust (`Accounts` state in
 * `src-tauri/src/lib.rs`) and are addressed by account id, so they never enter
 * webview memory or cross the IPC bridge.
 */
export type ConnectedAccount = GitHubUser & {
  repositories: Repository[];
  selectedRepositories: string[];
};
