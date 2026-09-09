/*
 * Markdown parser (.md, .markdown):
 *   - An item is defined by a line containing only its ID in backticks: `req:auth/login#1`
 *   - Title: the heading directly above the ID (only blank lines in between),
 *     either ATX (#...) or setext (a paragraph underlined with === / ---; the
 *     whole paragraph folds into the title, as in CommonMark).
 *   - Description: the lines following the ID (one blank line directly under the
 *     ID is allowed) up to the next blank line.
 *   - Keywords "Needs:", "Covers:", "Tags:" - inline comma-separated, as a
 *     bullet list on the following lines, or as a table column whose header
 *     cell is the bare keyword name. A Needs or Covers entry is a reference:
 *     a full ID, or a short form (impl, impl:name, impl#2) whose omitted
 *     [group/]name and revision are taken from the item stating it. Needs may
 *     demand a wildcard revision; Covers stay concrete.
 *   - Neither a table cell nor a setext heading can define an item: a
 *     backticked ID in a table cell, or an ID line with no blank line below it
 *     (which folds into the following heading), is reported, not defined.
 *   - A line containing only `[<id> --> <id>]` (optionally backticked) forwards
 *     the first item's coverage obligation to the second (spaces optional).
 *
 * Only the Markdown spelling lives here; what a keyword's entries mean for an
 * item is format-neutral and lives in spec_items.rs.
 *
 * A forwarding line has a backticked and a bare spelling, each its own
 * anchored expression, so a line with a lone backtick matches neither.
 */

use std::ops::Range;
use std::sync::LazyLock;

use regex::{Captures, Regex};

use crate::defects::Problem;
use crate::ids::{Forward, Item, Origin, forward_src, id_src, make_forward, make_id, new_item};
use crate::spec_items::{Entry, KEYWORDS, apply_keyword, is_keyword};

static DEFINITION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"^\s*`{}`\s*$", id_src())).unwrap());
static HEADING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(#{1,6})\s+(\S(?:.*\S)?)\s*$").unwrap());
// Setext heading underline: a run of only `=` (level 1) or `-` (level 2),
// with up to three leading spaces and optional trailing whitespace per
// CommonMark. A row carrying pipes (a table delimiter) never matches.
static SETEXT_UNDERLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^ {0,3}(?:=+|-+)[ \t]*$").unwrap());
// Thematic break, dash-spelled. Only this shape collides with a table row or
// setext underline, and it only matters inside a table - under a paragraph the
// setext underline still wins (CommonMark).
static THEMATIC_BREAK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^ {0,3}-{3,}[ \t]*$").unwrap());
// The vocabulary is owned by spec_items.rs and interpolated here as an
// alternation; keywords stay bare words (spec_items.rs guards that), so they
// need no regex escaping.
static KEYWORD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"^({}):\s*((?:\S.*)?)$", KEYWORDS.join("|"))).unwrap());
static BULLET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*[-*+]\s+(\S(?:.*\S)?)\s*$").unwrap());
static DELIMITER_CELL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new("^:?-+:?$").unwrap());
// the two spellings of a forwarding line; in both, the ID captures start at
// group 1
static BACKTICKED_FORWARD_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"^\s*`{}`\s*$", forward_src())).unwrap());
static BARE_FORWARD_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"^\s*{}\s*$", forward_src())).unwrap());

// the full ID a definition match captured (type, optional [group/]name, name,
// revision are groups 1-4)
fn captured_id(m: &Captures<'_>) -> String {
    make_id(
        m.get(1).unwrap().as_str(),
        m.get(2).map(|group| group.as_str()),
        m.get(3).unwrap().as_str(),
        m.get(4).unwrap().as_str(),
    )
}

// the length of a text prefix in characters (Unicode scalar values) - the
// unit report columns count
fn character_length(text: &str) -> usize {
    text.chars().count()
}

// the character index of the first non-whitespace character, or None on an
// all-whitespace text
fn index_of_first_non_whitespace(text: &str) -> Option<usize> {
    text.chars()
        .position(|character| !character.is_whitespace())
}

// 1-based column of the first non-blank character of a line - the construct a
// location points at (the backtick of an ID line, the opener of a forwarding
// line). Never called on a blank line.
fn first_non_blank_column(line: &str) -> usize {
    index_of_first_non_whitespace(line).map_or(0, |index| index + 1)
}

// a line that is only a forwarding tag pushes a forward and is otherwise skipped
fn take_forward(line: &str, file: &str, line_index: usize, forwards: &mut Vec<Forward>) -> bool {
    let forward = BACKTICKED_FORWARD_LINE_RE
        .captures(line)
        .or_else(|| BARE_FORWARD_LINE_RE.captures(line));
    match forward {
        Some(m) => {
            forwards.push(make_forward(
                &m,
                1,
                file,
                line_index + 1,
                first_non_blank_column(line),
            ));
            true
        }
        None => false,
    }
}

// A setext underline forms a heading only when a paragraph line sits directly
// above it (CommonMark). That excludes the lookalikes the issue names: a
// thematic break (blank line above the run), a table delimiter row (its run
// carries pipes, so SETEXT_UNDERLINE_RE never matches it), and a bullet list
// (a run whose neighbour above is a bullet, not a paragraph). Keyword,
// forwarding, and ID lines are paragraph text too: folded into a setext title
// they serve the heading, not their usual role (as `# Covers: ...` is a
// heading, not a keyword), and a so-folded ID defines no item. A pipe alone
// does not disqualify a line either - only membership in an actual table
// does, which is context, not shape (see is_paragraph_at).
fn is_paragraph_line(line: &str) -> bool {
    !line.trim().is_empty()
        && !HEADING_RE.is_match(line)
        && !BULLET_RE.is_match(line)
        && !SETEXT_UNDERLINE_RE.is_match(line)
}

// a paragraph line in document context: paragraph-shaped and not part of a
// table - a table row above an underline stays a row (see scan_tables)
fn is_paragraph_at(lines: &[&str], in_table: &[bool], j: usize) -> bool {
    !in_table[j] && is_paragraph_line(lines[j])
}

// The line at `title_index` forms a setext heading with the line below it
// exactly when that line is a valid =/- run and `title_index` is a paragraph
// in context. title_above and is_boundary share this predicate, so title
// recognition and body termination agree by construction.
fn is_setext_heading(lines: &[&str], in_table: &[bool], title_index: usize) -> bool {
    title_index + 1 < lines.len()
        && SETEXT_UNDERLINE_RE.is_match(lines[title_index + 1])
        && is_paragraph_at(lines, in_table, title_index)
}

// Mark every paragraph line that opens a setext heading: one whose run of
// paragraph lines ends directly at an underline - CommonMark folds the whole
// run into the heading, so every line in it belongs to the title, not to the
// body above it. Computed once per run rather than re-walked from each line,
// the way scan_tables marks a whole table in one pass instead of re-scanning
// it from every row.
fn scan_setext_headings(lines: &[&str], in_table: &[bool]) -> Vec<bool> {
    let mut opens_heading = vec![false; lines.len()];
    let mut j = 0;
    while j < lines.len() {
        if !is_paragraph_at(lines, in_table, j) {
            j += 1;
            continue;
        }
        let start = j;
        while j + 1 < lines.len() && is_paragraph_at(lines, in_table, j + 1) {
            j += 1;
        }
        if is_setext_heading(lines, in_table, j) {
            opens_heading[start..=j].fill(true);
        }
        j += 1;
    }
    opens_heading
}

// An item's body ends at an ID definition, an ATX heading, or a setext heading
// - the last even with no blank line between, since the heading claims its
// whole paragraph, so the body ends at the first line of the folding run. An ID
// line swallowed into a table is a row, not a definition, so it bounds nothing.
fn is_boundary(lines: &[&str], in_table: &[bool], opens_heading: &[bool], j: usize) -> bool {
    (!in_table[j] && DEFINITION_RE.is_match(lines[j]))
        || HEADING_RE.is_match(lines[j])
        || opens_heading[j]
}

// Fold the paragraph run ending at `last_index` into one title. Each line is
// trimmed and the lines are joined with a single space - the whitespace a
// renderer shows for a soft line break. A line ending in two or more spaces
// spells a hard line break (CommonMark) and joins with a newline instead.
fn fold_setext_title(lines: &[&str], in_table: &[bool], last_index: usize) -> String {
    let mut first = last_index;
    while first > 0 && is_paragraph_at(lines, in_table, first - 1) {
        first -= 1;
    }
    let mut title = String::new();
    for (k, line) in lines.iter().enumerate().take(last_index + 1).skip(first) {
        title.push_str(line.trim());
        if k < last_index {
            title.push(if line.ends_with("  ") { '\n' } else { ' ' });
        }
    }
    title
}

fn title_above(lines: &[&str], in_table: &[bool], definition_index: usize) -> Option<String> {
    for k in (0..definition_index).rev() {
        let line = lines[k];
        if line.trim().is_empty() {
            continue; // blank lines between heading and ID are fine
        }
        if let Some(heading) = HEADING_RE.captures(line) {
            return Some(heading.get(2).unwrap().as_str().to_string()); // ATX heading (#...)
        }
        // A setext underline folds the paragraph directly above it into the
        // title; without a paragraph line above, the run of =/- is not a heading.
        if k > 0 && is_setext_heading(lines, in_table, k - 1) {
            return Some(fold_setext_title(lines, in_table, k - 1));
        }
        return None; // any other text directly above -> no title
    }
    None
}

// entries of a keyword line: inline comma-separated, or a bullet list on the
// following lines. Each entry carries its own source location (the column of
// its first character, and - for a bullet list - the line it sits on rather
// than the keyword line), so an invalid-reference defect points at the entry
// itself. Returns the entries and the index of the last consumed line.
fn keyword_entries(lines: &[&str], j: usize, inline_range: Range<usize>) -> (Vec<Entry>, usize) {
    let line = lines[j];
    let inline = &line[inline_range.clone()];
    if !inline.trim().is_empty() {
        // inline is the `$`-anchored tail of lines[j], so it begins at this
        // character offset
        let inline_start = character_length(&line[..inline_range.start]);
        let mut entries = Vec::new();
        let mut pos = 0;
        for part in inline.split(',') {
            let value = part.trim();
            if !value.is_empty() {
                let leading = index_of_first_non_whitespace(part).unwrap();
                entries.push(Entry {
                    value: value.to_string(),
                    line: j + 1,
                    character: inline_start + pos + leading + 1,
                });
            }
            pos += character_length(part) + 1; // + 1 for the consumed comma
        }
        return (entries, j);
    }
    let mut entries = Vec::new();
    let mut j = j;
    while j + 1 < lines.len() {
        let Some(bullet) = BULLET_RE.captures(lines[j + 1]) else {
            break;
        };
        let captured = bullet.get(1).unwrap();
        entries.push(Entry {
            value: captured.as_str().to_string(),
            line: j + 2,
            character: character_length(&lines[j + 1][..captured.start()]) + 1,
        });
        j += 1;
    }
    (entries, j)
}

// cells of a `| a | b |` table row, or None; as in GFM, one leading and one
// trailing pipe are optional, but a row must contain at least one pipe
fn row_cells(line: &str) -> Option<Vec<&str>> {
    let mut row = line.trim();
    if !row.contains('|') {
        return None;
    }
    if let Some(stripped) = row.strip_prefix('|') {
        row = stripped;
    }
    if let Some(stripped) = row.strip_suffix('|') {
        row = stripped;
    }
    Some(row.split('|').map(str::trim).collect())
}

// 1-based columns of each cell's content, aligned one-to-one with the cells
// row_cells_in_table returns, so a cell-level problem can point at the
// offending cell the way an item column points at its backtick. Mirrors
// row_cells: it works on the trimmed row and one optional leading/trailing
// pipe, tracking the offset back into the original line. An empty cell
// reports its start column.
fn row_cell_columns(line: &str) -> Vec<usize> {
    if row_cells(line).is_none() {
        return vec![first_non_blank_column(line)];
    }
    // the character index where the trim starts; the row has a pipe, so the
    // line is not blank
    let mut base = index_of_first_non_whitespace(line).unwrap();
    let trimmed = line.trim();
    let mut body = trimmed;
    if let Some(stripped) = body.strip_prefix('|') {
        body = stripped;
        base += 1;
    }
    if let Some(stripped) = body.strip_suffix('|') {
        body = stripped;
    }
    let mut columns = Vec::new();
    let mut pos = 0;
    for part in body.split('|') {
        let value = part.trim();
        let leading = if value.is_empty() {
            0
        } else {
            index_of_first_non_whitespace(part).unwrap()
        };
        columns.push(base + pos + leading + 1);
        pos += character_length(part) + 1; // + 1 for the consumed pipe
    }
    columns
}

// does `lines[j]` start a table: a pipe-carrying header row directly followed
// by a delimiter row with the same number of cells? GFM degrades a block
// whose delimiter row deviates in cell count to prose, so the tracer must
// not read it as a table either.
fn table_starts_at(lines: &[&str], j: usize) -> bool {
    let Some(header) = row_cells(lines[j]) else {
        return false;
    };
    let delimiter = if j + 1 < lines.len() {
        row_cells(lines[j + 1])
    } else {
        None
    };
    match delimiter {
        Some(delimiter) if delimiter.len() == header.len() => delimiter
            .iter()
            .all(|cell| DELIMITER_CELL_RE.is_match(cell)),
        _ => false,
    }
}

// Like GFM, a table runs to the first blank line or block-level element: an
// ATX heading, or a thematic break (a `---` run under a row is a break, so it
// ends the table as plain text). Any other pipe-less line ends it too, except
// those GFM swallows as single-cell rows: a `===` run, a dash run too short for
// a break (`-`, `--`), or an item-definition line - each fills the first
// column, so it ends nothing, underlines nothing, and defines nothing.
fn continues_table(line: &str) -> bool {
    !line.trim().is_empty()
        && !HEADING_RE.is_match(line)
        && !THEMATIC_BREAK_RE.is_match(line)
        && (line.contains('|')
            || SETEXT_UNDERLINE_RE.is_match(line)
            || DEFINITION_RE.is_match(line))
}

// cells of a row inside a table: a swallowed pipe-less line (a =/- run) is a
// single-cell row - its text fills the first column
fn row_cells_in_table(line: &str) -> Vec<&str> {
    row_cells(line).unwrap_or_else(|| vec![line.trim()])
}

// Mark every line belonging to a table so heading detection can rule them out:
// a table row above an underline stays a row. While scanning, flag a cell that
// holds nothing but a backticked ID - an item cannot be defined inside a table.
// Keyword columns are exempt: their cells are entries, not definitions.
fn scan_tables(lines: &[&str], file: &str, problems: &mut Vec<Problem>) -> Vec<bool> {
    let mut in_table = vec![false; lines.len()];
    let mut j = 0;
    while j < lines.len() {
        if !table_starts_at(lines, j) {
            j += 1;
            continue;
        }
        let mut keyword_columns = std::collections::HashSet::new();
        for (col, cell) in row_cells(lines[j]).unwrap().iter().enumerate() {
            if is_keyword(cell) {
                keyword_columns.insert(col);
            }
        }
        let start = j;
        let mut end = j + 1;
        while end + 1 < lines.len() && continues_table(lines[end + 1]) {
            end += 1;
        }
        for k in start..=end {
            in_table[k] = true;
            if k == start + 1 {
                continue; // the delimiter row carries no content
            }
            let columns = row_cell_columns(lines[k]);
            for (col, cell) in row_cells_in_table(lines[k]).iter().enumerate() {
                let definition = if keyword_columns.contains(&col) {
                    None
                } else {
                    DEFINITION_RE.captures(cell)
                };
                if let Some(definition) = definition {
                    let id = captured_id(&definition);
                    problems.push(Problem {
                        file: file.to_string(),
                        line: k + 1,
                        character: columns[col],
                        message: format!(
                            "item {id} defined inside a table; a table cell is not an item definition"
                        ),
                    });
                }
            }
        }
        j = end + 1;
    }
    in_table
}

// a table whose header row contains keyword cells ("Needs", "Covers", "Tags")
// contributes each row's cell in those columns as one entry; empty cells and
// all other columns are ignored. Returns the index of the last consumed line,
// or None if `lines[j]` is not the header of such a table. Only the line a
// scanned table starts at qualifies - a keyword-headed row inside a larger
// table is a row of that table, not a nested table of its own.
fn take_keyword_table(
    lines: &[&str],
    in_table: &[bool],
    j: usize,
    item: &mut Item,
    file: &str,
) -> Option<usize> {
    if !in_table[j] || (j > 0 && in_table[j - 1]) {
        return None;
    }
    let mut columns: Vec<(usize, &'static str)> = Vec::new();
    for (col, cell) in row_cells(lines[j]).unwrap().iter().enumerate() {
        if let Some(keyword) = KEYWORDS.iter().copied().find(|keyword| keyword == cell) {
            columns.push((col, keyword));
        }
    }
    if columns.is_empty() {
        return None;
    }
    let mut j = j + 1; // the delimiter row
    while j + 1 < lines.len() && in_table[j + 1] {
        j += 1;
        let cells = row_cells_in_table(lines[j]);
        let cell_columns = row_cell_columns(lines[j]);
        for (col, keyword) in &columns {
            let Some(cell) = cells.get(*col).filter(|cell| !cell.is_empty()) else {
                continue;
            };
            let item_id = &item.id;
            let source = format!("the {keyword} column of {item_id}");
            apply_keyword(
                item,
                keyword,
                &[Entry {
                    value: cell.to_string(),
                    line: j + 1,
                    character: cell_columns[*col],
                }],
                file,
                &source,
            );
        }
    }
    Some(j)
}

// consume the item's body (description and keyword lines) starting at
// `start`; returns the index of the first line after the item
fn parse_item_body(
    lines: &[&str],
    in_table: &[bool],
    opens_heading: &[bool],
    start: usize,
    item: &mut Item,
    file: &str,
    forwards: &mut Vec<Forward>,
) -> usize {
    let mut j = start;
    let mut description_done = false;
    while j < lines.len() && !is_boundary(lines, in_table, opens_heading, j) {
        let line = lines[j];
        if take_forward(line, file, j, forwards) {
            j += 1;
            continue;
        }
        let keyword_match = KEYWORD_RE.captures(line);
        let table_end = if keyword_match.is_some() {
            None
        } else {
            take_keyword_table(lines, in_table, j, item, file)
        };
        if let Some(m) = keyword_match {
            description_done = true;
            let keyword = m.get(1).unwrap().as_str().to_string();
            let (entries, consumed) = keyword_entries(lines, j, m.get(2).unwrap().range());
            let item_id = &item.id;
            let source = format!("the {keyword} list of {item_id}");
            apply_keyword(item, &keyword, &entries, file, &source);
            j = consumed;
        } else if let Some(table_end) = table_end {
            description_done = true;
            j = table_end;
        } else if line.trim().is_empty() {
            if !item.description.is_empty() {
                description_done = true;
            }
            // a blank line directly under the ID (before the description) is allowed
        } else if !description_done {
            item.description.push(line.trim().to_string());
        }
        // anything after the description's terminating blank line is informative text
        j += 1;
    }
    j
}

pub fn parse_markdown(
    file: &str,
    text: &str,
    problems: &mut Vec<Problem>,
    forwards: &mut Vec<Forward>,
) -> Vec<Item> {
    let lines: Vec<&str> = text.lines().collect();
    let in_table = scan_tables(&lines, file, problems);
    let opens_heading = scan_setext_headings(&lines, &in_table);
    let mut items = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let starts_heading = opens_heading[i];
        // a forwarding line serving a setext title is heading text, not a forward
        if !starts_heading && take_forward(lines[i], file, i, forwards) {
            i += 1;
            continue;
        }
        // an ID line swallowed into a table is a row (scan_tables reports it
        // outside keyword columns), never a definition
        let definition = if in_table[i] {
            None
        } else {
            DEFINITION_RE.captures(lines[i])
        };
        let Some(definition) = definition else {
            i += 1;
            continue;
        };
        if starts_heading {
            // No blank line below the ID, so its paragraph folds into a setext
            // heading (CommonMark): the ID is heading text, not a definition.
            // Report it and create no item; the folded text titles the item below.
            let id = captured_id(&definition);
            problems.push(Problem {
                file: file.to_string(),
                line: i + 1,
                character: first_non_blank_column(lines[i]),
                message: format!(
                    "item {id} defined inside a setext heading; a heading is not an item definition"
                ),
            });
            i += 1;
            continue;
        }
        let mut item = new_item(
            &captured_id(&definition),
            Origin::Spec,
            file,
            i + 1,
            first_non_blank_column(lines[i]),
        );
        item.title = title_above(&lines, &in_table, i);
        i = parse_item_body(
            &lines,
            &in_table,
            &opens_heading,
            i + 1,
            &mut item,
            file,
            forwards,
        );
        items.push(item);
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fixtures are built from line arrays: backticked IDs inside string
    // literals would need escaping and hurt readability.
    fn parse(lines: &[&str]) -> (Vec<Item>, Vec<Problem>, Vec<Forward>) {
        let mut problems = Vec::new();
        let mut forwards = Vec::new();
        let items = parse_markdown("spec.md", &lines.join("\n"), &mut problems, &mut forwards);
        (items, problems, forwards)
    }

    fn forward(from: &str, to: &str, line: usize, character: usize) -> Forward {
        Forward {
            from: from.to_string(),
            to: to.to_string(),
            file: "spec.md".to_string(),
            line,
            character,
            effective: true,
            voided_by: None,
        }
    }

    #[test]
    fn full_item_title_description_needs_covers_tags() {
        let (items, problems, _) = parse(&[
            "### Login requires a valid session token",
            "`req:auth/login#1`",
            "",
            "The system only accepts requests that carry a valid session token.",
            "A second line still belongs to the description.",
            "",
            "Everything after the blank line above is informative and ignored.",
            "",
            "Needs: impl:auth/login#1, utest:auth/login#1",
            "",
            "Covers:",
            "- feat:auth#1",
            "",
            "Tags: Auth, Security",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.id, "req:auth/login#1");
        assert_eq!(item.key, "req:auth/login");
        assert_eq!(item.revision, "1");
        assert_eq!(item.origin, Origin::Spec);
        assert_eq!(item.file, "spec.md");
        assert_eq!(item.line, 2);
        assert_eq!(
            item.title.as_deref(),
            Some("Login requires a valid session token")
        );
        assert_eq!(
            item.description,
            [
                "The system only accepts requests that carry a valid session token.",
                "A second line still belongs to the description.",
            ]
        );
        assert_eq!(item.needs, ["impl:auth/login#1", "utest:auth/login#1"]);
        assert_eq!(item.covers, ["feat:auth#1"]);
        assert_eq!(item.tags, ["Auth", "Security"]);
    }

    #[test]
    fn title_survives_blank_lines_between_heading_and_id() {
        let (items, _, _) = parse(&["# The title", "", "", "`req:a#1`"]);
        assert_eq!(items[0].title.as_deref(), Some("The title"));
    }

    #[test]
    fn non_blank_text_between_heading_and_id_means_no_title() {
        let (items, _, _) = parse(&["# The title", "some other text", "`req:a#1`"]);
        assert_eq!(items[0].title, None);
    }

    // Setext-style headings: a paragraph line underlined with `=` (level 1)
    // or `-` (level 2) is the item's title, just like an ATX `#` heading.
    #[test]
    fn setext_level_1_heading_is_recognized_as_the_title() {
        let (items, _, _) = parse(&["Title level 1", "=============", "`req:a#1`"]);
        assert_eq!(items[0].title.as_deref(), Some("Title level 1"));
    }

    #[test]
    fn setext_level_2_heading_is_recognized_as_the_title() {
        let (items, _, _) = parse(&["Title level 2", "-------------", "`req:a#1`"]);
        assert_eq!(items[0].title.as_deref(), Some("Title level 2"));
    }

    #[test]
    fn a_setext_underline_may_carry_trailing_whitespace_and_three_leading_spaces() {
        let (items, _, _) = parse(&["The title", "   ===   ", "`req:a#1`"]);
        assert_eq!(items[0].title.as_deref(), Some("The title"));
    }

    #[test]
    fn setext_title_survives_blank_lines_between_the_underline_and_the_id() {
        let (items, _, _) = parse(&["The title", "=========", "", "", "`req:a#1`"]);
        assert_eq!(items[0].title.as_deref(), Some("The title"));
    }

    // The underline must sit directly under a paragraph line. A thematic
    // break is a run of `-` set off by a blank line, so it must not become a
    // heading.
    #[test]
    fn a_thematic_break_after_a_blank_line_is_not_a_setext_heading() {
        let (items, _, _) = parse(&["Some intro paragraph", "", "---", "", "`req:a#1`"]);
        assert_eq!(items[0].title, None);
    }

    // A table delimiter row carries pipes, so it is never a setext underline.
    // The blank line ends the table; without it the ID line would be
    // swallowed as a row.
    #[test]
    fn a_table_delimiter_row_is_not_mistaken_for_a_setext_heading() {
        let (items, _, _) = parse(&["| Feature | Owner |", "| --- | --- |", "", "`req:a#1`"]);
        assert_eq!(items[0].title, None);
    }

    // A run of `-` directly below a bullet ends the list; it is not a heading.
    #[test]
    fn a_bullet_list_above_a_run_of_dashes_is_not_a_setext_heading() {
        let (items, _, _) = parse(&["- item one", "- item two", "---", "`req:a#1`"]);
        assert_eq!(items[0].title, None);
    }

    // A setext heading claims only its own paragraph: the blank line above
    // ends the description, which stays with the previous item while the
    // heading titles the next.
    #[test]
    fn a_blank_line_separates_the_description_from_a_following_setext_heading() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "Description of a.",
            "",
            "Next Title",
            "==========",
            "`req:b#1`",
        ]);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].description, ["Description of a."]);
        assert_eq!(items[1].title.as_deref(), Some("Next Title"));
    }

    // The tracer folds every paragraph line down to the underline into one
    // multi-line title: lines trimmed and joined with a space, or a newline
    // where a line ends in two+ spaces (a hard break). Folded lines are never
    // the description.
    #[test]
    fn setext_titles_are_multi_line_and_keep_every_folded_line_to_themselves() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "",
            "First title line without trailing spaces.",
            "Second title line with actual line break by spaces.  ",
            "Third title line with space in the end. ",
            "Fourth title line with actual line break by spaces.  ",
            " Fifth title line with space in the beginning.",
            "======================",
            "`req:b#1`",
        ]);
        assert_eq!(items.len(), 2);
        assert!(items[0].description.is_empty());
        assert_eq!(
            items[1].title.as_deref(),
            Some(
                "First title line without trailing spaces. \
                 Second title line with actual line break by spaces.\n\
                 Third title line with space in the end. \
                 Fourth title line with actual line break by spaces.\n\
                 Fifth title line with space in the beginning."
            )
        );
    }

    // Glued onto the paragraph a setext underline turns into a heading, an ID
    // line is heading text (CommonMark): reported, defining no item, and
    // folded - with the rest of the run - into the following item's title.
    #[test]
    fn an_id_line_glued_above_a_setext_heading_is_heading_text_flagged_and_creating_no_item() {
        let (items, problems, _) = parse(&["`req:a#1`", "Some title", "==========", "`req:b#1`"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "req:b#1");
        assert_eq!(items[0].title.as_deref(), Some("`req:a#1` Some title"));
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].line, 1);
        assert!(problems[0].message.contains(
            "item req:a#1 defined inside a setext heading; a heading is not an item definition"
        ));
    }

    // The degenerate case: an ID line directly above an underline is itself
    // the whole heading. It is reported and defines no item.
    #[test]
    fn an_id_line_directly_above_a_setext_underline_is_the_heading_itself_flagged() {
        let (items, problems, _) = parse(&["`req:a#1`", "==========", "`req:b#1`"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "req:b#1");
        assert_eq!(items[0].title.as_deref(), Some("`req:a#1`"));
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0]
                .message
                .contains("item req:a#1 defined inside a setext heading")
        );
    }

    // Every ID line folded into one heading is reported, not just the last: a
    // run of two glued ID lines above an underline yields two problems and no
    // items.
    #[test]
    fn every_id_line_folded_into_a_setext_heading_is_flagged() {
        let (items, problems, _) = parse(&["`req:a#1`", "`req:b#1`", "==========", "`req:c#1`"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "req:c#1");
        assert_eq!(problems.len(), 2);
        assert!(
            problems[0]
                .message
                .contains("item req:a#1 defined inside a setext heading")
        );
        assert!(
            problems[1]
                .message
                .contains("item req:b#1 defined inside a setext heading")
        );
    }

    // A blank line below the ID keeps it a standalone definition: the
    // paragraph that becomes the heading starts below the blank, so the ID
    // stays an item.
    #[test]
    fn a_blank_line_below_an_id_keeps_it_a_definition_even_when_a_setext_heading_follows() {
        let (items, problems, _) =
            parse(&["`req:a#1`", "", "Some title", "==========", "`req:b#1`"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "req:a#1");
        assert_eq!(items[1].title.as_deref(), Some("Some title"));
    }

    // A thematic break (a run of `-` set off by blank lines) is not a setext
    // heading, so it must neither terminate the body nor split off a new item.
    #[test]
    fn a_thematic_break_inside_a_body_does_not_terminate_it_or_split_the_item() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "Description of a.",
            "",
            "---",
            "",
            "More prose that is not a new item.",
        ]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].description, ["Description of a."]);
    }

    // Underlined, a keyword line serves the setext title and is ignored for
    // its keyword - exactly as `# Covers: ...` is a heading, not a keyword.
    #[test]
    fn a_keyword_line_above_a_setext_underline_serves_the_title_its_keyword_ignored() {
        let (items, _, _) = parse(&["`req:a#1`", "", "Covers: req:x#1", "---", "`req:b#1`"]);
        assert_eq!(items.len(), 2);
        assert!(items[0].covers.is_empty());
        assert_eq!(items[1].title.as_deref(), Some("Covers: req:x#1"));
    }

    // The same holds for a forwarding line - `# [a --> b]` would not forward
    // either.
    #[test]
    fn a_forwarding_line_above_a_setext_underline_serves_the_title_its_forward_ignored() {
        let (items, _, forwards) =
            parse(&["`req:a#1`", "", "[req:a#1 --> dsn:b#1]", "---", "`req:b#1`"]);
        assert_eq!(forwards.len(), 0);
        assert_eq!(items[1].title.as_deref(), Some("[req:a#1 --> dsn:b#1]"));
    }

    // The fold covers the whole paragraph: a keyword line anywhere in the run
    // that ends at an underline belongs to the title, not to the keyword list.
    #[test]
    fn a_keyword_line_folded_into_a_multi_line_setext_title_is_ignored_for_its_keyword() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "Description of a.",
            "",
            "Covers: req:x#1  ",
            "Second title line",
            "=================",
            "`req:b#1`",
        ]);
        assert_eq!(items.len(), 2);
        assert!(items[0].covers.is_empty());
        assert_eq!(items[0].description, ["Description of a."]);
        assert_eq!(
            items[1].title.as_deref(),
            Some("Covers: req:x#1\nSecond title line")
        );
    }

    // A pipe alone does not make a line a table row: as in GFM, a
    // pipe-carrying paragraph above an underline is a setext heading with the
    // pipe in its text. Only membership in an actual table rules a line out.
    #[test]
    fn a_pipe_carrying_paragraph_above_an_underline_is_a_setext_title() {
        let (items, problems, _) = parse(&["Login | Logout", "==============", "`req:a#1`"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].title.as_deref(), Some("Login | Logout"));
    }

    // The same on the boundary side: the pipe-carrying paragraph opens a
    // setext heading, so it terminates the body like any other heading.
    #[test]
    fn a_pipe_carrying_line_above_an_underline_terminates_the_body_and_titles_the_next_item() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "Description of a.",
            "",
            "Login | Logout",
            "==============",
            "`req:b#1`",
        ]);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].description, ["Description of a."]);
        assert_eq!(items[1].title.as_deref(), Some("Login | Logout"));
    }

    // The same rule applies to ATX headings: the pipe is plain text and stays
    // in the title.
    #[test]
    fn an_atx_heading_may_carry_a_pipe_and_still_titles_the_item() {
        let (items, _, _) = parse(&["## Login | Logout", "`req:a#1`"]);
        assert_eq!(items[0].title.as_deref(), Some("Login | Logout"));
    }

    // Every bullet marker (-, *, +) must be accepted, and each item ID may be
    // written bare or wrapped in backticks - independently within one list.
    #[test]
    fn needs_as_bullet_list_with_every_marker_ids_bare_or_backticked() {
        for marker in ["-", "*", "+"] {
            let (items, problems, _) = parse(&[
                "`req:a#1`",
                "",
                "Needs:",
                &format!("{marker} `impl:a#1`"),
                &format!("{marker} utest:a#1"),
            ]);
            assert_eq!(problems.len(), 0, "marker {marker}");
            assert_eq!(items[0].needs, ["impl:a#1", "utest:a#1"], "marker {marker}");
        }
    }

    #[test]
    fn inline_comma_separated_needs_ids_bare_or_backticked() {
        let (items, problems, _) = parse(&["`req:a#1`", "", "Needs: `impl:a#1`, utest:a#1"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1", "utest:a#1"]);
    }

    // Covers shares the same list machinery as Needs: every bullet marker and
    // bare/backticked IDs must work identically, inline or as a bullet list.
    #[test]
    fn covers_as_bullet_list_with_every_marker_ids_bare_or_backticked() {
        for marker in ["-", "*", "+"] {
            let (items, problems, _) = parse(&[
                "`req:a#1`",
                "",
                "Covers:",
                &format!("{marker} `feat:a#1`"),
                &format!("{marker} feat:b#1"),
            ]);
            assert_eq!(problems.len(), 0, "marker {marker}");
            assert_eq!(items[0].covers, ["feat:a#1", "feat:b#1"], "marker {marker}");
        }
    }

    #[test]
    fn inline_comma_separated_covers_ids_bare_or_backticked() {
        let (items, problems, _) = parse(&["`req:a#1`", "", "Covers: `feat:a#1`, feat:b#1"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].covers, ["feat:a#1", "feat:b#1"]);
    }

    #[test]
    fn invalid_id_in_a_needs_list_is_a_defect_on_the_item() {
        let (items, problems, _) = parse(&["`req:a#1`", "", "Needs: not/valid, impl:ok#1"]);
        assert_eq!(items[0].needs, ["impl:ok#1"]);
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert_eq!(defect.reference, "not/valid");
        assert_eq!(
            defect.message,
            "invalid: \"not/valid\" in the Needs list of req:a#1 is not a valid ID and is ignored"
        );
        assert_eq!(defect.location.as_ref().unwrap().file, "spec.md");
    }

    #[test]
    fn a_wildcard_revision_is_accepted_in_needs_but_not_in_covers() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "Needs: impl:a#2.x, impl:b#2.3.x, impl:c#2.*, impl:d#x",
            "",
            "Covers: feat:x#1.x",
        ]);
        assert_eq!(
            items[0].needs,
            ["impl:a#2.x", "impl:b#2.3.x", "impl:c#2.*", "impl:d#x"]
        );
        assert!(items[0].covers.is_empty());
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"feat:x#1.x\" in the Covers list of req:a#1")
        );
    }

    #[test]
    fn a_wildcard_layer_is_only_valid_as_the_last_layer() {
        let (items, _, _) = parse(&["`req:a#1`", "", "Needs: impl:a#2.x.y"]);
        assert!(items[0].needs.is_empty());
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"impl:a#2.x.y\" in the Needs list of req:a#1")
        );
    }

    #[test]
    fn a_wildcard_revision_is_not_accepted_in_an_item_definition() {
        let (items, _, _) = parse(&["`req:a#2.x`", "`req:b#*`"]);
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_short_form_takes_the_group_name_from_the_item_when_only_the_revision_is_written() {
        let (items, problems, _) = parse(&["`req:auth/login#1`", "", "Needs: impl#2, `utest#2.x`"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(
            items[0].needs,
            ["impl:auth/login#2", "utest:auth/login#2.x"]
        );
    }

    #[test]
    fn a_short_form_takes_the_revision_from_the_item_when_only_a_name_is_written() {
        let (items, problems, _) = parse(&[
            "`req:auth/login#3`",
            "",
            "Needs: impl, impl:other, dsn:auth/audit",
        ]);
        assert_eq!(problems.len(), 0);
        // impl -> name and revision both taken; impl:other / dsn:auth/audit
        // -> revision taken
        assert_eq!(
            items[0].needs,
            ["impl:auth/login#3", "impl:other#3", "dsn:auth/audit#3"]
        );
    }

    #[test]
    fn a_bare_type_takes_both_the_name_and_the_revision_from_an_ungrouped_item() {
        let (items, problems, _) = parse(&["`req:a#1`", "", "Needs: impl"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1"]);
    }

    #[test]
    fn a_short_form_need_in_a_table_column_is_completed_like_an_inline_entry() {
        let (items, problems, _) = parse(&[
            "`req:auth/login#1`",
            "",
            "| Needs   |",
            "|---------|",
            "| impl    |",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:auth/login#1"]);
    }

    #[test]
    fn a_short_form_covers_entry_is_completed_from_the_item_like_a_needs_entry() {
        let (items, problems, _) =
            parse(&["`impl:auth/login#2`", "", "Covers: feat, req:auth#1, dsn#2"]);
        assert_eq!(problems.len(), 0);
        // feat -> name and revision taken; req:auth#1 -> full; dsn#2 -> name taken
        assert_eq!(
            items[0].covers,
            ["feat:auth/login#2", "req:auth#1", "dsn:auth/login#2"]
        );
    }

    #[test]
    fn a_wildcard_revision_is_rejected_in_a_short_form_covers_entry() {
        let (items, problems, _) = parse(&["`impl:auth/login#1`", "", "Covers: feat#2.x"]);
        assert!(items[0].covers.is_empty());
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"feat#2.x\" in the Covers list of impl:auth/login#1")
        );
    }

    #[test]
    fn an_item_definition_ends_at_the_next_id_line_or_heading() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "Needs: impl:a#1",
            "`req:b#1`",
            "",
            "# Later heading",
            "Needs: impl:stray#1",
        ]);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].needs, ["impl:a#1"]);
        assert!(items[1].needs.is_empty());
    }

    #[test]
    fn revisions_may_carry_up_to_three_semver_style_layers() {
        let (items, problems, _) = parse(&["`req:a#1`", "", "`req:b#2.4`", "", "`req:c#2.4.0`"]);
        assert_eq!(problems.len(), 0);
        let ids: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["req:a#1", "req:b#2.4", "req:c#2.4.0"]);
        let revisions: Vec<&str> = items.iter().map(|item| item.revision.as_str()).collect();
        assert_eq!(revisions, ["1", "2.4", "2.4.0"]);
        assert_eq!(items[1].key, "req:b");
    }

    #[test]
    fn a_fourth_revision_layer_is_not_a_valid_id_definition() {
        let (items, _, _) = parse(&["`req:a#1.2.3.4`"]);
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_revision_with_a_pre_release_appendix_is_not_a_valid_id_definition() {
        let (items, _, _) = parse(&["`req:a#1.0.0-rc.1`"]);
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn group_paths_may_be_nested_arbitrarily_deep() {
        let (items, _, _) = parse(&["`req:auth/session/login#1`"]);
        assert_eq!(items[0].id, "req:auth/session/login#1");
        assert_eq!(items[0].key, "req:auth/session/login");
    }

    #[test]
    fn a_line_that_is_not_only_an_id_does_not_define_an_item() {
        let (items, _, _) = parse(&["The ID `req:a#1` mentioned in prose is not a definition."]);
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn standalone_forwarding_line_plain_or_backticked_spaces_optional() {
        let (items, _, forwards) = parse(&[
            "[req:login#1 --> dsn:auth#2]",
            "",
            "`[req:logout#1-->dsn:auth#2]`",
        ]);
        assert_eq!(items.len(), 0);
        assert_eq!(
            forwards,
            [
                forward("req:login#1", "dsn:auth#2", 1, 1),
                forward("req:logout#1", "dsn:auth#2", 3, 1),
            ]
        );
    }

    #[test]
    fn a_forwarding_line_inside_an_item_body_is_not_description() {
        let (items, _, forwards) = parse(&[
            "`req:a#1`",
            "",
            "The description.",
            "[req:a#1 --> dsn:b#1]",
            "Still the description.",
        ]);
        assert_eq!(
            items[0].description,
            ["The description.", "Still the description."]
        );
        assert_eq!(forwards, [forward("req:a#1", "dsn:b#1", 4, 1)]);
    }

    #[test]
    fn a_forwarding_mentioned_in_prose_is_not_recognized() {
        let (_, _, forwards) = parse(&["The tag [req:a#1 --> dsn:b#1] in prose does not forward."]);
        assert_eq!(forwards.len(), 0);
    }

    #[test]
    fn needs_from_a_table_column_among_irrelevant_columns_ids_bare_or_backticked() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Needs | Owner |",
            "|---|---|---|",
            "| Login | `impl:a#1` | Alice |",
            "| Logout | utest:a#1 | Bob |",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1", "utest:a#1"]);
    }

    #[test]
    fn one_table_may_feed_needs_covers_and_tags_columns_at_once() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs | Covers | Tags |",
            "| :--- | ----: | :-: |",
            "| impl:a#1 | feat:a#1 | Auth |",
            "| utest:a#1 | | Security |",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1", "utest:a#1"]);
        assert_eq!(items[0].covers, ["feat:a#1"]);
        assert_eq!(items[0].tags, ["Auth", "Security"]);
    }

    #[test]
    fn empty_and_missing_keyword_cells_are_skipped() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Needs |",
            "|---|---|",
            "| Login | impl:a#1 |",
            "| Empty cell | |",
            "| Row too short |",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1"]);
    }

    #[test]
    fn invalid_id_in_a_table_cell_is_a_defect_carrying_the_row_line() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs |",
            "|---|",
            "| impl:ok#1 |",
            "| not/valid |",
        ]);
        assert_eq!(items[0].needs, ["impl:ok#1"]);
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"not/valid\" in the Needs column of req:a#1")
        );
        assert_eq!(defect.location.as_ref().unwrap().line, 6);
    }

    #[test]
    fn a_wildcard_revision_is_accepted_in_a_needs_column_but_not_in_a_covers_column() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs | Covers |",
            "|---|---|",
            "| impl:a#2.x | feat:x#1.x |",
        ]);
        assert_eq!(items[0].needs, ["impl:a#2.x"]);
        assert!(items[0].covers.is_empty());
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"feat:x#1.x\" in the Covers column of req:a#1")
        );
    }

    #[test]
    fn a_table_without_a_keyword_header_cell_stays_plain_text() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Owner |",
            "|---|---|",
            "| Login | impl:a#1 |",
        ]);
        assert_eq!(problems.len(), 0);
        assert!(items[0].needs.is_empty());
    }

    #[test]
    fn a_keyword_header_row_without_a_delimiter_row_is_not_a_table() {
        let (items, problems, _) = parse(&["`req:a#1`", "", "| Needs |", "| impl:a#1 |"]);
        assert_eq!(problems.len(), 0);
        assert!(items[0].needs.is_empty());
    }

    // GFM renders tables without leading/trailing pipes too; the tracer must
    // recognize them as well - only at least one pipe per row is required.
    #[test]
    fn keyword_table_without_leading_and_trailing_pipes() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "Feature | Needs | Owner",
            "--- | --- | ---",
            "Login | impl:a#1 | Alice",
            "Logout | utest:a#1 | Bob",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1", "utest:a#1"]);
    }

    // A pipe-less setext title line ends the table like any block element and
    // becomes the next item's title.
    #[test]
    fn a_keyword_table_ends_at_a_setext_heading_directly_below_it() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs |",
            "|---|",
            "| impl:a#1 |",
            "Next Title",
            "==========",
            "`req:b#1`",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].needs, ["impl:a#1"]);
        assert_eq!(items[1].title.as_deref(), Some("Next Title"));
    }

    // A `===` run directly under a table row is swallowed as a single-cell
    // row (GFM), not a heading underline. Here it fills the Needs column,
    // surfacing as an invalid entry rather than vanishing. The ID line below
    // is swallowed the same way - a row of the item above, not a definition.
    #[test]
    fn an_underline_directly_under_a_table_is_a_row_filling_the_first_column_not_a_heading() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs |",
            "|---|",
            "| impl:a#1 |",
            "| impl:b#1 |",
            "===========",
            "`req:b#1`",
        ]);
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"===========\" in the Needs column of req:a#1")
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["impl:a#1", "impl:b#1", "req:b#1"]);
    }

    // A `---` run of three or more dashes directly under a table row is a
    // thematic break (GFM): it ends the table - no row (nothing reported for
    // the keyword column) and no underline (the row above stays a row).
    #[test]
    fn a_thematic_break_directly_under_a_table_ends_it() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs | Covers |",
            "|---|---|",
            "| impl:a#1 | feat:a#1 |",
            "---",
            "`req:b#1`",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "req:a#1");
        assert_eq!(items[0].needs, ["impl:a#1"]);
        assert_eq!(items[0].covers, ["feat:a#1"]);
        assert_eq!(items[1].id, "req:b#1");
        assert_eq!(items[1].title, None);
    }

    // The break truly ends the table: a row-shaped line below it belongs to
    // no table (a lone pipe-carrying line starts none) and contributes
    // nothing.
    #[test]
    fn a_row_shaped_line_below_a_thematic_break_is_not_part_of_the_table() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Needs |",
            "|---|---|",
            "| Login | impl:a#1 |",
            "---",
            "| Logout | impl:b#1 |",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1"]);
    }

    // A dash run too short for a thematic break (`-`, `--`) is no block
    // element - like `===`, it is swallowed as a single-cell row, and the
    // table continues past it.
    #[test]
    fn a_dash_run_too_short_for_a_thematic_break_is_swallowed_as_a_row() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs |",
            "|---|",
            "| impl:a#1 |",
            "--",
            "| impl:b#1 |",
        ]);
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"--\" in the Needs column of req:a#1")
        );
        assert_eq!(items[0].needs, ["impl:a#1", "impl:b#1"]);
    }

    // A swallowed underline fills only the first column: when no keyword
    // column sits there, it feeds an ignored column and surfaces nowhere. The
    // blank line ends the table, keeping the ID below a definition.
    #[test]
    fn a_swallowed_underline_is_silent_when_the_first_column_is_not_a_keyword_column() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Needs |",
            "|---|---|",
            "| Login | impl:a#1 |",
            "=================",
            "",
            "`req:b#1`",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1"]);
        assert_eq!(items[1].title, None);
    }

    // The swallowed underline does not end the table: rows below it still
    // belong to the table and contribute their entries.
    #[test]
    fn a_table_continues_past_a_swallowed_underline() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Needs |",
            "|---|---|",
            "| Login | impl:a#1 |",
            "===",
            "| Logout | impl:b#1 |",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1", "impl:b#1"]);
    }

    // Any pipe-carrying line under a table is a row, even underlined and even
    // when it reads like prose: its cells feed the keyword columns, so an
    // invalid entry is flagged as a defect rather than becoming a title. The
    // underline below is a row too.
    #[test]
    fn a_pipe_carrying_line_under_a_table_is_a_row_even_when_underlined() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Needs |",
            "|---|",
            "| impl:a#1 |",
            "Next | Title",
            "=============",
            "",
            "`req:b#1`",
        ]);
        // Both `Next | Title` and the `====` run are rows of the table, not a
        // setext heading, so their first column is read as a Needs cell.
        // `Next` is a valid type on its own, so it completes to the
        // short-form need Next:a#1; the `====` run is not a valid reference
        // and flags the item.
        assert_eq!(problems.len(), 0);
        let defect = &items[0].defects[0];
        assert_eq!(defect.kind, "invalid-reference");
        assert!(
            defect
                .message
                .contains("\"=============\" in the Needs column of req:a#1")
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].needs, ["impl:a#1", "Next:a#1"]);
        assert_eq!(items[1].title, None);
    }

    // A table without keyword columns is informative text, but its rows are
    // still pipe-carrying lines - an underline below the last one neither
    // makes it a title nor terminates anything.
    #[test]
    fn an_informative_table_row_above_an_underline_is_not_a_heading() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "Description of a.",
            "",
            "| Feature | Owner |",
            "|---|---|",
            "| Login | Alice |",
            "=================",
            "",
            "`req:b#1`",
        ]);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].description, ["Description of a."]);
        assert_eq!(items[1].title, None);
    }

    // A table cannot define an item: a cell holding nothing but a backticked
    // ID is reported, no item created - for any table, keyword-carrying or
    // informative.
    #[test]
    fn an_item_defined_inside_a_table_cell_is_flagged_and_creates_no_item() {
        let (items, problems, _) = parse(&["| ID | Owner |", "|---|---|", "| `req:x#1` | Alice |"]);
        assert_eq!(items.len(), 0);
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].line, 3);
        assert!(problems[0].message.contains(
            "item req:x#1 defined inside a table; a table cell is not an item definition"
        ));
    }

    // Keyword columns hold entries, optionally backticked - a backticked ID
    // there is an entry, never a flagged definition attempt.
    #[test]
    fn a_backticked_id_in_a_keyword_column_is_an_entry_not_a_flagged_definition() {
        let (items, problems, _) =
            parse(&["`req:a#1`", "", "| Needs |", "|---|", "| `impl:a#1` |"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["impl:a#1"]);
    }

    // The flag also fires in the non-keyword columns of a keyword table.
    #[test]
    fn a_definition_shaped_cell_outside_the_keyword_columns_is_flagged() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Needs |",
            "|---|---|",
            "| `req:x#1` | impl:a#1 |",
        ]);
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0]
                .message
                .contains("item req:x#1 defined inside a table")
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["impl:a#1"]);
    }

    // An ID line directly under a table (no blank line) is a swallowed
    // single-cell row (GFM), defining nothing. In a keyword column it is an
    // entry (see above); elsewhere it is a definition-shaped cell and is
    // flagged.
    #[test]
    fn an_id_line_directly_under_a_table_is_a_swallowed_row_not_a_definition() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| Feature | Needs |",
            "|---|---|",
            "| Login | impl:a#1 |",
            "`req:b#1`",
        ]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["impl:a#1"]);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.contains(
            "item req:b#1 defined inside a table; a table cell is not an item definition"
        ));
    }

    #[test]
    fn a_pipe_bearing_heading_ends_the_table_like_any_block_element() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "Needs |",
            "--- |",
            "impl:a#1 |",
            "## Next | chapter",
            "`req:b#1`",
        ]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].needs, ["impl:a#1"]);
    }

    // GFM degrades a table whose delimiter row has a deviating cell count to
    // plain text; the tracer must agree with the rendered document.
    #[test]
    fn a_delimiter_row_with_a_mismatched_cell_count_is_not_a_table() {
        let (items, problems, _) = parse(&[
            "`req:a#1`",
            "",
            "| A | Needs |",
            "|---|",
            "| x | impl:a#1 |",
        ]);
        assert_eq!(problems.len(), 0);
        assert!(items[0].needs.is_empty());
    }

    #[test]
    fn a_keyword_table_terminates_the_description_like_a_keyword_line() {
        let (items, _, _) = parse(&[
            "`req:a#1`",
            "",
            "The description.",
            "| Needs |",
            "|---|",
            "| impl:a#1 |",
            "Not description anymore.",
        ]);
        assert_eq!(items[0].description, ["The description."]);
        assert_eq!(items[0].needs, ["impl:a#1"]);
    }

    // Source columns: every location records the 1-based column of the
    // construct it points at - the backtick of an ID line, the opener of a
    // forwarding line, or the offending entry of a problem or defect.

    #[test]
    fn an_item_and_a_forwarding_record_the_column_of_their_construct() {
        let (items, _, forwards) = parse(&["  `req:a#1`", "", "   [req:a#1 --> dsn:b#1]"]);
        assert_eq!(items[0].line, 1);
        assert_eq!(items[0].character, 3); // the backtick, past two spaces
        assert_eq!(forwards, [forward("req:a#1", "dsn:b#1", 3, 4)]);
    }

    #[test]
    fn a_setext_heading_item_definition_problem_points_at_the_id_backtick() {
        let (_, problems, _) = parse(&["  `req:a#1`", "========="]);
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0]
                .message
                .contains("defined inside a setext heading")
        );
        assert_eq!(problems[0].line, 1);
        assert_eq!(problems[0].character, 3);
    }

    #[test]
    fn a_table_cell_item_definition_problem_points_at_the_cell_backtick() {
        let (_, problems, _) = parse(&["| Col |", "|---|", "| `req:x#1` |"]);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.contains("defined inside a table"));
        assert_eq!(problems[0].line, 3);
        assert_eq!(problems[0].character, 3);
    }

    #[test]
    fn an_invalid_inline_needs_entry_is_flagged_at_the_entry_column() {
        let (items, _, _) = parse(&["`req:a#1`", "", "Needs: impl:ok#1, not/valid"]);
        let defect = &items[0].defects[0];
        assert!(defect.message.contains("\"not/valid\""));
        let location = defect.location.as_ref().unwrap();
        assert_eq!(location.file, "spec.md");
        assert_eq!(location.line, 3);
        assert_eq!(location.character, 19); // the 'n' of not/valid
    }

    #[test]
    fn an_invalid_bullet_needs_entry_is_flagged_at_its_own_line_and_column() {
        let (items, _, _) = parse(&["`req:a#1`", "", "Needs:", "  - not/valid"]);
        let defect = &items[0].defects[0];
        assert!(defect.message.contains("\"not/valid\""));
        let location = defect.location.as_ref().unwrap();
        assert_eq!(location.line, 4); // the bullet line, not the keyword line
        assert_eq!(location.character, 5); // the 'n', past "  - "
    }

    #[test]
    fn an_invalid_needs_column_cell_is_flagged_at_the_cell_column() {
        let (items, _, _) = parse(&["`req:a#1`", "", "| Needs |", "|---|", "| not/valid |"]);
        let defect = &items[0].defects[0];
        assert!(defect.message.contains("\"not/valid\" in the Needs column"));
        let location = defect.location.as_ref().unwrap();
        assert_eq!(location.line, 5);
        assert_eq!(location.character, 3);
    }
}
