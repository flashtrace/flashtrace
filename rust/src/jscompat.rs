/*
 * JavaScript string semantics, reproduced for byte parity.
 *
 * The port must emit exactly the bytes the JavaScript implementation emits,
 * and four of JavaScript's string primitives differ from Rust's in ways that
 * reach the output:
 *
 *  - String indexing counts UTF-16 code units, so a character beyond the
 *    Basic Multilingual Plane counts as two columns (`utf16_column`).
 *  - `a < b` compares UTF-16 code units, Rust's `str` ordering compares
 *    code points; the two disagree when one string carries a character in
 *    U+E000..U+FFFF where the other carries one beyond U+FFFF
 *    (`compare_utf16`).
 *  - The `\s` regex class and `String.prototype.trim` cover U+FEFF and not
 *    U+0085; Rust's `char::is_whitespace` is exactly the other way around
 *    (`JS_WHITESPACE_CLASS`, `js_trim`).
 *  - `\d` is ASCII-only in JavaScript and Unicode-aware in the regex crate;
 *    ported patterns write `[0-9]`.
 *
 * Translation policy for every ported regex: `\d` becomes `[0-9]`, `\s`
 * becomes `JS_WHITESPACE_CLASS`, and a `.` whose haystack can carry U+2028 or
 * U+2029 becomes an explicit negated class, because JavaScript line-splitting
 * (`split_lines`) does not split on those characters.
 */

use std::cmp::Ordering;

/// A regex class matching exactly the characters JavaScript's `\s` matches:
/// the ECMA-262 WhiteSpace and LineTerminator sets. It includes U+FEFF and
/// excludes U+0085, each the reverse of Unicode's `White_Space` property that
/// the regex crate's `\s` implements.
pub const JS_WHITESPACE_CLASS: &str = r"[\t\n\x0B\x0C\r \x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// Is this character in JavaScript's whitespace set (see
/// [`JS_WHITESPACE_CLASS`])?
pub fn is_javascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{000B}' | '\u{000C}' | '\r' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `String.prototype.trim`: strips JavaScript's whitespace set from both
/// ends - U+FEFF included, U+0085 kept, unlike Rust's `str::trim`.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_javascript_whitespace)
}

/// `text.split(/\r?\n/)`: a line ends at `\n` or `\r\n`. A lone `\r` is not a
/// separator, and neither are U+2028 and U+2029. Like the JavaScript split,
/// an empty input yields one empty line and a trailing separator yields a
/// trailing empty line.
pub fn split_lines(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

/// The length of a string in UTF-16 code units - JavaScript's
/// `String.prototype.length`.
pub fn utf16_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The 1-based column of a byte offset into a line, counted in UTF-16 code
/// units as JavaScript string indexing does: a character beyond the Basic
/// Multilingual Plane counts as two columns.
pub fn utf16_column(line: &str, byte_offset: usize) -> usize {
    utf16_length(&line[..byte_offset]) + 1
}

/// String order under JavaScript's `<` on strings: code unit by UTF-16 code
/// unit. Every comparator whose result reaches the output goes through this,
/// never through Rust's code-point-wise `str` ordering.
pub fn compare_utf16(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;

    #[test]
    fn split_lines_takes_carriage_return_only_before_a_line_feed() {
        assert_eq!(split_lines("a\r\r\nb"), ["a\r", "b"]);
        assert_eq!(split_lines("a\rb"), ["a\rb"]);
        assert_eq!(split_lines("a\n\rb"), ["a", "\rb"]);
    }

    #[test]
    fn split_lines_keeps_the_javascript_edge_shapes() {
        assert_eq!(split_lines(""), [""]);
        assert_eq!(split_lines("a\n"), ["a", ""]);
        assert_eq!(split_lines("a\r\n\r\n"), ["a", "", ""]);
    }

    #[test]
    fn split_lines_does_not_split_on_the_unicode_line_separators() {
        assert_eq!(split_lines("a\u{2028}b\u{2029}c"), ["a\u{2028}b\u{2029}c"]);
    }

    #[test]
    fn js_trim_strips_the_byte_order_mark_and_keeps_next_line() {
        // the two characters where the JavaScript and Unicode sets disagree
        assert_eq!(js_trim("\u{FEFF} x \u{FEFF}"), "x");
        assert_eq!(js_trim("\u{0085}x\u{0085}"), "\u{0085}x\u{0085}");
        // Rust's own trim decides both the other way; if that ever changes,
        // js_trim could only have become redundant, never wrong
        assert_eq!("\u{FEFF}x".trim(), "\u{FEFF}x");
        assert_eq!("\u{0085}x".trim(), "x");
    }

    #[test]
    fn utf16_column_counts_an_astral_character_as_two() {
        let line = "a\u{1D54F}b"; // 𝕏 sits beyond the Basic Multilingual Plane
        let offset_of_b = line.find('b').unwrap();
        assert_eq!(utf16_column(line, offset_of_b), 4);
        assert_eq!(utf16_column(line, 0), 1);
    }

    #[test]
    fn utf16_column_counts_a_basic_plane_character_as_one() {
        let line = "é[x]";
        assert_eq!(utf16_column(line, line.find('[').unwrap()), 2);
    }

    #[test]
    fn compare_utf16_orders_by_code_unit_not_code_point() {
        // U+FFFF > U+10000 in UTF-16 code units (the astral character starts
        // with the surrogate 0xD800), while code-point order says the reverse
        assert_eq!(compare_utf16("\u{FFFF}", "\u{10000}"), Ordering::Greater);
        assert_eq!("\u{FFFF}".cmp("\u{10000}"), Ordering::Less);
        assert_eq!(compare_utf16("a", "b"), Ordering::Less);
        assert_eq!(compare_utf16("a", "a"), Ordering::Equal);
    }

    #[test]
    fn the_whitespace_class_matches_exactly_the_javascript_set() {
        let class = Regex::new(&format!("^{JS_WHITESPACE_CLASS}$")).unwrap();
        for member in [
            '\t', '\n', '\u{000B}', '\u{000C}', '\r', ' ', '\u{00A0}', '\u{1680}', '\u{2000}',
            '\u{200A}', '\u{2028}', '\u{2029}', '\u{202F}', '\u{205F}', '\u{3000}', '\u{FEFF}',
        ] {
            assert!(
                class.is_match(&member.to_string()),
                "U+{:04X}",
                member as u32
            );
            assert!(is_javascript_whitespace(member), "U+{:04X}", member as u32);
        }
        for outsider in ['\u{0085}', 'x', '\u{200B}'] {
            assert!(
                !class.is_match(&outsider.to_string()),
                "U+{:04X}",
                outsider as u32
            );
            assert!(
                !is_javascript_whitespace(outsider),
                "U+{:04X}",
                outsider as u32
            );
        }
    }
}
