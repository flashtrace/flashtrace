-- hyperglot fixture: .ads has line comments only.
-- [impl:dash-line/ads#1]

-- A string hides comment markers; a comment after it still counts.
Text : constant String := "it""s -- [impl:dash-line/ads-ghost-double-quoted#1]"; -- [impl:dash-line/ads-after-double-quoted#1]
Text : constant String := '"'; -- [impl:dash-line/ads-after-character-literal#1]
Size : constant Natural := Text'Length; -- [impl:dash-line/ads-after-attribute#1]
