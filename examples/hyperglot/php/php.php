<?php
// hyperglot fixture: .php accepts two line-comment markers.
// [impl:php/php-line-slash#1]
# [impl:php/php-line-hash#1]

/*
 * [impl:php/php-block#1]
 */

// A string hides comment markers; a comment after it still counts.
$text = "\" // [impl:php/php-ghost-double-quoted#1]"; // [impl:php/php-after-double-quoted#1]
$text = '\' // [impl:php/php-ghost-single-quoted#1]'; // [impl:php/php-after-single-quoted#1]
