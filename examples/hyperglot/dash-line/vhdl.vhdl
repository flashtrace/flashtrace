-- hyperglot fixture: .vhdl has line comments only.
-- [impl:dash-line/vhdl#1]

-- A string hides comment markers; a comment after it still counts.
constant double_quoted : string := "it""s -- [impl:dash-line/vhdl-ghost-double-quoted#1]"; -- [impl:dash-line/vhdl-after-double-quoted#1]
constant character_literal : string := '"'; -- [impl:dash-line/vhdl-after-character-literal#1]
rising <= clk'event and clk = '1'; -- [impl:dash-line/vhdl-after-attribute#1]
