# command-line

There is nothing to trace here. This folder holds no requirements and no
code: the end-to-end suite (`tests/e2e.rs`) runs the command-line surface in
it - the `--help` text and the usage errors for an unknown option, a missing
value, an invalid value and a missing input path - and verifies each output
byte-for-byte against the snapshots in
[tests/e2e-expect/](../../tests/e2e-expect/).
