# TrialFlow Authentication Acceptance Criteria

## Goal

Only an authenticated operations user can access the console or protected workflow API, while the public health check remains available for deployment monitoring.

## Acceptance criteria

- An unauthenticated visit renders the sign-in screen and does not render inbox or task data.
- Valid server-configured credentials create an HTTP-only session and reveal the operations console.
- Invalid credentials return an error and never create an authenticated session.
- The session cookie is signed, expires, uses `SameSite=Lax`, and is `Secure` in production.
- `/api/auth/session` returns `401` without a valid session and the authenticated user otherwise.
- `/api/workflow` returns `401` without a valid session and `200` only with a valid session.
- Signing out clears the session and returns the user to the sign-in screen.
- `/api/health` returns `200` without authentication.
- Workflow behavior after login remains unchanged, including approval, booking, send, and human-takeover paths.
- Production deployments fail closed when auth environment variables are missing; no credentials are committed to the repository.
