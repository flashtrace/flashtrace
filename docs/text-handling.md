# Text handling

How flashtrace decodes its input, and how it counts and orders what it reports. These rules hold on every platform.

## Decoding

- Every input file is read as UTF-8. A byte sequence that is not valid UTF-8 becomes U+FFFD REPLACEMENT CHARACTER; the rest of the file is traced as usual.
- A byte-order mark (U+FEFF) at the very start of a file is dropped, so line 1 begins at its first real character. A U+FEFF anywhere else is an ordinary character.
- A line ends at LF or CRLF. A lone CR does not end a line.

## Whitespace

Wherever these specifications speak of whitespace - blank lines, trimmed titles and entries, the optional spaces inside a tag, the end of URL-shaped text - any Unicode whitespace character counts (the `White_Space` property): besides space and tab, for example U+00A0 NO-BREAK SPACE and U+0085 NEXT LINE. U+0085 is whitespace but does not end a line; U+FEFF is not whitespace.

## Columns

A column is 1-based and counts characters - Unicode scalar values - from the start of its line. A tab counts one, `é` (U+00E9) one, `😀` (U+1F600) one, and an `e` followed by a combining U+0301 two. Columns appear as `character` in the [JSON report](json-report.md); the plain-text report shows lines only.

## Ordering

Wherever a report orders by text, it compares Unicode code points one by one - no locale, no case folding - so `B.md` comes before `a.md`. A file is compared by its path relative to the working directory, with `/` as the separator, so files appear in the same order on every platform. Revisions are the exception: they order numerically (see [Revisions](revisions.md)).

## Paths

Input paths are made absolute and normalized lexically (`.` and `..` segments, separators), then compared exactly and case-sensitively. See [Known limitations](known-limitations.md) for what this means on a case-insensitive file system.
