/*
 * Terminal report.
 *
 * Colors are on exactly when stdout is a terminal and NO_COLOR is unset or
 * empty (per no-color.org, only a non-empty NO_COLOR disables them). Output
 * goes through print_line, which swallows write errors: on a broken pipe the
 * run ends quietly with its computed exit code.
 */

use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

use crate::analyze::{Resolver, build_resolver, is_clean, status_of, summarize};
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
    on: bool,
}

impl Styler {
    fn new() -> Styler {
        let no_color = std::env::var_os("NO_COLOR").is_some_and(|value| !value.is_empty());
        Styler {
            on: std::io::stdout().is_terminal() && !no_color,
        }
    }

    fn wrap(&self, code: &str, text: &str) -> String {
        if self.on {
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
            let title = match &item.title {
                Some(title) => format!(" {}", self.style.dim(&format!("\"{title}\""))),
                None => String::new(),
            };
            let mark = styled_mark(item, &self.style);
            let id = self.style.bold(&item.id);
            let location = self.dim_location(&item.file, item.line);
            let tag = styled_tag(item, &self.style);
            out.push(format!("{mark} {id}{title}  {location}  {tag}"));
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
            let title = match &item.title {
                Some(title) => format!(" {}", self.style.dim(&format!("\"{title}\""))),
                None => String::new(),
            };
            let mark = styled_mark(item, &self.style);
            let id = self.style.bold(&item.id);
            let location = self.dim_location(&item.file, item.line);
            out.push(format!("{mark} {id}{title}  {location}"));
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
