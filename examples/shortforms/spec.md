# Authentication feature

`feat:auth/login#1`

Users authenticate with a session token before any protected request.

Needs: req

# Login requires a valid session token

`req:auth/login#1`

The system accepts a request only when it carries a valid session token.

Covers: feat
Needs:
- impl
- utest#1
