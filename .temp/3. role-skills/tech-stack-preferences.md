# Tech Stack Preferences

Synthesized from: Paperwork.vc (Next.js SaaS), Annabelle (MCP agent system). Every skill in this library reads this file to adapt its output to your tools. Leave items blank if not applicable.

---

## Language & Runtime

- **Primary language:** TypeScript (strict mode)
- **Runtime:** Node.js 22+
- **Secondary languages:** Python (data scripts, AI tooling)

## Frontend

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS 4 + tailwindcss-animate
- **Component library:** shadcn/ui (Radix UI primitives)
- **State management:** React Server Components + Zustand (client when needed)
- **Forms:** React Hook Form + Zod resolvers
- **Icons:** lucide-react, react-icons
- **Charts:** Recharts
- **Theming:** next-themes

## Backend

- **API style:** Server Actions (Next.js) + API routes for webhooks/external
- **Database:** PostgreSQL (primary), SQLite + sqlite-vec (for local/agent projects)
- **ORM:** Prisma 7
- **Cache:** Upstash Redis (@upstash/redis)
- **Rate limiting:** @upstash/ratelimit
- **Queue/Jobs:** Inngest
- **File storage:** Vercel Blob, Cloudinary (images)
- **Search:** LlamaIndex (RAG), sqlite-vec (vector search for agents)

## Authentication & Authorization

- **Auth provider:** Clerk
- **Authorization model:** Org-level RBAC via Clerk metadata
- **Session strategy:** Clerk session tokens + middleware

## Payments & Billing

- **Payment engine:** Stripe (direct) or Clerk Billing (Stripe-backed, integrated with Clerk auth)
- **Subscription management:** Stripe Billing (complex/custom billing), Clerk Billing (simple SaaS subscriptions)
- **Webhooks:** Stripe webhooks via API routes (Stripe direct), Clerk webhooks via Svix (Clerk Billing)
- **Clerk Billing components:** `<PricingTable />`, `<Protect plan="...">`, `has({ plan, feature })`, `usePlans()`
- **Decision:** Use Clerk Billing for straightforward subscription gating with minimal code. Use Stripe directly for metered/usage-based billing, multi-currency, tax/VAT, or complex pricing models.

## Infrastructure & Deployment

- **Hosting:** Vercel (web apps)
- **CI/CD:** GitHub Actions
- **Monitoring:** PostHog (product analytics), Vercel Analytics
- **Error tracking:** PostHog + Vercel Logs
- **Logging:** Vercel Logs (web), file-based JSON logs (agents)
- **DNS/CDN:** Cloudflare
- **Container orchestration:** Docker Compose (test databases, local services)
- **IaC tool:** —

## AI & LLM

- **Primary model provider:** Groq (llama-3.3-70b-versatile), Anthropic (Claude)
- **SDK:** Vercel AI SDK (ai package), @ai-sdk/groq, @ai-sdk/openai
- **Embeddings:** sqlite-vec
- **Vector store:** sqlite-vec (agents), pgvector (web apps, PostgreSQL extension)
- **Agent framework:** Model Context Protocol (MCP) + Vercel AI SDK ReAct
- **RAG:** LlamaIndex (@llamaindex/core)
- **Local inference:** LM Studio, Ollama (optional)

## Email & Notifications

- **Transactional email:** Resend
- **Email templates:** React Email (@react-email/components)
- **Push notifications:** —
- **SMS:** —

## Communication (Agent-Specific)

- **Messaging:** Telegram (GramJS MTProto)
- **Email access:** Gmail (googleapis OAuth2)
- **Calendar:** Google Calendar (googleapis)
- **Web search:** Brave Search API
- **Secrets management:**

## Development Workflow

- **Package manager:** npm
- **Monorepo tool:** Turborepo (web projects), local workspaces (agent projects)
- **Linting:** ESLint
- **Formatting:** Prettier
- **TypeScript check:** `npx tsc --noEmit` on every change
- **Git workflow:** Feature branches -> PR -> main
- **Code review:** Required

## Testing Strategy

- **Unit tests:** Vitest
- **Integration tests:** Vitest (API routes, server actions)
- **E2E tests:** Playwright
- **Test data:** @faker-js/faker
- **Test database:** PostgreSQL 16-alpine via Docker Compose (port 5433)
- **API tests:** Vitest
- **Visual regression:** —
- **Load testing:** —

## Conventions

- **Naming:** kebab-case (files/routes/components/types)
- **Error handling:** Return `{ data, error }` objects from server actions, never throw
- **Validation:** Zod schemas co-located with server actions, `safeParse` always
- **Env vars:** `.env.local` for development, Vercel env / platform env for production
- **Logging format:** Structured JSON (agents), console (web dev)
- **API versioning:** —

## Third-Party Integrations

- **Analytics:** PostHog (posthog-js + posthog-node), Google Analytics via GTM
- **Feature flags:** PostHog
- **CMS:** MDX (next-mdx-remote + gray-matter)
- **File upload/CDN:** Vercel Blob (documents), Cloudinary (images)
- **PDF:** PDF.js (viewing), @napi-rs/canvas (generation)
- **Document processing:** Mammoth (Word docs), archiver (ZIP)
- **Apple Wallet:** passkit-generator
- **QR codes:** qrcode.react
- **Spreadsheets:** xlsx
- **Security scanning:** Granite Guardian (prompt injection detection, agent-specific)
- **Browser automation:** Playwright MCP (@playwright/mcp, agent-specific)
- **Code execution:** Sandboxed execution via CodeExec-MCP (agent-specific)

## Security

- **Content Security Policy:** Configured for Clerk, Google Analytics, PostHog, Cloudinary
- **Security headers:** X-Frame-Options, HSTS, XSS Protection
- **Password hashing:** bcryptjs
- **Prompt injection:** Granite Guardian scanning (agents)
- **MCP security:** Per-agent tool policies (allowedTools/deniedTools globs)
