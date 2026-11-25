mod skills;

use std::collections::HashMap;
use std::sync::Mutex;

use reqwest::{
    header::{ACCEPT, AUTHORIZATION, LINK, USER_AGENT},
    Client, Response,
};
use serde_json::{json, Value};
use skills::Skill;
use tauri::State;

/// A connected account's credentials. These never cross the IPC bridge: the
/// webview receives only the numeric account id and sends it back to address
/// this entry, so a compromised frontend cannot read or exfiltrate the token.
struct Credentials {
    token: String,
    login: String,
}

#[derive(Default)]
struct Accounts(Mutex<HashMap<u64, Credentials>>);

impl Accounts {
    /// Copies out what a request needs. The lock is released before any await,
    /// so a slow GitHub call never blocks another command.
    fn get(&self, account_id: u64) -> Result<(String, String), String> {
        let accounts = self
            .0
            .lock()
            .map_err(|_| "The account store is unavailable.".to_string())?;
        accounts
            .get(&account_id)
            .map(|credentials| (credentials.token.clone(), credentials.login.clone()))
            .ok_or_else(|| "Connect a GitHub account first.".to_string())
    }

    fn insert(&self, account_id: u64, credentials: Credentials) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "The account store is unavailable.".to_string())?
            .insert(account_id, credentials);
        Ok(())
    }

    fn remove(&self, account_id: u64) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "The account store is unavailable.".to_string())?
            .remove(&account_id);
        Ok(())
    }
}

fn valid_repository(repository: &str) -> bool {
    let mut parts = repository.split('/');
    // `.` and `..` are RFC 3986 dot segments: a URL parser resolves them away,
    // letting such a name escape the `/repos/{owner}/{repo}` path it belongs in.
    let valid_segment = |value: &str| {
        !value.is_empty()
            && value != "."
            && value != ".."
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    };
    matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(repo), None) if valid_segment(owner) && valid_segment(repo))
}

/// Pulls the `rel="next"` URL out of a GitHub `Link` header value.
fn parse_next_link(links: &str) -> Option<String> {
    links.split(',').find_map(|link| {
        if link.contains("rel=\"next\"") {
            let start = link.find('<')? + 1;
            let end = link[start..].find('>')? + start;
            Some(link[start..end].to_string())
        } else {
            None
        }
    })
}

fn next_link(response: &Response) -> Option<String> {
    response
        .headers()
        .get(LINK)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_next_link)
}

async fn github_get(client: &Client, url: &str, token: &str) -> Result<Response, String> {
    let response = client
        .get(url)
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .header(USER_AGENT, "skillflow-desktop")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|_| {
            "Could not connect to GitHub. Check your connection and try again.".to_string()
        })?;

    if response.status().is_success() {
        return Ok(response);
    }

    Err(match response.status().as_u16() {
        401 => "GitHub rejected this token. Check it and try again.".into(),
        403 => "GitHub denied this request. Check the token permissions, organization approval, or API rate limit.".into(),
        404 => "A GitHub resource could not be found or this token cannot access it.".into(),
        422 => "GitHub could not process this request.".into(),
        code => format!("GitHub returned an error ({code})."),
    })
}

#[tauri::command]
async fn connect_github_account(token: String, accounts: State<'_, Accounts>) -> Result<Value, String> {
    if token.trim().is_empty() {
        return Err("Enter a fine-grained personal access token.".into());
    }

    let client = Client::new();
    let account = github_get(&client, "https://api.github.com/user", &token)
        .await?
        .json::<Value>()
        .await
        .map_err(|_| "GitHub returned an unexpected account response.".to_string())?;

    let mut repositories = Vec::new();
    let mut next_url = Some(
        "https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&visibility=all&sort=updated&direction=desc&per_page=100"
            .to_string(),
    );

    while let Some(url) = next_url {
        let response = github_get(&client, &url, &token).await?;
        next_url = next_link(&response);
        let mut page = response
            .json::<Vec<Value>>()
            .await
            .map_err(|_| "GitHub returned an unexpected repository response.".to_string())?;
        repositories.append(&mut page);
    }

    let account_id = account
        .get("id")
        .and_then(Value::as_u64)
        .ok_or_else(|| "GitHub returned an account without an id.".to_string())?;
    let login = account
        .get("login")
        .and_then(Value::as_str)
        .ok_or_else(|| "GitHub returned an account without a login.".to_string())?
        .to_string();

    accounts.insert(
        account_id,
        Credentials {
            token: token.trim().to_string(),
            login,
        },
    )?;

    Ok(json!({ "account": account, "repositories": repositories }))
}

/// Lists the skills found under a directory the user picked.
#[tauri::command]
async fn scan_skill_directory(root: String) -> Result<Vec<Skill>, String> {
    skills::scan(&root)
}

/// Drops a connected account's stored token.
#[tauri::command]
fn disconnect_github_account(account_id: u64, accounts: State<'_, Accounts>) -> Result<(), String> {
    accounts.remove(account_id)
}

#[tauri::command]
async fn list_authored_pull_requests(
    account_id: u64,
    repositories: Vec<String>,
    accounts: State<'_, Accounts>,
) -> Result<Vec<Value>, String> {
    if repositories.is_empty() {
        return Err("Select at least one repository.".into());
    }
    if repositories.iter().any(|repo| !valid_repository(repo)) {
        return Err("One of the selected repositories is invalid.".into());
    }

    let (token, author) = accounts.get(account_id)?;

    let client = Client::new();
    let mut pull_requests = Vec::new();

    for repository in repositories {
        let mut next_url = Some(format!(
            "https://api.github.com/repos/{repository}/pulls?state=all&sort=updated&direction=desc&per_page=100"
        ));

        while let Some(url) = next_url {
            let response = github_get(&client, &url, &token).await?;
            next_url = next_link(&response);
            let page = response
                .json::<Vec<Value>>()
                .await
                .map_err(|_| "GitHub returned an unexpected pull request response.".to_string())?;

            for mut pull_request in page {
                let authored_by_user = pull_request
                    .pointer("/user/login")
                    .and_then(Value::as_str)
                    .is_some_and(|login| login.eq_ignore_ascii_case(author.trim()));

                if authored_by_user {
                    if let Some(object) = pull_request.as_object_mut() {
                        object.insert(
                            "repository_full_name".into(),
                            Value::String(repository.clone()),
                        );
                    }
                    pull_requests.push(pull_request);
                }
            }
        }
    }

    pull_requests.sort_by(|left, right| {
        right
            .get("updated_at")
            .and_then(Value::as_str)
            .cmp(&left.get("updated_at").and_then(Value::as_str))
    });

    Ok(pull_requests)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Accounts::default())
        .invoke_handler(tauri::generate_handler![
            connect_github_account,
            disconnect_github_account,
            scan_skill_directory,
            list_authored_pull_requests
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{parse_next_link, valid_repository};

    #[test]
    fn accepts_ordinary_repository_names() {
        assert!(valid_repository("egjimenezg/skillflow"));
        assert!(valid_repository("tauri-apps/tauri"));
        assert!(valid_repository("owner/repo.with.dots"));
        assert!(valid_repository("owner/repo_with_underscores"));
        assert!(valid_repository("Owner123/Repo456"));
    }

    #[test]
    fn rejects_wrong_segment_counts() {
        assert!(!valid_repository("skillflow"));
        assert!(!valid_repository("owner/repo/extra"));
        assert!(!valid_repository(""));
        assert!(!valid_repository("/"));
        assert!(!valid_repository("owner/"));
        assert!(!valid_repository("/repo"));
    }

    /// The command interpolates this value straight into an api.github.com URL,
    /// so anything that could escape the repository path must be rejected.
    #[test]
    fn rejects_path_traversal_and_url_injection() {
        assert!(!valid_repository("../../user"));
        assert!(!valid_repository("owner/.."));
        assert!(!valid_repository("../user"));
        assert!(!valid_repository("owner/repo?per_page=1"));
        assert!(!valid_repository("owner/repo#fragment"));
        assert!(!valid_repository("owner/repo pulls"));
        assert!(!valid_repository("owner/repo%2F"));
        assert!(!valid_repository("evil.com/owner/repo"));
    }

    #[test]
    fn finds_the_next_url_among_several_links() {
        let header = concat!(
            "<https://api.github.com/user/repos?page=1>; rel=\"prev\", ",
            "<https://api.github.com/user/repos?page=3>; rel=\"next\", ",
            "<https://api.github.com/user/repos?page=9>; rel=\"last\""
        );
        assert_eq!(
            parse_next_link(header).as_deref(),
            Some("https://api.github.com/user/repos?page=3")
        );
    }

    #[test]
    fn finds_the_next_url_when_it_is_the_only_link() {
        let header = "<https://api.github.com/user/repos?page=2>; rel=\"next\"";
        assert_eq!(
            parse_next_link(header).as_deref(),
            Some("https://api.github.com/user/repos?page=2")
        );
    }

    /// The last page sends prev/first but no next; pagination must stop there.
    #[test]
    fn returns_none_on_the_final_page() {
        let header = concat!(
            "<https://api.github.com/user/repos?page=8>; rel=\"prev\", ",
            "<https://api.github.com/user/repos?page=1>; rel=\"first\""
        );
        assert_eq!(parse_next_link(header), None);
    }

    #[test]
    fn returns_none_for_empty_or_malformed_headers() {
        assert_eq!(parse_next_link(""), None);
        assert_eq!(parse_next_link("not a link header"), None);
        assert_eq!(parse_next_link("https://example.com; rel=\"next\""), None);
    }
}
