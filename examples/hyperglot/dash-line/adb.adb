-- hyperglot fixture: .adb has line comments only.
-- [impl:dash-line/adb#1]

-- A string hides comment markers; a comment after it still counts.
Text : constant String := "it""s -- [impl:dash-line/adb-ghost-double-quoted#1]"; -- [impl:dash-line/adb-after-double-quoted#1]
Text : constant String := '"'; -- [impl:dash-line/adb-after-character-literal#1]
Size : constant Natural := Text'Length; -- [impl:dash-line/adb-after-attribute#1]
