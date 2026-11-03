/*
 * Terminal report.
 *
 * Colors are enabled exactly when stdout is a terminal and NO_COLOR is unset or
 * empty (per no-color.org, only a non-empty NO_COLOR disables them). Output
 * goes through print_line, which swallows write errors: on a broken pipe the
 * run ends quietly with its computed exit code.
 */

use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

use crate::analyze::{
    BumpImpact, DependencyEdge, DependencyKind, Resolver, RevisionsByKey, build_resolver, is_clean,
    status_of, summarize,
};
use crate::defects::Problem;
use crate::ids::{Item, Origin, canonical_id, is_wildcard_rev, rev_of};
use crate::paths::display_relative;

/// print one line to stdout, ignoring write errors (broken pipes end quietly)
pub fn print_line(text: &str) {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(text.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

struct Styler {
    is_color_enabled: bool,
}

impl Styler {
    fn new() -> Styler {
        let no_color = std::env::var_os("NO_COLOR").is_some_and(|value| !value.is_empty());
        Styler {
            is_color_enabled: std::io::stdout().is_terminal() && !no_color,
        }
    }

    fn wrap(&self, code: &str, text: &str) -> String {
        if self.is_color_enabled {
            format!("\u{001b}[{code}m{text}\u{001b}[0m")
        } else {
            text.to_string()
        }
    }

    fn red(&self, text: &str) -> String {
        self.wrap("31", text)
    }
    fn green(&self, text: &str) -> String {
        self.wrap("32", text)
    }
    fn yellow(&self, text: &str) -> String {
        self.wrap("33", text)
    }
    fn cyan(&self, text: &str) -> String {
        self.wrap("36", text)
    }
    fn dim(&self, text: &str) -> String {
        self.wrap("2", text)
    }
    fn bold(&self, text: &str) -> String {
        self.wrap("1", text)
    }
}

// marker and color per status; the bracketed label is the status name itself,
// so this renders what analyze decided rather than deciding it again
fn status_style(status: &str) -> (&'static str, fn(&Styler, &str) -> String) {
    match status {
        "defective" => ("\u{2718}", Styler::red),
        "shallow-covered" => ("~", Styler::yellow),
        _ => ("\u{2714}", Styler::green),
    }
}

fn styled_mark(item: &Item, style: &Styler) -> String {
    let (mark, color) = status_style(status_of(item));
    color(style, mark)
}

fn styled_tag(item: &Item, style: &Styler) -> String {
    let status = status_of(item);
    let (_, color) = status_style(status);
    color(style, &format!("[{status}]"))
}

struct Renderer<'run> {
    items: &'run [Item],
    style: Styler,
    cwd: PathBuf,
}

impl<'run> Renderer<'run> {
    fn dim_location(&self, file: &str, line: usize) -> String {
        let path = display_relative(&self.cwd, file);
        self.style.dim(&format!("{path}:{line}"))
    }

    fn located_item(&self, item: &Item) -> String {
        let title = match &item.title {
            Some(title) => format!(" {}", self.style.dim(&format!("\"{title}\""))),
            None => String::new(),
        };
        let id = self.style.bold(&item.id);
        let location = self.dim_location(&item.file, item.line);
        format!("{id}{title}  {location}")
    }

    fn impact_edge(&self, edge: &DependencyEdge, target: &Item) -> String {
        let label = match edge.kind {
            DependencyKind::Need => self.style.dim("needs"),
            DependencyKind::Cover => self.style.dim("covers"),
            DependencyKind::Forward => self.style.cyan("→"),
        };
        let reference = if edge.kind == DependencyKind::Need
            && (is_wildcard_rev(rev_of(&edge.reference)) || edge.reference != target.id)
        {
            let arrow = self.style.dim(&format!("(→ {})", target.id));
            format!("{} {arrow}", edge.reference)
        } else {
            edge.reference.clone()
        };
        let classification = match &edge.bump {
            BumpImpact::Exact => self.style.red("exact — breaks on bump"),
            BumpImpact::WildcardLast => self
                .style
                .yellow("wildcard-last — breaks on bump; same-pattern replacement heals it"),
            BumpImpact::Tolerant(alternatives) => {
                let revisions = alternatives
                    .iter()
                    .map(|&index| format!("#{}", self.items[index].revision))
                    .collect::<Vec<_>>()
                    .join(", ");
                self.style
                    .green(&format!("tolerant (also matched by {revisions})"))
            }
        };
        format!("        {label} {reference}  {classification}")
    }

    fn render_impact(&self, canonical: &str, resolver: &Resolver, out: &mut Vec<String>) {
        let target_index = resolver.group(canonical).unwrap()[0];
        let target = &self.items[target_index];
        let mut impact = resolver.impact_of(canonical);
        if impact.direct.is_empty() {
            out.push(format!(
                "no items depend on {}",
                self.style.bold(&target.id)
            ));
            return;
        }
        let location_order = |index: usize| {
            let item = &self.items[index];
            (&item.file, item.line, item.character)
        };
        impact.direct.sort_by_key(|&index| location_order(index));
        impact
            .transitive
            .sort_by_key(|&(index, _)| location_order(index));
        let id = self.style.bold(&target.id);
        let location = self.dim_location(&target.file, target.line);
        let counts = self.style.dim(&format!(
            "({} direct, {} transitive)",
            impact.direct.len(),
            impact.transitive.len()
        ));
        out.push(format!("impact of {id}  {location}  {counts}"));
        out.push(String::new());
        out.push(self.style.bold("  direct"));
        for dependent in impact.direct {
            out.push(format!("    {}", self.located_item(&self.items[dependent])));
            for edge in resolver
                .dependents_of(target_index)
                .iter()
                .filter(|edge| edge.dependent == dependent)
            {
                out.push(self.impact_edge(edge, target));
            }
        }
        if !impact.transitive.is_empty() {
            out.push(self.style.bold("  transitive"));
            for (index, via) in impact.transitive {
                let item = self.located_item(&self.items[index]);
                let via = self.style.dim(&format!("via {}", self.items[via].id));
                out.push(format!("    {item}  {via}"));
            }
        }
    }

    // a need or forwarding edge carries this item's coverage obligation, so
    // it shows the target's own status mark - not a bare check mark - making
    // a shallow-covered item's broken chain diagnosable in place
    fn forward_edge(&self, item: &Item, resolver: &Resolver) -> String {
        let forwards_to = item.forwards_to.as_ref().expect("a forwarding source");
        let target = resolver
            .group(&canonical_id(forwards_to))
            .and_then(|group| group.first())
            .map(|&index| &self.items[index]);
        let arrow = self.style.cyan("\u{2192}");
        match target {
            None => {
                let missing = self.style.red("\u{2718} missing");
                format!("    {arrow} {forwards_to}  {missing}")
            }
            Some(target) => {
                let mark = styled_mark(target, &self.style);
                let location = self.dim_location(&target.file, target.line);
                format!("    {arrow} {forwards_to}  {mark} {location}")
            }
        }
    }

    // one line per need: the covering item's own status mark and location, or
    // missing; the resolved item's ID is shown as (→ id) for a wildcard
    // reference and whenever its spelling differs from the need's
    fn need_edges(&self, item: &Item, resolver: &Resolver) -> Vec<String> {
        let mut lines = Vec::new();
        for need in &item.needs {
            let ids = resolver.matches_of(need);
            if ids.is_empty() {
                let needs_label = self.style.dim("needs");
                let missing = self.style.red("\u{2718} missing");
                lines.push(format!("    {needs_label} {need}  {missing}"));
                continue;
            }
            let wildcard = is_wildcard_rev(rev_of(need));
            for id in ids {
                let covering = &self.items[resolver.group(id).unwrap()[0]];
                // matches_of yields canonical IDs; show the resolved item as
                // it is written
                let arrow = self.style.dim(&format!("(\u{2192} {})", covering.id));
                let reference = if wildcard || covering.id != *need {
                    format!("{need} {arrow}")
                } else {
                    need.clone()
                };
                let needs_label = self.style.dim("needs");
                let mark = styled_mark(covering, &self.style);
                let location = self.dim_location(&covering.file, covering.line);
                lines.push(format!("    {needs_label} {reference}  {mark} {location}"));
            }
        }
        lines
    }

    // covers references are concrete IDs; the relation's validation
    // (orphaned, unwanted) is carried by the defect bullets, the edge shows
    // existence
    fn cover_edges(&self, item: &Item, resolver: &Resolver) -> Vec<String> {
        let mut lines = Vec::new();
        for cover_id in &item.covers {
            let target = resolver
                .group(&canonical_id(cover_id))
                .and_then(|group| group.first())
                .map(|&index| &self.items[index]);
            let covers_label = self.style.dim("covers");
            match target {
                None => {
                    let missing = self.style.red("\u{2718} missing");
                    lines.push(format!("    {covers_label} {cover_id}  {missing}"));
                }
                Some(target) => {
                    let mark = self.style.green("\u{2714}");
                    let location = self.dim_location(&target.file, target.line);
                    lines.push(format!("    {covers_label} {cover_id}  {mark} {location}"));
                }
            }
        }
        lines
    }

    // one bullet per defect; a defect carrying its own source location (an
    // invalid entry, a cyclic forwarding declaration) shows it after the
    // message
    fn defect_lines(&self, item: &Item) -> Vec<String> {
        item.defects
            .iter()
            .map(|defect| {
                let location = match &defect.location {
                    Some(location) => {
                        format!("  {}", self.dim_location(&location.file, location.line))
                    }
                    None => String::new(),
                };
                let bullet = self.style.red("\u{2022}");
                let message = &defect.message;
                format!("    {bullet} {message}{location}")
            })
            .collect()
    }

    // role-appropriate edges: a spec item its needs, a forwarding source its
    // target (its own needs are excused, its covers are not), every item its
    // covers and who wants it - so a code item's own needs stay visible on
    // their targets, whatever origin those have
    fn edge_lines(&self, index: usize, resolver: &Resolver) -> Vec<String> {
        let item = &self.items[index];
        let mut lines = Vec::new();
        if item.forwards_to.is_some() {
            lines.push(self.forward_edge(item, resolver));
        } else if item.origin == Origin::Spec {
            lines.extend(self.need_edges(item, resolver));
        }
        lines.extend(self.cover_edges(item, resolver));
        for &wanting in resolver
            .wanted_by
            .get(&index)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            let wanting = &self.items[wanting];
            let wanted_by_label = self.style.dim("wanted by");
            let wanting_id = &wanting.id;
            let location = self.dim_location(&wanting.file, wanting.line);
            lines.push(format!("    {wanted_by_label} {wanting_id}  {location}"));
        }
        lines
    }

    // full item list for --verbose: every item with status and trace edges,
    // grouped by file, then line
    fn render_verbose(&self, out: &mut Vec<String>) {
        let resolver = build_resolver(self.items);
        let mut sorted: Vec<usize> = (0..self.items.len()).collect();
        sorted.sort_by(|&a, &b| {
            self.items[a]
                .file
                .cmp(&self.items[b].file)
                .then_with(|| self.items[a].line.cmp(&self.items[b].line))
        });
        let mut previous_file: Option<&str> = None;
        for index in &sorted {
            let item = &self.items[*index];
            if previous_file.is_some() && previous_file != Some(item.file.as_str()) {
                out.push(String::new());
            }
            previous_file = Some(item.file.as_str());
            let mark = styled_mark(item, &self.style);
            let located = self.located_item(item);
            let tag = styled_tag(item, &self.style);
            out.push(format!("{mark} {located}  {tag}"));
            out.extend(self.edge_lines(*index, &resolver));
            out.extend(self.defect_lines(item));
        }
        if !sorted.is_empty() {
            out.push(String::new());
        }
    }

    // the default report: one block per defective item only
    fn render_defective(&self, out: &mut Vec<String>) {
        for item in self.items.iter().filter(|item| !item.defects.is_empty()) {
            let mark = styled_mark(item, &self.style);
            let located = self.located_item(item);
            out.push(format!("{mark} {located}"));
            out.extend(self.defect_lines(item));
            out.push(String::new());
        }
    }

    fn render_summary(&self, summary: &crate::analyze::Summary, out: &mut Vec<String>) {
        let spec_items = summary.spec_items;
        let code_items = summary.code_items;
        let origin_breakdown = self.style.dim(&format!(
            "({spec_items} from specs, {code_items} from code)"
        ));
        // an ok item is either deep-covered or shallow-covered; naming both
        // keeps the split readable without a second summary line
        let coverage_breakdown = if summary.shallow_covered_items > 0 {
            let deep_covered = summary.ok_items - summary.shallow_covered_items;
            let shallow_covered = summary.shallow_covered_items;
            let breakdown = self.style.dim(&format!(
                "({deep_covered} deep-covered, {shallow_covered} only shallow-covered)"
            ));
            format!("  {breakdown}")
        } else {
            String::new()
        };
        let item_count = summary.items;
        let ok_count = self.style.green(&summary.ok_items.to_string());
        let defective_count = if summary.defective_items > 0 {
            self.style.red(&summary.defective_items.to_string())
        } else {
            "0".to_string()
        };

        out.push(self.style.bold("Summary"));
        out.push(format!("  items       {item_count}  {origin_breakdown}"));
        out.push(format!("  ok          {ok_count}{coverage_breakdown}"));
        out.push(format!("  defective   {defective_count}"));
        if summary.problems > 0 {
            let problem_count = self.style.yellow(&summary.problems.to_string());
            out.push(format!("  problems    {problem_count}"));
        }
        out.push(String::new());
    }
}

/// Query verdict: a defined reference succeeds independently of coverage defects.
pub fn report_impact(items: &[Item], reference: &str, cwd: &Path) -> bool {
    let resolver = build_resolver(items);
    let mut matches = resolver.query_matches(reference);
    matches.sort_by(|a, b| crate::ids::compare_rev(rev_of(a), rev_of(b)));
    if matches.is_empty() {
        let hint = if reference.contains('#') {
            RevisionsByKey::record(items).rev_hint(reference)
        } else {
            String::new()
        };
        let mut err = std::io::stderr().lock();
        let _ = writeln!(err, "no item matches {reference}{hint}");
        let _ = err.flush();
        return false;
    }
    let renderer = Renderer {
        items,
        style: Styler::new(),
        cwd: cwd.to_path_buf(),
    };
    let mut out = Vec::new();
    for canonical in matches {
        if !out.is_empty() {
            out.push(String::new());
        }
        renderer.render_impact(canonical, &resolver, &mut out);
    }
    print_line(&out.join("\n"));
    true
}

pub fn report(items: &[Item], problems: &[Problem], cwd: &Path, verbose: bool) -> bool {
    let renderer = Renderer {
        items,
        style: Styler::new(),
        cwd: cwd.to_path_buf(),
    };
    let summary = summarize(items, problems);
    let mut out: Vec<String> = Vec::new();

    if verbose {
        renderer.render_verbose(&mut out);
    } else {
        renderer.render_defective(&mut out);
    }

    for problem in problems {
        let warning = renderer.style.yellow("\u{26a0}");
        let message = &problem.message;
        let location = renderer.dim_location(&problem.file, problem.line);
        out.push(format!("{warning} {message}  {location}"));
    }
    if !problems.is_empty() {
        out.push(String::new());
    }

    renderer.render_summary(&summary, &mut out);

    let clean = is_clean(&summary);
    out.push(if clean {
        renderer.style.green(&renderer.style.bold("ok"))
    } else {
        renderer.style.red(&renderer.style.bold("not ok"))
    });
    print_line(&out.join("\n"));
    clean
}
