import type { PullRequest } from "../../lib/tauri/types";

export type Filter = "all" | "open" | "merged" | "closed";

export const filters: { label: string; value: Filter }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Merged", value: "merged" },
  { label: "Closed", value: "closed" },
];

export function pullRequestStatus(pullRequest: PullRequest) {
  return pullRequest.merged_at ? "merged" : pullRequest.state;
}

export function matchesFilter(pullRequest: PullRequest, filter: Filter) {
  return filter === "all" || pullRequestStatus(pullRequest) === filter;
}

export function matchesQuery(pullRequest: PullRequest, query: string) {
  const normalized = query.trim().toLowerCase();
  return !normalized
    || pullRequest.title.toLowerCase().includes(normalized)
    || pullRequest.repository_full_name.toLowerCase().includes(normalized)
    || String(pullRequest.number).includes(normalized);
}

export function filterPullRequests(pullRequests: PullRequest[], filter: Filter, query: string) {
  return pullRequests.filter(
    (pullRequest) => matchesFilter(pullRequest, filter) && matchesQuery(pullRequest, query),
  );
}

export function countByFilter(pullRequests: PullRequest[]): Record<Filter, number> {
  return {
    all: pullRequests.length,
    open: pullRequests.filter((pr) => pullRequestStatus(pr) === "open").length,
    merged: pullRequests.filter((pr) => pullRequestStatus(pr) === "merged").length,
    closed: pullRequests.filter((pr) => pullRequestStatus(pr) === "closed").length,
  };
}
