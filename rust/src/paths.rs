/*
 * Lexical path helpers on top of std::path: the few operations the tool needs
 * that the standard library does not offer directly. Paths are handled
 * lexically throughout - no filesystem access, no symlink resolution - so
 * the same input always yields the same spelling in the reports.
 */

use std::path::Path;

/// The extension of a file name, lowercased and without its leading dot, as
/// `Path::extension` yields it - the spelling every extension table in this
/// crate uses. Empty for a dotfile (`.gitignore`) and an extensionless name.
pub fn extension_of(file: &str) -> String {
    Path::new(file)
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default()
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
}
