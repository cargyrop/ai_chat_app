# Module: backend/middleware/security.js

## Responsibility
HTTP security: rate limiting, CSP headers, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.

## Public API
- `rateLimiter(windowMs, max): function` — Returns Express middleware factory
- `securityHeaders(req, res, next): void` — Express middleware setting all security headers

## Invariants
- Rate limiter bucket cleanup runs every 5 minutes (unref'd timer)
- Rate limit is 90 requests per minute per IP (default)
- CSP must include `script-src 'self' 'unsafe-inline'` until inline handlers are migrated (see INVARIANTS.md #3)
- CORS is handled separately in `server.js`, not here

## Dependencies
None.

## Side Effects
- `setInterval` for bucket cleanup
- In-memory `Map` for rate limit buckets (lost on restart)
