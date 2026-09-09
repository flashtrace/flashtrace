/*
 * Coverage analysis: duplicate IDs, forwarding (first-wins, cycle detection),
 * per-item reference checks, deep coverage and the summary both reports
 * render.
 *
 * Items are grouped and mutated through indices into the item slice, and
 * every map or set whose iteration order reaches the output (the resolver's
 * ID groups, the forwarding maps, the per-key revision lists behind the
 * mismatch hint) keeps insertion order - the order of definition - through
 * `OrderedMap` or an order-preserving Vec, so the reports are deterministic.
 */

use std::collections::{HashMap, HashSet};

use crate::defects::{
    Defect, Location, Problem, cyclic_forwarding, duplicate_forwarding, duplicate_id,
    orphaned_cover, uncovered_forward, uncovered_need, unwanted_cover, unwanted_item,
};
use crate::ids::{
    Forward, Item, Origin, canonical_id, compare_rev, id_matches, is_wildcard_rev, key_of, rev_of,
};

// a String-keyed map iterating in insertion order - used wherever that order
// reaches the output
struct OrderedMap<V> {
    order: Vec<String>,
    entries: HashMap<String, V>,
}

impl<V> OrderedMap<V> {
    fn new() -> Self {
        OrderedMap {
            order: Vec::new(),
            entries: HashMap::new(),
        }
    }

    fn get(&self, key: &str) -> Option<&V> {
        self.entries.get(key)
    }

    fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    fn insert(&mut self, key: &str, value: V) {
        if !self.entries.contains_key(key) {
            self.order.push(key.to_string());
        }
        self.entries.insert(key.to_string(), value);
    }

    fn entry_or_insert_with(&mut self, key: &str, default: impl FnOnce() -> V) -> &mut V {
        if !self.entries.contains_key(key) {
            self.order.push(key.to_string());
            self.entries.insert(key.to_string(), default());
        }
        self.entries.get_mut(key).unwrap()
    }

    fn remove(&mut self, key: &str) {
        if self.entries.remove(key).is_some() {
            self.order.retain(|existing| existing != key);
        }
    }

    fn keys(&self) -> impl Iterator<Item = &String> {
        self.order.iter()
    }

    fn iter(&self) -> impl Iterator<Item = (&String, &V)> {
        self.order
            .iter()
            .map(|key| (key, self.entries.get(key).unwrap()))
    }
}

/// Items grouped by canonical ID plus need resolution over them:
/// `matches_of(reference)` returns the defined canonical IDs satisfying a
/// (possibly wildcard) reference, `wanted_by` the inverse edge. Shared with
/// both reports so what they render cannot drift from what analyze checked.
/// Items are carried as indices into the analyzed slice.
pub struct Resolver {
    // canonical ID -> items (each keeps its raw item.id for display)
    by_id: OrderedMap<Vec<usize>>,
    // defined IDs grouped by their key (everything but the revision), so a
    // wildcard need can be resolved against the revisions sharing its key
    ids_by_key: HashMap<String, Vec<String>>,
    // item -> the items whose needs resolve to it, wildcard needs included:
    // the inverse of need resolution. Declared needs only - an item wanted
    // solely as a forwarding target has no entry here (unlike is_needed,
    // which does count forwarding demand).
    pub wanted_by: HashMap<usize, Vec<usize>>,
}

impl Resolver {
    /// the item indices defined under a canonical ID
    pub fn group(&self, canonical: &str) -> Option<&Vec<usize>> {
        self.by_id.get(canonical)
    }

    /// every defined canonical ID, in first-definition order
    pub fn ids(&self) -> impl Iterator<Item = &String> {
        self.by_id.keys()
    }

    /// the defined canonical IDs satisfying a (possibly wildcard) reference
    pub fn matches_of(&self, reference: &str) -> Vec<&String> {
        self.ids_by_key
            .get(key_of(reference))
            .map(|ids| ids.iter().filter(|id| id_matches(reference, id)).collect())
            .unwrap_or_default()
    }
}

pub fn build_resolver(items: &[Item]) -> Resolver {
    let mut by_id: OrderedMap<Vec<usize>> = OrderedMap::new();
    for (index, item) in items.iter().enumerate() {
        by_id
            .entry_or_insert_with(&item.canonical_id, Vec::new)
            .push(index);
    }
    let mut ids_by_key: HashMap<String, Vec<String>> = HashMap::new();
    for id in by_id.keys() {
        ids_by_key
            .entry(key_of(id).to_string())
            .or_default()
            .push(id.clone());
    }
    let mut resolver = Resolver {
        by_id,
        ids_by_key,
        wanted_by: HashMap::new(),
    };
    let mut wanted_by: HashMap<usize, Vec<usize>> = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        for need in &item.needs {
            for id in resolver.matches_of(need) {
                for provider in resolver.group(id).unwrap() {
                    let wanting = wanted_by.entry(*provider).or_default();
                    if !wanting.contains(&index) {
                        wanting.push(index);
                    }
                }
            }
        }
    }
    resolver.wanted_by = wanted_by;
    resolver
}

/// the single status label both reports render, decided here alone so they
/// cannot disagree on it. "defective" wins over the coverage axis and so
/// hides whether the item is deep-covered; the JSON document carries
/// `defective` and `deepCovered` beside the label for the two independently.
pub fn status_of(item: &Item) -> &'static str {
    if !item.defects.is_empty() {
        return "defective";
    }
    if item.deep_covered {
        "deep-covered"
    } else {
        "shallow-covered"
    }
}

/// The counts both reports show, in the key order the JSON document uses -
/// the struct serializes straight into the document. Derived here alone so
/// the two reports cannot disagree on them.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub items: usize,
    pub spec_items: usize,
    pub code_items: usize,
    pub ok_items: usize,
    pub defective_items: usize,
    pub shallow_covered_items: usize,
    pub problems: usize,
}

pub fn summarize(items: &[Item], problems: &[Problem]) -> Summary {
    let spec_items = items
        .iter()
        .filter(|item| item.origin == Origin::Spec)
        .count();
    let defective_items = items.iter().filter(|item| !item.defects.is_empty()).count();
    let shallow_covered_items = items
        .iter()
        .filter(|item| item.defects.is_empty() && !item.deep_covered)
        .count();
    Summary {
        items: items.len(),
        spec_items,
        code_items: items.len() - spec_items,
        ok_items: items.len() - defective_items,
        defective_items,
        shallow_covered_items,
        problems: problems.len(),
    }
}

/// the run verdict both reports end on, and the exit code behind it
pub fn is_clean(summary: &Summary) -> bool {
    summary.defective_items == 0 && summary.problems == 0
}

// the ID a duplicate defect (duplicate ID or duplicate forwarding) names:
// spelled identically everywhere, that spelling; SemVer-equal spellings, the
// canonical ID
fn displayed_duplicate_id(written_ids: &[&str], canonical: &str) -> String {
    if written_ids.iter().all(|id| *id == written_ids[0]) {
        written_ids[0].to_string()
    } else {
        canonical.to_string()
    }
}

// the sibling revisions recorded per key, in definition order; the hint sorts
// them SemVer-aware with a stable sort, so SemVer-equal spellings keep that
// order
struct RevisionsByKey(HashMap<String, Vec<String>>);

impl RevisionsByKey {
    fn record(items: &[Item]) -> Self {
        let mut revs_by_key: HashMap<String, Vec<String>> = HashMap::new();
        for item in items {
            let revs = revs_by_key.entry(item.key.clone()).or_default();
            if !revs.contains(&item.revision) {
                revs.push(item.revision.clone());
            }
        }
        RevisionsByKey(revs_by_key)
    }

    // sibling revisions of a key, ascending - the revision-mismatch hint's data
    fn existing_revisions_of(&self, id: &str) -> Option<Vec<String>> {
        self.0.get(key_of(id)).map(|revs| {
            let mut sorted = revs.clone();
            sorted.sort_by(|a, b| compare_rev(a, b));
            sorted
        })
    }

    // string hint for a problem message (missing forwarding source)
    fn rev_hint(&self, id: &str) -> String {
        match self.existing_revisions_of(id) {
            Some(revs) => {
                let key = key_of(id);
                let existing = revs.join(", ");
                format!(" (revision mismatch: existing revision(s) of {key}: {existing})")
            }
            None => String::new(),
        }
    }

    // a defect about a missing ID gains existing_revisions, and the same hint
    // in its message, exactly when a sibling revision of its ref's key exists
    fn with_revisions(&self, defect: Defect) -> Defect {
        let Some(existing_revisions) = self.existing_revisions_of(&defect.reference) else {
            return defect;
        };
        let stated = &defect.message;
        let key = key_of(&defect.reference);
        let existing = existing_revisions.join(", ");
        let message =
            format!("{stated} (revision mismatch: existing revision(s) of {key}: {existing})");
        Defect {
            kind: defect.kind,
            reference: defect.reference,
            location: None,
            existing_revisions: Some(existing_revisions),
            message,
        }
    }
}

fn location_of(forward: &Forward) -> Location {
    Location {
        file: forward.file.clone(),
        line: forward.line,
        character: forward.character,
    }
}

// void every forwarding on one detected cycle: flag the defect on each source
// item, mark its declaration voided by the cycle, and drop it from the live map
fn void_forwarding_cycle(
    cycle: &[String],
    chain: &str,
    forward_targets: &mut OrderedMap<(String, usize)>,
    forwards: &mut [Forward],
    resolver: &Resolver,
    items: &mut [Item],
) {
    for id in cycle {
        let (_, declaration_index) = *forward_targets.get(id).expect("cycle members forward");
        forwards[declaration_index].effective = false;
        forwards[declaration_index].voided_by = Some("cycle");
        for &item_index in resolver.group(id).expect("cycle members are defined") {
            items[item_index].defects.push(cyclic_forwarding(
                &forwards[declaration_index].to,
                chain,
                location_of(&forwards[declaration_index]),
            ));
        }
        forward_targets.remove(id);
    }
}

// forwarding chains must be acyclic (self-forwarding included); every
// forwarding on a cycle is flagged as a defect on its source item, voided,
// and has no effect - the source falls back to its own needs
fn drop_cyclic_forwards(
    forward_targets: &mut OrderedMap<(String, usize)>,
    forwards: &mut [Forward],
    resolver: &Resolver,
    items: &mut [Item],
) {
    let mut done: HashSet<String> = HashSet::new(); // ids verified to not sit on a cycle
    // a snapshot of the keys: an entry a cycle voids before its turn simply
    // fails the walk's membership check and is skipped
    let starts: Vec<String> = forward_targets.keys().cloned().collect();
    for start in starts {
        if done.contains(&start) {
            continue;
        }
        let mut seen: HashMap<String, usize> = HashMap::new(); // id -> position in the walked path
        let mut path: Vec<String> = Vec::new();
        let mut current = start;
        while forward_targets.contains(&current)
            && !done.contains(&current)
            && !seen.contains_key(&current)
        {
            seen.insert(current.clone(), path.len());
            path.push(current.clone());
            current = canonical_id(&forward_targets.get(&current).unwrap().0);
        }
        if let Some(&cycle_start) = seen.get(&current) {
            let cycle: Vec<String> = path[cycle_start..].to_vec();
            // the walk runs on canonical IDs; show each source as its
            // declaration wrote it
            let chain = cycle
                .iter()
                .chain(std::iter::once(&current))
                .map(|id| forwards[forward_targets.get(id).unwrap().1].from.clone())
                .collect::<Vec<_>>()
                .join(" --> ");
            void_forwarding_cycle(&cycle, &chain, forward_targets, forwards, resolver, items);
        }
        done.extend(path);
    }
}

// forwarding [A --> B]: A's coverage obligation is redirected to B - A's own
// needs are excused; A is covered iff B exists, deep-covered iff B is. Builds
// the source -> target map (each entry carrying its effective declaration's
// index), reporting a missing source as a problem and duplicate/cyclic
// declarations as defects on the source item, and marks each surviving target
// as wanted coverage. Every forward is annotated with `effective` and, when
// voided, `voided_by` (the item forwards_to fields mirror exactly the
// effective declarations).
fn build_forward_map(
    forwards: &mut [Forward],
    resolver: &Resolver,
    needed_ids: &mut HashSet<String>,
    revisions: &RevisionsByKey,
    problems: &mut Vec<Problem>,
    items: &mut [Item],
) -> OrderedMap<(String, usize)> {
    let mut forward_targets: OrderedMap<(String, usize)> = OrderedMap::new();
    // keyed canonically so SemVer-equal sources meet
    let mut forwards_by_source: OrderedMap<Vec<usize>> = OrderedMap::new();
    for (index, forward) in forwards.iter().enumerate() {
        forwards_by_source
            .entry_or_insert_with(&canonical_id(&forward.from), Vec::new)
            .push(index);
    }
    let groups: Vec<(String, Vec<usize>)> = forwards_by_source
        .iter()
        .map(|(from, group)| (from.clone(), group.clone()))
        .collect();
    for (from, group) in groups {
        let Some(sources) = resolver.group(&from) else {
            for &forward_index in &group {
                forwards[forward_index].effective = false;
                forwards[forward_index].voided_by = Some("missing-source");
                let source = &forwards[forward_index].from;
                let hint = revisions.rev_hint(source);
                let message = format!("forwarding from {source}, which does not exist{hint}");
                problems.push(Problem {
                    file: forwards[forward_index].file.clone(),
                    line: forwards[forward_index].line,
                    character: forwards[forward_index].character,
                    message,
                });
            }
            continue;
        };
        // only the first declaration takes effect; later ones for the same
        // source are voided as duplicates (and flagged as a defect on the
        // source item)
        if group.len() > 1 {
            let written: Vec<&str> = group
                .iter()
                .map(|&forward_index| forwards[forward_index].from.as_str())
                .collect();
            let shown = displayed_duplicate_id(&written, &from);
            for &item_index in sources {
                items[item_index].defects.push(duplicate_forwarding(
                    &shown,
                    group.len(),
                    location_of(&forwards[group[0]]),
                ));
            }
        }
        forwards[group[0]].effective = true;
        for &forward_index in &group[1..] {
            forwards[forward_index].effective = false;
            forwards[forward_index].voided_by = Some("duplicate");
        }
        forward_targets.insert(&from, (forwards[group[0]].to.clone(), group[0]));
    }
    drop_cyclic_forwards(&mut forward_targets, forwards, resolver, items);
    for (_, (to, _)) in forward_targets.iter() {
        needed_ids.insert(canonical_id(to)); // a forwarding target is wanted coverage
    }
    forward_targets
}

// a forwarded item (source of an [A --> B] tag) has its own needs excused;
// its coverage obligation is redirected to the target, checked here instead.
// The defects collect into the item afterwards, in the order the checks raise
// them, while other items stay readable during the checks.
fn check_item_references(
    index: usize,
    items: &mut [Item],
    resolver: &Resolver,
    is_needed: impl Fn(&str) -> bool,
    revisions: &RevisionsByKey,
    forward_targets: &OrderedMap<(String, usize)>,
) {
    let mut defects: Vec<Defect> = Vec::new();
    let item = &items[index];
    match forward_targets.get(&item.canonical_id) {
        Some((forward_target, _)) => {
            if resolver.group(&canonical_id(forward_target)).is_none() {
                defects.push(revisions.with_revisions(uncovered_forward(forward_target)));
            }
        }
        None => {
            for need in &item.needs {
                if resolver.matches_of(need).is_empty() {
                    defects.push(revisions.with_revisions(uncovered_need(need)));
                }
            }
        }
    }
    for cover_id in &item.covers {
        match resolver.group(&canonical_id(cover_id)) {
            None => defects.push(revisions.with_revisions(orphaned_cover(cover_id))),
            Some(targets) => {
                let wanted = targets.iter().any(|&target| {
                    items[target]
                        .needs
                        .iter()
                        .any(|need| id_matches(need, &item.id))
                });
                if !wanted {
                    defects.push(unwanted_cover(cover_id, &item.id));
                }
            }
        }
    }
    if item.origin == Origin::Code && !is_needed(&item.canonical_id) {
        defects.push(unwanted_item(&item.id));
    }
    items[index].defects.extend(defects);
}

// deep coverage: all needs exist and are themselves deep-covered
// (cycle-safe); a forwarded ID follows its target instead of its own needs. A
// need may be a wildcard: it is deep-covered when at least one matching item
// is deep-covered.
fn mark_deep_coverage(
    items: &mut [Item],
    resolver: &Resolver,
    forward_targets: &OrderedMap<(String, usize)>,
) {
    fn deep(
        id: &str,
        memo: &mut HashMap<String, bool>,
        items: &[Item],
        resolver: &Resolver,
        forward_targets: &OrderedMap<(String, usize)>,
    ) -> bool {
        if let Some(&known) = memo.get(id) {
            return known;
        }
        memo.insert(id.to_string(), true); // cycle guard
        let Some(group) = resolver.group(id) else {
            memo.insert(id.to_string(), false);
            return false;
        };
        let ok = match forward_targets.get(id) {
            Some((forward_target, _)) => deep(
                &canonical_id(forward_target),
                memo,
                items,
                resolver,
                forward_targets,
            ),
            None => {
                let mut ok = true;
                for &item_index in group {
                    for need in &items[item_index].needs {
                        if !need_deep(need, memo, items, resolver, forward_targets) {
                            ok = false;
                        }
                    }
                }
                ok
            }
        };
        memo.insert(id.to_string(), ok);
        ok
    }

    fn need_deep(
        need: &str,
        memo: &mut HashMap<String, bool>,
        items: &[Item],
        resolver: &Resolver,
        forward_targets: &OrderedMap<(String, usize)>,
    ) -> bool {
        let matches: Vec<String> = resolver.matches_of(need).into_iter().cloned().collect();
        matches
            .iter()
            .any(|id| deep(id, memo, items, resolver, forward_targets))
    }

    let mut memo: HashMap<String, bool> = HashMap::new();
    for index in 0..items.len() {
        let canonical = items[index].canonical_id.clone();
        let covered = deep(&canonical, &mut memo, items, resolver, forward_targets);
        items[index].deep_covered = covered;
    }
}

// split all need references into exact IDs (fast membership) and wildcard
// patterns (matched individually)
fn split_needs(items: &[Item]) -> (HashSet<String>, Vec<String>) {
    let mut exact = HashSet::new();
    let mut wildcard = Vec::new();
    for item in items {
        for need in &item.needs {
            if is_wildcard_rev(rev_of(need)) {
                wildcard.push(need.clone());
            } else {
                exact.insert(canonical_id(need));
            }
        }
    }
    (exact, wildcard)
}

pub fn analyze(items: &mut [Item], forwards: &mut [Forward], problems: &mut Vec<Problem>) {
    let resolver = build_resolver(items);
    let revisions = RevisionsByKey::record(items);

    // is a code item wanted, by its canonical ID? an exact need matches by
    // ID, a wildcard by pattern; forwarding targets are added to the exact
    // set below
    let (mut exact_needs, wildcard_needs) = split_needs(items);

    for id in resolver.ids() {
        let group = resolver.group(id).unwrap();
        if group.len() > 1 {
            let written: Vec<&str> = group
                .iter()
                .map(|&index| items[index].id.as_str())
                .collect();
            let shown = displayed_duplicate_id(&written, id);
            for &index in group {
                items[index].defects.push(duplicate_id(&shown, group.len()));
            }
        }
    }

    let forward_targets = build_forward_map(
        forwards,
        &resolver,
        &mut exact_needs,
        &revisions,
        problems,
        items,
    );

    let is_needed = |canonical: &str| {
        exact_needs.contains(canonical)
            || wildcard_needs
                .iter()
                .any(|wildcard| id_matches(wildcard, canonical))
    };

    for index in 0..items.len() {
        // effective forwarding target, for renderers
        items[index].forwards_to = forward_targets
            .get(&items[index].canonical_id)
            .map(|(to, _)| to.clone());
        check_item_references(
            index,
            items,
            &resolver,
            is_needed,
            &revisions,
            &forward_targets,
        );
    }

    mark_deep_coverage(items, &resolver, &forward_targets);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_code::parse_code;
    use crate::parse_markdown::parse_markdown;

    // Builds items through the real parsers so the shapes always match.
    fn run_all(md: &[&str], code: &[&str]) -> (Vec<Item>, Vec<Problem>) {
        let mut problems = Vec::new();
        let mut forwards = Vec::new();
        let mut items = parse_markdown("spec.md", &md.join("\n"), &mut problems, &mut forwards);
        items.extend(parse_code(
            "src.ts",
            &code.join("\n"),
            &mut problems,
            &mut forwards,
        ));
        assert!(problems.is_empty(), "fixture must parse cleanly");
        analyze(&mut items, &mut forwards, &mut problems);
        (items, problems)
    }

    fn run(md: &[&str], code: &[&str]) -> Vec<Item> {
        run_all(md, code).0
    }

    fn by_id<'items>(items: &'items [Item], id: &str) -> &'items Item {
        items
            .iter()
            .find(|item| item.id == id)
            .expect("item exists")
    }

    fn defect_of_kind<'item>(item: &'item Item, kind: &str) -> &'item Defect {
        item.defects
            .iter()
            .find(|defect| defect.kind == kind)
            .expect("defect of kind exists")
    }

    #[test]
    fn a_need_satisfied_by_an_existing_item_yields_no_defects() {
        let items = run(&["`req:a#1`", "", "Needs: impl:a#1"], &["// [impl:a#1]"]);
        for item in &items {
            assert!(item.defects.is_empty());
        }
        assert!(by_id(&items, "req:a#1").deep_covered);
    }

    #[test]
    fn a_missing_need_is_uncovered_with_a_revision_mismatch_hint() {
        let items = run(&["`req:a#1`", "", "Needs: impl:a#2"], &["// [impl:a#1]"]);
        let message = &by_id(&items, "req:a#1").defects[0].message;
        assert!(message.starts_with("uncovered: needs impl:a#2"));
        assert!(message.contains("revision mismatch"));
        assert!(message.contains('1'));
    }

    #[test]
    fn semver_equality_an_item_at_two_four_satisfies_a_need_for_two_four_zero() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#2.4.0"],
            &["// [impl:a#2.4]"],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
        assert!(by_id(&items, "req:a#1").deep_covered);
    }

    #[test]
    fn semver_equality_an_item_at_one_zero_zero_satisfies_a_need_for_one() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#1"],
            &["// [impl:a#1.0.0]"],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
        assert!(by_id(&items, "req:a#1").deep_covered);
    }

    #[test]
    fn semver_equality_applies_to_covers_and_forwarding_targets() {
        let items = run(
            &[
                "`feat:auth#1`",
                "",
                "Needs: req:a#1",
                "",
                "`req:a#1.0`",
                "",
                "Covers: feat:auth#1.0.0",
                "",
                "`dsn:a#1`",
                "",
                "`req:b#1`",
                "",
                "[req:b#1.0 --> dsn:a#1.0.0]",
            ],
            &[],
        );
        for item in &items {
            assert!(item.defects.is_empty(), "{}: {:?}", item.id, item.defects);
        }
    }

    #[test]
    fn semver_equal_spellings_of_one_id_are_duplicates_named_canonically() {
        let items = run(&["`req:a#2.4`", "", "`req:a#2.4.0`"], &[]);
        assert_eq!(items.len(), 2);
        for item in &items {
            assert!(
                item.defects[0]
                    .message
                    .starts_with("duplicate: ID req:a#2.4.0 is defined 2 times")
            );
        }
    }

    #[test]
    fn an_exact_multi_layer_revision_need_is_covered() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#2.4.0"],
            &["// [impl:a#2.4.0]"],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
        assert!(by_id(&items, "req:a#1").deep_covered);
    }

    #[test]
    fn revision_mismatch_hints_are_ordered_semver_aware() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "Needs: impl:a#9",
                "",
                "`impl:a#2.10`",
                "",
                "`impl:a#2.9`",
                "",
                "`impl:a#2.9.1`",
            ],
            &[],
        );
        let message = &by_id(&items, "req:a#1").defects[0].message;
        assert!(
            message.contains("existing revision(s) of impl:a: 2.9, 2.9.1, 2.10"),
            "{message}"
        );
    }

    #[test]
    fn covering_a_non_existent_item_is_orphaned() {
        let items = run(&["`req:a#1`", "", "Covers: feat:x#1"], &[]);
        assert!(
            by_id(&items, "req:a#1").defects[0]
                .message
                .starts_with("orphaned: covers feat:x#1")
        );
    }

    #[test]
    fn covering_an_item_that_does_not_need_you_is_unwanted() {
        let items = run(
            &["`feat:auth#1`", "", "`req:a#1`", "", "Covers: feat:auth#1"],
            &[],
        );
        assert!(
            by_id(&items, "req:a#1").defects[0]
                .message
                .starts_with("unwanted: covers feat:auth#1")
        );
    }

    #[test]
    fn a_covers_entry_matched_by_the_targets_needs_is_valid() {
        let items = run(
            &[
                "`feat:auth#1`",
                "",
                "Needs: req:a#1",
                "",
                "`req:a#1`",
                "",
                "Covers: feat:auth#1",
            ],
            &[],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
    }

    #[test]
    fn defining_the_same_full_id_twice_flags_both_as_duplicates() {
        let items = run(&["`req:a#1`", "", "`req:a#1`"], &[]);
        assert_eq!(items.len(), 2);
        for item in &items {
            assert!(item.defects[0].message.starts_with("duplicate: ID req:a#1"));
        }
    }

    #[test]
    fn a_wildcard_need_is_satisfied_by_any_matching_concrete_item() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#2.x"],
            &["// [impl:a#2.5]"],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
        assert!(by_id(&items, "req:a#1").deep_covered);
    }

    #[test]
    fn a_wildcard_extends_over_the_deeper_layers() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#2.x, impl:b#2.x"],
            &["// [impl:a#2.5.0]", "// [impl:b#2]"],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
        assert!(by_id(&items, "req:a#1").deep_covered);
    }

    #[test]
    fn a_wildcard_still_pins_its_numeric_layers() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#2.x"],
            &["// [impl:a#3.1]"],
        );
        assert!(
            by_id(&items, "req:a#1").defects[0]
                .message
                .starts_with("uncovered: needs impl:a#2.x")
        );
        // the near-miss item is not what the wildcard asked for, so it stays unwanted
        assert!(
            by_id(&items, "impl:a#3.1").defects[0]
                .message
                .starts_with("unwanted: no item needs")
        );
    }

    #[test]
    fn a_three_layer_wildcard_pins_two_layers() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#2.3.x"],
            &["// [impl:a#2.3.7]", "// [impl:a#2.4.0]"],
        );
        assert!(by_id(&items, "req:a#1").defects.is_empty());
        assert!(
            by_id(&items, "impl:a#2.4.0").defects[0]
                .message
                .starts_with("unwanted: no item needs")
        );
    }

    #[test]
    fn a_bare_x_matches_any_revision_star_is_an_alias_for_x() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#x, impl:b#*, impl:c#2.*"],
            &["// [impl:a#4.1]", "// [impl:b#3.0.9]", "// [impl:c#2.7]"],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
        assert!(by_id(&items, "req:a#1").deep_covered);
    }

    #[test]
    fn a_covers_entry_satisfies_a_wildcard_need_on_its_target() {
        let items = run(
            &[
                "`feat:auth#1`",
                "",
                "Needs: impl:a#2.x",
                "",
                "`impl:a#2.5`",
                "",
                "Covers: feat:auth#1",
            ],
            &[],
        );
        for item in &items {
            assert!(item.defects.is_empty());
        }
    }

    #[test]
    fn a_wildcard_need_is_shallow_covered_but_not_deep_when_its_match_is_defective() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "Needs: dsn:b#2.x",
                "",
                "`dsn:b#2.5`",
                "",
                "Needs: impl:c#1",
            ],
            &[],
        );
        let req_a = by_id(&items, "req:a#1");
        assert!(req_a.defects.is_empty()); // its wildcard need is matched
        assert!(!req_a.deep_covered); // but dsn:b#2.5 is itself uncovered
        assert!(
            by_id(&items, "dsn:b#2.5").defects[0]
                .message
                .starts_with("uncovered: needs impl:c#1")
        );
    }

    #[test]
    fn a_wildcard_need_matching_nothing_is_uncovered_with_a_revision_hint() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#9.x"],
            &["// [impl:a#2.5]"],
        );
        let message = &by_id(&items, "req:a#1").defects[0].message;
        assert!(message.starts_with("uncovered: needs impl:a#9.x"));
        assert!(message.contains("existing revision(s) of impl:a: 2.5"));
    }

    #[test]
    fn a_code_item_nobody_needs_is_unwanted() {
        let items = run(&[], &["// [impl:stray#1]"]);
        assert!(
            by_id(&items, "impl:stray#1").defects[0]
                .message
                .starts_with("unwanted: no item needs")
        );
    }

    #[test]
    fn a_defect_further_down_the_chain_breaks_deep_coverage_only() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "Needs: dsn:b#1",
                "",
                "`dsn:b#1`",
                "",
                "Needs: impl:c#1",
            ],
            &[],
        );
        let req_a = by_id(&items, "req:a#1");
        assert!(req_a.defects.is_empty()); // its own need exists
        assert!(!req_a.deep_covered); // but dsn:b is itself defective
        assert!(
            by_id(&items, "dsn:b#1").defects[0]
                .message
                .starts_with("uncovered")
        );
    }

    #[test]
    fn forwarding_excuses_the_items_own_needs_and_follows_the_target() {
        let items = run(
            &[
                "`req:login#1`",
                "",
                "Needs: impl:login#1",
                "",
                "[req:login#1 --> dsn:auth#2]",
                "",
                "`dsn:auth#2`",
            ],
            &[],
        );
        let login = by_id(&items, "req:login#1");
        assert!(login.defects.is_empty()); // impl:login#1 missing, but excused
        assert!(login.deep_covered);
    }

    #[test]
    fn forwarding_to_a_missing_item_is_uncovered_with_revision_hint() {
        let items = run(
            &["`req:a#1`", "", "`dsn:b#1`", "", "[req:a#1 --> dsn:b#2]"],
            &[],
        );
        let message = &by_id(&items, "req:a#1").defects[0].message;
        assert!(message.starts_with("uncovered: forwards to dsn:b#2, which does not exist"));
        assert!(message.contains("revision mismatch"));
    }

    #[test]
    fn forwarding_from_a_non_existent_item_is_a_problem() {
        let (items, problems) = run_all(&["`dsn:b#1`", "", "[req:ghost#1 --> dsn:b#1]"], &[]);
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0]
                .message
                .starts_with("forwarding from req:ghost#1, which does not exist")
        );
        assert!(by_id(&items, "dsn:b#1").defects.is_empty());
    }

    #[test]
    fn a_second_forwarding_for_the_same_item_is_a_duplicate_defect() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "`dsn:b#1`",
                "",
                "`dsn:c#1`",
                "",
                "[req:a#1 --> dsn:b#1]",
                "[req:a#1 --> dsn:c#1]",
            ],
            &[],
        );
        assert!(
            by_id(&items, "req:a#1").defects[0]
                .message
                .starts_with("duplicate: forwarding for req:a#1 is declared 2 times")
        );
    }

    #[test]
    fn semver_equal_source_spellings_group_into_one_duplicate_forwarding() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "`dsn:b#1`",
                "",
                "`dsn:c#1`",
                "",
                "[req:a#1 --> dsn:b#1]",
                "[req:a#1.0 --> dsn:c#1]",
            ],
            &[],
        );
        let req_a = by_id(&items, "req:a#1");
        // differing SemVer-equal spellings name the duplicate canonically,
        // like a duplicate ID
        assert!(
            req_a.defects[0]
                .message
                .starts_with("duplicate: forwarding for req:a#1.0.0 is declared 2 times")
        );
        assert_eq!(req_a.forwards_to.as_deref(), Some("dsn:b#1")); // the first declaration stays effective
    }

    #[test]
    fn deep_coverage_of_a_forwarded_item_tracks_the_targets_chain() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "[req:a#1 --> dsn:b#1]",
                "",
                "`dsn:b#1`",
                "",
                "Needs: impl:c#1",
            ],
            &[],
        );
        let req_a = by_id(&items, "req:a#1");
        assert!(req_a.defects.is_empty()); // its target exists
        assert!(!req_a.deep_covered); // but the target is uncovered itself
    }

    #[test]
    fn a_code_item_referenced_only_as_forwarding_target_is_not_unwanted() {
        let items = run(
            &["`req:a#1`", "", "[req:a#1 --> impl:b#1]"],
            &["// [impl:b#1]"],
        );
        assert!(by_id(&items, "impl:b#1").defects.is_empty());
    }

    #[test]
    fn cyclic_forwarding_is_a_defect_on_every_cycle_member_and_has_no_effect() {
        let (items, problems) = run_all(
            &[
                "`req:a#1`",
                "",
                "Needs: impl:missing#1",
                "",
                "`req:b#1`",
                "",
                "[req:a#1 --> req:b#1]",
                "[req:b#1 --> req:a#1]",
            ],
            &[],
        );
        assert_eq!(problems.len(), 0);
        let cyclic_a = defect_of_kind(by_id(&items, "req:a#1"), "cyclic-forwarding");
        assert_eq!(cyclic_a.reference, "req:b#1");
        assert_eq!(
            cyclic_a.message,
            "cyclic: forwards to req:b#1, closing the cycle req:a#1 --> req:b#1 --> req:a#1, so the forwarding has no effect"
        );
        let cyclic_b = defect_of_kind(by_id(&items, "req:b#1"), "cyclic-forwarding");
        assert_eq!(cyclic_b.reference, "req:a#1");
        // the forwardings are inert: req:a#1 falls back to its own needs
        let uncovered = defect_of_kind(by_id(&items, "req:a#1"), "uncovered-need");
        assert!(
            uncovered
                .message
                .starts_with("uncovered: needs impl:missing#1")
        );
    }

    #[test]
    fn a_self_forwarding_is_a_cyclic_forwarding_defect() {
        let (items, problems) = run_all(&["`req:a#1`", "", "[req:a#1 --> req:a#1]"], &[]);
        assert_eq!(problems.len(), 0);
        let defect = &by_id(&items, "req:a#1").defects[0];
        assert_eq!(defect.kind, "cyclic-forwarding");
        assert!(
            defect
                .message
                .contains("closing the cycle req:a#1 --> req:a#1")
        );
    }

    #[test]
    fn a_cycle_across_semver_equal_spellings_is_found_and_shown_as_written() {
        let (items, problems) = run_all(
            &[
                "`req:a#1`",
                "",
                "Needs: impl:missing#1",
                "",
                "`req:b#1`",
                "",
                "[req:a#1 --> req:b#1]",
                "[req:b#1.0 --> req:a#1.0.0]",
            ],
            &[],
        );
        assert_eq!(problems.len(), 0);
        // both cycle members carry a cyclic-forwarding defect; the chain
        // names each source as its declaration wrote it (SemVer-equal
        // spellings shown verbatim)
        let cyclic_a = defect_of_kind(by_id(&items, "req:a#1"), "cyclic-forwarding");
        assert_eq!(cyclic_a.reference, "req:b#1");
        assert_eq!(
            cyclic_a.message,
            "cyclic: forwards to req:b#1, closing the cycle req:a#1 --> req:b#1.0 --> req:a#1, so the forwarding has no effect"
        );
        let cyclic_b = defect_of_kind(by_id(&items, "req:b#1"), "cyclic-forwarding");
        assert_eq!(cyclic_b.reference, "req:a#1.0.0");
        // the forwardings are inert: req:a#1 falls back to its own needs
        let other = by_id(&items, "req:a#1")
            .defects
            .iter()
            .find(|defect| defect.kind != "cyclic-forwarding")
            .unwrap();
        assert!(other.message.starts_with("uncovered: needs impl:missing#1"));
    }

    #[test]
    fn an_acyclic_forwarding_chain_is_allowed() {
        let (items, problems) = run_all(
            &[
                "`req:a#1`",
                "",
                "`dsn:b#1`",
                "",
                "`impl:c#1`",
                "",
                "[req:a#1 --> dsn:b#1]",
                "[dsn:b#1 --> impl:c#1]",
            ],
            &[],
        );
        assert_eq!(problems.len(), 0);
        for item in &items {
            assert!(item.defects.is_empty());
            assert!(item.deep_covered);
        }
    }

    #[test]
    fn cyclic_needs_do_not_hang_and_count_as_deep_covered() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "Needs: req:b#1",
                "",
                "`req:b#1`",
                "",
                "Needs: req:a#1",
            ],
            &[],
        );
        for item in &items {
            assert!(item.defects.is_empty());
            assert!(item.deep_covered);
        }
    }

    // Source columns: what analyze raises over forwarding declarations - the
    // missing-source problem, the cyclic-forwarding defect - carries the
    // location of the declaration it points at.

    #[test]
    fn a_forwarding_from_missing_source_problem_carries_the_declaration_column() {
        let (_, problems) = run_all(&["`dsn:b#1`", "", "  `[req:ghost#1 --> dsn:b#1]`"], &[]);
        let problem = problems
            .iter()
            .find(|problem| problem.message.contains("forwarding from req:ghost#1"))
            .unwrap();
        assert_eq!(problem.line, 3);
        assert_eq!(problem.character, 3); // the backtick, past two spaces
    }

    #[test]
    fn a_duplicate_forwarding_defect_carries_the_first_declaration_location() {
        let items = run(
            &[
                "`req:a#1`",
                "",
                "`dsn:b#1`",
                "",
                "`dsn:c#1`",
                "",
                "  `[req:a#1 --> dsn:b#1]`",
                "`[req:a#1 --> dsn:c#1]`",
            ],
            &[],
        );
        let duplicate = defect_of_kind(by_id(&items, "req:a#1"), "duplicate-forwarding");
        let location = duplicate.location.as_ref().unwrap();
        assert_eq!(location.file, "spec.md");
        assert_eq!(location.line, 7); // the first (effective) declaration
        assert_eq!(location.character, 3); // the backtick, past two spaces
    }

    #[test]
    fn a_cyclic_forwarding_defect_carries_the_declaration_location_not_the_item_location() {
        let (items, _) = run_all(
            &[
                "`req:a#1`",
                "",
                "  `[req:a#1 --> req:b#1]`",
                "",
                "`req:b#1`",
                "",
                "`[req:b#1 --> req:a#1]`",
            ],
            &[],
        );
        let cyclic_a = defect_of_kind(by_id(&items, "req:a#1"), "cyclic-forwarding");
        let location_a = cyclic_a.location.as_ref().unwrap();
        assert_eq!(location_a.file, "spec.md");
        assert_eq!(location_a.line, 3);
        assert_eq!(location_a.character, 3); // the backtick, past two spaces
        let cyclic_b = defect_of_kind(by_id(&items, "req:b#1"), "cyclic-forwarding");
        let location_b = cyclic_b.location.as_ref().unwrap();
        assert_eq!(location_b.file, "spec.md");
        assert_eq!(location_b.line, 7);
        assert_eq!(location_b.character, 1);
    }

    #[test]
    fn summarize_counts_in_the_documents_key_order_and_is_clean_matches() {
        let (items, problems) = run_all(
            &["`req:a#1`", "", "Needs: impl:a#1"],
            &["// [impl:a#1]", "// [impl:stray#1]"],
        );
        let summary = summarize(&items, &problems);
        assert_eq!(
            summary,
            Summary {
                items: 3,
                spec_items: 1,
                code_items: 2,
                ok_items: 2,
                defective_items: 1,
                shallow_covered_items: 0,
                problems: 0,
            }
        );
        assert!(!is_clean(&summary));
        let clean = run_all(&["`req:a#1`", "", "Needs: impl:a#1"], &["// [impl:a#1]"]);
        assert!(is_clean(&summarize(&clean.0, &clean.1)));
    }

    #[test]
    fn status_of_decides_the_one_label_both_reports_render() {
        let items = run(
            &["`req:a#1`", "", "Needs: impl:a#1"],
            &["// [impl:a#1]", "// [impl:stray#1]"],
        );
        assert_eq!(status_of(by_id(&items, "req:a#1")), "deep-covered");
        assert_eq!(status_of(by_id(&items, "impl:stray#1")), "defective");
    }
}
