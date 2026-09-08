/*
 * Completeness guard for the examples/hyperglot fixture tree.
 *
 * The fixtures there are hand-written like every other example, but which
 * fixtures exist is not free: examples/hyperglot exists to show that
 * flashtrace scans every extension it claims to support, and that is only
 * true while every extension in languages.rs actually has one. This suite
 * ties the two together, so a change teaching flashtrace a new extension
 * cannot land without the fixture that exercises it.
 *
 * The conventions it checks, all of which the example's README spells out:
 *   - one fixture per extension, named after it (ts.ts covers .ts), so "the
 *     fixture for .ts" is something this suite can look up at all;
 *   - fixtures grouped in a folder per comment grammar, shared by exactly the
 *     extensions resolving to the same grammar object;
 *   - each fixture writing every marker its grammar defines and defining an
 *     item per comment form, so a new fixture cannot cover an extension in
 *     name only.
 *
 * That last pair is an approximation, not the statement it stands in for: it
 * counts items and searches for marker text separately, so it never ties an
 * item to the comment form that carried it. Pinning where each item actually
 * comes from is the end-to-end snapshots' job.
 */

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use flashtrace::languages::{CODE_EXT, Grammar, grammar_for};
use flashtrace::parse_code::parse_code;
use flashtrace::paths::extension_of;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/hyperglot")
}

const MARKDOWN: [&str; 2] = ["md", "markdown"];

struct Fixture {
    ext: String,
    folder: Option<String>,
    name: String,
    text: String,
}

// Every code fixture under examples/hyperglot: its extension, the folder it
// sits in and its text. Markdown is skipped - the specs and the README are
// prose about the fixtures, not fixtures themselves.
fn collect_fixtures() -> Vec<Fixture> {
    fn walk(dir: &Path, folder: Option<&str>, fixtures: &mut Vec<Fixture>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().unwrap().is_dir() {
                walk(&entry.path(), Some(&name), fixtures);
                continue;
            }
            let ext = extension_of(&name);
            if MARKDOWN.contains(&ext.as_str()) {
                continue;
            }
            fixtures.push(Fixture {
                ext,
                folder: folder.map(str::to_string),
                name,
                text: fs::read_to_string(entry.path()).unwrap(),
            });
        }
    }
    let mut fixtures = Vec::new();
    walk(&root(), None, &mut fixtures);
    fixtures.sort_by(|a, b| a.name.cmp(&b.name));
    fixtures
}

// How many tags a fixture must carry to exercise its grammar: one per line
// marker, one per block pair, and two more for every pair that nests - one
// tag inside the inner block and one after the inner closer, which is what
// makes nesting an assertion rather than decoration. A composite grammar has
// no such number: which regions a file carries follows the convention of the
// extension, so those are only required to tag something.
fn tags_required_by(grammar: Grammar) -> usize {
    match grammar {
        Grammar::Composite(_) => 1,
        Grammar::Leaf(leaf) => {
            leaf.line.len()
                + leaf.block.len()
                + 2 * leaf
                    .block
                    .iter()
                    .filter(|block_pair| block_pair.nestable)
                    .count()
        }
    }
}

// Every marker a grammar defines as literal text: its line markers plus both
// ends of every block pair. A composite grammar contributes its default
// grammar's markers for the same reason it has no tag count - the embedded
// grammars a file reaches follow the convention of the extension.
fn markers_of(grammar: Grammar) -> Vec<&'static str> {
    let leaf = match grammar {
        Grammar::Composite(composite) => composite.default,
        Grammar::Leaf(leaf) => leaf,
    };
    let mut markers = Vec::new();
    for marker in leaf.line.iter().copied() {
        if !markers.contains(&marker) {
            markers.push(marker);
        }
    }
    for block_pair in leaf.block {
        for marker in [block_pair.open, block_pair.close] {
            if !markers.contains(&marker) {
                markers.push(marker);
            }
        }
    }
    markers
}

fn by_extension(fixtures: &[Fixture]) -> HashMap<&str, &Fixture> {
    fixtures
        .iter()
        .map(|fixture| (fixture.ext.as_str(), fixture))
        .collect()
}

fn where_of(fixture: &Fixture) -> String {
    match &fixture.folder {
        Some(folder) => {
            let name = &fixture.name;
            format!("{folder}/{name}")
        }
        None => fixture.name.clone(),
    }
}

#[test]
fn every_known_code_extension_has_a_fixture() {
    let fixtures = collect_fixtures();
    let by_extension = by_extension(&fixtures);
    let mut missing: Vec<&str> = CODE_EXT
        .iter()
        .copied()
        .filter(|ext| !by_extension.contains_key(ext))
        .collect();
    missing.sort();
    assert!(
        missing.is_empty(),
        "extensions flashtrace scans with no fixture in examples/hyperglot: {}. \
         Add one file per extension, named after it, in the folder of its comment grammar, \
         and wire it into that folder's spec.md.",
        missing.join(", ")
    );
}

#[test]
fn every_fixture_covers_a_known_code_extension() {
    let fixtures = collect_fixtures();
    let known: HashSet<&str> = CODE_EXT.iter().copied().collect();
    let mut stray: Vec<String> = fixtures
        .iter()
        .filter(|fixture| !known.contains(fixture.ext.as_str()))
        .map(where_of)
        .collect();
    stray.sort();
    assert!(
        stray.is_empty(),
        "fixtures for extensions flashtrace does not scan: {}",
        stray.join(", ")
    );
}

#[test]
fn each_extension_has_exactly_one_fixture_named_after_it() {
    let fixtures = collect_fixtures();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for fixture in &fixtures {
        *counts.entry(fixture.ext.as_str()).or_insert(0) += 1;
    }
    let mut duplicated: Vec<&str> = counts
        .iter()
        .filter(|(_, n)| **n > 1)
        .map(|(ext, _)| *ext)
        .collect();
    duplicated.sort();
    assert!(
        duplicated.is_empty(),
        "extensions with more than one fixture: {}",
        duplicated.join(", ")
    );

    let mut misnamed: Vec<String> = fixtures
        .iter()
        .filter(|fixture| {
            let ext = &fixture.ext;
            fixture.name != format!("{ext}.{ext}")
        })
        .map(|fixture| {
            let location = where_of(fixture);
            let ext = &fixture.ext;
            format!("{location} (expected {ext}.{ext})")
        })
        .collect();
    misnamed.sort();
    assert!(
        misnamed.is_empty(),
        "fixtures not named after their extension: {}",
        misnamed.join(", ")
    );
}

#[test]
fn extensions_are_grouped_by_shared_grammar_not_by_similarity() {
    let fixtures = collect_fixtures();
    let by_extension = by_extension(&fixtures);
    // grammar identity -> the folder it was first seen in
    let mut folder_of: HashMap<usize, Option<String>> = HashMap::new();
    let mut sorted_ext: Vec<&str> = CODE_EXT.to_vec();
    sorted_ext.sort();
    for ext in sorted_ext {
        let Some(fixture) = by_extension.get(ext) else {
            continue; // reported by the first test
        };
        let grammar = grammar_for(ext).unwrap();
        match folder_of.get(&grammar.identity()) {
            None => {
                folder_of.insert(grammar.identity(), fixture.folder.clone());
            }
            Some(seen) => {
                assert_eq!(
                    &fixture.folder,
                    seen,
                    "{ext} resolves to the same grammar as the {}/ fixtures but sits in {}/",
                    seen.clone().unwrap_or_default(),
                    fixture.folder.clone().unwrap_or_default()
                );
            }
        }
    }
    // distinct grammars must not share a folder either, so a folder means one grammar
    let folders: Vec<&Option<String>> = folder_of.values().collect();
    let mut shared: Vec<String> = folders
        .iter()
        .enumerate()
        .filter(|(i, folder)| folders.iter().position(|other| other == *folder) != Some(*i))
        .map(|(_, folder)| (*folder).clone().unwrap_or_default())
        .collect();
    shared.sort();
    assert!(
        shared.is_empty(),
        "folders holding more than one grammar: {}",
        shared.join(", ")
    );
}

#[test]
fn each_fixture_writes_every_marker_and_defines_an_item_per_comment_form() {
    let fixtures = collect_fixtures();
    let known: HashSet<&str> = CODE_EXT.iter().copied().collect();
    let mut short = Vec::new();
    let mut unwritten = Vec::new();
    for (ext, fixture) in by_extension(&fixtures) {
        if !known.contains(ext) {
            continue; // reported by the second test
        }
        let grammar = grammar_for(ext).unwrap();
        let location = where_of(fixture);

        let required = tags_required_by(grammar);
        let mut problems = Vec::new();
        let mut forwards = Vec::new();
        let found = parse_code(&fixture.name, &fixture.text, &mut problems, &mut forwards).len();
        if found < required {
            short.push(format!("{location}: {found} of {required}"));
        }

        let missing: Vec<&str> = markers_of(grammar)
            .into_iter()
            .filter(|marker| !fixture.text.contains(marker))
            .collect();
        if !missing.is_empty() {
            let markers = missing.join(" ");
            unwritten.push(format!("{location}: {markers}"));
        }
    }
    unwritten.sort();
    assert!(
        unwritten.is_empty(),
        "fixtures never writing a marker their grammar defines: {}",
        unwritten.join("; ")
    );
    short.sort();
    assert!(
        short.is_empty(),
        "fixtures defining fewer items than their grammar has comment forms \
         (one per line marker, one per block pair, two per nesting pair): {}",
        short.join("; ")
    );
}
