; hyperglot fixture: .clj has line comments only.
; [impl:semicolon/clj#1]

; A string hides comment markers; a comment after it still counts.
(def text "\" ; [impl:semicolon/clj-ghost-double-quoted#1]") ; [impl:semicolon/clj-after-double-quoted#1]
(def text \") ; [impl:semicolon/clj-after-character-prefix#1]
