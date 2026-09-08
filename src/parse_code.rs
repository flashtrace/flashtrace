/*
 * Code parser - comment-aware tag scanner. The comment vocabulary (line
 * markers and block-comment pairs) is chosen per file extension by
 * languages.rs, so the same machinery serves every supported language:
 *   - `[<id>]` inside a comment defines a coverage item with that ID.
 *   - `[>><id>]` inside a comment attaches a need to the nearest preceding
 *     item tag in the same file (error if there is none).
 *   - `[<source-id> >> <id>]` attaches the need to the preceding item tag with
 *     exactly that source ID instead (error if there is none), so tags placed
 *     in between cannot steal the attachment (spaces around `>>` optional).
 *   - The need target of either form may be short (`utest`, `utest:name`,
 *     `utest#2`): its omitted [group/]name and revision are taken from the
 *     item the need attaches to.
 *   - `[<id> --> <id>]` inside a comment forwards the first item's coverage
 *     obligation to the second (spaces optional).
 *
 * The scanner walks byte offsets, which is safe because every marker and
 * pattern boundary is ASCII; each reported column counts the characters
 * (Unicode scalar values) of the original line up to the byte offset
 * (character_column).
 */

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::{Captures, Regex};

use crate::defects::Problem;
use crate::ids::{
    Forward, Item, Origin, canonical_id, forward_src, id_src, make_forward, make_id, new_item,
    ref_src, resolve_ref,
};
use crate::languages::{C_LIKE, Composite, Grammar, Leaf, Region, RegionGrammar, grammar_for};
use crate::paths::extension_of;

// Alternation: a need tag with an optional explicit source (groups 1-4 source,
// 5-7 target), or a plain item tag (groups 8-11). The target is a ref_src
// reference (type, optional [group/]name, optional revision) completed against
// the anchor item; the source and item tags stay full, concrete IDs (id_src).
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    let id = id_src();
    let reference = ref_src();
    Regex::new(&format!(
        r"\[(?:\s*{id}\s*)?>>\s*{reference}\s*\]|\[\s*{id}\s*\]"
    ))
    .unwrap()
});
static FORWARD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(&forward_src()).unwrap());

// URL-shaped text: a scheme followed by ://, extending until a character that
// ends a URL in practice (whitespace, quotes/backtick, brackets, angle
// brackets - so a tag or an HTML tag right next to a URL stays outside).
// The scheme repetition is bounded so a long run of scheme-valid characters
// with no :// cannot force super-linear backtracking; 63 clears every real
// scheme (RFC 3986 and reverse-DNS custom schemes stay well under it).
static URL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[A-Za-z][A-Za-z0-9+.-]{0,63}://[^\s"'`<>\[\]]*"#).unwrap());

// the 1-based column of a byte offset into a line, counted in characters
// (Unicode scalar values)
fn character_column(line: &str, byte_offset: usize) -> usize {
    line[..byte_offset].chars().count() + 1
}

// a URL span [start, end) in a line, in byte offsets
struct UrlSpan {
    start: usize,
    end: usize,
}

// spans of URL-shaped text in a line, in order. Comment *openers* inside a
// span are ignored (see marker_index), so the `//`, `#`, `--` or `/*` of e.g.
// `https://example.com/a--b#anchor` cannot open a phantom comment. Block
// *closers* are still honoured inside URLs: skipping a closer could leave a
// block comment open far past its real end, which is worse than the phantom
// it would prevent.
fn url_spans(line: &str) -> Vec<UrlSpan> {
    if !line.contains("://") {
        return Vec::new();
    }
    URL_RE
        .find_iter(line)
        .map(|m| UrlSpan {
            start: m.start(),
            end: m.end(),
        })
        .collect()
}

// first index of `marker` at or after pos that lies outside every URL span,
// or None. Spans are in ascending order and the index only moves forward, so
// a single pass over the spans suffices.
fn marker_index(line: &str, marker: &str, pos: usize, spans: &[UrlSpan]) -> Option<usize> {
    let find_from = |from: usize| {
        line.get(from..)
            .and_then(|rest| rest.find(marker).map(|idx| from + idx))
    };
    let mut idx = find_from(pos);
    for span in spans {
        match idx {
            None => break,
            Some(found) if found < span.start => break,
            Some(found) if found < span.end => idx = find_from(span.end),
            Some(_) => {}
        }
    }
    idx
}

// an open block comment carried across lines: its tokens and nesting depth
struct OpenBlock {
    open: &'static str,
    close: &'static str,
    nestable: bool,
    depth: usize,
}

// the active composite region carried across lines
#[derive(Clone, Copy)]
struct ActiveRegion {
    exit: &'static Regex,
    grammar: &'static Leaf,
}

struct ScanState {
    // nearest preceding item tag in this file, as an index into the items
    last_item: Option<usize>,
    // preceding item tags by canonical ID (so an anchor may spell a
    // SemVer-equal revision), as indices into the items
    by_id: HashMap<String, usize>,
    block: Option<OpenBlock>,
    region: Option<ActiveRegion>,
}

// leaf grammar (line markers + block pairs) active at the current position:
// the region's grammar when inside one, otherwise the file's default.
fn active_leaf(grammar: Grammar, state: &ScanState) -> &'static Leaf {
    if let Some(region) = &state.region {
        return region.grammar;
    }
    match grammar {
        Grammar::Leaf(leaf) => leaf,
        Grammar::Composite(composite) => composite.default,
    }
}

// what the scanner found next in a line
enum EventKind {
    Line,
    Block {
        open: &'static str,
        close: &'static str,
        nestable: bool,
    },
    Enter(ActiveRegion),
    Exit,
}

struct Event {
    idx: usize,
    len: usize,
    kind: EventKind,
}

// region boundary events (enter/exit) for a composite grammar at or after pos
fn region_events(
    line: &str,
    pos: usize,
    composite: &'static Composite,
    state: &ScanState,
) -> Vec<Event> {
    if let Some(region) = &state.region {
        return match region.exit.find_at(line, pos) {
            Some(m) => vec![Event {
                idx: m.start(),
                len: m.len(),
                kind: EventKind::Exit,
            }],
            None => Vec::new(),
        };
    }
    let mut events = Vec::new();
    for region in &composite.regions {
        if let Some(m) = region.enter.find_at(line, pos) {
            // the region's grammar may be a resolver picking the leaf from
            // the opening tag
            let leaf = match &region.grammar {
                RegionGrammar::Fixed(leaf) => leaf,
                RegionGrammar::Resolver(resolve) => resolve(m.as_str()),
            };
            events.push(Event {
                idx: m.start(),
                len: m.len(),
                kind: EventKind::Enter(ActiveRegion {
                    exit: region_exit_regex(region),
                    grammar: leaf,
                }),
            });
        }
    }
    events
}

// the region's exit regex with the composite's 'static lifetime
fn region_exit_regex(region: &'static Region) -> &'static Regex {
    &region.exit
}

// earliest scanning event in the line at or after pos, or None: a comment
// opener from the active leaf grammar, or - for composite grammars - a region
// boundary.
fn next_event(
    line: &str,
    pos: usize,
    grammar: Grammar,
    state: &ScanState,
    spans: &[UrlSpan],
) -> Option<Event> {
    let leaf = active_leaf(grammar, state);
    let mut best: Option<Event> = None;
    // earliest match wins; on a tie the longest opener wins, so a block opener
    // that shares a prefix with a line marker (Lua `--[[` vs `--`) is not
    // masked. Candidates are considered in a fixed order (line markers, block
    // pairs, region events), which the strict `>` preserves on a full tie.
    let mut consider = |idx: Option<usize>, event: Event| {
        let Some(idx) = idx else { return };
        let better = match &best {
            None => true,
            Some(current) => idx < current.idx || (idx == current.idx && event.len > current.len),
        };
        if better {
            best = Some(Event { idx, ..event });
        }
    };
    for marker in leaf.line {
        consider(
            marker_index(line, marker, pos, spans),
            Event {
                idx: 0,
                len: marker.len(),
                kind: EventKind::Line,
            },
        );
    }
    for block_pair in leaf.block {
        consider(
            marker_index(line, block_pair.open, pos, spans),
            Event {
                idx: 0,
                len: block_pair.open.len(),
                kind: EventKind::Block {
                    open: block_pair.open,
                    close: block_pair.close,
                    nestable: block_pair.nestable,
                },
            },
        );
    }
    if let Grammar::Composite(composite) = grammar {
        for event in region_events(line, pos, composite, state) {
            consider(Some(event.idx), event);
        }
    }
    best
}

struct Consumed {
    end: usize,
    pos: usize,
}

// consume text while a block comment is open, honoring nested openers when
// the grammar marks the pair nestable (Rust, Swift, Kotlin, Scala, ...).
// Scanning stops at `limit` (used to cap a block at a region exit); mutates
// block.depth and returns the comment content range end, where scanning
// resumes, and whether the block closed.
fn read_block_rest(
    line: &str,
    pos: usize,
    block: &mut OpenBlock,
    limit: usize,
) -> (Consumed, bool) {
    // a token found beyond the limit is discarded, so it neither closes nor
    // nests
    let find_from = |token: &str, from: usize| {
        line[from..]
            .find(token)
            .map(|idx| from + idx)
            .filter(|found| *found < limit)
    };
    let mut i = pos;
    while i < limit {
        let close_idx = find_from(block.close, i);
        let open_idx = if block.nestable {
            find_from(block.open, i)
        } else {
            None
        };
        match (open_idx, close_idx) {
            (None, None) => break,
            (Some(open_found), None) => {
                block.depth += 1;
                i = open_found + block.open.len();
            }
            (Some(open_found), Some(close_found)) if open_found < close_found => {
                block.depth += 1;
                i = open_found + block.open.len();
            }
            (_, Some(close_found)) => {
                block.depth -= 1;
                i = close_found + block.close.len();
                if block.depth == 0 {
                    return (
                        Consumed {
                            end: close_found,
                            pos: i,
                        },
                        true,
                    );
                }
            }
        }
    }
    (
        Consumed {
            end: limit,
            pos: limit,
        },
        false,
    )
}

// the region's exit match at or after pos on this line, or None
fn region_exit_at(line: &str, pos: usize, region: &ActiveRegion) -> Option<(usize, usize)> {
    region.exit.find_at(line, pos).map(|m| (m.start(), m.len()))
}

// advance over an open block comment, capped at the region exit if one is
// ahead; returns the comment content end and resume pos, updating
// state.block/state.region.
fn consume_block(
    line: &str,
    pos: usize,
    state: &mut ScanState,
    exit: Option<(usize, usize)>,
) -> Consumed {
    let limit = exit.map_or(line.len(), |(exit_idx, _)| exit_idx);
    let block = state.block.as_mut().expect("a block is open");
    let (rest, closed) = read_block_rest(line, pos, block, limit);
    if closed {
        state.block = None;
        return rest;
    }
    if let Some((exit_idx, exit_len)) = exit {
        // exit reached before the block closed: end block and region together
        state.block = None;
        state.region = None;
        return Consumed {
            end: rest.end,
            pos: exit_idx + exit_len,
        };
    }
    rest
}

// consume a line comment from pos: to the region exit if one is ahead (the
// region then ends), otherwise to end of line. The returned `done` means stop
// scanning.
fn consume_line(
    line: &str,
    state: &mut ScanState,
    exit: Option<(usize, usize)>,
) -> (Consumed, bool) {
    if let Some((exit_idx, exit_len)) = exit {
        state.region = None;
        return (
            Consumed {
                end: exit_idx,
                pos: exit_idx + exit_len,
            },
            false,
        );
    }
    (
        Consumed {
            end: line.len(),
            pos: line.len(),
        },
        true,
    )
}

// comment text of one line, position-preserving: the returned string has the
// same byte length as `line`, carrying each comment character at its original
// offset and a space at every code byte and comment marker. A tag or
// forwarding matched in it therefore occupies the same offsets it does in the
// source, so its 1-based character column converts through the original line.
//
// state.block carries an open block comment (its open/close tokens and
// nesting depth) across lines; state.region carries the active composite
// region across lines. A region *enter* is only recognized outside comments
// (so `<!-- <script> -->` never opens a script region), but a region *exit*
// is a hard boundary that ends the region even mid-comment, the way a browser
// terminates a raw-text element at the first `</script>`.
fn comment_text(line: &str, state: &mut ScanState, grammar: Grammar) -> String {
    let spans = url_spans(line);
    let mut buffer = vec![b' '; line.len()];
    let mut keep = |from: usize, to: usize| {
        buffer[from..to].copy_from_slice(&line.as_bytes()[from..to]);
    };
    let mut pos = 0;
    while pos < line.len() {
        let exit = match &state.region {
            Some(region) => region_exit_at(line, pos, region),
            None => None,
        };

        if state.block.is_some() {
            let consumed = consume_block(line, pos, state, exit);
            keep(pos, consumed.end);
            pos = consumed.pos;
            continue;
        }

        let Some(event) = next_event(line, pos, grammar, state, &spans) else {
            break;
        };
        pos = event.idx + event.len;
        match event.kind {
            EventKind::Line => {
                let (consumed, done) = consume_line(line, state, exit);
                keep(pos, consumed.end);
                pos = consumed.pos;
                if done {
                    break;
                }
            }
            EventKind::Block {
                open,
                close,
                nestable,
            } => {
                state.block = Some(OpenBlock {
                    open,
                    close,
                    nestable,
                    depth: 1,
                });
            }
            EventKind::Enter(region) => {
                state.region = Some(region);
            }
            EventKind::Exit => {
                // reached only outside a block comment (the block branch
                // above continues), so there is no open block to clear here
                state.region = None;
            }
        }
    }
    String::from_utf8(buffer).expect("kept ranges end on character boundaries")
}

// Attach one need tag to its anchor item. The explicit form [<source-id> >> ...]
// anchors at the item tag named by its source ID, the implicit form [>>...]
// at the nearest preceding item tag; a missing anchor is reported. The target
// reference (groups 5-7: type, optional [group/]name, optional revision) is
// completed against the anchor item - see ref_src.
fn attach_need(
    m: &Captures<'_>,
    file: &str,
    line: usize,
    character: usize,
    state: &ScanState,
    items: &mut [Item],
    problems: &mut Vec<Problem>,
) {
    let capture = |index: usize| m.get(index).map(|group| group.as_str());
    let source = capture(1).map(|id_type| {
        make_id(
            id_type,
            capture(2),
            capture(3).unwrap(),
            capture(4).unwrap(),
        )
    });
    let anchor = match &source {
        Some(source) => state.by_id.get(&canonical_id(source)).copied(),
        None => state.last_item,
    };
    let Some(anchor) = anchor else {
        // the target as written, for the problem message
        let mut written = capture(5).unwrap().to_string();
        if let Some(path) = capture(6) {
            written.push(':');
            written.push_str(path);
        }
        if let Some(rev) = capture(7) {
            written.push('#');
            written.push_str(rev);
        }
        problems.push(Problem {
            file: file.to_string(),
            line,
            character,
            message: match &source {
                Some(source) => format!(
                    "need tag [{source} >> {written}] has no preceding item tag [{source}] in this file"
                ),
                None => format!("need tag [>>{written}] has no preceding item tag in this file"),
            },
        });
        return;
    };
    let need = resolve_ref(
        capture(5).unwrap(),
        capture(6),
        capture(7),
        &items[anchor].id,
    );
    items[anchor].needs.push(need);
}

fn collect_tags(
    comment: &str,
    source_line: &str,
    file: &str,
    line: usize,
    state: &mut ScanState,
    items: &mut Vec<Item>,
    problems: &mut Vec<Problem>,
) {
    for m in TAG_RE.captures_iter(comment) {
        // comment is position-preserving, so the tag's `[` sits at its source
        // offset; the column converts through the original line
        let character = character_column(source_line, m.get(0).unwrap().start());
        if m.get(8).is_some() {
            // [<id>] item tag
            let capture = |index: usize| m.get(index).map(|group| group.as_str());
            let id = make_id(
                capture(8).unwrap(),
                capture(9),
                capture(10).unwrap(),
                capture(11).unwrap(),
            );
            let item = new_item(&id, Origin::Code, file, line, character);
            state.last_item = Some(items.len());
            state.by_id.insert(item.canonical_id.clone(), items.len());
            items.push(item);
        } else {
            attach_need(&m, file, line, character, state, items, problems);
        }
    }
}

pub fn parse_code(
    file: &str,
    text: &str,
    problems: &mut Vec<Problem>,
    forwards: &mut Vec<Forward>,
) -> Vec<Item> {
    let ext = extension_of(file);
    // Unknown extensions never reach here via the CLI (file collection
    // filters on CODE_EXT); direct callers fall back to C-like.
    let grammar = grammar_for(&ext).unwrap_or(Grammar::Leaf(&C_LIKE));
    let lines: Vec<&str> = text.lines().collect();
    let mut items = Vec::new();
    let mut state = ScanState {
        last_item: None,
        by_id: HashMap::new(),
        block: None,
        region: None,
    };

    for (i, line) in lines.iter().enumerate() {
        let comment = comment_text(line, &mut state, grammar);
        for m in FORWARD_RE.captures_iter(&comment) {
            let character = character_column(line, m.get(0).unwrap().start());
            forwards.push(make_forward(&m, 1, file, i + 1, character));
        }
        collect_tags(
            &comment,
            line,
            file,
            i + 1,
            &mut state,
            &mut items,
            problems,
        );
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(file: &str, lines: &[&str]) -> (Vec<Item>, Vec<Problem>, Vec<Forward>) {
        let mut problems = Vec::new();
        let mut forwards = Vec::new();
        let items = parse_code(file, &lines.join("\n"), &mut problems, &mut forwards);
        (items, problems, forwards)
    }

    fn ids(items: &[Item]) -> Vec<&str> {
        items.iter().map(|item| item.id.as_str()).collect()
    }

    #[test]
    fn line_comment_item_tag_with_attached_need_tag() {
        let (items, problems, _) = parse(
            "src.ts",
            &[
                "// [impl:auth/login#1]",
                "// [>>utest:auth/login#1]",
                "export function login() {}",
            ],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:auth/login#1");
        assert_eq!(items[0].origin, Origin::Code);
        assert_eq!(items[0].line, 1);
        assert_eq!(items[0].needs, ["utest:auth/login#1"]);
    }

    #[test]
    fn need_tag_without_a_preceding_item_tag_is_a_problem() {
        let (items, problems, _) = parse("src.ts", &["// [>>utest:a#1]"]);
        assert_eq!(items.len(), 0);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.contains("no preceding item tag"));
    }

    #[test]
    fn explicit_need_tag_attaches_to_the_named_item_not_the_nearest_one() {
        let (items, problems, _) = parse(
            "src.ts",
            &[
                "// [impl:some-name#1]",
                "function fn() {",
                "  // [impl:in-between-link#1]",
                "  const x = 1;",
                "  // [impl:some-name#1>>impl:anotherFunc#1]",
                "  anotherFunc();",
                "}",
            ],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].needs, ["impl:anotherFunc#1"]);
        assert!(items[1].needs.is_empty());
    }

    #[test]
    fn explicit_need_tag_allows_spaces_around_the_attachment_arrow() {
        let (items, problems, _) =
            parse("src.ts", &["// [impl:a#1]", "// [ impl:a#1 >> utest:a#1 ]"]);
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["utest:a#1"]);
    }

    #[test]
    fn explicit_need_tag_does_not_move_the_anchor_for_later_implicit_tags() {
        let (items, problems, _) = parse(
            "src.ts",
            &[
                "// [impl:a#1]",
                "// [impl:b#1]",
                "// [impl:a#1>>utest:a#1]",
                "// [>>utest:b#1]",
            ],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["utest:a#1"]);
        assert_eq!(items[1].needs, ["utest:b#1"]);
    }

    #[test]
    fn explicit_need_tag_without_a_matching_preceding_item_tag_is_a_problem() {
        let (items, problems, _) = parse(
            "src.ts",
            &["// [impl:a#1]", "// [impl:other#1>>utest:other#1]"],
        );
        assert_eq!(items.len(), 1);
        assert!(items[0].needs.is_empty());
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0].message.contains(
                "[impl:other#1 >> utest:other#1] has no preceding item tag [impl:other#1]"
            )
        );
    }

    #[test]
    fn a_need_tag_may_reference_a_wildcard_revision() {
        let (items, problems, _) = parse(
            "src.ts",
            &[
                "// [impl:a#1]",
                "// [>>utest:a#2.x]",
                "// [impl:a#1 >> utest:b#2.3.x]",
                "// [>>utest:c#*]",
                "// [impl:a#1 >> utest:d#x]",
            ],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(
            items[0].needs,
            ["utest:a#2.x", "utest:b#2.3.x", "utest:c#*", "utest:d#x"]
        );
    }

    #[test]
    fn an_explicit_need_tag_may_spell_its_anchor_with_a_semver_equal_revision() {
        let (items, problems, _) = parse(
            "src.ts",
            &["// [impl:a#1]", "// [impl:a#1.0.0 >> utest:a#2]"],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["utest:a#2"]);
    }

    #[test]
    fn a_wildcard_revision_is_not_accepted_in_an_item_tag() {
        let (items, _, _) = parse("src.ts", &["// [impl:a#2.x]"]);
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_short_form_need_target_takes_name_and_revision_from_the_anchor_item() {
        let (items, problems, _) = parse(
            "src.ts",
            &[
                "// [impl:auth/login#2]",
                "// [>>utest]",
                "// [>>utest#3]",
                "// [>>dsn:auth/audit]",
            ],
        );
        assert_eq!(problems.len(), 0);
        // utest -> both taken; utest#3 -> name taken; dsn:auth/audit ->
        // revision taken
        assert_eq!(
            items[0].needs,
            [
                "utest:auth/login#2",
                "utest:auth/login#3",
                "dsn:auth/audit#2"
            ]
        );
    }

    #[test]
    fn an_explicit_short_form_need_target_is_completed_from_the_named_source_item() {
        let (items, problems, _) = parse(
            "src.ts",
            &[
                "// [impl:a#1]",
                "// [impl:b#1]",
                "// [impl:a#1 >> utest#2.x]",
                "// [impl:b#1 >> utest]",
            ],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(items[0].needs, ["utest:a#2.x"]);
        assert_eq!(items[1].needs, ["utest:b#1"]);
    }

    #[test]
    fn a_short_form_need_tag_without_a_preceding_item_tag_is_a_problem() {
        let (items, problems, _) = parse("src.ts", &["// [>>utest]"]);
        assert_eq!(items.len(), 0);
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0]
                .message
                .contains("[>>utest] has no preceding item tag")
        );
    }

    #[test]
    fn a_short_form_reference_is_not_accepted_in_an_item_tag() {
        let (items, problems, _) = parse("src.ts", &["// [impl#1]", "// [impl]"]);
        assert_eq!(items.len(), 0);
        assert_eq!(problems.len(), 0);
    }

    #[test]
    fn tags_outside_comments_are_ignored() {
        let (items, _, _) = parse("src.ts", &["const s = \"[impl:a#1]\";"]);
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_double_slash_inside_a_url_does_not_open_a_comment_a_later_real_one_does() {
        let (items, _, _) = parse(
            "src.ts",
            &[
                "const docs = \"https://example.com/specs\"; // [impl:real#1]",
                "const api = \"https://example.com/api\"; register(\"[impl:phantom#1]\");",
            ],
        );
        assert_eq!(ids(&items), ["impl:real#1"]);
    }

    #[test]
    fn a_hash_fragment_in_a_url_does_not_open_a_comment() {
        let (items, _, _) = parse(
            "app.py",
            &["link = \"https://example.com/docs#setup [impl:phantom#1]\"  # [impl:real#1]"],
        );
        assert_eq!(ids(&items), ["impl:real#1"]);
    }

    #[test]
    fn a_dash_dash_in_a_url_path_does_not_open_a_comment() {
        let (items, _, _) = parse(
            "schema.sql",
            &["INSERT INTO links VALUES ('https://example.com/a--b'); -- [impl:real#1]"],
        );
        assert_eq!(ids(&items), ["impl:real#1"]);
    }

    #[test]
    fn a_block_opener_inside_a_url_does_not_open_a_block_comment() {
        let (items, _, _) = parse(
            "src.ts",
            &[
                "const glob = \"https://example.com/*/index\";",
                "const s = \"[impl:phantom#1]\";",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_url_in_an_embedded_script_string_does_not_define_a_phantom_item() {
        let (items, _, _) = parse(
            "page.html",
            &[
                "<script>",
                "const u = \"https://cdn.example.com/lib.js\"; run(\"[impl:phantom#1]\");",
                "</script>",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_url_inside_a_comment_does_not_hide_a_tag_after_it() {
        let (items, _, _) = parse("src.ts", &["// see https://example.com/spec [impl:real#1]"]);
        assert_eq!(ids(&items), ["impl:real#1"]);
    }

    #[test]
    fn a_comment_opener_glued_to_a_scheme_shaped_token_is_missed_known_limitation() {
        let (items, _, _) = parse("src.ts", &["const x = 1; note://[impl:missed#1]"]);
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_block_closer_inside_a_url_still_closes_an_open_block_comment() {
        // Block *closers* are honoured inside URLs (unlike openers): the `*/`
        // in the URL ends the block, so the following line is scanned as
        // code, not comment.
        let (items, _, _) = parse(
            "src.ts",
            &[
                "/* see https://example.com/a*/b",
                "const s = \"[impl:phantom#1]\";",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn markers_in_multiple_urls_on_one_line_are_all_skipped_a_trailing_real_comment_opens() {
        let (items, _, _) = parse(
            "src.ts",
            &[
                "const a = \"https://x.example/p\"; const b = \"https://y.example/q\"; // [impl:real#1]",
            ],
        );
        assert_eq!(ids(&items), ["impl:real#1"]);
    }

    #[test]
    fn multi_line_block_comment_one_tag_per_line() {
        let (items, _, _) = parse("src.ts", &["/*", " [impl:a#1]", " [>>utest:a#1]", "*/"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].line, 2);
        assert_eq!(items[0].needs, ["utest:a#1"]);
    }

    #[test]
    fn multiple_tags_in_one_comment_line() {
        let (items, _, _) = parse("src.ts", &["// [impl:a#1] [>>utest:a#1]"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:a#1"]);
    }

    #[test]
    fn non_nesting_block_comment_closes_at_the_first_closer() {
        let (items, _, _) = parse(
            "src.ts",
            &["/* [impl:a#1] /* still-comment */ [impl:code-not-tag#1] */"],
        );
        assert_eq!(ids(&items), ["impl:a#1"]);
    }

    #[test]
    fn nested_block_comments_close_only_at_the_matching_closer() {
        let (items, _, _) = parse(
            "lib.rs",
            &[
                "/* [impl:outer#1] /* [impl:inner#1] */ [impl:still#1] */",
                "let x = \"[impl:code-not-tag#1]\";",
            ],
        );
        assert_eq!(
            ids(&items),
            ["impl:outer#1", "impl:inner#1", "impl:still#1"]
        );
    }

    #[test]
    fn nested_block_comment_spanning_multiple_lines() {
        let (items, _, _) = parse(
            "View.swift",
            &[
                "/* [impl:a#1]",
                "   /* nested",
                "   [impl:b#1] */",
                "   [impl:c#1]",
                "*/",
                "let d = 1 // [impl:e#1]",
            ],
        );
        assert_eq!(
            ids(&items),
            ["impl:a#1", "impl:b#1", "impl:c#1", "impl:e#1"]
        );
    }

    #[test]
    fn sql_uses_dash_dash_comments_and_does_not_honour_double_slash() {
        let (items, _, _) = parse(
            "schema.sql",
            &["-- [impl:db/schema#1]", "SELECT '// [impl:not-a-tag#1]';"],
        );
        assert_eq!(ids(&items), ["impl:db/schema#1"]);
    }

    #[test]
    fn hash_comment_languages_recognise_hash_tags() {
        let (items, _, _) = parse(
            "app.py",
            &[
                "# [impl:app/main#1]",
                "x = \"// [impl:not-a-tag#1]\"  # not a comment tag context",
            ],
        );
        assert_eq!(ids(&items), ["impl:app/main#1"]);
    }

    #[test]
    fn c_like_extras_use_both_comment_forms() {
        let (items, _, _) = parse(
            "main.go",
            &["// [impl:svc/run#1]", "/* [>>utest:svc/run#1] */"],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:svc/run#1"]);
    }

    #[test]
    fn c_like_extras_groovy_solidity_cxx_use_both_comment_forms() {
        for file in ["build.gradle", "app.groovy", "Token.sol", "engine.cxx"] {
            let (items, problems, _) =
                parse(file, &["// [impl:x/run#1]", "/* [>>utest:x/run#1] */"]);
            assert_eq!(problems.len(), 0, "{file}");
            assert_eq!(items.len(), 1, "{file}");
            assert_eq!(items[0].needs, ["utest:x/run#1"], "{file}");
        }
    }

    #[test]
    fn php_accepts_both_line_comment_forms_and_blocks() {
        let (items, _, _) = parse(
            "index.php",
            &[
                "// [impl:php/a#1]",
                "# [impl:php/b#1]",
                "/* [impl:php/c#1] */",
            ],
        );
        assert_eq!(
            ids(&items),
            ["impl:php/a#1", "impl:php/b#1", "impl:php/c#1"]
        );
    }

    #[test]
    fn hash_comment_extras_crystal_gdscript_awk_recognise_hash_tags() {
        for file in ["app.cr", "player.gd", "report.awk"] {
            let (items, problems, _) = parse(
                file,
                &["# [impl:app/main#1]", "x = \"// [impl:not-a-tag#1]\""],
            );
            assert_eq!(problems.len(), 0, "{file}");
            assert_eq!(ids(&items), ["impl:app/main#1"], "{file}");
        }
    }

    #[test]
    fn cmake_uses_hash_line_and_bracket_block_comments() {
        let (items, _, _) = parse(
            "build.cmake",
            &["# [impl:cmake/mod#1]", "#[[ [>>utest:cmake/mod#1] ]]"],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:cmake/mod#1"]);
    }

    #[test]
    fn cmake_bracket_block_comment_opens_and_spans_multiple_lines() {
        // #[[ shares its prefix with the # line marker; the block opener must
        // win the tie, otherwise the block never opens and the inner tags are
        // missed.
        let (items, _, _) = parse(
            "build.cmake",
            &[
                "#[[",
                "  [impl:cmake/block#1]",
                "  [>>utest:cmake/block#1]",
                "]]",
                "add_executable(app main.c)",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:cmake/block#1");
        assert_eq!(items[0].needs, ["utest:cmake/block#1"]);
    }

    #[test]
    fn lua_uses_dash_line_and_bracket_block_comments() {
        let (items, _, _) = parse(
            "mod.lua",
            &["-- [impl:lua/mod#1]", "--[[ [>>utest:lua/mod#1] ]]"],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:lua/mod#1"]);
    }

    #[test]
    fn lua_bracket_block_comment_opens_and_spans_multiple_lines() {
        // --[[ shares its prefix with the -- line marker; the block opener
        // must win the tie, otherwise the block never opens and the inner
        // tags are missed.
        let (items, _, _) = parse(
            "mod.lua",
            &[
                "--[[",
                "  [impl:lua/block#1]",
                "  [>>utest:lua/block#1]",
                "]]",
                "print(\"done\")",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:lua/block#1");
        assert_eq!(items[0].needs, ["utest:lua/block#1"]);
    }

    #[test]
    fn coffeescript_uses_hash_line_and_triple_hash_block_comments() {
        let (items, _, _) = parse(
            "app.coffee",
            &["# [impl:cs/app#1]", "### [>>utest:cs/app#1] ###"],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:cs/app#1"]);
    }

    #[test]
    fn coffeescript_triple_hash_block_comment_opens_and_spans_multiple_lines() {
        // ### shares its prefix with the # line marker; the block opener must
        // win the tie, otherwise the block never opens and the inner tags are
        // missed.
        let (items, _, _) = parse(
            "app.coffee",
            &[
                "###",
                "  [impl:cs/block#1]",
                "  [>>utest:cs/block#1]",
                "###",
                "run()",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:cs/block#1");
        assert_eq!(items[0].needs, ["utest:cs/block#1"]);
    }

    #[test]
    fn coffeescript_quadruple_hash_heading_is_a_line_comment_not_a_block_opener() {
        // The language opens a block on ### only when no further # follows,
        // so this heading must not open one and leave the code below scanned
        // as comment text.
        let (items, _, _) = parse(
            "app.coffee",
            &["#### Section", "[impl:cs/heading#1]", "run()"],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn coffeescript_hash_divider_is_a_line_comment_not_a_block_opener() {
        let (items, _, _) = parse(
            "app.coffee",
            &[
                "# [impl:cs/divider#1]",
                "##########",
                "### [>>utest:cs/divider#1] ###",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:cs/divider#1"]);
    }

    #[test]
    fn julia_uses_hash_line_and_hash_equals_block_comments_which_nest() {
        let (items, _, _) = parse(
            "mod.jl",
            &[
                "# [impl:jl/mod#1]",
                "#= outer #= inner =# [>>utest:jl/mod#1] =#",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:jl/mod#1"]);
    }

    #[test]
    fn julia_block_comment_opens_and_spans_multiple_lines() {
        // #= shares its prefix with the # line marker; the block opener must
        // win the tie for the block to open.
        let (items, _, _) = parse(
            "mod.jl",
            &[
                "#=",
                "  [impl:jl/block#1]",
                "  [>>utest:jl/block#1]",
                "=#",
                "x = 1",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:jl/block#1");
        assert_eq!(items[0].needs, ["utest:jl/block#1"]);
    }

    #[test]
    fn nim_uses_hash_line_and_bracket_block_comments_which_nest() {
        let (items, _, _) = parse(
            "mod.nim",
            &[
                "# [impl:nim/mod#1]",
                "#[ outer #[ inner ]# [>>utest:nim/mod#1] ]#",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:nim/mod#1"]);
    }

    #[test]
    fn nim_doc_block_comments_are_recognized_and_nest() {
        let (items, _, _) = parse(
            "mod.nim",
            &[
                "# [impl:nim/doc#1]",
                "##[ outer ##[ inner ]## [>>utest:nim/doc#1] ]##",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:nim/doc#1"]);
    }

    #[test]
    fn nim_doc_block_opens_and_spans_multiple_lines() {
        // ##[ shares a prefix with both the # line marker and the #[ opener;
        // the longest match at the tie must win for the doc block to open as
        // one.
        let (items, _, _) = parse(
            "mod.nim",
            &[
                "##[",
                "  [impl:nim/docblock#1]",
                "  [>>utest:nim/docblock#1]",
                "]##",
                "x = 1",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:nim/docblock#1");
        assert_eq!(items[0].needs, ["utest:nim/docblock#1"]);
    }

    #[test]
    fn scheme_uses_semicolon_line_and_hash_pipe_block_comments_which_nest() {
        let (items, _, _) = parse(
            "lib.scm",
            &[
                "; [impl:scm/lib#1]",
                "#| outer #| inner |# [>>utest:scm/lib#1] |#",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:scm/lib#1"]);
    }

    #[test]
    fn scheme_block_comment_opens_and_spans_multiple_lines() {
        let (items, _, _) = parse(
            "lib.scm",
            &[
                "#|",
                "  [impl:scm/block#1]",
                "  [>>utest:scm/block#1]",
                "|#",
                "(run)",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:scm/block#1");
        assert_eq!(items[0].needs, ["utest:scm/block#1"]);
    }

    #[test]
    fn racket_shares_the_scheme_grammar() {
        let (items, _, _) = parse(
            "lib.rkt",
            &["; [impl:rkt/lib#1]", "#| [>>utest:rkt/lib#1] |#"],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:rkt/lib#1"]);
    }

    #[test]
    fn guile_chez_shares_the_scheme_grammar() {
        let (items, _, _) = parse("lib.ss", &["; [impl:ss/lib#1]", "#| [>>utest:ss/lib#1] |#"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:ss/lib#1"]);
    }

    #[test]
    fn powershell_uses_hash_line_and_angle_hash_block_comments() {
        let (items, _, _) = parse(
            "deploy.ps1",
            &["# [impl:ops/deploy#1]", "<# [>>utest:ops/deploy#1] #>"],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:ops/deploy#1"]);
    }

    #[test]
    fn css_honours_blocks_but_not_line_comments() {
        let (items, _, _) = parse(
            "theme.css",
            &["/* [impl:ui/theme#1] */", "// [impl:not-a-tag#1]"],
        );
        assert_eq!(ids(&items), ["impl:ui/theme#1"]);
    }

    #[test]
    fn semicolon_comment_languages_recognise_semicolon_tags() {
        let (items, _, _) = parse("core.clj", &["; [impl:app/core#1]"]);
        assert_eq!(ids(&items), ["impl:app/core#1"]);
    }

    #[test]
    fn percent_comment_languages_recognise_percent_tags() {
        let (items, _, _) = parse("mod.erl", &["% [impl:erl/mod#1]"]);
        assert_eq!(ids(&items), ["impl:erl/mod#1"]);
    }

    #[test]
    fn ocaml_uses_parenthesis_star_block_comments() {
        let (items, _, _) = parse("m.ml", &["(* [impl:ml/m#1] [>>utest:ml/m#1] *)"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:ml/m#1"]);
    }

    #[test]
    fn ocaml_block_comments_nest() {
        let (items, _, _) = parse(
            "m.ml",
            &["(* outer (* inner *) [impl:ml/still#1] *)", "let x = 1"],
        );
        assert_eq!(ids(&items), ["impl:ml/still#1"]);
    }

    #[test]
    fn haskell_block_comments_nest() {
        let (items, _, _) = parse(
            "M.hs",
            &["{- outer {- inner -} [impl:hs/still#1] -}", "x = 1"],
        );
        assert_eq!(ids(&items), ["impl:hs/still#1"]);
    }

    #[test]
    fn elm_and_purescript_share_the_haskell_grammar() {
        for file in ["Main.elm", "Main.purs"] {
            let (items, problems, _) = parse(
                file,
                &[
                    "-- [impl:m/main#1]",
                    "{- outer {- inner -} [>>utest:m/main#1] -}",
                ],
            );
            assert_eq!(problems.len(), 0, "{file}");
            assert_eq!(items.len(), 1, "{file}");
            assert_eq!(items[0].needs, ["utest:m/main#1"], "{file}");
        }
    }

    #[test]
    fn pascal_parenthesis_star_does_not_nest() {
        let (items, _, _) = parse(
            "u.pas",
            &["(* outer (* inner *) [impl:p/code-not-tag#1] *)"],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn pascal_recognises_both_block_comment_pairs() {
        let (items, _, _) = parse(
            "u.pas",
            &["{ [impl:p/a#1] }", "(* [impl:p/b#1] *)", "// [impl:p/c#1]"],
        );
        assert_eq!(ids(&items), ["impl:p/a#1", "impl:p/b#1", "impl:p/c#1"]);
    }

    #[test]
    fn pascal_parenthesis_star_block_comment_spans_multiple_lines() {
        let (items, _, _) = parse("u.pas", &["(* [impl:p/a#1]", "   [>>utest:p/a#1] *)"]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:p/a#1"]);
    }

    #[test]
    fn hcl_honours_all_three_comment_forms() {
        let (items, _, _) = parse(
            "main.tf",
            &["# [impl:tf/a#1]", "// [impl:tf/b#1]", "/* [impl:tf/c#1] */"],
        );
        assert_eq!(ids(&items), ["impl:tf/a#1", "impl:tf/b#1", "impl:tf/c#1"]);
    }

    fn forward(from: &str, to: &str, file: &str, line: usize, character: usize) -> Forward {
        Forward {
            from: from.to_string(),
            to: to.to_string(),
            file: file.to_string(),
            line,
            character,
            effective: true,
            voided_by: None,
        }
    }

    #[test]
    fn forwarding_tag_in_a_comment_spaces_around_the_arrow_optional() {
        let (items, problems, forwards) = parse(
            "src.ts",
            &[
                "// [req:login#1 --> dsn:auth#2]",
                "// [req:logout#1-->dsn:auth#2]",
            ],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 0); // a forwarding tag defines no item
        assert_eq!(
            forwards,
            [
                forward("req:login#1", "dsn:auth#2", "src.ts", 1, 4),
                forward("req:logout#1", "dsn:auth#2", "src.ts", 2, 4),
            ]
        );
    }

    #[test]
    fn a_forwarding_tag_does_not_anchor_subsequent_need_tags() {
        let (items, problems, _) =
            parse("src.ts", &["// [req:a#1 --> dsn:b#1]", "// [>>utest:a#1]"]);
        assert_eq!(items.len(), 0);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.contains("no preceding item tag"));
    }

    #[test]
    fn forwarding_tags_outside_comments_are_ignored() {
        let (_, _, forwards) = parse("src.ts", &["const s = \"[req:a#1 --> dsn:b#1]\";"]);
        assert_eq!(forwards.len(), 0);
    }

    #[test]
    fn vue_supports_html_comments() {
        let (items, _, _) = parse(
            "Button.vue",
            &["<template>", "  <!-- [impl:ui/button#1] -->", "</template>"],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:ui/button#1");
        assert_eq!(items[0].line, 2);
    }

    #[test]
    fn vue_template_does_not_treat_double_slash_as_a_comment() {
        let (items, _, _) = parse(
            "Link.vue",
            &[
                "<template>",
                "  <a href=\"https://example.com/[impl:not-a-tag#1]\">x</a>",
                "</template>",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn vue_script_uses_js_comments_style_uses_css_comments() {
        let (items, _, _) = parse(
            "Button.vue",
            &[
                "<template><button>ok</button></template>",
                "<script setup lang=\"ts\">",
                "// [impl:ui/button#1]",
                "// [>>utest:ui/button#1]",
                "</script>",
                "<style scoped>",
                "/* [impl:ui/button-style#1] */",
                "</style>",
            ],
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "impl:ui/button#1");
        assert_eq!(items[0].needs, ["utest:ui/button#1"]);
        assert_eq!(items[1].id, "impl:ui/button-style#1");
    }

    #[test]
    fn vue_style_does_not_treat_double_slash_as_a_comment() {
        let (items, _, _) = parse(
            "Button.vue",
            &[
                "<style>",
                ".x { background: url(//cdn/[impl:not-a-tag#1].png); }",
                "</style>",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn an_html_comment_containing_a_script_tag_does_not_open_a_script_region() {
        let (items, _, _) = parse(
            "page.html",
            &[
                "<!-- <script> [impl:page/head#1] -->",
                "<p>// [impl:not-a-tag#1]</p>",
            ],
        );
        assert_eq!(ids(&items), ["impl:page/head#1"]);
    }

    #[test]
    fn plain_html_files_scan_markup_script_and_style_regions() {
        let (items, _, _) = parse(
            "index.html",
            &[
                "<!-- [impl:web/page#1] -->",
                "<script>// [impl:web/script#1]</script>",
                "<style>/* [impl:web/style#1] */</style>",
            ],
        );
        assert_eq!(
            ids(&items),
            ["impl:web/page#1", "impl:web/script#1", "impl:web/style#1"]
        );
    }

    #[test]
    fn a_line_comment_before_the_script_end_does_not_swallow_the_region_exit() {
        let (items, _, _) = parse(
            "page.html",
            &["<script>// setup</script>", "<p>// [impl:phantom#1]</p>"],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn an_unclosed_block_comment_before_the_script_end_still_ends_the_region() {
        let (items, _, _) = parse(
            "page.html",
            &["<script>/* note </script>", "<p>// [impl:phantom#1]</p>"],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_tag_before_the_script_end_on_the_same_line_is_still_captured() {
        let (items, _, _) = parse(
            "page.html",
            &[
                "<script>// [impl:web/inline#1]</script>",
                "<p>plain markup</p>",
            ],
        );
        assert_eq!(ids(&items), ["impl:web/inline#1"]);
    }

    #[test]
    fn a_json_script_is_scanned_without_comments() {
        let (items, _, _) = parse(
            "page.html",
            &[
                "<script type=\"application/json\">",
                "{ \"url\": \"//cdn.example.com/[impl:phantom#1].js\" }",
                "</script>",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn a_template_script_is_scanned_as_html_markup() {
        let (items, _, _) = parse(
            "page.html",
            &[
                "<script type=\"text/x-template\">",
                "  <!-- [impl:ui/tpl#1] -->",
                "  <a href=\"//x/[impl:not-a-tag#1]\">go</a>",
                "</script>",
            ],
        );
        assert_eq!(ids(&items), ["impl:ui/tpl#1"]);
    }

    #[test]
    fn a_coffee_script_uses_hash_line_and_triple_hash_block_comments() {
        let (items, _, _) = parse(
            "page.html",
            &[
                "<script lang=\"coffee\">",
                "# [impl:web/coffee#1]",
                "###",
                "  [>>utest:web/coffee#1]",
                "###",
                "</script>",
            ],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].needs, ["utest:web/coffee#1"]);
    }

    #[test]
    fn a_coffee_script_treats_a_quadruple_hash_as_a_line_comment() {
        let (items, _, _) = parse(
            "page.html",
            &[
                "<script lang=\"coffee\">",
                "#### Section",
                "[impl:web/heading#1]",
                "</script>",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn an_scss_style_honours_line_comments() {
        let (items, _, _) = parse(
            "Button.vue",
            &[
                "<style lang=\"scss\">",
                "// [impl:ui/scss#1]",
                ".x { color: red; } /* [impl:ui/scss-block#1] */",
                "</style>",
            ],
        );
        assert_eq!(ids(&items), ["impl:ui/scss#1", "impl:ui/scss-block#1"]);
    }

    #[test]
    fn a_plain_style_still_treats_double_slash_as_not_a_comment() {
        let (items, _, _) = parse(
            "Button.vue",
            &[
                "<style>",
                ".x { background: url(//cdn/[impl:not-a-tag#1].png); }",
                "</style>",
            ],
        );
        assert_eq!(items.len(), 0);
    }

    // Source columns: comment extraction is position-preserving, so a tag's
    // column is the column of its opening bracket in the source line,
    // whatever comment syntax and indentation precede it.

    #[test]
    fn a_code_item_tag_records_the_column_of_its_opening_bracket() {
        let (items, _, _) = parse("src.ts", &["    // [impl:a#1]"]);
        assert_eq!(items[0].line, 1);
        assert_eq!(items[0].character, 8); // the '[' past "    // "
    }

    #[test]
    fn a_trailing_line_comment_on_real_code_records_the_tag_column() {
        let (items, problems, _) = parse(
            "src.ts",
            &["let variable = someFunctionReturningSomeValue(); // [impl:variable#1]"],
        );
        assert_eq!(problems.len(), 0);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "impl:variable#1");
        assert_eq!(items[0].origin, Origin::Code);
        assert_eq!(items[0].line, 1);
        assert!(items[0].needs.is_empty());
        assert_eq!(items[0].character, 53); // the '[' past the code and "// "
    }

    #[test]
    fn a_code_item_tag_inside_a_block_comment_carries_its_bracket_column() {
        let (items, _, _) = parse("src.ts", &["/* [impl:b#1] */"]);
        assert_eq!(items[0].character, 4); // the '[' past "/* "
    }

    #[test]
    fn an_orphan_need_tag_problem_points_at_its_bracket_column() {
        let (_, problems, _) = parse("src.ts", &["  // [>>utest:a#1]"]);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.contains("no preceding item tag"));
        assert_eq!(problems[0].character, 6); // the '[' past "  // "
    }

    #[test]
    fn an_unanchored_explicit_need_tag_problem_points_at_its_bracket_column() {
        let (_, problems, _) = parse("src.ts", &["// [impl:x#1 >> utest:a#1]"]);
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0]
                .message
                .contains("no preceding item tag [impl:x#1]")
        );
        assert_eq!(problems[0].character, 4); // the '[' past "// "
    }

    // columns count characters, not bytes: é is two bytes and the astral 𝕏
    // four, yet each is one column
    #[test]
    fn columns_after_non_ascii_text_count_characters() {
        let (items, _, _) = parse("src.ts", &["const \u{E9} = 1; // \u{1D54F} [impl:a#1]"]);
        // the bracket is the 19th character of the line
        assert_eq!(items[0].character, 19);
    }
}
