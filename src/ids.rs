/*
 * Item IDs:  <type>:[<group>/[<group>/...]]<name>#<revision>
 *   e.g.  req:auth/login#1   req:auth/session/login#1   impl:whatever-other-name#2
 *
 * A revision is one to three dot-separated non-negative integers (semver-style):
 * X, X.Y or X.Y.Z. No pre-release/build appendices; at most three layers.
 * Omitted layers are zero, as SemVer defines: 2.4 and 2.4.0 name the same
 * revision (see canonical_rev / rev_matches).
 *
 * The grammar admits ASCII digits only, so the expressions write `[0-9]`
 * rather than the Unicode-aware `\d`.
 */

use std::sync::LazyLock;

use regex::{Captures, Regex};

use crate::defects::Defect;

const SEGMENT_SRC: &str = "[A-Za-z][A-Za-z0-9_.-]*";
// concrete revision: X, X.Y or X.Y.Z (one to three numeric layers)
const REV_SRC: &str = r"[0-9]+(?:\.[0-9]+){0,2}";
// wildcard revision: zero to two leading numeric layers followed by a single
// trailing wildcard layer, written x or its alias * (x, 2.x, 2.3.x; *, 2.*,
// 2.3.*). The wildcard layer stands for that layer and every deeper one, so
// 2.x matches 2, 2.4 and 2.4.1 alike, and a bare x matches every revision.
const WILDCARD_SRC: &str = r"(?:[0-9]+\.){0,2}[x*]";

// a revision *reference* (used only in Needs): concrete or wildcard; the
// wildcard alternative comes first so 2.x is not read as the concrete 2
fn rev_ref_src() -> String {
    format!("(?:{WILDCARD_SRC}|{REV_SRC})")
}

pub fn id_src() -> String {
    format!(r"([A-Za-z]+):(?:((?:{SEGMENT_SRC}/)*{SEGMENT_SRC})/)?({SEGMENT_SRC})#({REV_SRC})")
}

pub static ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!("^{}$", id_src())).unwrap());

// A need/cover reference completes into a full ID against the item that states
// it. Beyond a full ID it may drop the [group/]name, the revision, or both, and
// each dropped part is taken from that stating item (resolve_ref):
//   impl:auth/login#2  full ID - nothing to complete
//   impl:auth/login    name given, revision from the stating item
//   impl#2             revision given, [group/]name from the stating item
//   impl               type only, [group/]name and revision both taken
// The revision may be a wildcard here (rev_ref_src), as needs may demand a
// range. Captures: type, optional [group/]name, optional revision. Definitions,
// forwarding and the source anchor of a code need tag stay full IDs (id_src).
fn path_src() -> String {
    format!("(?:{SEGMENT_SRC}/)*{SEGMENT_SRC}")
}

pub fn ref_src() -> String {
    format!("([A-Za-z]+)(?::({}))?(?:#({}))?", path_src(), rev_ref_src())
}

pub static REF_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!("^{}$", ref_src())).unwrap());

// Like ref_src but a given revision must be concrete - Covers never take a
// wildcard. An omitted name or revision still completes from the stating item
// (whose revision is always concrete).
pub static COVER_REF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        "^([A-Za-z]+)(?::({}))?(?:#({REV_SRC}))?$",
        path_src()
    ))
    .unwrap()
});

// Forwarding tag: [<source-id> --> <target-id>], spaces optional.
// Contains two id_src captures (4 groups each); make_forward turns a match
// into a forwarding record given the index of the first captured group.
pub fn forward_src() -> String {
    format!(r"\[\s*{}\s*-->\s*{}\s*\]", id_src(), id_src())
}

pub fn make_id(id_type: &str, group: Option<&str>, name: &str, rev: &str) -> String {
    match group {
        Some(group) => format!("{id_type}:{group}/{name}#{rev}"),
        None => format!("{id_type}:{name}#{rev}"),
    }
}

/// A forwarding declaration `[<source-id> --> <target-id>]` at its location.
/// `effective` and `voided_by` stay unset until the analysis decides them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Forward {
    pub from: String,
    pub to: String,
    pub file: String,
    pub line: usize,
    pub character: usize,
    pub effective: bool,
    pub voided_by: Option<&'static str>,
}

pub fn make_forward(
    m: &Captures<'_>,
    base: usize,
    file: &str,
    line: usize,
    character: usize,
) -> Forward {
    let capture = |index: usize| m.get(base + index).map(|group| group.as_str());
    Forward {
        from: make_id(
            capture(0).unwrap(),
            capture(1),
            capture(2).unwrap(),
            capture(3).unwrap(),
        ),
        to: make_id(
            capture(4).unwrap(),
            capture(5),
            capture(6).unwrap(),
            capture(7).unwrap(),
        ),
        file: file.to_string(),
        line,
        character,
        effective: true,
        voided_by: None,
    }
}

pub fn key_of(id: &str) -> &str {
    &id[..id.rfind('#').expect("an ID carries a revision")]
}

pub fn rev_of(id: &str) -> &str {
    &id[id.rfind('#').expect("an ID carries a revision") + 1..]
}

// the [group/[group/]]name part of an ID, between the type and the revision
fn path_of(id: &str) -> &str {
    &id[id.find(':').expect("an ID carries a type") + 1
        ..id.rfind('#').expect("an ID carries a revision")]
}

// Complete a reference (type, and an optionally omitted [group/]name and
// revision) into a full ID against owner_id, the item that states it: a
// missing name or revision is taken from owner_id. Its revision is always
// concrete, so a completed revision is concrete too.
pub fn resolve_ref(id_type: &str, path: Option<&str>, rev: Option<&str>, owner_id: &str) -> String {
    format!(
        "{id_type}:{}#{}",
        path.unwrap_or_else(|| path_of(owner_id)),
        rev.unwrap_or_else(|| rev_of(owner_id))
    )
}

// a revision layer with its leading zeros dropped
fn canonical_layer(layer: &str) -> &str {
    let stripped = layer.trim_start_matches('0');
    if stripped.is_empty() { "0" } else { stripped }
}

/// Canonical form of a concrete revision: exactly three layers, leading zeros
/// dropped - the SemVer identity under which 2.4, 2.4.0 and 2.04 are all
/// 2.4.0. Not defined for wildcard revisions (a wildcard layer is no number).
pub fn canonical_rev(rev: &str) -> String {
    let mut layers: Vec<&str> = rev.split('.').map(canonical_layer).collect();
    while layers.len() < 3 {
        layers.push("0");
    }
    layers.join(".")
}

/// Canonical form of a concrete ID: its revision in canonical form. Exact-ID
/// bookkeeping (definitions, needs, covers, forwarding) keys on this form so
/// SemVer-equal revisions meet; the raw ID as written is kept for display.
pub fn canonical_id(id: &str) -> String {
    format!("{}#{}", key_of(id), canonical_rev(rev_of(id)))
}

// two canonical layers compared as the numbers they spell: with leading zeros
// gone, the longer number is the larger and equal lengths compare bytewise
fn compare_layer(a: &str, b: &str) -> std::cmp::Ordering {
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// Order two concrete revisions: compare their canonical three-layer forms
/// numerically, layer by layer; SemVer-equal revisions compare equal.
pub fn compare_rev(a: &str, b: &str) -> std::cmp::Ordering {
    let canonical_a = canonical_rev(a);
    let canonical_b = canonical_rev(b);
    let mut layers_a = canonical_a.split('.');
    let mut layers_b = canonical_b.split('.');
    for _ in 0..3 {
        let ordering = compare_layer(layers_a.next().unwrap(), layers_b.next().unwrap());
        if ordering != std::cmp::Ordering::Equal {
            return ordering;
        }
    }
    std::cmp::Ordering::Equal
}

fn is_wildcard_layer(layer: &str) -> bool {
    layer == "x" || layer == "*"
}

/// Does a revision carry a wildcard layer (and is thus a range, not a
/// concrete revision)? Concrete revisions are digits and dots only.
pub fn is_wildcard_rev(rev: &str) -> bool {
    rev.contains(['x', '*'])
}

/// Does a (possibly wildcard) revision pattern match a concrete revision?
/// Both sides are taken to their three-layer form: omitted concrete layers
/// are zero (3.7 matches 3.7.0), and a pattern's trailing wildcard layer
/// extends over the remaining layers (2.x matches 2, 2.4 and 2.4.1; x and *
/// match every revision). Each wildcard layer matches any number; numeric
/// layers must be numerically equal.
pub fn rev_matches(pattern: &str, concrete: &str) -> bool {
    let mut pattern_layers: Vec<&str> = pattern.split('.').collect();
    while pattern_layers.len() < 3 {
        let last_is_wildcard = is_wildcard_layer(pattern_layers.last().unwrap());
        pattern_layers.push(if last_is_wildcard { "x" } else { "0" });
    }
    let concrete_rev = canonical_rev(concrete);
    let mut concrete_layers = concrete_rev.split('.');
    for pattern_layer in pattern_layers {
        let concrete_layer = concrete_layers.next().unwrap();
        if is_wildcard_layer(pattern_layer) {
            continue;
        }
        if canonical_layer(pattern_layer) != concrete_layer {
            return false;
        }
    }
    true
}

/// Does a (possibly wildcard) need ID match a concrete item ID? Everything up
/// to the revision must be identical; the revisions are compared with
/// rev_matches.
pub fn id_matches(need: &str, id: &str) -> bool {
    key_of(need) == key_of(id) && rev_matches(rev_of(need), rev_of(id))
}

/// A need reference (Markdown Needs, the target of a code need tag): a full
/// ID, a wildcard revision (2.x), or a short form completed from owner_id,
/// the item stating it - see ref_src. Returns the full ID, or None when the
/// text is not a valid reference.
pub fn parse_need_entry(raw: &str, owner_id: &str) -> Option<String> {
    let cleaned = raw.replace('`', "");
    let cleaned = cleaned.trim();
    REF_RE.captures(cleaned).map(|m| {
        resolve_ref(
            m.get(1).unwrap().as_str(),
            m.get(2).map(|group| group.as_str()),
            m.get(3).map(|group| group.as_str()),
            owner_id,
        )
    })
}

/// A cover reference: like a need, but a given revision must be concrete
/// (Covers never take a wildcard). An omitted name or revision still
/// completes from owner_id just the same.
pub fn parse_cover_entry(raw: &str, owner_id: &str) -> Option<String> {
    let cleaned = raw.replace('`', "");
    let cleaned = cleaned.trim();
    COVER_REF_RE.captures(cleaned).map(|m| {
        resolve_ref(
            m.get(1).unwrap().as_str(),
            m.get(2).map(|group| group.as_str()),
            m.get(3).map(|group| group.as_str()),
            owner_id,
        )
    })
}

/// Where an item was defined: in a specification or in code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    Spec,
    Code,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::Spec => "spec",
            Origin::Code => "code",
        }
    }
}

/// A traced item as the parsers build it and the analysis annotates it.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub id: String,
    pub key: String,
    pub revision: String,
    /// the SemVer-equal identity every exact-ID lookup keys on
    pub canonical_id: String,
    pub origin: Origin,
    pub file: String,
    pub line: usize,
    /// 1-based column of the first character of the defining construct
    pub character: usize,
    pub title: Option<String>,
    pub description: Vec<String>,
    pub needs: Vec<String>,
    pub covers: Vec<String>,
    pub tags: Vec<String>,
    pub defects: Vec<Defect>,
    /// effective forwarding target, set by the analysis
    pub forwards_to: Option<String>,
    /// deep-coverage verdict, set by the analysis: all needs exist and are
    /// themselves deep-covered
    pub deep_covered: bool,
}

pub fn new_item(id: &str, origin: Origin, file: &str, line: usize, character: usize) -> Item {
    Item {
        id: id.to_string(),
        key: key_of(id).to_string(),
        revision: rev_of(id).to_string(),
        canonical_id: canonical_id(id),
        origin,
        file: file.to_string(),
        line,
        character,
        title: None,
        description: Vec::new(),
        needs: Vec::new(),
        covers: Vec::new(),
        tags: Vec::new(),
        defects: Vec::new(),
        forwards_to: None,
        deep_covered: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn canonical_rev_pads_omitted_layers_with_zeros() {
        assert_eq!(canonical_rev("2"), "2.0.0");
        assert_eq!(canonical_rev("2.4"), "2.4.0");
        assert_eq!(canonical_rev("2.4.1"), "2.4.1");
    }

    #[test]
    fn canonical_rev_drops_leading_zeros_per_layer() {
        assert_eq!(canonical_rev("02.04.010"), "2.4.10");
    }

    #[test]
    fn canonical_id_canonicalizes_only_the_revision() {
        assert_eq!(canonical_id("req:auth/login#2.4"), "req:auth/login#2.4.0");
    }

    #[test]
    fn rev_matches_treats_semver_equal_revisions_as_equal() {
        assert!(rev_matches("3.7", "3.7.0"));
        assert!(rev_matches("3.7.0", "3.7"));
        assert!(rev_matches("1", "1.0.0"));
        assert!(!rev_matches("3.7", "3.7.1"));
    }

    #[test]
    fn a_trailing_wildcard_extends_over_the_deeper_layers() {
        assert!(rev_matches("2.x", "2"));
        assert!(rev_matches("2.x", "2.4"));
        assert!(rev_matches("2.x", "2.4.1"));
        assert!(!rev_matches("2.x", "3.0"));
        assert!(rev_matches("2.3.x", "2.3.7"));
        assert!(rev_matches("2.3.x", "2.3"));
        assert!(!rev_matches("2.3.x", "2.4.0"));
    }

    #[test]
    fn x_and_its_alias_star_match_every_revision() {
        for pattern in ["x", "*"] {
            assert!(rev_matches(pattern, "2"));
            assert!(rev_matches(pattern, "4.1"));
            assert!(rev_matches(pattern, "3.0.9"));
        }
        assert!(rev_matches("5.*", "5.9.2"));
        assert!(!rev_matches("5.*", "6"));
    }

    #[test]
    fn is_wildcard_rev_recognizes_x_and_star_layers() {
        assert!(is_wildcard_rev("2.x"));
        assert!(is_wildcard_rev("2.*"));
        assert!(is_wildcard_rev("*"));
        assert!(!is_wildcard_rev("2.4.0"));
    }

    #[test]
    fn compare_rev_orders_semver_equal_revisions_as_equal() {
        assert_eq!(compare_rev("2.4", "2.4.0"), Ordering::Equal);
        assert_eq!(compare_rev("2.9", "2.10"), Ordering::Less);
        assert_eq!(compare_rev("2.4.1", "2.4"), Ordering::Greater);
    }

    #[test]
    fn parse_need_entry_accepts_the_wildcard_shapes_parse_cover_entry_none() {
        for rev in ["x", "*", "2.x", "2.*", "2.3.x", "2.3.*"] {
            let reference = format!("impl:a#{rev}");
            assert_eq!(
                parse_need_entry(&reference, "req:owner#1").as_deref(),
                Some(reference.as_str()),
                "{rev}"
            );
            assert_eq!(parse_cover_entry(&reference, "req:owner#1"), None, "{rev}");
        }
    }

    // regression test: 2.x.y, x.y and x.y.z were valid wildcard revisions
    // before the wildcard rework in PR #63 dropped them for the single
    // trailing wildcard layer - they must stay rejected, not quietly become
    // revisions again
    #[test]
    fn the_dropped_multi_wildcard_shapes_are_no_revisions() {
        for rev in ["2.x.y", "x.y", "x.y.z", "2.x.x", "x.2"] {
            assert_eq!(
                parse_need_entry(&format!("impl:a#{rev}"), "req:owner#1"),
                None,
                "{rev}"
            );
        }
    }

    #[test]
    fn references_complete_from_the_stating_item() {
        assert_eq!(
            parse_need_entry("impl:auth/login#2", "req:owner#1").as_deref(),
            Some("impl:auth/login#2")
        );
        assert_eq!(
            parse_need_entry("impl:auth/login", "req:auth/owner#3").as_deref(),
            Some("impl:auth/login#3")
        );
        assert_eq!(
            parse_need_entry("impl#2", "req:auth/owner#1").as_deref(),
            Some("impl:auth/owner#2")
        );
        assert_eq!(
            parse_need_entry("impl", "req:auth/owner#1.2").as_deref(),
            Some("impl:auth/owner#1.2")
        );
        assert_eq!(
            parse_need_entry("`impl#2`", "req:owner#1").as_deref(),
            Some("impl:owner#2")
        );
        assert_eq!(parse_need_entry("not an id", "req:owner#1"), None);
    }

    #[test]
    fn new_item_derives_key_revision_and_canonical_id() {
        let item = new_item("req:auth/login#2.4", Origin::Spec, "spec.md", 3, 1);
        assert_eq!(item.key, "req:auth/login");
        assert_eq!(item.revision, "2.4");
        assert_eq!(item.canonical_id, "req:auth/login#2.4.0");
        assert_eq!(item.origin, Origin::Spec);
        assert_eq!(item.title, None);
        assert_eq!(item.forwards_to, None);
    }

    #[test]
    fn make_forward_reads_both_ids_off_a_forwarding_match() {
        let forward_re = Regex::new(&forward_src()).unwrap();
        let m = forward_re.captures("[ req:auth/a#1 --> dsn:b#2 ]").unwrap();
        let forward = make_forward(&m, 1, "spec.md", 7, 3);
        assert_eq!(forward.from, "req:auth/a#1");
        assert_eq!(forward.to, "dsn:b#2");
        assert_eq!((forward.line, forward.character), (7, 3));
    }
}
