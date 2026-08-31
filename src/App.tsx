import { FormEvent, ReactNode, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
};

type Repository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
  owner: { login: string; avatar_url: string };
};

type ConnectedAccount = GitHubUser & {
  token: string;
  repositories: Repository[];
  selectedRepositories: string[];
};

type ConnectionResponse = {
  account: GitHubUser;
  repositories: Repository[];
};

type PullRequest = {
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

type Filter = "all" | "open" | "merged" | "closed";

const filters: { label: string; value: Filter }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Merged", value: "merged" },
  { label: "Closed", value: "closed" },
];

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>{children}</svg>;
}

const PullIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="2" />
    <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="2" />
    <path d="M6 8v11M18 15V9a4 4 0 0 0-4-4h-2m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
  </Icon>
);

function relativeDate(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000], ["month", 2_592_000], ["week", 604_800],
    ["day", 86_400], ["hour", 3_600], ["minute", 60],
  ];
  for (const [unit, amount] of ranges) {
    if (Math.abs(seconds) >= amount) return formatter.format(Math.round(seconds / amount), unit);
  }
  return "just now";
}

function App() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [showConnect, setShowConnect] = useState(true);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [loadingPullRequests, setLoadingPullRequests] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");

  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  const visibleRepositories = useMemo(() => {
    const normalized = repositoryQuery.trim().toLowerCase();
    return activeAccount?.repositories.filter((repository) =>
      !normalized || repository.full_name.toLowerCase().includes(normalized)
        || repository.description?.toLowerCase().includes(normalized),
    ) ?? [];
  }, [activeAccount, repositoryQuery]);

  const counts = useMemo(() => ({
    all: pullRequests.length,
    open: pullRequests.filter((pr) => pr.state === "open").length,
    merged: pullRequests.filter((pr) => Boolean(pr.merged_at)).length,
    closed: pullRequests.filter((pr) => pr.state === "closed" && !pr.merged_at).length,
  }), [pullRequests]);

  const visiblePullRequests = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return pullRequests.filter((pr) => {
      const matchesFilter = activeFilter === "all"
        || (activeFilter === "open" && pr.state === "open")
        || (activeFilter === "merged" && Boolean(pr.merged_at))
        || (activeFilter === "closed" && pr.state === "closed" && !pr.merged_at);
      const matchesQuery = !normalizedQuery || pr.title.toLowerCase().includes(normalizedQuery)
        || pr.repository_full_name.toLowerCase().includes(normalizedQuery) || String(pr.number).includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [activeFilter, pullRequests, query]);

  function updateActiveAccount(update: (account: ConnectedAccount) => ConnectedAccount) {
    setAccounts((current) => current.map((account) => account.id === activeAccountId ? update(account) : account));
  }

  async function connectAccount(event: FormEvent) {
    event.preventDefault();
    if (!tokenInput.trim()) {
      setError("Enter a fine-grained personal access token.");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const result = await invoke<ConnectionResponse>("connect_github_account", { token: tokenInput.trim() });
      const existing = accounts.find((account) => account.id === result.account.id);
      const availableNames = new Set(result.repositories.map((repository) => repository.full_name));
      const connected: ConnectedAccount = {
        ...result.account,
        token: tokenInput.trim(),
        repositories: result.repositories,
        selectedRepositories: existing?.selectedRepositories.filter((name) => availableNames.has(name)) ?? [],
      };
      setAccounts((current) => [...current.filter((account) => account.id !== connected.id), connected]);
      setActiveAccountId(connected.id);
      setTokenInput("");
      setShowConnect(false);
      setPullRequests([]);
      setHasLoaded(false);
      setRepositoryQuery("");
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Unable to connect this GitHub account.");
    } finally {
      setConnecting(false);
    }
  }

  function selectAccount(id: number) {
    setActiveAccountId(id);
    setShowConnect(false);
    setRepositoryQuery("");
    setPullRequests([]);
    setHasLoaded(false);
    setError("");
  }

  function disconnectAccount() {
    if (!activeAccount) return;
    const remaining = accounts.filter((account) => account.id !== activeAccount.id);
    setAccounts(remaining);
    setActiveAccountId(remaining[0]?.id ?? null);
    setShowConnect(remaining.length === 0);
    setPullRequests([]);
    setHasLoaded(false);
    setError("");
  }

  function toggleRepository(fullName: string) {
    updateActiveAccount((account) => ({
      ...account,
      selectedRepositories: account.selectedRepositories.includes(fullName)
        ? account.selectedRepositories.filter((name) => name !== fullName)
        : [...account.selectedRepositories, fullName],
    }));
    setHasLoaded(false);
  }

  function toggleVisibleRepositories() {
    if (!activeAccount) return;
    const visibleNames = visibleRepositories.map((repository) => repository.full_name);
    const allVisibleSelected = visibleNames.length > 0
      && visibleNames.every((name) => activeAccount.selectedRepositories.includes(name));
    updateActiveAccount((account) => ({
      ...account,
      selectedRepositories: allVisibleSelected
        ? account.selectedRepositories.filter((name) => !visibleNames.includes(name))
        : [...new Set([...account.selectedRepositories, ...visibleNames])],
    }));
    setHasLoaded(false);
  }

  async function loadPullRequests() {
    if (!activeAccount?.selectedRepositories.length) {
      setError("Select at least one repository.");
      return;
    }
    setLoadingPullRequests(true);
    setError("");
    try {
      const results = await invoke<PullRequest[]>("list_authored_pull_requests", {
        repositories: activeAccount.selectedRepositories,
        author: activeAccount.login,
        token: activeAccount.token,
      });
      setPullRequests(results);
      setHasLoaded(true);
      setActiveFilter("all");
      setQuery("");
    } catch (reason) {
      setPullRequests([]);
      setHasLoaded(false);
      setError(typeof reason === "string" ? reason : "Unable to load pull requests.");
    } finally {
      setLoadingPullRequests(false);
    }
  }

  const allVisibleSelected = Boolean(visibleRepositories.length)
    && visibleRepositories.every((repository) => activeAccount?.selectedRepositories.includes(repository.full_name));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><PullIcon size={17} /></div><span>Skillflow</span></div>
        <nav aria-label="Main navigation">
          <p className="nav-heading">Workspace</p>
          <button className="nav-item active" type="button"><PullIcon />Pull requests</button>
          {accounts.length > 0 && <p className="nav-heading accounts-heading">Accounts</p>}
          {accounts.map((account) => (
            <button className={`account-nav ${account.id === activeAccountId ? "active" : ""}`} key={account.id} onClick={() => selectAccount(account.id)} type="button">
              <img alt="" src={account.avatar_url} /><span><strong>{account.name || account.login}</strong><small>@{account.login}</small></span>
            </button>
          ))}
          <button className="add-account-nav" onClick={() => { setShowConnect(true); setError(""); }} type="button"><span>+</span>Add account</button>
        </nav>
        <div className="sidebar-footer"><span className={accounts.length ? "status-dot" : "status-dot idle"} />{accounts.length} account{accounts.length === 1 ? "" : "s"} connected</div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div><p className="eyebrow">GITHUB</p><h1>My pull requests</h1><p className="page-description">Choose the repositories that belong in this view.</p></div>
          {activeAccount && <div className="account-badge"><img alt="" src={activeAccount.avatar_url} /><span><strong>{activeAccount.name || activeAccount.login}</strong><small>@{activeAccount.login}</small></span></div>}
        </header>

        {showConnect && (
          <section className="connection-card" aria-labelledby="connect-title">
            <div className="connection-copy">
              <div className="github-mark" aria-hidden="true">GH</div>
              <div><h2 id="connect-title">Connect a GitHub account</h2><p>Use a fine-grained token with Metadata and Pull requests read access. The token stays in memory and is cleared when Skillflow closes.</p></div>
              {accounts.length > 0 && <button className="close-button" aria-label="Close account connection" onClick={() => setShowConnect(false)} type="button">×</button>}
            </div>
            <form className="token-form" onSubmit={connectAccount}>
              <label>
                <span>Fine-grained personal access token</span>
                <div className="input-wrap"><Icon size={17}><rect height="8" rx="2" stroke="currentColor" strokeWidth="2" width="14" x="5" y="11" /><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" /></Icon><input aria-label="GitHub fine-grained personal access token" autoComplete="off" onChange={(event) => setTokenInput(event.target.value)} placeholder="github_pat_..." type="password" value={tokenInput} /></div>
              </label>
              <button className="load-button" disabled={connecting} type="submit">{connecting ? <><span className="spinner" />Discovering repositories…</> : "Connect account"}</button>
            </form>
          </section>
        )}

        {error && <div className="error-message" role="alert">{error}</div>}

        {activeAccount && !showConnect && (
          <section className="repository-card" aria-labelledby="repository-title">
            <div className="repository-header">
              <div><p className="section-kicker">CUSTOMIZE VIEW</p><h2 id="repository-title">Choose repositories</h2><p>Only pull requests opened by @{activeAccount.login} will be included.</p></div>
              <button className="disconnect-button" onClick={disconnectAccount} type="button">Disconnect account</button>
            </div>
            <div className="repository-toolbar">
              <div className="repo-search"><Icon size={17}><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" /><path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></Icon><input aria-label="Search repositories" onChange={(event) => setRepositoryQuery(event.target.value)} placeholder="Search repositories…" value={repositoryQuery} /></div>
              <button className="select-all-button" onClick={toggleVisibleRepositories} type="button">{allVisibleSelected ? "Clear visible" : "Select visible"}</button>
              <span className="selection-count">{activeAccount.selectedRepositories.length} selected</span>
            </div>
            <div className="repository-list">
              {visibleRepositories.length ? visibleRepositories.map((repository) => {
                const selected = activeAccount.selectedRepositories.includes(repository.full_name);
                return (
                  <button aria-pressed={selected} className={`repository-row ${selected ? "selected" : ""}`} key={repository.id} onClick={() => toggleRepository(repository.full_name)} type="button">
                    <span className="checkbox">{selected && "✓"}</span>
                    <img alt="" src={repository.owner.avatar_url} />
                    <span className="repository-info"><strong>{repository.full_name}</strong><small>{repository.description || "No description"}</small></span>
                    {repository.language && <span className="language"><i />{repository.language}</span>}
                    <span className={`visibility ${repository.private ? "private" : ""}`}>{repository.private ? "Private" : "Public"}</span>
                  </button>
                );
              }) : <div className="no-repositories"><h3>No repositories found</h3><p>Try a different search or check this token’s repository access.</p></div>}
            </div>
            <div className="repository-actions">
              <p>Selections are kept separately for each connected account.</p>
              <button className="load-button" disabled={loadingPullRequests || !activeAccount.selectedRepositories.length} onClick={loadPullRequests} type="button">{loadingPullRequests ? <><span className="spinner" />Loading authored PRs…</> : <>Load my pull requests <span className="button-count">{activeAccount.selectedRepositories.length}</span></>}</button>
            </div>
          </section>
        )}

        {activeAccount && hasLoaded && (
          <section className="results" aria-live="polite">
            <div className="results-toolbar">
              <div className="filter-tabs" role="tablist" aria-label="Filter pull requests">
                {filters.map((filter) => <button aria-selected={activeFilter === filter.value} className={activeFilter === filter.value ? "selected" : ""} key={filter.value} onClick={() => setActiveFilter(filter.value)} role="tab" type="button">{filter.label}<span>{counts[filter.value]}</span></button>)}
              </div>
              <div className="search-box"><Icon size={17}><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" /><path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></Icon><input aria-label="Search pull requests" onChange={(event) => setQuery(event.target.value)} placeholder="Search pull requests…" value={query} /></div>
            </div>
            <div className="pr-list">
              {visiblePullRequests.length ? visiblePullRequests.map((pr) => {
                const status = pr.merged_at ? "merged" : pr.state;
                return (
                  <button className="pr-row" key={pr.id} onClick={() => openUrl(pr.html_url)} type="button">
                    <div className={`pr-status ${status}`}><PullIcon size={18} /></div>
                    <div className="pr-details"><div className="pr-title-line"><h3>{pr.title}</h3>{pr.draft && <span className="draft-badge">Draft</span>}</div><p>{pr.repository_full_name} · #{pr.number} · opened {relativeDate(pr.created_at)}</p><div className="branch-line"><code>{pr.head.ref}</code><span>→</span><code>{pr.base.ref}</code></div></div>
                    <span className={`state-label ${status}`}><span />{status}</span>
                    <span className="updated">Updated {relativeDate(pr.updated_at)}</span>
                    <Icon size={17}><path d="m9 18 6-6-6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></Icon>
                  </button>
                );
              }) : <div className="empty-results"><PullIcon size={26} /><h3>No matching pull requests</h3><p>{pullRequests.length ? "Try a different status or search term." : "This account has not opened a pull request in the selected repositories."}</p></div>}
            </div>
          </section>
        )}

        {!activeAccount && !showConnect && <section className="empty-state"><div className="empty-illustration"><PullIcon size={34} /></div><h2>Connect your first GitHub account</h2><p>Add a fine-grained token to discover and select the repositories you can access.</p></section>}
      </main>
    </div>
  );
}

export default App;
