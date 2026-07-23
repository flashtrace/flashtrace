# F# comment grammar

`req:fsharp/grammar#1`

Line comments plus block comments that nest.

Covers: feat:support-grammar/fsharp#1

Needs:
* req:fsharp/fs#1
* req:fsharp/fsi#1
* req:fsharp/fsx#1

Tags: grammar, ml

## .fs

`req:fsharp/fs#1`

Needs:
- impl:fsharp/fs-line#1
- impl:fsharp/fs-block#1
- impl:fsharp/fs-nested/deep#1
- impl:fsharp/fs-nested/after-close#1

## .fsi

`req:fsharp/fsi#1`

Needs:
- impl:fsharp/fsi-line#1
- impl:fsharp/fsi-block#1
- impl:fsharp/fsi-nested/deep#1
- impl:fsharp/fsi-nested/after-close#1

## .fsx

`req:fsharp/fsx#1`

Needs:
- impl:fsharp/fsx-line#1
- impl:fsharp/fsx-block#1
- impl:fsharp/fsx-nested/deep#1
- impl:fsharp/fsx-nested/after-close#1
