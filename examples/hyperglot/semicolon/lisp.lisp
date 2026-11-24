; hyperglot fixture: .lisp has line comments only.
; [impl:semicolon/lisp#1]

; A string hides comment markers; a comment after it still counts.
(defvar *text* "\" ; [impl:semicolon/lisp-ghost-double-quoted#1]") ; [impl:semicolon/lisp-after-double-quoted#1]
(defvar *text* #\") ; [impl:semicolon/lisp-after-character-prefix#1]
