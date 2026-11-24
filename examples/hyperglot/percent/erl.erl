% hyperglot fixture: .erl has line comments only.
% [impl:percent/erl#1]

% A string hides comment markers; a comment after it still counts.
Text = "\" % [impl:percent/erl-ghost-double-quoted#1]", % [impl:percent/erl-after-double-quoted#1]
Text = '\' % [impl:percent/erl-ghost-single-quoted#1]', % [impl:percent/erl-after-single-quoted#1]
Text = $", % [impl:percent/erl-after-character-prefix#1]
