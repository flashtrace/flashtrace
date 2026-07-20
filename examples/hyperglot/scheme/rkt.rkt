; hyperglot fixture: .rkt nests its block comments.
; [impl:scheme/rkt-line#1]

#|
  [impl:scheme/rkt-block#1]
|#

#| outer
  #| [impl:scheme/rkt-nested/deep#1] inner |#
  [impl:scheme/rkt-nested/after-close#1] still inside the outer block
|#
