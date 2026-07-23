# Hyperglot grammar support

One feature item per comment grammar the tracer knows. Each is covered by the
spec.md of the matching folder, which in turn needs one requirement per file
extension, which needs the item tags that extension's fixture file defines -
one tag per comment form the grammar offers.

## C-like

`feat:support-grammar/c-like#1`

Line comments and block comments that do not nest.

Needs: req:c-like/grammar#1

## Nesting C-like

`feat:support-grammar/c-like-nested#1`

Line comments plus block comments that nest.

Needs: req:c-like-nested/grammar#1

## CoffeeScript

`feat:support-grammar/coffee#1`

Hash line comments plus a block pair whose opener and closer are identical.

Needs: req:coffee/grammar#1

## CSS

`feat:support-grammar/css#1`

One block pair and no line comments at all.

Needs: req:css/grammar#1

## Dash

`feat:support-grammar/dash-line#1`

A single line-comment marker and no block comments.

Needs: req:dash-line/grammar#1

## F#

`feat:support-grammar/fsharp#1`

Line comments plus block comments that nest.

Needs: req:fsharp/grammar#1

## Hash

`feat:support-grammar/hash#1`

A single line-comment marker and no block comments.

Needs: req:hash/grammar#1

## Haskell

`feat:support-grammar/haskell#1`

Dash line comments plus block comments that nest.

Needs: req:haskell/grammar#1

## HCL

`feat:support-grammar/hcl#1`

Two line-comment markers plus one block pair.

Needs: req:hcl/grammar#1

## HTML

`feat:support-grammar/html#1`

Markup comments by default, with script and style regions that switch grammar.

Needs: req:html/grammar#1

## Julia

`feat:support-grammar/julia#1`

Hash line comments plus block comments that nest.

Needs: req:julia/grammar#1

## Lua

`feat:support-grammar/lua#1`

Dash line comments plus a long-bracket block pair sharing their prefix.

Needs: req:lua/grammar#1

## ML

`feat:support-grammar/ml#1`

Block comments that nest, and no line comments at all.

Needs: req:ml/grammar#1

## Nim

`feat:support-grammar/nim#1`

Hash line comments plus two nesting block pairs, one of them a doc block.

Needs: req:nim/grammar#1

## Pascal

`feat:support-grammar/pascal#1`

Line comments plus two block pairs, neither of which nests.

Needs: req:pascal/grammar#1

## Percent

`feat:support-grammar/percent#1`

A single line-comment marker and no block comments.

Needs: req:percent/grammar#1

## PHP

`feat:support-grammar/php#1`

Two line-comment markers plus one block pair.

Needs: req:php/grammar#1

## PowerShell

`feat:support-grammar/powershell#1`

Hash line comments plus a block pair that does not nest.

Needs: req:powershell/grammar#1

## Scheme

`feat:support-grammar/scheme#1`

Semicolon line comments plus block comments that nest.

Needs: req:scheme/grammar#1

## Semicolon

`feat:support-grammar/semicolon#1`

A single line-comment marker and no block comments.

Needs: req:semicolon/grammar#1

## SQL

`feat:support-grammar/sql#1`

Dash line comments plus a block pair that does not nest.

Needs: req:sql/grammar#1

## XML

`feat:support-grammar/xml#1`

One block pair and no line comments at all.

Needs: req:xml/grammar#1
