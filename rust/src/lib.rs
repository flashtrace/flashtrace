/*
 * The Rust port of flashtrace, module for module a mirror of the JavaScript
 * implementation in ../src so the two can be reviewed side by side. The port
 * must reproduce the JavaScript CLI's observable behavior byte for byte; the
 * two modules without a JavaScript counterpart exist for exactly that goal:
 * `jscompat` reproduces JavaScript string and regex semantics, `paths` ports
 * Node's path functions.
 */

pub mod defects;
pub mod errors;
pub mod ids;
pub mod jscompat;
pub mod paths;
pub mod spec_items;
