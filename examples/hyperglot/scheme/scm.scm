; hyperglot fixture: .scm nests its block comments.
; [impl:scheme/scm-line#1]

#|
  [impl:scheme/scm-block#1]
|#

#| outer
  #| [impl:scheme/scm-nested/deep#1] inner |#
  [impl:scheme/scm-nested/after-close#1] still inside the outer block
|#

; A string hides comment markers; a comment after it still counts.
(define text "\" ; [impl:scheme/scm-ghost-double-quoted#1]") ; [impl:scheme/scm-after-double-quoted#1]
(define text #\") ; [impl:scheme/scm-after-character-prefix#1]
