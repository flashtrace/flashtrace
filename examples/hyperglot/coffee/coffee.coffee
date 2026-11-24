# hyperglot fixture: .coffee opens and closes blocks with the same marker,
# and a run of four or more # is a line comment, not a block opener.
# [impl:coffee/coffee-line-hash#1]

###
  [impl:coffee/coffee-block#1]
###

#### [impl:coffee/coffee-line-hash-run#1] comments out only its own line
[impl:coffee/ghost#1] stays code: a run opening a block would swallow this line
#### and end that block here

# A string hides comment markers; a comment after it still counts.
text = "\" # [impl:coffee/coffee-ghost-double-quoted#1]" # [impl:coffee/coffee-after-double-quoted#1]
text = '\' # [impl:coffee/coffee-ghost-single-quoted#1]' # [impl:coffee/coffee-after-single-quoted#1]
