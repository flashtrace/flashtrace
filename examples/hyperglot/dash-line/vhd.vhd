-- hyperglot fixture: .vhd has line comments only.
-- [impl:dash-line/vhd#1]

-- A string hides comment markers; a comment after it still counts.
constant double_quoted : string := "it""s -- [impl:dash-line/vhd-ghost-double-quoted#1]"; -- [impl:dash-line/vhd-after-double-quoted#1]
constant character_literal : string := '"'; -- [impl:dash-line/vhd-after-character-literal#1]
rising <= clk'event and clk = '1'; -- [impl:dash-line/vhd-after-attribute#1]
