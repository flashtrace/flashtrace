/*
 * flashtrace: lightning-fast, reference-based requirement tracing.
 *
 * `ids` defines item IDs and references, `spec_items` the item semantics
 * shared by every specification format, `defects` the defect taxonomy,
 * `errors` the user-facing error types, `parse_markdown` the Markdown
 * specification parser and `parse_spec` the format dispatch.
 */

pub mod defects;
pub mod errors;
pub mod ids;
pub mod parse_markdown;
pub mod parse_spec;
pub mod spec_items;
