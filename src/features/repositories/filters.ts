import type { Repository } from "../../lib/tauri/types";

export function filterRepositories(repositories: Repository[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return repositories;
  return repositories.filter(
    (repository) =>
      repository.full_name.toLowerCase().includes(normalized)
      || repository.description?.toLowerCase().includes(normalized),
  );
}
