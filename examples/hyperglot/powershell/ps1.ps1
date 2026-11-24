# hyperglot fixture: .ps1 has line comments and block comments.
# [impl:powershell/ps1-line#1]

<#
  [impl:powershell/ps1-block#1]
#>

# A string hides comment markers; a comment after it still counts.
$singleQuoted = 'it''s # [impl:powershell/ps1-ghost-single-quoted#1]' # [impl:powershell/ps1-after-single-quoted#1]
$doubleQuoted = "`" # [impl:powershell/ps1-ghost-double-quoted#1]" # [impl:powershell/ps1-after-double-quoted#1]
