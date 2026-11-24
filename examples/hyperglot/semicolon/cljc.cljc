; hyperglot fixture: .cljc has line comments only.
; [impl:semicolon/cljc#1]

; A string hides comment markers; a comment after it still counts.
(def double-quoted "\" ; [impl:semicolon/cljc-ghost-double-quoted#1]") ; [impl:semicolon/cljc-after-double-quoted#1]
(def character-prefix \") ; [impl:semicolon/cljc-after-character-prefix#1]
