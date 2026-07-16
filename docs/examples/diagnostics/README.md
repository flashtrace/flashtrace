# Diagnostics gallery

An intentionally defective project: every defect and problem kind flashtrace
reports, one per item, as documentation of what a broken trace looks like.
Running flashtrace here exits with code 1.

From [spec.md](spec.md):

- uncovered - req:alpha#1 needs impl:alpha#2, which does not exist; since
  revision 1 of impl:alpha is defined, the report adds a revision-mismatch
  hint. feat:alpha#1 sits on top of it and is only shallow-covered: its own
  need is met, but the chain below is broken.
- orphaned - req:beta#1 covers feat:beta#1, an ID defined nowhere.
- unwanted covers - req:gamma#1 covers feat:gamma#1, but feat:gamma#1 does
  not list req:gamma#1 in its needs.
- duplicate ID - req:epsilon#1 is defined twice.
- duplicate forwarding - two forwardings are declared for req:zeta#1; the
  first (to dsn:zeta#1) stays in effect, and the duplicate is flagged.
- cyclic forwarding - req:eta#1 forwards to req:theta#1 and vice versa; both
  forwardings are reported as problems and voided, so the two items fall back
  to their own (empty) needs.
- forwarding from a nonexistent item - a forwarding names req:ghost#1 as its
  source, which is defined nowhere.

From the code files:

- unwanted code item - [unwanted.ts](unwanted.ts) defines impl:delta#1, which
  no item needs.
- need tag without a preceding item tag - [orphan-need.ts](orphan-need.ts)
  opens with a need tag, so there is no item tag it could attach to.
