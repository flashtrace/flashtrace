/*
 * File collection (gitignore-aware): files ignored by git are excluded via
 * `git ls-files`; plain directory walk as fallback outside a git repository.
 */

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use crate::errors::UsageError;
use crate::languages::CODE_EXT;
use crate::parse_spec::SPEC_EXT;
use crate::paths::{absolute_normalized, extension_of};

// git is looked up in fixed, non-user-writable install locations only, never
// via PATH (writable PATH entries would allow binary planting).
const GIT_LOCATIONS: &[&str] = if cfg!(windows) {
    &[
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files (x86)\Git\cmd\git.exe",
    ]
} else {
    &["/usr/bin/git", "/bin/git"]
};

pub fn find_git() -> Option<&'static str> {
    static GIT_BIN: OnceLock<Option<&'static str>> = OnceLock::new();
    *GIT_BIN.get_or_init(|| {
        GIT_LOCATIONS
            .iter()
            .copied()
            .find(|location| Path::new(location).exists())
    })
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            walk(&entry.path(), out);
        } else if file_type.is_file() {
            out.push(entry.path());
        }
    }
}

// the repository's file list as git reports it, or None when the directory is
// no repository (or git is missing or fails)
fn git_listed_files(abs: &Path) -> Option<Vec<PathBuf>> {
    let git = find_git()?;
    let output = Command::new(git)
        .arg("-C")
        .arg(abs)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let listed = String::from_utf8_lossy(&output.stdout);
    Some(
        listed
            .split('\0')
            .filter(|file| !file.is_empty())
            .map(|file| {
                // git spells the path with forward slashes on every platform;
                // pushing it segment by segment gives it native separators
                let mut path = abs.to_path_buf();
                path.extend(file.split('/'));
                path
            })
            .collect(),
    )
}

pub fn collect_files(dirs: &[String]) -> Result<Vec<String>, UsageError> {
    let mut files: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut add = |file: PathBuf| {
        let file = file.to_string_lossy().into_owned();
        if seen.insert(file.clone()) {
            files.push(file);
        }
    };
    for dir in dirs {
        let abs = absolute_normalized(Path::new(dir))
            .map_err(|error| UsageError(format!("cannot resolve {dir}: {error}")))?;
        let Ok(stats) = std::fs::metadata(&abs) else {
            return Err(UsageError(format!("input path does not exist: {dir}")));
        };
        if stats.is_file() {
            add(abs);
            continue;
        }
        let list = match git_listed_files(&abs) {
            Some(list) => list,
            None => {
                // not a git repo (or git missing)
                let mut walked = Vec::new();
                walk(&abs, &mut walked);
                walked
            }
        };
        for file in list {
            add(file);
        }
    }
    let mut collected: Vec<String> = files
        .into_iter()
        .filter(|file| {
            let ext = extension_of(file);
            SPEC_EXT.contains(&ext.as_str()) || CODE_EXT.contains(&ext.as_str())
        })
        .collect();
    // code-point order, locale-independent
    collected.sort();
    Ok(collected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_files_takes_a_single_file_verbatim_and_rejects_a_missing_path() {
        let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/basic/spec.md");
        let collected = collect_files(&[manifest.to_string()]).unwrap();
        assert_eq!(collected.len(), 1);
        assert!(collected[0].ends_with("spec.md"));

        let missing = collect_files(&["definitely-not-here-1234".to_string()]);
        assert!(missing.unwrap_err().0.contains("input path does not exist"));
    }

    #[test]
    fn collect_files_filters_to_known_extensions_and_sorts_in_code_point_order() {
        let example = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/basic");
        let collected = collect_files(&[example.to_string()]).unwrap();
        // examples/basic holds spec.md, login.ts and a README the filter drops
        let names: Vec<&str> = collected
            .iter()
            .map(|file| file.rsplit(['/', '\\']).next().unwrap())
            .collect();
        assert!(names.contains(&"spec.md"));
        assert!(names.contains(&"login.ts"));
        let mut sorted = collected.clone();
        sorted.sort();
        assert_eq!(collected, sorted);
    }

    #[test]
    fn collected_paths_are_absolute_and_normalized() {
        let example = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/./basic");
        let collected = collect_files(&[example.to_string()]).unwrap();
        for file in &collected {
            assert!(Path::new(file).is_absolute(), "{file}");
            assert!(!file.contains("/./") && !file.contains("/../"), "{file}");
        }
    }
}
