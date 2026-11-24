# hyperglot fixture: .py has line comments only.
# [impl:hash/py#1.2]

# A string hides comment markers; a comment after it still counts.
double_quoted = "\" # [impl:hash/py-ghost-double-quoted#1]" # [impl:hash/py-after-double-quoted#1]
single_quoted = '\' # [impl:hash/py-ghost-single-quoted#1]' # [impl:hash/py-after-single-quoted#1]
