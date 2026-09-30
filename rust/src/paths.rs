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
        assert_eq!(extension_of("file.ts"), "ts");
        assert_eq!(extension_of("file.TS"), "ts");
        assert_eq!(extension_of("archive.tar.gz"), "gz");
        assert_eq!(extension_of("dir/sub/file.md"), "md");
    }

    #[test]
    fn extension_of_is_empty_without_one() {
        assert_eq!(extension_of("file"), "");
        assert_eq!(extension_of(".gitignore"), "");
        assert_eq!(extension_of("dir.x/file"), "");
        assert_eq!(extension_of(""), "");
    }

    #[test]
    fn normalize_resolves_dot_and_parent_segments() {
        assert_eq!(normalize(Path::new("/a/b/../c")), Path::new("/a/c"));
        assert_eq!(normalize(Path::new("/a/./b//c/")), Path::new("/a/b/c"));
        assert_eq!(normalize(Path::new("/a/b/../../..")), Path::new("/"));
        // a parent segment at the root has nothing to pop and is dropped
        assert_eq!(normalize(Path::new("/../a")), Path::new("/a"));
    }

    #[test]
    fn absolute_normalized_anchors_at_the_working_directory() {
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(absolute_normalized(Path::new("")).unwrap(), cwd);
        assert_eq!(absolute_normalized(Path::new(".")).unwrap(), cwd);
        assert_eq!(
            absolute_normalized(Path::new("sub/../x")).unwrap(),
            cwd.join("x")
        );
        assert_eq!(
            absolute_normalized(Path::new("..")).unwrap(),
            cwd.parent().unwrap()
        );
    }

    #[test]
    fn relative_to_walks_from_the_base_to_the_target() {
        let relative = |base: &str, target: &str| relative_to(Path::new(base), Path::new(target));
        assert_eq!(relative("/a/b", "/a/b/c"), Path::new("c"));
        assert_eq!(relative("/a/b", "/a/b/c/d"), Path::new("c/d"));
        assert_eq!(relative("/a/b/c", "/a/b"), Path::new(".."));
        assert_eq!(relative("/a/b", "/a/x/y"), Path::new("../x/y"));
        assert_eq!(relative("/a/b", "/a/b"), Path::new(""));
        // a shared name prefix is no shared segment
        assert_eq!(relative("/ab", "/abc"), Path::new("../abc"));
    }

    #[test]
    fn display_relative_falls_back_to_the_file_itself_when_equal() {
        assert_eq!(
            display_relative(Path::new("/a/b"), "/a/b/spec.md"),
            "spec.md"
        );
        assert_eq!(display_relative(Path::new("/a/b"), "/a/b"), "/a/b");
    }

    #[cfg(windows)]
    #[test]
    fn windows_prefixes_are_kept_and_never_crossed() {
        assert_eq!(normalize(Path::new(r"C:\a\..\b")), Path::new(r"C:\b"));
        assert_eq!(
            normalize(Path::new(r"\\server\share\x\..")),
            Path::new(r"\\server\share")
        );
        let relative = |base: &str, target: &str| relative_to(Path::new(base), Path::new(target));
        assert_eq!(relative(r"C:\a\b", r"C:\a\c"), Path::new(r"..\c"));
        assert_eq!(relative(r"C:\a", r"D:\a\b"), Path::new(r"D:\a\b"));
    }
}
