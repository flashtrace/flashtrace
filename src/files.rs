/*
 * File collection uses ignore rules directly, without executing Git.
 */

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;

use crate::errors::UsageError;
use crate::languages::CODE_EXT;
use crate::parse_spec::SPEC_EXT;
use crate::paths::{absolute_normalized, extension_of};

// Git metadata is never content, so no option brings it into a scan.
const GIT_METADATA_DIRECTORY: &str = ".git";

// Directories that hold content of no interest to a trace and are large enough
// to slow a scan noticeably. They are skipped by name at any depth, including
// as a scan root, unless the caller turns the default ignores off.
const DEFAULT_IGNORED_DIRECTORIES: &[&str] = &["node_modules"];

fn is_excluded_directory(name: &std::ffi::OsStr, apply_default_ignores: bool) -> bool {
    name == GIT_METADATA_DIRECTORY
        || (apply_default_ignores
            && DEFAULT_IGNORED_DIRECTORIES
                .iter()
                .any(|directory| name == *directory))
}

pub fn collect_files(
    dirs: &[String],
    apply_default_ignores: bool,
) -> Result<Vec<String>, UsageError> {
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
        if abs
            .file_name()
            .is_some_and(|name| is_excluded_directory(name, apply_default_ignores))
        {
            continue;
        }
        let walker = WalkBuilder::new(&abs)
            .hidden(false)
            .require_git(false)
            .follow_links(false)
            .filter_entry(move |entry| {
                !is_excluded_directory(entry.file_name(), apply_default_ignores)
            })
            .build();
        // Preserve silent traversal failures for now; general diagnostics are
        // a separate change. Explicit file arguments bypass the walker above.
        for entry in walker.flatten() {
            if entry.file_type().is_some_and(|kind| kind.is_file()) {
                add(entry.into_path());
            }
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
        let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/examples/basic/spec.md");
        let collected = collect_files(&[manifest.to_string()], true).unwrap();
        assert_eq!(collected.len(), 1);
        assert!(collected[0].ends_with("spec.md"));

        let missing = collect_files(&["definitely-not-here-1234".to_string()], true);
        assert!(missing.unwrap_err().0.contains("input path does not exist"));
    }

    #[test]
    fn collect_files_filters_to_known_extensions_and_sorts_in_code_point_order() {
        let example = concat!(env!("CARGO_MANIFEST_DIR"), "/examples/basic");
        let collected = collect_files(&[example.to_string()], true).unwrap();
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
        let example = concat!(env!("CARGO_MANIFEST_DIR"), "/examples/./basic");
        let collected = collect_files(&[example.to_string()], true).unwrap();
        for file in &collected {
            assert!(Path::new(file).is_absolute(), "{file}");
            assert!(!file.contains("/./") && !file.contains("/../"), "{file}");
        }
    }

    #[test]
    fn default_ignores_can_be_turned_off_but_git_metadata_stays_excluded() {
        for directory in DEFAULT_IGNORED_DIRECTORIES {
            let name = std::ffi::OsStr::new(directory);
            assert!(is_excluded_directory(name, true), "{directory}");
            assert!(!is_excluded_directory(name, false), "{directory}");
        }
        let metadata = std::ffi::OsStr::new(GIT_METADATA_DIRECTORY);
        assert!(is_excluded_directory(metadata, true));
        assert!(is_excluded_directory(metadata, false));
        assert!(!is_excluded_directory(std::ffi::OsStr::new("src"), true));
    }
}
