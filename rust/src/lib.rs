/*
 * flashtrace: lightning-fast, reference-based requirement tracing.
 *
 * `ids` defines item IDs and references, `spec_items` the item semantics
 * shared by every specification format, `defects` the defect taxonomy,
 * `errors` the user-facing error types, `parse_markdown` the Markdown
 * specification parser, `parse_spec` the format dispatch, `languages` the
 * comment grammars per file extension, `parse_code` the comment-aware code
 * tag scanner, `analyze` the coverage analysis and `paths` the lexical path
 * helpers std lacks.
 */

pub mod analyze;
pub mod cli;
pub mod defects;
pub mod errors;
pub mod files;
pub mod ids;
pub mod languages;
pub mod parse_code;
pub mod parse_markdown;
pub mod parse_spec;
pub mod paths;
pub mod report;
pub mod report_json;
pub mod spec_items;
