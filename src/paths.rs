/*
 * Lexical path helpers on top of std::path: the few operations the tool needs
 * that the standard library does not offer directly. Paths are handled
 * lexically throughout - no symlink resolution, no case folding - so the same
 * input always yields the same spelling in the reports.
 */

use std::io;
use std::path::{Component, Path, PathBuf};

/// The extension of a file name, lowercased and without its leading dot, as
/// `Path::extension` yields it - the spelling every extension table in this
/// crate uses. Empty for a dotfile (`.gitignore`) and an extensionless name.
pub fn extension_of(file: &str) -> String {
    Path::new(file)
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// The path made absolute against the working directory and lexically
/// normalized: `.` segments dropped, `..` segments resolved against their
/// parent (or dropped at the root), separators collapsed. An empty path names
/// the working directory. Nothing on the filesystem is consulted beyond the
/// working directory itself.
pub fn absolute_normalized(path: &Path) -> io::Result<PathBuf> {
    let path = if path.as_os_str().is_empty() {
        Path::new(".")
    } else {
        path
    };
    Ok(normalize(&std::path::absolute(path)?))
}

// `std::path::absolute` keeps `..` segments on POSIX; this resolves them
fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => normalized.push(component),
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(
                    normalized.components().next_back(),
                    Some(Component::Normal(_))
                ) {
                    normalized.pop();
                }
            }
            Component::Normal(name) => normalized.push(name),
        }
    }
    normalized
}

/// The relative path leading from `base` to `target`, both absolute and
/// normalized: the common prefix stripped, one `..` per remaining base
/// segment, then the remaining target segments. Equal paths yield an empty
/// path; a target on another Windows drive or share has no relative spelling
/// and is returned as it is.
pub fn relative_to(base: &Path, target: &Path) -> PathBuf {
    let mut base_components = base.components().peekable();
    let mut target_components = target.components().peekable();
    if let (Some(Component::Prefix(base_prefix)), Some(Component::Prefix(target_prefix))) =
        (base_components.peek(), target_components.peek())
        && base_prefix != target_prefix
    {
        return target.to_path_buf();
    }
    while base_components.peek().is_some() && base_components.peek() == target_components.peek() {
        base_components.next();
        target_components.next();
    }
    let mut relative = PathBuf::new();
    for _ in base_components {
        relative.push("..");
    }
    relative.extend(target_components);
    relative
}

/// The spelling a report shows for a file: its path relative to the working
/// directory, or the file itself when the two coincide.
pub fn display_relative(base: &Path, file: &str) -> String {
    let relative = relative_to(base, Path::new(file));
    if relative.as_os_str().is_empty() {
        file.to_string()
    } else {
        relative.to_string_lossy().into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_of_is_lowercased_and_dotless() {
        // given
        let cases = [
            ("file.ts", "ts"),
            ("file.TS", "ts"),
            ("archive.tar.gz", "gz"),
            ("dir/sub/file.md", "md"),
        ];

        for (file, expected) in cases {
            // when
            let ext = extension_of(file);

            // then
            assert_eq!(ext, expected, "{file}");
        }
    }

    #[test]
    fn extension_of_is_empty_without_one() {
        // given
        let files = ["file", ".gitignore", "dir.x/file", ""];

        for file in files {
            // when
            let ext = extension_of(file);

            // then
            assert_eq!(ext, "", "{file}");
        }
    }

    #[test]
    fn normalize_resolves_dot_and_parent_segments() {
        // given
        let cases = [
            ("/a/b/../c", "/a/c"),
            ("/a/./b//c/", "/a/b/c"),
            ("/a/b/../../..", "/"),
            // a parent segment at the root has nothing to pop and is dropped
            ("/../a", "/a"),
        ];

        for (path, expected) in cases {
            // when
            let normalized = normalize(Path::new(path));

            // then
            assert_eq!(normalized, Path::new(expected), "{path}");
        }
    }

    #[test]
    fn absolute_normalized_anchors_at_the_working_directory() {
        // given
        let cwd = std::env::current_dir().unwrap();
        let cases = [
            ("", cwd.clone()),
            (".", cwd.clone()),
            ("sub/../x", cwd.join("x")),
            ("..", cwd.parent().unwrap().to_path_buf()),
        ];

        for (path, expected) in cases {
            // when
            let absolute = absolute_normalized(Path::new(path)).unwrap();

            // then
            assert_eq!(absolute, expected, "{path:?}");
        }
    }

    #[test]
    fn relative_to_walks_from_the_base_to_the_target() {
        // given
        let cases = [
            ("/a/b", "/a/b/c", "c"),
            ("/a/b", "/a/b/c/d", "c/d"),
            ("/a/b/c", "/a/b", ".."),
            ("/a/b", "/a/x/y", "../x/y"),
            ("/a/b", "/a/b", ""),
            // a shared name prefix is no shared segment
            ("/ab", "/abc", "../abc"),
        ];

        for (base, target, expected) in cases {
            // when
            let relative = relative_to(Path::new(base), Path::new(target));

            // then
            assert_eq!(relative, Path::new(expected), "{base} -> {target}");
        }
    }

    #[test]
    fn display_relative_shows_a_file_relative_to_the_base() {
        // given
        let base = Path::new("/a/b");

        // when
        let displayed = display_relative(base, "/a/b/spec.md");

        // then
        assert_eq!(displayed, "spec.md");
    }

    #[test]
    fn display_relative_falls_back_to_the_file_itself_when_equal() {
        // given
        let base = Path::new("/a/b");

        // when
        let displayed = display_relative(base, "/a/b");

        // then
        assert_eq!(displayed, "/a/b");
    }

    #[cfg(windows)]
    #[test]
    fn windows_prefixes_are_kept_by_normalize() {
        // given
        let cases = [
            (r"C:\a\..\b", r"C:\b"),
            (r"\\server\share\x\..", r"\\server\share"),
        ];

        for (path, expected) in cases {
            // when
            let normalized = normalize(Path::new(path));

            // then
            assert_eq!(normalized, Path::new(expected), "{path}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_prefixes_are_never_crossed_by_relative_to() {
        // given
        let cases = [
            (r"C:\a\b", r"C:\a\c", r"..\c"),
            (r"C:\a", r"D:\a\b", r"D:\a\b"),
        ];

        for (base, target, expected) in cases {
            // when
            let relative = relative_to(Path::new(base), Path::new(target));

            // then
            assert_eq!(relative, Path::new(expected), "{base} -> {target}");
        }
    }
}
