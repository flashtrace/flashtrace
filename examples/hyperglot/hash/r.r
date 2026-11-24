# hyperglot fixture: .r has line comments only.
# [impl:hash/r#1]

# A string hides comment markers; a comment after it still counts.
text <- "\" # [impl:hash/r-ghost-double-quoted#1]" # [impl:hash/r-after-double-quoted#1]
text <- '\' # [impl:hash/r-ghost-single-quoted#1]' # [impl:hash/r-after-single-quoted#1]
