---
name: security-assessment
description: >
  Assess and remediate security vulnerabilities in web applications. Activate
  when asked about security review, vulnerability assessment, threat modeling,
  OWASP Top 10, XSS, SQL injection, CSRF, authentication security, dependency
  vulnerabilities, or security hardening. Also use when asked to "review
  security", "check for vulnerabilities", "harden this", "is this secure",
  "security audit", or "fix security issue".
---

## When to Activate

Use this skill when:
- User asks for a security review or vulnerability assessment
- User reports a potential security issue or vulnerability
- User needs threat modeling for a feature or system
- User asks about OWASP Top 10, XSS, injection, CSRF, or auth security
- User wants to harden an application or API
- Dependency audit reveals vulnerabilities

Do NOT use this skill when:
- User is debugging a non-security functional bug (use diagnostic-debugging)
- User is responding to an active security incident in production (use incident-response)
- User wants general code quality review (use code-quality-patterns)

## Vulnerability Quick Reference

| Vulnerability | Risk | Check | Start Here |
|--------------|------|-------|------------|
| SQL/NoSQL Injection | Critical | User input in queries | [Injection](#injection) |
| XSS (Cross-Site Scripting) | High | User content rendered in HTML | [XSS](#cross-site-scripting-xss) |
| Broken Authentication | Critical | Session handling, token management | [Auth Security](#authentication-security) |
| Sensitive Data Exposure | High | API responses, client bundles, logs | [Data Exposure](#sensitive-data-exposure) |
| CSRF | Medium | State-changing requests without tokens | [CSRF](#csrf) |
| Dependency Vulnerabilities | Varies | Outdated packages with known CVEs | [Dependencies](#dependency-security) |
| Insecure Direct Object Reference | High | User accessing other users' data | [IDOR](#insecure-direct-object-reference) |
| Security Misconfiguration | Medium | Missing headers, permissive CORS, debug mode | [Configuration](#security-configuration) |

## Assessment Methodology

**CRITICAL:** Assess systematically. Do NOT spot-check random files — follow this sequence to ensure coverage.

1. **Dependency audit** — Run `npm audit` and review results. Fix critical/high first.
2. **Configuration review** — Check security headers, CORS, CSP, env var exposure.
3. **Authentication review** — Verify auth middleware, session handling, token management.
4. **Input validation** — Check every user input path for proper sanitization.
5. **Authorization review** — Verify access control on every endpoint and server action.
6. **Data exposure check** — Review API responses, client bundles, and logs for sensitive data.
7. **Document findings** — Record each vulnerability with severity, location, and remediation.

## Investigation Toolkit

```bash
# Dependency vulnerability scan
npm audit
npm audit --audit-level=high

# Check for outdated packages
npm outdated

# Check for known vulnerable packages
npx is-my-node-vulnerable

# Scan for secrets accidentally committed
npx secretlint "**/*"

# Check security headers on deployed app
curl -I https://your-app.vercel.app | grep -iE "x-frame|x-content|strict-transport|x-xss|content-security"
```

## Diagnostic Trees

### Injection

```
Is user input used in a database query?
│
├─ Using Prisma ORM?
│  ├─ YES → Prisma parameterizes by default — SAFE for standard queries
│  │        BUT check for:
│  │        ├─ $queryRaw or $executeRaw → VULNERABLE if interpolating user input
│  │        │  ✅ Use Prisma.sql template tag: prisma.$queryRaw(Prisma.sql`...${param}`)
│  │        └─ Dynamic column/table names → VULNERABLE — validate against allowlist
│  └─ NO → Raw SQL?
│           └─ Always use parameterized queries. Never concatenate user input into SQL strings.
│
Is user input used in a shell command?
│
├─ YES → CRITICAL VULNERABILITY
│        Never pass user input to exec(), spawn(), or system() without sanitization.
│        ✅ Use allowlisted commands with validated parameters only.
└─ NO → Check: Is user input used in file paths?
         ├─ YES → Path traversal risk. Validate and normalize paths.
         │        ✅ Use path.resolve() and verify result is within expected directory.
         └─ NO → Lower risk, but still validate all input with Zod schemas.
```

### Cross-Site Scripting (XSS)

```
Is user-provided content rendered in HTML?
│
├─ Using React/Next.js JSX?
│  ├─ YES → React escapes by default — SAFE for {variable} in JSX
│  │        BUT check for:
│  │        ├─ dangerouslySetInnerHTML → VULNERABLE — sanitize with DOMPurify first
│  │        ├─ href={userInput} → VULNERABLE to javascript: URLs
│  │        │  ✅ Validate URL protocol: must start with https:// or /
│  │        └─ Rendering in <script> tags → VULNERABLE
│  │           ✅ Use JSON.stringify() and parse on client side
│  └─ NO → All user content must be escaped before rendering.
│
Is user input reflected in HTTP responses?
│
├─ In headers → Response splitting risk. Never include newlines in header values.
├─ In redirects → Open redirect risk. Validate redirect URLs against allowlist.
└─ In error messages → Reflected XSS risk. Never include raw user input in error responses.
```

### Authentication Security

```
Auth review checklist:
│
├─ Using Clerk?
│  ├─ Middleware configured correctly?
│  │  ├─ middleware.ts exports clerkMiddleware
│  │  ├─ Public routes explicitly listed (not implicit)
│  │  └─ Matcher covers all routes that need protection
│  │
│  ├─ Server-side auth checks?
│  │  ├─ Server Actions use auth() to verify session
│  │  ├─ API routes use getAuth(req) to verify session
│  │  └─ Server Components use currentUser() for user data
│  │
│  └─ Client-side tokens?
│     ├─ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is the publishable key (safe)
│     └─ CLERK_SECRET_KEY is NEVER in client-side code or NEXT_PUBLIC_ vars
│
├─ Session management:
│  ├─ Tokens expire and refresh correctly
│  ├─ Logout invalidates the session server-side
│  └─ Session tokens are HttpOnly, Secure, SameSite
│
└─ Password/credential handling:
   ├─ Passwords hashed with bcryptjs (cost factor ≥ 10)
   ├─ No plaintext passwords in logs, errors, or API responses
   └─ Rate limiting on login endpoints (use @upstash/ratelimit)
```

### Sensitive Data Exposure

```
Where might sensitive data leak?
│
├─ Client-side bundle
│  ├─ Search for NEXT_PUBLIC_ env vars — only truly public values?
│  ├─ API keys in client code? → Move to server-side, proxy through API route
│  └─ User PII in client state? → Minimize, never persist to localStorage
│
├─ API responses
│  ├─ Returning full database objects? → Use Prisma select to return only needed fields
│  ├─ Including internal IDs, emails, or tokens in responses to unauthorized users?
│  └─ Error messages revealing stack traces or DB schema? → Return generic errors in production
│
├─ Logs
│  ├─ Logging request bodies with passwords or tokens? → Redact sensitive fields
│  └─ Logging full error objects with user data? → Sanitize before logging
│
└─ Git repository
   ├─ .env files committed? → Add to .gitignore, rotate compromised secrets
   └─ Secrets in code comments? → Remove and rotate
```

### Insecure Direct Object Reference

```
Can a user access another user's data by changing an ID?
│
├─ Server Actions / API routes:
│  ├─ Is the resource ownership verified?
│  │  ├─ NO → VULNERABLE — add WHERE userId = currentUser.id to all queries
│  │  └─ YES → Is it using the authenticated user's ID from the session?
│  │           ├─ From request body/params → VULNERABLE — user can fake it
│  │           └─ From auth() / getAuth() → SAFE
│  │
│  └─ Multi-tenant data:
│     ├─ Is org/tenant ID from session or from request?
│     │  ├─ From request → VULNERABLE — user can access other org's data
│     │  └─ From Clerk org metadata → SAFE
│     └─ Are all queries scoped to the user's organization?
```

## Root Cause → Fix Map

| Root Cause | Fix | Verify With | Prevention |
|------------|-----|------------|------------|
| Raw SQL with user input | Use Prisma.sql template tag for $queryRaw | Test with SQL injection payloads | Lint for string concatenation in raw queries |
| dangerouslySetInnerHTML | Sanitize with DOMPurify before rendering | Test with XSS payloads (`<script>alert(1)</script>`) | Lint for dangerouslySetInnerHTML usage |
| Missing auth check | Add `auth()` call at start of every server action | Test endpoint without auth token — should return 401 | Add auth check to server action template |
| IDOR — no ownership check | Add `where: { userId: session.userId }` to query | Access resource with different user — should return 404 | Code review checklist item |
| Secret in client bundle | Move to server-side env var (remove NEXT_PUBLIC_ prefix) | Search client bundle for key pattern | CI check for secrets in bundle |
| Missing security headers | Add headers in `next.config.js` or middleware | Check with `curl -I` or securityheaders.com | Automated header check in CI |
| Vulnerable dependency | `npm audit fix` or upgrade to patched version | `npm audit` shows no high/critical | Weekly `npm audit` in CI |
| Missing rate limiting | Add @upstash/ratelimit to auth and mutation endpoints | Test with rapid requests — should get 429 | Add rate limiting to API route template |

## Security Headers Checklist

Add to `next.config.js`:

```typescript
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
    // Adapt CSP to your needs — this is a starting point
  },
]
```

**IMPORTANT:** Content Security Policy must be customized for your app's external resources (Clerk, PostHog, Cloudinary, Google Analytics). Test thoroughly after adding CSP — overly strict policies break functionality silently.

## Anti-Patterns

❌ **Anti-pattern: Security Through Obscurity**
Problem: Relying on hidden URLs, obfuscated parameters, or non-standard ports for security. Attackers use automated scanners that find these trivially.
✅ Solution: Every endpoint must have proper authentication AND authorization checks. Assume all URLs are public knowledge.

❌ **Anti-pattern: Client-Side Authorization**
Problem: Hiding UI elements (buttons, pages) based on role, but the API endpoints behind them have no access control. Any user with the URL can access admin functionality.
✅ Solution: Always enforce authorization on the server. Client-side hiding is UX, not security. Every server action and API route must independently verify the user's permissions.

❌ **Anti-pattern: Blanket CORS Allow-All**
Problem: Setting `Access-Control-Allow-Origin: *` to "fix CORS errors." This allows any website to make authenticated requests to your API.
✅ Solution: Set CORS origin to your specific domains only. For APIs that need broad access, use a separate unauthenticated endpoint.

❌ **Anti-pattern: Logging Sensitive Data**
Problem: Logging full request bodies, including passwords, tokens, and PII, for debugging. Logs are stored in plain text, often with broader access than the database.
✅ Solution: Redact sensitive fields before logging. Never log passwords, tokens, API keys, or full credit card numbers. Log only what's needed for debugging.

## Stack Adaptation

Before assessing, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Auth** → audit Clerk configuration, middleware, and session handling
- **Database** → audit Prisma queries for raw SQL usage and IDOR patterns
- **API** → audit Server Actions and API routes for input validation (Zod safeParse)
- **Dependencies** → use `npm audit` for vulnerability scanning
- **Headers** → configure in `next.config.js` or Vercel settings
- **Rate limiting** → use @upstash/ratelimit from preferences
- **Payments** → audit Stripe webhook signature verification
- **File uploads** → audit Vercel Blob and Cloudinary for access control

## Integration with Other Skills

- **incident-response** — When a security vulnerability is actively being exploited, hand off to incident-response for the structured response process.
- **diagnostic-debugging** — When investigating whether a vulnerability has been exploited, use diagnostic-debugging for evidence gathering and log analysis.
- **code-quality-patterns** — After remediating a vulnerability, use code-quality-patterns to ensure the fix is properly tested and maintainable.
- **ci-cd-pipelines** — For adding automated security scanning (npm audit, secret scanning) to the CI/CD pipeline.
- **infrastructure-ops** — For infrastructure-level security (DNS, CDN, WAF configuration).
