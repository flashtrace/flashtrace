-- hyperglot fixture: .sql has line comments and block comments.
-- [impl:sql/sql-line#1]

/*
 * [impl:sql/sql-block#1]
 */

-- A string hides comment markers; a comment after it still counts.
SELECT 'it''s -- [impl:sql/sql-ghost-single-quoted#1]' AS text; -- [impl:sql/sql-after-single-quoted#1]
SELECT "it""s -- [impl:sql/sql-ghost-double-quoted#1]" AS text; -- [impl:sql/sql-after-double-quoted#1]
