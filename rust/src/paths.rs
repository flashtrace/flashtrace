/*
 * Node's path functions, ported for byte parity.
 *
 * The four functions the JavaScript implementation calls - resolve, join,
 * relative and extname - are ported from Node's lib/path.js for both flavors,
 * `win32` and `posix`, each a faithful transcription of Node's algorithm so
 * that separators, `..` handling, drive letters, UNC roots and dotfile
 * extensions come out character for character the same. The top-level
 * functions pick the host platform's flavor, as `node:path` does.
 *
 * The flavor functions are pure: where Node reads `process.cwd()` they take
 * the working directory as their first parameter, which is what makes them
 * testable against pinned Node outputs on every platform. One knowing
 * departure: for a drive-relative path (`C:file`) Node consults a per-drive
 * working directory in the environment (`=C:`) before falling back; the port
 * always uses the one working directory it is given. The CLI resolves paths
 * against the actual process working directory, where the two agree.
 *
 * Paths are handled as strings, as in JavaScript. All structural characters
 * (separators, colons, dots, drive letters) are ASCII, so the ports scan
 * bytes; non-ASCII characters ride along inside segments either way.
 */

fn process_cwd() -> String {
    std::env::current_dir()
        .expect("the process has a working directory")
        .to_string_lossy()
        .into_owned()
}

/// Node `path.resolve(path)`: the path made absolute against the process
/// working directory and normalized.
pub fn resolve(path: &str) -> String {
    if cfg!(windows) {
        win32::resolve(&process_cwd(), path)
    } else {
        posix::resolve(&process_cwd(), path)
    }
}

/// Node `path.join(first, second)` for the host platform.
pub fn join(first: &str, second: &str) -> String {
    if cfg!(windows) {
        win32::join(first, second)
    } else {
        posix::join(first, second)
    }
}

/// Node `path.relative(from, to)` for the host platform.
pub fn relative(from: &str, to: &str) -> String {
    if cfg!(windows) {
        win32::relative(&process_cwd(), from, to)
    } else {
        posix::relative(&process_cwd(), from, to)
    }
}

/// Node `path.extname(path)` for the host platform: the last extension of the
/// final segment, empty for dotfiles and extensionless names.
pub fn extname(path: &str) -> &str {
    if cfg!(windows) {
        win32::extname(path)
    } else {
        posix::extname(path)
    }
}

/// Node's `normalizeString`: resolves `.` and `..` segments and collapses
/// separators in the part of a path below its root. The transcription keeps
/// Node's variable names so the two can be read side by side.
fn normalize_string(
    path: &str,
    allow_above_root: bool,
    separator: char,
    is_separator: fn(u8) -> bool,
) -> String {
    let bytes = path.as_bytes();
    let mut res = String::new();
    let mut last_segment_length: isize = 0;
    let mut last_slash: isize = -1;
    let mut dots: isize = 0;
    let mut code: u8 = 0;
    let mut i: isize = 0;
    while i <= bytes.len() as isize {
        if (i as usize) < bytes.len() {
            code = bytes[i as usize];
        } else if is_separator(code) {
            break;
        } else {
            code = b'/';
        }
        if is_separator(code) {
            if last_slash == i - 1 || dots == 1 {
                // an empty segment or a lone `.`: nothing to keep
            } else if dots == 2 {
                if res.len() < 2 || last_segment_length != 2 || !res.ends_with("..") {
                    if res.len() > 2 {
                        match res.rfind(separator) {
                            None => {
                                res.clear();
                                last_segment_length = 0;
                            }
                            Some(last_slash_index) => {
                                res.truncate(last_slash_index);
                                last_segment_length = res.len() as isize
                                    - 1
                                    - res.rfind(separator).map_or(-1, |index| index as isize);
                            }
                        }
                        last_slash = i;
                        dots = 0;
                        i += 1;
                        continue;
                    } else if !res.is_empty() {
                        res.clear();
                        last_segment_length = 0;
                        last_slash = i;
                        dots = 0;
                        i += 1;
                        continue;
                    }
                }
                if allow_above_root {
                    if !res.is_empty() {
                        res.push(separator);
                    }
                    res.push_str("..");
                    last_segment_length = 2;
                }
            } else {
                let segment = &path[(last_slash + 1) as usize..i as usize];
                if !res.is_empty() {
                    res.push(separator);
                }
                res.push_str(segment);
                last_segment_length = i - last_slash - 1;
            }
            last_slash = i;
            dots = 0;
        } else if code == b'.' && dots != -1 {
            dots += 1;
        } else {
            dots = -1;
        }
        i += 1;
    }
    res
}

/// Node's shared `extname` scan: from the end, find the last `.` of the final
/// segment, empty when that dot leads the segment (a dotfile) or is missing.
/// `start` skips a `C:` device prefix on win32.
fn extname_from(path: &str, start: usize, is_separator: fn(u8) -> bool) -> &str {
    let bytes = path.as_bytes();
    let mut start_dot: isize = -1;
    let mut start_part: isize = start as isize;
    let mut end: isize = -1;
    let mut matched_slash = true;
    // the state of the character before a dot: 0 nothing read yet, 1 dots
    // only, -1 a proper name character
    let mut pre_dot_state: isize = 0;
    let mut i = bytes.len() as isize - 1;
    while i >= start as isize {
        let code = bytes[i as usize];
        if is_separator(code) {
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i -= 1;
            continue;
        }
        if end == -1 {
            matched_slash = false;
            end = i + 1;
        }
        if code == b'.' {
            if start_dot == -1 {
                start_dot = i;
            } else if pre_dot_state != 1 {
                pre_dot_state = 1;
            }
        } else if start_dot != -1 {
            pre_dot_state = -1;
        }
        i -= 1;
    }
    if start_dot == -1
        || end == -1
        || pre_dot_state == 0
        || (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part + 1)
    {
        return "";
    }
    &path[start_dot as usize..end as usize]
}

pub mod win32 {
    use super::{extname_from, normalize_string};

    fn is_path_separator(code: u8) -> bool {
        code == b'\\' || code == b'/'
    }

    fn is_windows_device_root(code: u8) -> bool {
        code.is_ascii_alphabetic()
    }

    // the device (`C:` or `\\server\share`), root end and absoluteness of a
    // path, as the identical parsing prelude of Node's resolve and normalize
    // reads them
    fn parse_root(path: &str) -> (String, usize, bool) {
        let bytes = path.as_bytes();
        let len = bytes.len();
        let mut root_end = 0;
        let mut device = String::new();
        let mut is_absolute = false;
        if len == 1 {
            if is_path_separator(bytes[0]) {
                root_end = 1;
                is_absolute = true;
            }
        } else if len > 1 && is_path_separator(bytes[0]) {
            is_absolute = true;
            if is_path_separator(bytes[1]) {
                // possible UNC root: \\server\share
                let mut j = 2;
                let mut last = j;
                while j < len && !is_path_separator(bytes[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    let first_part = &path[last..j];
                    last = j;
                    while j < len && is_path_separator(bytes[j]) {
                        j += 1;
                    }
                    if j < len && j != last {
                        last = j;
                        while j < len && !is_path_separator(bytes[j]) {
                            j += 1;
                        }
                        if j == len || j != last {
                            device = format!("\\\\{first_part}\\{}", &path[last..j]);
                            root_end = j;
                        }
                    }
                }
            } else {
                root_end = 1;
            }
        } else if len > 1 && is_windows_device_root(bytes[0]) && bytes[1] == b':' {
            device = path[0..2].to_string();
            root_end = 2;
            if len > 2 && is_path_separator(bytes[2]) {
                is_absolute = true;
                root_end = 3;
            }
        }
        (device, root_end, is_absolute)
    }

    /// Node `path.win32.resolve` with the working directory injected: the
    /// path made absolute against `cwd` and normalized.
    pub fn resolve(cwd: &str, path: &str) -> String {
        let mut resolved_device = String::new();
        let mut resolved_tail = String::new();
        let mut resolved_absolute = false;

        // Node walks its arguments last to first and then a working-directory
        // fallback: index 1 is `path`, 0 is `cwd`, -1 the fallback for a
        // device no earlier round matched (Node's per-drive `=C:` lookup)
        let mut i: isize = 1;
        while i >= -1 {
            let current: String = if i == 1 {
                if path.is_empty() {
                    i -= 1;
                    continue;
                }
                path.to_string()
            } else if i == 0 {
                if cwd.is_empty() {
                    i -= 1;
                    continue;
                }
                cwd.to_string()
            } else if resolved_device.is_empty() {
                cwd.to_string()
            } else {
                // the working directory serves the unmatched device only when
                // it sits on it; anywhere else the device's root does
                let cwd_bytes = cwd.as_bytes();
                let device_mismatch = cwd_bytes.len() < 2
                    || !cwd_bytes[0..2].eq_ignore_ascii_case(resolved_device.as_bytes());
                if device_mismatch && cwd_bytes.len() > 2 && cwd_bytes[2] == b'\\' {
                    format!("{resolved_device}\\")
                } else {
                    cwd.to_string()
                }
            };

            let (device, root_end, is_absolute) = parse_root(&current);

            if !device.is_empty() {
                if !resolved_device.is_empty() {
                    // Node compares with toLowerCase(), reaching non-ASCII
                    // characters in UNC server names too
                    if device.to_lowercase() != resolved_device.to_lowercase() {
                        i -= 1;
                        continue;
                    }
                } else {
                    resolved_device = device;
                }
            }

            if resolved_absolute {
                if !resolved_device.is_empty() {
                    break;
                }
            } else {
                resolved_tail = format!("{}\\{resolved_tail}", &current[root_end..]);
                resolved_absolute = is_absolute;
                if is_absolute && !resolved_device.is_empty() {
                    break;
                }
            }
            i -= 1;
        }

        resolved_tail =
            normalize_string(&resolved_tail, !resolved_absolute, '\\', is_path_separator);
        if resolved_absolute {
            format!("{resolved_device}\\{resolved_tail}")
        } else {
            let resolved = format!("{resolved_device}{resolved_tail}");
            if resolved.is_empty() {
                ".".to_string()
            } else {
                resolved
            }
        }
    }

    /// Node `path.win32.normalize`.
    pub fn normalize(path: &str) -> String {
        let bytes = path.as_bytes();
        let len = bytes.len();
        if len == 0 {
            return ".".to_string();
        }
        if len == 1 {
            return if bytes[0] == b'/' {
                "\\".to_string()
            } else {
                path.to_string()
            };
        }
        // Node's normalize returns early for a bare UNC root: exactly
        // \\server\share with nothing behind it keeps a trailing separator
        if is_path_separator(bytes[0]) && is_path_separator(bytes[1]) {
            let mut j = 2;
            let mut last = j;
            while j < len && !is_path_separator(bytes[j]) {
                j += 1;
            }
            if j < len && j != last {
                let first_part = &path[last..j];
                last = j;
                while j < len && is_path_separator(bytes[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    last = j;
                    while j < len && !is_path_separator(bytes[j]) {
                        j += 1;
                    }
                    if j == len {
                        return format!("\\\\{first_part}\\{}\\", &path[last..]);
                    }
                }
            }
        }
        let (device, root_end, is_absolute) = parse_root(path);
        let mut tail = if root_end < len {
            normalize_string(&path[root_end..], !is_absolute, '\\', is_path_separator)
        } else {
            String::new()
        };
        if tail.is_empty() && !is_absolute {
            tail = ".".to_string();
        }
        if !tail.is_empty() && is_path_separator(bytes[len - 1]) {
            tail.push('\\');
        }
        if device.is_empty() {
            return if is_absolute {
                format!("\\{tail}")
            } else {
                tail
            };
        }
        if is_absolute {
            format!("{device}\\{tail}")
        } else {
            format!("{device}{tail}")
        }
    }

    /// Node `path.win32.join(first, second)`.
    pub fn join(first: &str, second: &str) -> String {
        let (joined, first_part) = match (first.is_empty(), second.is_empty()) {
            (true, true) => return ".".to_string(),
            (false, true) => (first.to_string(), first),
            (true, false) => (second.to_string(), second),
            (false, false) => (format!("{first}\\{second}"), first),
        };
        // Node guards against a joined path reading as a UNC root the parts
        // never spelled: unless the first part is one, leading separators
        // beyond the first collapse into one
        let first_bytes = first_part.as_bytes();
        let mut needs_replace = true;
        let mut slash_count = 0;
        if !first_bytes.is_empty() && is_path_separator(first_bytes[0]) {
            slash_count += 1;
            if first_bytes.len() > 1 && is_path_separator(first_bytes[1]) {
                slash_count += 1;
                if first_bytes.len() > 2 {
                    if is_path_separator(first_bytes[2]) {
                        slash_count += 1;
                    } else {
                        needs_replace = false;
                    }
                }
            }
        }
        let mut joined = joined;
        if needs_replace {
            let joined_bytes = joined.as_bytes();
            while slash_count < joined_bytes.len() && is_path_separator(joined_bytes[slash_count]) {
                slash_count += 1;
            }
            if slash_count >= 2 {
                joined = format!("\\{}", &joined[slash_count..]);
            }
        }
        normalize(&joined)
    }

    /// Node `path.win32.relative(from, to)` with the working directory
    /// injected for making the two absolute. Windows compares
    /// case-insensitively and keeps the casing of `to` in the result.
    pub fn relative(cwd: &str, from: &str, to: &str) -> String {
        if from == to {
            return String::new();
        }
        let from_orig = resolve(cwd, from);
        let to_orig = resolve(cwd, to);
        if from_orig == to_orig {
            return String::new();
        }
        let from_lower = from_orig.to_lowercase();
        let to_lower = to_orig.to_lowercase();
        if from_lower == to_lower {
            return String::new();
        }

        let from_bytes = from_lower.as_bytes();
        let mut from_start = 0;
        while from_start < from_bytes.len() && from_bytes[from_start] == b'\\' {
            from_start += 1;
        }
        let mut from_end = from_bytes.len();
        while from_end - 1 > from_start && from_bytes[from_end - 1] == b'\\' {
            from_end -= 1;
        }
        let from_len = from_end - from_start;

        let to_bytes = to_lower.as_bytes();
        let mut to_start = 0;
        while to_start < to_bytes.len() && to_bytes[to_start] == b'\\' {
            to_start += 1;
        }
        let mut to_end = to_bytes.len();
        while to_end - 1 > to_start && to_bytes[to_end - 1] == b'\\' {
            to_end -= 1;
        }
        let to_len = to_end - to_start;

        let length = from_len.min(to_len);
        let mut last_common_sep: isize = -1;
        let mut i = 0;
        while i < length {
            let from_code = from_bytes[from_start + i];
            if from_code != to_bytes[to_start + i] {
                break;
            }
            if from_code == b'\\' {
                last_common_sep = i as isize;
            }
            i += 1;
        }
        if i != length {
            if last_common_sep == -1 {
                return to_orig;
            }
        } else {
            if to_len > length {
                if to_bytes[to_start + i] == b'\\' {
                    return to_orig[to_start + i + 1..].to_string();
                }
                if i == 2 {
                    return to_orig[to_start + i..].to_string();
                }
            }
            if from_len > length {
                if from_bytes[from_start + i] == b'\\' {
                    last_common_sep = i as isize;
                } else if i == 2 {
                    last_common_sep = 3;
                }
            }
            if last_common_sep == -1 {
                last_common_sep = 0;
            }
        }

        let mut out = String::new();
        let mut i = from_start as isize + last_common_sep + 1;
        while i <= from_end as isize {
            if i == from_end as isize || from_bytes[i as usize] == b'\\' {
                out.push_str(if out.is_empty() { ".." } else { "\\.." });
            }
            i += 1;
        }

        let mut to_start = (to_start as isize + last_common_sep) as usize;
        if !out.is_empty() {
            return format!("{out}{}", &to_orig[to_start..to_end]);
        }
        if to_bytes[to_start] == b'\\' {
            to_start += 1;
        }
        to_orig[to_start..to_end].to_string()
    }

    /// Node `path.win32.extname`.
    pub fn extname(path: &str) -> &str {
        let bytes = path.as_bytes();
        // a device prefix (`C:`) is no segment, so the scan skips it
        let start = if bytes.len() >= 2 && is_windows_device_root(bytes[0]) && bytes[1] == b':' {
            2
        } else {
            0
        };
        extname_from(path, start, is_path_separator)
    }
}

pub mod posix {
    use super::{extname_from, normalize_string};

    fn is_posix_path_separator(code: u8) -> bool {
        code == b'/'
    }

    /// Node `path.posix.resolve` with the working directory injected.
    pub fn resolve(cwd: &str, path: &str) -> String {
        let mut resolved_path = String::new();
        let mut resolved_absolute = false;
        // last argument to first, then the working directory, until absolute
        for current in [path, cwd, cwd] {
            if resolved_absolute {
                break;
            }
            if current.is_empty() {
                continue;
            }
            resolved_path = format!("{current}/{resolved_path}");
            resolved_absolute = current.as_bytes()[0] == b'/';
        }
        resolved_path = normalize_string(
            &resolved_path,
            !resolved_absolute,
            '/',
            is_posix_path_separator,
        );
        if resolved_absolute {
            return format!("/{resolved_path}");
        }
        if resolved_path.is_empty() {
            ".".to_string()
        } else {
            resolved_path
        }
    }

    /// Node `path.posix.normalize`.
    pub fn normalize(path: &str) -> String {
        if path.is_empty() {
            return ".".to_string();
        }
        let bytes = path.as_bytes();
        let is_absolute = bytes[0] == b'/';
        let trailing_separator = bytes[bytes.len() - 1] == b'/';
        let mut normalized = normalize_string(path, !is_absolute, '/', is_posix_path_separator);
        if normalized.is_empty() {
            if is_absolute {
                return "/".to_string();
            }
            return if trailing_separator {
                "./".to_string()
            } else {
                ".".to_string()
            };
        }
        if trailing_separator {
            normalized.push('/');
        }
        if is_absolute {
            format!("/{normalized}")
        } else {
            normalized
        }
    }

    /// Node `path.posix.join(first, second)`.
    pub fn join(first: &str, second: &str) -> String {
        let joined = match (first.is_empty(), second.is_empty()) {
            (true, true) => return ".".to_string(),
            (false, true) => first.to_string(),
            (true, false) => second.to_string(),
            (false, false) => format!("{first}/{second}"),
        };
        normalize(&joined)
    }

    /// Node `path.posix.relative(from, to)` with the working directory
    /// injected for making the two absolute.
    pub fn relative(cwd: &str, from: &str, to: &str) -> String {
        if from == to {
            return String::new();
        }
        let from = resolve(cwd, from);
        let to = resolve(cwd, to);
        if from == to {
            return String::new();
        }

        let from_bytes = from.as_bytes();
        let to_bytes = to.as_bytes();
        let from_start = 1;
        let from_end = from_bytes.len();
        let from_len = from_end - from_start;
        let to_start = 1;
        let to_len = to_bytes.len() - to_start;

        let length = from_len.min(to_len);
        let mut last_common_sep: isize = -1;
        let mut i = 0;
        while i < length {
            let from_code = from_bytes[from_start + i];
            if from_code != to_bytes[to_start + i] {
                break;
            }
            if from_code == b'/' {
                last_common_sep = i as isize;
            }
            i += 1;
        }
        if i == length {
            if to_len > length {
                if to_bytes[to_start + i] == b'/' {
                    return to[to_start + i + 1..].to_string();
                }
                if length == 0 {
                    return to[to_start + i..].to_string();
                }
            } else if from_len > length {
                if from_bytes[from_start + i] == b'/' {
                    last_common_sep = i as isize;
                } else if length == 0 {
                    last_common_sep = 0;
                }
            }
        }

        let mut out = String::new();
        let mut i = from_start as isize + last_common_sep + 1;
        while i <= from_end as isize {
            if i == from_end as isize || from_bytes[i as usize] == b'/' {
                out.push_str(if out.is_empty() { ".." } else { "/.." });
            }
            i += 1;
        }
        format!(
            "{out}{}",
            &to[(to_start as isize + last_common_sep) as usize..]
        )
    }

    /// Node `path.posix.extname`.
    pub fn extname(path: &str) -> &str {
        extname_from(path, 0, is_posix_path_separator)
    }
}

#[cfg(test)]
mod tests {
    use super::{posix, win32};

    // the working directory for relative(): irrelevant while both sides are
    // absolute, as they are in every pinned case
    const CWD: &str = "C:\\cwd";
    const CWD_POSIX: &str = "/cwd";

    // Every expectation below is pinned Node 26 output, generated with
    // path.win32 / path.posix - regenerate rather than hand-edit.

    #[test]
    fn win32_resolve_matches_node() {
        assert_eq!(win32::resolve("C:\\work\\proj", "."), "C:\\work\\proj");
        assert_eq!(
            win32::resolve("C:\\work\\proj", "sub"),
            "C:\\work\\proj\\sub"
        );
        assert_eq!(
            win32::resolve("C:\\work\\proj", "sub\\x"),
            "C:\\work\\proj\\sub\\x"
        );
        assert_eq!(
            win32::resolve("C:\\work\\proj", "sub/x"),
            "C:\\work\\proj\\sub\\x"
        );
        assert_eq!(win32::resolve("C:\\work\\proj", ".."), "C:\\work");
        assert_eq!(
            win32::resolve("C:\\work\\proj", "..\\other"),
            "C:\\work\\other"
        );
        assert_eq!(win32::resolve("C:\\work\\proj", "..\\..\\..\\up"), "C:\\up");
        assert_eq!(win32::resolve("C:\\work\\proj", "C:\\abs\\p"), "C:\\abs\\p");
        assert_eq!(win32::resolve("C:\\work\\proj", "C:/abs/p"), "C:\\abs\\p");
        assert_eq!(win32::resolve("C:\\work\\proj", "D:\\other"), "D:\\other");
        assert_eq!(
            win32::resolve("C:\\work\\proj", "C:rel"),
            "C:\\work\\proj\\rel"
        );
        assert_eq!(win32::resolve("C:\\work\\proj", "D:rel"), "D:\\rel");
        assert_eq!(win32::resolve("C:\\work\\proj", "\\rooted"), "C:\\rooted");
        assert_eq!(win32::resolve("C:\\work\\proj", "/rooted"), "C:\\rooted");
        assert_eq!(
            win32::resolve("C:\\work\\proj", "\\\\srv\\share\\p"),
            "\\\\srv\\share\\p"
        );
        assert_eq!(
            win32::resolve("C:\\work\\proj", "\\\\srv\\share"),
            "\\\\srv\\share\\"
        );
        assert_eq!(win32::resolve("C:\\work\\proj", ""), "C:\\work\\proj");
        assert_eq!(
            win32::resolve("C:\\work\\proj", "a\\.\\b"),
            "C:\\work\\proj\\a\\b"
        );
        assert_eq!(
            win32::resolve("C:\\work\\proj", "a\\b\\"),
            "C:\\work\\proj\\a\\b"
        );
        assert_eq!(win32::resolve("c:\\work", "C:rel"), "C:\\work\\rel");
        assert_eq!(
            win32::resolve("\\\\srv\\share\\dir", "x"),
            "\\\\srv\\share\\dir\\x"
        );
        assert_eq!(
            win32::resolve("\\\\srv\\share\\dir", ".."),
            "\\\\srv\\share\\"
        );
        assert_eq!(
            win32::resolve("\\\\srv\\share\\dir", "..\\.."),
            "\\\\srv\\share\\"
        );
    }

    #[test]
    fn win32_join_matches_node() {
        assert_eq!(win32::join("C:\\a", "b"), "C:\\a\\b");
        assert_eq!(win32::join("a", "b"), "a\\b");
        assert_eq!(win32::join("a\\", "\\b"), "a\\b");
        assert_eq!(win32::join("", "b"), "b");
        assert_eq!(win32::join("a", ""), "a");
        assert_eq!(win32::join("\\\\srv", "share"), "\\\\srv\\share\\");
        assert_eq!(win32::join("\\\\srv\\", "share"), "\\\\srv\\share\\");
        assert_eq!(win32::join("\\\\srv\\share", "x"), "\\\\srv\\share\\x");
        assert_eq!(win32::join("c:\\", "x"), "c:\\x");
        assert_eq!(win32::join("a/b", "../c"), "a\\c");
        assert_eq!(win32::join("a", "..\\..\\c"), "..\\c");
        assert_eq!(win32::join(".", "x.ts"), "x.ts");
        assert_eq!(win32::join("..", ".."), "..\\..");
    }

    #[test]
    fn win32_relative_matches_node() {
        assert_eq!(win32::relative(CWD, "C:\\a\\b", "C:\\a\\b"), "");
        assert_eq!(win32::relative(CWD, "C:\\a", "C:\\a\\b\\c"), "b\\c");
        assert_eq!(win32::relative(CWD, "C:\\a\\b\\c", "C:\\a"), "..\\..");
        assert_eq!(win32::relative(CWD, "C:\\a\\b", "C:\\a\\c"), "..\\c");
        assert_eq!(win32::relative(CWD, "C:\\A\\b", "c:\\a\\C"), "..\\C");
        assert_eq!(win32::relative(CWD, "C:\\a", "D:\\b"), "D:\\b");
        assert_eq!(win32::relative(CWD, "C:\\", "C:\\x"), "x");
        assert_eq!(win32::relative(CWD, "C:\\x", "C:\\"), "..");
        assert_eq!(win32::relative(CWD, "C:\\a\\", "C:\\a\\b"), "b");
        assert_eq!(
            win32::relative(CWD, "\\\\srv\\share\\a", "\\\\srv\\share\\b"),
            "..\\b"
        );
        assert_eq!(
            win32::relative(CWD, "\\\\srv\\share", "\\\\srv\\other\\x"),
            "..\\other\\x"
        );
        assert_eq!(win32::relative(CWD, "C:\\ab", "C:\\abc"), "..\\abc");
    }

    #[test]
    fn win32_extname_matches_node() {
        assert_eq!(win32::extname("file.ts"), ".ts");
        assert_eq!(win32::extname("file"), "");
        assert_eq!(win32::extname("file."), ".");
        assert_eq!(win32::extname(".gitignore"), "");
        assert_eq!(win32::extname(".gitignore.swp"), ".swp");
        assert_eq!(win32::extname("a.b/c"), "");
        assert_eq!(win32::extname("dir.x\\file"), "");
        assert_eq!(win32::extname("file.TAR.GZ"), ".GZ");
        assert_eq!(win32::extname(".."), "");
        assert_eq!(win32::extname("."), "");
        assert_eq!(win32::extname("a..b"), ".b");
        assert_eq!(win32::extname("file.."), ".");
        assert_eq!(win32::extname("C:.js"), "");
        assert_eq!(win32::extname("C:x.js"), ".js");
    }

    #[test]
    fn posix_resolve_matches_node() {
        assert_eq!(posix::resolve("/work/proj", "."), "/work/proj");
        assert_eq!(posix::resolve("/work/proj", "sub"), "/work/proj/sub");
        assert_eq!(posix::resolve("/work/proj", ".."), "/work");
        assert_eq!(posix::resolve("/work/proj", "../o"), "/work/o");
        assert_eq!(posix::resolve("/work/proj", "/abs"), "/abs");
        assert_eq!(posix::resolve("/work/proj", "a/../../.."), "/");
        assert_eq!(posix::resolve("/work/proj", ""), "/work/proj");
        assert_eq!(posix::resolve("/work/proj", "a/./b/"), "/work/proj/a/b");
        assert_eq!(posix::resolve("/work/proj", "//net/share"), "/net/share");
        assert_eq!(posix::resolve("/", ".."), "/");
    }

    #[test]
    fn posix_join_matches_node() {
        assert_eq!(posix::join("/a", "b"), "/a/b");
        assert_eq!(posix::join("a", "b"), "a/b");
        assert_eq!(posix::join("a/", "/b"), "a/b");
        assert_eq!(posix::join("", "b"), "b");
        assert_eq!(posix::join("a", ""), "a");
        assert_eq!(posix::join("a/b", "../c"), "a/c");
        assert_eq!(posix::join(".", "x.ts"), "x.ts");
        assert_eq!(posix::join("/", "/"), "/");
        assert_eq!(posix::join("//a", "b"), "/a/b");
    }

    #[test]
    fn posix_relative_matches_node() {
        assert_eq!(posix::relative(CWD_POSIX, "/a/b", "/a/b"), "");
        assert_eq!(posix::relative(CWD_POSIX, "/a", "/a/b/c"), "b/c");
        assert_eq!(posix::relative(CWD_POSIX, "/a/b/c", "/a"), "../..");
        assert_eq!(posix::relative(CWD_POSIX, "/a/b", "/a/c"), "../c");
        assert_eq!(posix::relative(CWD_POSIX, "/", "/x"), "x");
        assert_eq!(posix::relative(CWD_POSIX, "/x", "/"), "..");
        assert_eq!(posix::relative(CWD_POSIX, "/a/", "/a/b"), "b");
        assert_eq!(posix::relative(CWD_POSIX, "/ab", "/abc"), "../abc");
        assert_eq!(posix::relative(CWD_POSIX, "/A", "/a"), "../a");
    }

    #[test]
    fn posix_extname_matches_node() {
        assert_eq!(posix::extname("file.ts"), ".ts");
        assert_eq!(posix::extname("file"), "");
        assert_eq!(posix::extname(".gitignore"), "");
        assert_eq!(posix::extname("a.b/c"), "");
        assert_eq!(posix::extname("file."), ".");
        assert_eq!(posix::extname("a..b"), ".b");
    }
}
