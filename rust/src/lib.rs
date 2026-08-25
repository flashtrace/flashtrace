/*
 * flashtrace: lightning-fast, reference-based requirement tracing.
 *
 * `ids` defines item IDs and references, `spec_items` the item semantics
 * shared by every specification format, `defects` the defect taxonomy,
 * `errors` the user-facing error types and `paths` the path handling.
 */

pub mod defects;
pub mod errors;
pub mod ids;
pub mod paths;
pub mod spec_items;
