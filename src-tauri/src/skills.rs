//! Reads a directory of Claude Code skills into an inventory.
//!
//! A skill is a directory containing a `SKILL.md` whose YAML frontmatter
//! carries at least a `name` and a `description`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Skills nest a few levels under a marketplace or plugin root; this bounds the
/// walk so picking a large directory cannot wander the whole filesystem.
const MAX_DEPTH: usize = 8;
const MAX_SKILLS: usize = 500;

#[derive(Debug, Serialize, PartialEq)]
pub struct Skill {
    /// Path to the SKILL.md, and the inventory's stable identity.
    pub id: String,
    pub name: String,
    pub description: String,
    /// Directory holding the skill, shown to disambiguate same-named skills.
    pub source: String,
    pub user_invocable: bool,
    pub allowed_tools: Vec<String>,
}

/// Splits `---`-delimited YAML frontmatter from the body.
fn frontmatter(contents: &str) -> Option<&str> {
    let rest = contents.strip_prefix("---")?.trim_start_matches(['\r']);
    let rest = rest.strip_prefix('\n')?;
    let end = rest.find("\n---")?;
    Some(&rest[..end])
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    for quote in ['"', '\''] {
        if value.len() >= 2 && value.starts_with(quote) && value.ends_with(quote) {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

/// Reads the handful of scalar and sequence keys a skill declares.
///
/// Deliberately not a general YAML parser: it handles `key: value` scalars and
/// `- item` sequences, which is the whole of the SKILL.md frontmatter
/// convention. Anything else is skipped rather than treated as an error, so an
/// unusual file yields a partial entry instead of failing the whole scan.
fn parse_frontmatter(frontmatter: &str) -> (Vec<(String, String)>, Vec<(String, Vec<String>)>) {
    let mut scalars = Vec::new();
    let mut sequences: Vec<(String, Vec<String>)> = Vec::new();
    let mut current_key: Option<String> = None;

    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // A `- item` line continues the most recent key's sequence.
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(key) = &current_key {
                let item = unquote(item);
                match sequences.iter_mut().find(|(name, _)| name == key) {
                    Some((_, items)) => items.push(item),
                    None => sequences.push((key.clone(), vec![item])),
                }
            }
            continue;
        }

        // Indented non-sequence lines are continuations we do not model.
        if line.starts_with(char::is_whitespace) {
            continue;
        }

        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim().to_string();
        let value = value.trim();
        if value.is_empty() {
            // `key:` on its own opens a sequence on the following lines.
            current_key = Some(key);
        } else {
            scalars.push((key.clone(), unquote(value)));
            current_key = Some(key);
        }
    }

    (scalars, sequences)
}

fn read_skill(path: &Path) -> Option<Skill> {
    let contents = fs::read_to_string(path).ok()?;
    let (scalars, sequences) = parse_frontmatter(frontmatter(&contents)?);
    let scalar = |key: &str| {
        scalars
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
    };

    let directory = path.parent()?;
    // A skill without a `name` falls back to its directory name, which is what
    // the loader itself uses.
    let name = scalar("name").filter(|value| !value.is_empty()).or_else(|| {
        directory
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
    })?;

    Some(Skill {
        id: path.to_string_lossy().to_string(),
        name,
        description: scalar("description").unwrap_or_default(),
        source: directory.to_string_lossy().to_string(),
        user_invocable: scalar("user-invocable").is_some_and(|value| value == "true"),
        allowed_tools: sequences
            .iter()
            .find(|(key, _)| key == "allowed-tools")
            .map(|(_, items)| items.clone())
            .unwrap_or_default(),
    })
}

fn walk(directory: &Path, depth: usize, found: &mut Vec<Skill>) {
    if depth > MAX_DEPTH || found.len() >= MAX_SKILLS {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    let mut subdirectories = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        // Skip symlinks: they can point outside the chosen directory and can
        // form cycles the depth limit would only partly contain.
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            let hidden = path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with('.'));
            // `.claude` is where skills legitimately live, so it is not skipped.
            if !hidden || path.file_name().is_some_and(|name| name == ".claude") {
                subdirectories.push(path);
            }
        } else if path.file_name().is_some_and(|name| name == "SKILL.md") {
            if let Some(skill) = read_skill(&path) {
                found.push(skill);
            }
        }
    }

    subdirectories.sort();
    for subdirectory in subdirectories {
        walk(&subdirectory, depth + 1, found);
    }
}

/// Scans `root` for skills, sorted by name.
pub fn scan(root: &str) -> Result<Vec<Skill>, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err("That path is not a directory.".into());
    }

    let mut found = Vec::new();
    walk(&root, 0, &mut found);
    found.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::{frontmatter, parse_frontmatter, scan};

    const SAMPLE: &str = "---\nname: access\ndescription: Manage Discord channel access: approve pairings, edit allowlists.\nuser-invocable: true\nallowed-tools:\n  - Read\n  - Write\n  - Bash(ls *)\n---\n\n# /discord:access\n";

    #[test]
    fn splits_frontmatter_from_body() {
        let parsed = frontmatter(SAMPLE).unwrap();
        assert!(parsed.starts_with("name: access"));
        assert!(!parsed.contains("# /discord:access"));
    }

    #[test]
    fn returns_none_without_frontmatter() {
        assert_eq!(frontmatter("# Just a heading\n"), None);
        assert_eq!(frontmatter("---\nname: unterminated\n"), None);
    }

    /// Descriptions routinely contain colons; only the first may split the key.
    #[test]
    fn keeps_colons_inside_values() {
        let (scalars, _) = parse_frontmatter(frontmatter(SAMPLE).unwrap());
        let description = scalars.iter().find(|(key, _)| key == "description").unwrap();
        assert_eq!(
            description.1,
            "Manage Discord channel access: approve pairings, edit allowlists."
        );
    }

    #[test]
    fn reads_sequences_including_entries_with_spaces() {
        let (_, sequences) = parse_frontmatter(frontmatter(SAMPLE).unwrap());
        let tools = sequences.iter().find(|(key, _)| key == "allowed-tools").unwrap();
        assert_eq!(tools.1, vec!["Read", "Write", "Bash(ls *)"]);
    }

    #[test]
    fn strips_surrounding_quotes() {
        let (scalars, _) = parse_frontmatter("name: \"quoted\"\ndescription: 'single'\n");
        assert_eq!(scalars[0].1, "quoted");
        assert_eq!(scalars[1].1, "single");
    }

    #[test]
    fn rejects_a_path_that_is_not_a_directory() {
        assert!(scan("/definitely/not/a/real/directory").is_err());
    }
}

#[cfg(test)]
mod local_scan {
    /// Ad-hoc check against a real skills tree; machine-specific, so ignored.
    #[test]
    #[ignore]
    fn scans_the_local_claude_directory() {
        let home = std::env::var("HOME").unwrap();
        let found = super::scan(&format!("{home}/.claude")).unwrap();
        println!("found {} skills", found.len());
        for skill in found.iter().take(6) {
            println!(
                "  {} [invocable={}] tools={:?}\n    {}",
                skill.name,
                skill.user_invocable,
                skill.allowed_tools,
                skill.description.chars().take(80).collect::<String>()
            );
        }
    }
}
