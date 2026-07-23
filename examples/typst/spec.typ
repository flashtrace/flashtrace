= Authentication <auth-chapter>
`feat:auth#1`

Session-token authentication, split into a login and a logout requirement.

#table(
  columns: 2,
  table.header([Requirement], [Needs]),
  [Login], [`req:auth/login#1`],
  [Logout], [`req:auth/logout#1`],
)

== Login requires a valid session token
`req:auth/login#1`

The system accepts a request only when it carries a valid session token.

// An expired token counts as invalid and is rejected the same way.

Needs: `impl:auth/login#1`, `utest:auth/login#1`

/ Covers: feat:auth

== Logout revokes the session token
`req:auth/logout#1`

A logout invalidates the session token immediately.

Needs:
- `impl:auth/logout#1`
- `utest:auth/logout#1`

/ Covers: feat:auth
