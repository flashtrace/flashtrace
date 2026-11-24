; hyperglot fixture: .cljs has line comments only.
; [impl:semicolon/cljs#1]

; A string hides comment markers; a comment after it still counts.
(def text "\" ; [impl:semicolon/cljs-ghost-double-quoted#1]") ; [impl:semicolon/cljs-after-double-quoted#1]
(def text \") ; [impl:semicolon/cljs-after-character-prefix#1]
