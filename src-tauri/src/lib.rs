use reqwest::{
    header::{ACCEPT, AUTHORIZATION, LINK, USER_AGENT},
    Client, Response,
};
use serde_json::{json, Value};

fn valid_repository(repository: &str) -> bool {
    let mut parts = repository.split('/');
    let valid_segment = |value: &str| {
        !value.is_empty()
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    };
    matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(repo), None) if valid_segment(owner) && valid_segment(repo))
}

fn next_link(response: &Response) -> Option<String> {
    response
        .headers()
        .get(LINK)
        .and_then(|value| value.to_str().ok())
        .and_then(|links| {
            links.split(',').find_map(|link| {
                if link.contains("rel=\"next\"") {
                    let start = link.find('<')? + 1;
                    let end = link[start..].find('>')? + start;
                    Some(link[start..end].to_string())
                } else {
                    None
                }
            })
        })
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
async fn connect_github_account(token: String) -> Result<Value, String> {
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

    Ok(json!({ "account": account, "repositories": repositories }))
}

#[tauri::command]
async fn list_authored_pull_requests(
    repositories: Vec<String>,
    author: String,
    token: String,
) -> Result<Vec<Value>, String> {
    if repositories.is_empty() {
        return Err("Select at least one repository.".into());
    }
    if token.trim().is_empty() || author.trim().is_empty() {
        return Err("Connect a GitHub account first.".into());
    }
    if repositories.iter().any(|repo| !valid_repository(repo)) {
        return Err("One of the selected repositories is invalid.".into());
    }

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
        .invoke_handler(tauri::generate_handler![
            connect_github_account,
            list_authored_pull_requests
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
