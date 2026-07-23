CoffeeScript comment grammar
============================

`req:coffee/grammar#1`

Hash line comments - a run of four or more hashes is itself a line comment,
not a block opener - plus a block pair whose opener and closer are identical.

Covers: feat:support-grammar/coffee#1

Needs:
- req:coffee/coffee#1

Tags: grammar, hash

## .coffee

`req:coffee/coffee#1`

Needs: impl:coffee/coffee-line-hash#1, impl:coffee/coffee-line-hash-run#1, impl:coffee/coffee-block#1
