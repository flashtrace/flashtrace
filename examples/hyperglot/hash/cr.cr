# hyperglot fixture: .cr has line comments only.
# [impl:hash/cr#1]

# A string hides comment markers; a comment after it still counts.
text = "\" # [impl:hash/cr-ghost-double-quoted#1]" # [impl:hash/cr-after-double-quoted#1]
text = '"' # [impl:hash/cr-after-character-literal#1]
