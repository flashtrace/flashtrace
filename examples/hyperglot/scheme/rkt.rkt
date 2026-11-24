; hyperglot fixture: .rkt nests its block comments.
; [impl:scheme/rkt-line#1]

#|
  [impl:scheme/rkt-block#1]
|#

#| outer
  #| [impl:scheme/rkt-nested/deep#1] inner |#
  [impl:scheme/rkt-nested/after-close#1] still inside the outer block
|#

; A string hides comment markers; a comment after it still counts.
(define double-quoted "\" ; [impl:scheme/rkt-ghost-double-quoted#1]") ; [impl:scheme/rkt-after-double-quoted#1]
(define character-prefix #\") ; [impl:scheme/rkt-after-character-prefix#1]
