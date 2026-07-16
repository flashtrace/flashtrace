# Alpha feature

`feat:alpha#1`

Only shallow-covered: its own need is met by req:alpha#1, but that item's
chain is broken further down.

Needs: req:alpha#1

# Alpha requirement

`req:alpha#1`

Uncovered: demands revision 2 of the implementation while only revision 1
exists, so the report adds a revision-mismatch hint.

Needs: impl:alpha#2

# Alpha implementation (previous revision)

`impl:alpha#1`

Defined at revision 1 so the uncovered report above can point at the
mismatch.

# Beta requirement

`req:beta#1`

Orphaned: covers an ID that is defined nowhere.

Covers: feat:beta#1

# Gamma requirement

`req:gamma#1`

Unwanted cover: covers a feature that does not need it back.

Covers: feat:gamma#1

# Gamma feature

`feat:gamma#1`

Needs nothing, so the incoming cover from req:gamma#1 is unwanted.

# Epsilon requirement

`req:epsilon#1`

Duplicate: the first definition of this ID.

# Epsilon requirement (defined again)

`req:epsilon#1`

Duplicate: the second definition of the same full ID.

# Zeta requirement

`req:zeta#1`

Duplicate forwarding: two forwardings are declared for this item. The first
stays in effect, so the trace edge points at dsn:zeta#1.

`[req:zeta#1 --> dsn:zeta#1]`
`[req:zeta#1 --> dsn:zeta-other#1]`

# Zeta design

`dsn:zeta#1`

Target of the effective forwarding.

# Eta requirement

`req:eta#1`

On a forwarding cycle with req:theta#1; both forwardings are voided, so the
item falls back to its own empty needs.

`[req:eta#1 --> req:theta#1]`

# Theta requirement

`req:theta#1`

Forwards back to req:eta#1, closing the cycle.

`[req:theta#1 --> req:eta#1]`

The forwarding below names a source that is defined nowhere:

`[req:ghost#1 --> req:alpha#1]`
