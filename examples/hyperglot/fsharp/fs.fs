// hyperglot fixture: .fs nests its block comments.
// [impl:fsharp/fs-line#1]

(*
 * [impl:fsharp/fs-block#1]
 *)

(* outer
  (* [impl:fsharp/fs-nested/deep#1] inner *)
  [impl:fsharp/fs-nested/after-close#1] still inside the outer block
*)

// A string hides comment markers; a comment after it still counts.
let text = "\" // [impl:fsharp/fs-ghost-double-quoted#1]" // [impl:fsharp/fs-after-double-quoted#1]
let text = '"' // [impl:fsharp/fs-after-character-literal#1]
let identity (value: 'T) : 'T = value // [impl:fsharp/fs-after-type-variable#1]
