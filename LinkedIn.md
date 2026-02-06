# LinkedIn MCP — Brainstorm

## 1. Official LinkedIn API (OAuth 2.0)

LinkedIn has official REST APIs for posting, profile management, etc.

- **How**: Register an app on LinkedIn Developer Portal, get OAuth tokens, call their API endpoints
- **Pros**: Stable, sanctioned, no risk of account ban
- **Cons**: Very restrictive. Most useful endpoints (like posting on behalf of a user) require partner-level access or specific product approvals (e.g., "Share on LinkedIn", "Sign In with LinkedIn"). Getting approved can be slow/impossible for personal use
- **Verdict**: Worth checking what's available to you, but LinkedIn is notoriously stingy with API access for individual developers

## 2. Browser Automation (Playwright/Puppeteer)

Control a headless or headed browser that's logged into your LinkedIn session.

- **How**: Use Playwright to automate actions — navigate to the post composer, fill in text, click "Post", etc.
- **Pros**: Full access to everything you can do manually. No API approval needed
- **Cons**: Fragile (LinkedIn changes their DOM), slow, needs a browser running, LinkedIn actively fights automation (CAPTCHAs, session invalidation), risk of account restriction
- **Verdict**: Works for personal use if you're careful, but high maintenance

## 3. LinkedIn's Undocumented/Internal API ("Voyager API")

LinkedIn's frontend talks to internal REST endpoints. Libraries like `linkedin-api` (Python) reverse-engineer these.

- **How**: Authenticate with your credentials (or cookies), call the internal endpoints directly
- **Pros**: Fast, no browser needed, covers most actions (post, comment, message, profile edits)
- **Cons**: Against LinkedIn ToS, can break without warning, risk of account ban, requires maintaining cookie/session auth
- **Verdict**: The most practical "hacker" approach. Many open-source libs exist (mostly Python: `linkedin-api`, `linkedin-messaging-api`)

## 4. Hybrid: Cookie-Based Session + HTTP Requests

A middle ground between #2 and #3.

- **How**: Log in manually once in a browser, extract the `li_at` session cookie, use that cookie to make direct HTTP requests to LinkedIn's internal API
- **Pros**: No need for full browser automation, simpler than Playwright, same power as #3
- **Cons**: Cookie expires periodically (you'd need to refresh it), still against ToS
- **Verdict**: Probably the most pragmatic approach for a personal MCP

## Recommended Approach for Annabelle Stack

Options 3 or 4 implemented as a new `LinkedIn-MCP` package:

- A stdio MCP spawned by Orchestrator (like Guardian, Filer, etc.)
- Tools like `linkedin_create_post`, `linkedin_get_feed`, `linkedin_update_profile`, `linkedin_send_message`
- Credentials stored in 1Password, retrieved via the existing 1Password MCP
- The `li_at` cookie or username/password as the auth mechanism

The Python `linkedin-api` library is the most mature reverse-engineered client. Options:
- Write the MCP in **TypeScript** and port/re-implement the API calls directly (they're just HTTP requests with specific headers)
- Write it in **Python** and use `linkedin-api` directly, then bridge it as an MCP (slightly breaks the all-TS convention)
