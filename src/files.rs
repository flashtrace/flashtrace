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
        if abs
            .file_name()
            .is_some_and(|name| name == ".git" || name == "node_modules")
        {
            continue;
        }
        let walker = WalkBuilder::new(&abs)
            .hidden(false)
            .require_git(false)
            .follow_links(false)
            .filter_entry(|entry| {
                entry.file_name() != ".git" && entry.file_name() != "node_modules"
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

    // a throwaway directory of empty files, removed again when dropped; it
    // lies outside any repository, so collection takes the directory walk
    struct Fixture(PathBuf);

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn with_files(name: &str, files: &[&str]) -> Fixture {
        let process_id = std::process::id();
        let dir = std::env::temp_dir().join(format!("flashtrace-files-{name}-{process_id}"));
        let _ = std::fs::remove_dir_all(&dir);
        for file in files {
            let path = dir.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        Fixture(dir)
    }

    fn collect(dir: &Path) -> Vec<String> {
        collect_files(&[dir.to_string_lossy().into_owned()]).unwrap()
    }

    #[test]
    fn collect_files_takes_a_single_file_verbatim_and_rejects_a_missing_path() {
        let fixture = with_files("single", &["spec.md", "login.ts"]);
        let collected = collect(&fixture.0.join("spec.md"));
        assert_eq!(collected.len(), 1);
        assert!(collected[0].ends_with("spec.md"));

        let missing = collect_files(&["definitely-not-here-1234".to_string()]);
        assert!(missing.unwrap_err().0.contains("input path does not exist"));
    }

    #[test]
    fn collect_files_filters_to_known_extensions_and_sorts_in_code_point_order() {
        // B before a and z before ø hold in code-point order only, not under
        // case folding or a locale collation
        let fixture = with_files(
            "filter-sort",
            &[
                "z.ts",
                "a.md",
                "notes.txt",
                "ø.ts",
                "B.md",
                "LICENSE",
                "sub/c.rs",
            ],
        );
        let base = absolute_normalized(&fixture.0).unwrap();
        let relative: Vec<String> = collect(&fixture.0)
            .iter()
            .map(|file| {
                let path = Path::new(file).strip_prefix(&base).unwrap();
                path.to_string_lossy().replace('\\', "/")
            })
            .collect();
        assert_eq!(relative, ["B.md", "a.md", "sub/c.rs", "z.ts", "ø.ts"]);
    }

    #[test]
    fn collected_paths_are_absolute_and_normalized() {
        let fixture = with_files("normalized", &["spec.md", "sub/login.ts"]);
        let collected = collect(&fixture.0.join("sub/.././."));
        assert_eq!(collected.len(), 2);
        for file in &collected {
            assert!(Path::new(file).is_absolute(), "{file}");
            let slashed = file.replace('\\', "/");
            assert!(
                !slashed.contains("/./") && !slashed.contains("/../"),
                "{file}"
            );
        }
    }
}
