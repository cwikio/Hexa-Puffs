---
name: component-design
description: >
  Design and build React UI components with consistent aesthetics, composable
  architecture, and accessibility. Activate when asked to design a component,
  build a UI, create a layout, style a page, implement a design system, or
  work with shadcn/ui, Tailwind CSS, or Radix UI primitives. Also use when
  asked about "component architecture", "design system", "UI patterns",
  "responsive design", "accessible components", or "make this look good".
---

## Process Overview

This skill follows a 3-phase process:

1. **Philosophy** — Define the design intent before writing code
2. **Implementation** — Build with the component library and styling system
3. **Refinement** — Polish accessibility, responsiveness, and visual consistency

## Phase 1: Design Philosophy

### The Principles

Every component decision flows from these principles. When in doubt, return here.

1. **Server-first rendering.** Default to React Server Components. Add `'use client'` only when the component genuinely needs browser APIs, event handlers, or client state. A server component that passes data as props is always faster than a client component that fetches on mount.

2. **Composition over configuration.** Small, focused components composed together beat large components with many props. A `Card` with `CardHeader`, `CardContent`, and `CardFooter` slots is more flexible than a `Card` with `title`, `subtitle`, `body`, and `footer` props.

3. **Restraint over decoration.** Every visual element must earn its place. If removing an element makes the design cleaner without losing meaning, remove it. White space is a design element — use it deliberately.

4. **Consistency over novelty.** Use the existing design system (shadcn/ui + Tailwind) before inventing new patterns. A consistent interface with standard components is better than a creative one with custom components for every element.

5. **Accessibility is not optional.** Every interactive element is keyboard navigable. Every image has alt text. Color is never the only indicator of state. WCAG 2.1 AA is the minimum.

### Applying the Philosophy

Before building any component, answer:

- **What is this component's single responsibility?** If the answer contains "and," split it.
- **Is this a server or client component?** Server unless it needs interactivity.
- **Does this pattern already exist in shadcn/ui?** Use it. Do not rebuild.
- **What does this look like with no data?** Empty states matter as much as full states.

## Phase 2: Implementation

### Technical Foundation

Build on shadcn/ui (Radix UI primitives) + Tailwind CSS 4. Install components with:

```bash
npx shadcn@latest add button card dialog input table
```

### Component Architecture Patterns

**Pattern: Compound Components (slots)**

```tsx
// GOOD: composable, flexible, self-documenting
<Card>
  <CardHeader>
    <CardTitle>Invoice #1234</CardTitle>
    <CardDescription>Due March 15, 2025</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-2xl font-bold">$1,250.00</p>
  </CardContent>
  <CardFooter>
    <Button>Send Reminder</Button>
  </CardFooter>
</Card>

// BAD: rigid, unclear, hard to extend
<Card
  title="Invoice #1234"
  subtitle="Due March 15, 2025"
  body="$1,250.00"
  actionLabel="Send Reminder"
  onAction={handleAction}
/>
```

**Pattern: Server Component with Client Islands**

```tsx
// page.tsx — Server Component (default)
export default async function InvoicesPage() {
  const invoices = await getInvoices() // Server-side data fetch

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Invoices</h1>
      <InvoiceFilters />           {/* Client component — has interactive filters */}
      <InvoiceTable data={invoices} /> {/* Server component — just renders data */}
    </div>
  )
}

// invoice-filters.tsx — Client Component (interactive)
'use client'
export function InvoiceFilters() {
  const [status, setStatus] = useState('all')
  return (
    <Select value={status} onValueChange={setStatus}>
      {/* filter UI */}
    </Select>
  )
}
```

**Pattern: Polymorphic Component (asChild)**

```tsx
// Using Radix's asChild pattern (built into shadcn/ui)
<Button asChild>
  <Link href="/invoices/new">Create Invoice</Link>
</Button>
// Renders as <a> with Button styling — semantic HTML, accessible
```

### Design Rules

**Color:**
- Use semantic color tokens from Tailwind/shadcn theme: `text-foreground`, `text-muted-foreground`, `bg-card`, `border`
- Never hardcode hex values. Always use theme tokens for dark mode compatibility.
- Limit accent colors to 1-2 per page. Use `text-primary` for actions, `text-destructive` for danger.

**Typography:**
- Use Tailwind type scale: `text-sm` for secondary, `text-base` for body, `text-lg`/`text-xl` for headings
- Use `font-medium` for labels and emphasis, `font-bold` for headings only
- Line height: `leading-relaxed` for body text, `leading-tight` for headings

**Spacing:**
- Use Tailwind spacing scale consistently: `gap-2` (8px) for tight, `gap-4` (16px) for standard, `gap-6`/`gap-8` for sections
- Use `space-y-*` for vertical stacking, `gap-*` for flex/grid layouts
- Page padding: `p-4` on mobile, `p-6` on tablet, `p-8` on desktop

**Layout:**
- Use CSS Grid for page layouts: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3`
- Use Flexbox for component layouts: `flex items-center justify-between`
- Max content width: `max-w-7xl mx-auto` for page containers
- Responsive: mobile-first. Start with single column, add columns at `md:` and `lg:` breakpoints.

### Component File Structure

```
src/components/
├── ui/                    ← shadcn/ui primitives (auto-generated, rarely edit)
│   ├── button.tsx
│   ├── card.tsx
│   └── dialog.tsx
├── invoice-card.tsx       ← Feature-specific composed components
├── invoice-table.tsx
├── status-badge.tsx
└── empty-state.tsx        ← Reusable patterns
```

- **Name files in kebab-case** matching the component name: `invoice-card.tsx` for `InvoiceCard`
- **One component per file** for feature components. shadcn/ui files may export multiple related components.
- **Co-locate types** with the component. Define props interfaces above the component in the same file.

### What to Avoid

❌ Using `'use client'` on components that only render data — keep them as server components
❌ Creating wrapper components that just pass props through — use the primitive directly
❌ Using CSS modules or styled-components when Tailwind covers the case
❌ Building custom dropdowns, modals, or tooltips — use Radix/shadcn primitives (they handle accessibility)
❌ Hardcoding responsive breakpoints in logic — use Tailwind responsive classes
❌ Nesting more than 3 levels of Tailwind classes in one element — extract a component instead

## Phase 3: Refinement

**CRITICAL:** Do not skip this phase. The difference between amateur and professional UI is in the details.

### Refinement Checklist

1. **Keyboard navigation** — Tab through every interactive element. Is the order logical? Can you activate everything with Enter/Space?
2. **Focus indicators** — Are focused elements visually distinct? shadcn/ui provides `focus-visible:ring` by default — verify it's not overridden.
3. **Empty states** — What does the component show with no data? An empty table should show a message, not just headers.
4. **Loading states** — Use Suspense boundaries with skeleton components, not spinners. `npx shadcn@latest add skeleton`.
5. **Error states** — What happens when data fails to load? Show an error message with a retry action, not a blank page.
6. **Responsive check** — Resize the browser from 320px to 1920px. Does the layout adapt gracefully at every width?
7. **Dark mode** — Toggle theme. Do all colors use semantic tokens? Any hardcoded colors that break?
8. **Contrast** — Text on background meets WCAG AA contrast ratio (4.5:1 for normal text, 3:1 for large text).

### Common Refinements

| Issue | Fix |
|-------|-----|
| Text truncates awkwardly | Add `truncate` or `line-clamp-2` with full text in tooltip |
| Table too wide on mobile | Wrap in `overflow-x-auto` container |
| Button text unclear | Use specific labels: "Create Invoice" not "Submit" |
| Form feels cramped | Add `space-y-4` between form fields |
| Modal too tall on mobile | Add `max-h-[85vh] overflow-y-auto` to dialog content |
| Icon without label | Add `aria-label` or visually hidden text |

## Anti-Patterns

❌ **Anti-pattern: Prop Drilling Through 4+ Levels**
Problem: Passing `user`, `theme`, `permissions`, and `config` through 4 levels of components that don't use them. Every intermediate component has props it doesn't care about.
✅ Solution: Use React context for truly global data (theme, auth). For feature data, restructure so the consuming component is closer to the data source — compose in the parent rather than passing through children.

❌ **Anti-pattern: One Giant Client Component**
Problem: An entire page wrapped in `'use client'` because one button needs an `onClick`. All data fetching moves to the client. The page loses server-rendering benefits, becomes slower, and the bundle grows.
✅ Solution: Keep the page as a server component. Extract only the interactive part into a small client component. Pass server-fetched data as props. The `'use client'` boundary should be as low in the tree as possible.

❌ **Anti-pattern: Reinventing Accessible Primitives**
Problem: Building a custom dropdown menu with `<div onClick>` instead of using Radix's `DropdownMenu`. The custom version doesn't handle keyboard navigation, screen readers, focus trapping, or click-outside-to-close.
✅ Solution: Always use Radix/shadcn primitives for interactive elements: Dialog, DropdownMenu, Select, Popover, Tooltip, Tabs. These handle accessibility patterns that take weeks to implement correctly.

## Stack Adaptation

Before designing components, read `tech-stack-preferences.md` for the user's actual stack. Apply these substitutions:
- **Component library** → use shadcn/ui with Radix primitives from preferences
- **Styling** → use Tailwind CSS 4 + tailwindcss-animate from preferences
- **Icons** → use lucide-react from preferences
- **Charts** → use Recharts from preferences
- **Forms** → use React Hook Form + Zod resolvers from preferences
- **Theming** → use next-themes from preferences for dark mode
- **State** → use Zustand from preferences for client-side state when needed

## Integration with Other Skills

- **codebase-conventions** — For where to place new components, naming patterns, and file organization.
- **code-quality-patterns** — For component testing patterns and code review checklists.
- **performance-optimization** — When component rendering is slow, for profiling and optimization.
- **architecture-decisions** — When choosing between component architecture patterns (compound vs render props vs hooks).
