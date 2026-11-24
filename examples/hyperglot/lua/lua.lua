-- hyperglot fixture: .lua opens blocks with a longer form of its line marker.
-- [impl:lua/lua-line#1]

--[[
  [impl:lua/lua-block#1]
]]

-- A string hides comment markers; a comment after it still counts.
local double_quoted = "\" -- [impl:lua/lua-ghost-double-quoted#1]" -- [impl:lua/lua-after-double-quoted#1]
local single_quoted = '\' -- [impl:lua/lua-ghost-single-quoted#1]' -- [impl:lua/lua-after-single-quoted#1]
