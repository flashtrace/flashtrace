/*
 * The source position every located record carries: items, forwardings,
 * problems and the defects that point somewhere other than their item.
 */

/// A source position: 1-based line and 1-based column in a file, the column
/// counted in characters (Unicode scalar values). The derived order compares
/// the fields in declaration order - file (String's Ord is code-point
/// lexicographic, as str::cmp), then line, then character - which is exactly
/// the documented location order.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Location {
    pub file: String,
    pub line: usize,
    pub character: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations_order_by_file_then_line_then_character() {
        // given
        let at = |file: &str, line: usize, character: usize| Location {
            file: file.to_string(),
            line,
            character,
        };
        let mut locations = vec![
            at("b.md", 1, 1),
            at("a.md", 2, 1),
            at("a.md", 1, 9),
            at("a.md", 1, 2),
            // code-point order: an uppercase letter sorts before lowercase
            at("B.md", 9, 9),
        ];

        // when
        locations.sort();

        // then
        assert_eq!(
            locations,
            [
                at("B.md", 9, 9),
                at("a.md", 1, 2),
                at("a.md", 1, 9),
                at("a.md", 2, 1),
                at("b.md", 1, 1),
            ]
        );
    }
}
