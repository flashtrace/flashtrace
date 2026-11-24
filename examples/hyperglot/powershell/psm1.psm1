# hyperglot fixture: .psm1 has line comments and block comments.
# [impl:powershell/psm1-line#1]

<#
  [impl:powershell/psm1-block#1]
#>

# A string hides comment markers; a comment after it still counts.
$singleQuoted = 'it''s # [impl:powershell/psm1-ghost-single-quoted#1]' # [impl:powershell/psm1-after-single-quoted#1]
$doubleQuoted = "`" # [impl:powershell/psm1-ghost-double-quoted#1]" # [impl:powershell/psm1-after-double-quoted#1]
