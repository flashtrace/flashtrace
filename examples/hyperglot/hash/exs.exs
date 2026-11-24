# hyperglot fixture: .exs has line comments only.
# [impl:hash/exs#1]

# A string hides comment markers; a comment after it still counts.
double_quoted = "\" # [impl:hash/exs-ghost-double-quoted#1]" # [impl:hash/exs-after-double-quoted#1]
single_quoted = '\' # [impl:hash/exs-ghost-single-quoted#1]' # [impl:hash/exs-after-single-quoted#1]
character_prefix = ?" # [impl:hash/exs-after-character-prefix#1]
