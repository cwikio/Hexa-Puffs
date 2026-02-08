# Searcher MCP

MCP server that provides web and news search via the [Brave Search API](https://brave.com/search/api/).

Part of the **Annabelle** ecosystem. Auto-discovered by the Orchestrator on port `8007`.

## Tools

### `web_search`

Search the web for current information, documentation, or any topic.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | | Search query |
| `count` | number | no | 10 | Number of results (1-20) |
| `freshness` | string | no | | Recency filter: `24h`, `week`, `month`, `year` |
| `safesearch` | string | no | `moderate` | `off`, `moderate`, or `strict` |

**Response:**
```json
{
  "results": [{ "title": "...", "url": "...", "description": "...", "age": "..." }],
  "total_count": 10,
  "query": "..."
}
```

### `news_search`

Search recent news articles — use instead of `web_search` for current events and breaking news.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | | News search query |
| `count` | number | no | 10 | Number of results (1-20) |
| `freshness` | string | no | | Recency filter: `24h`, `week`, `month` (year not supported) |

**Response:**
```json
{
  "results": [{ "title": "...", "url": "...", "description": "...", "source": "...", "age": "...", "thumbnail": "...", "breaking": false }],
  "total_count": 10,
  "query": "..."
}
```

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and add your BRAVE_API_KEY
npm run build
```

Get an API key at https://brave.com/search/api/.

## Configuration

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `BRAVE_API_KEY` | | yes | Brave Search API key |
| `TRANSPORT` | `stdio` | no | `stdio`, `http`, or `sse` |
| `PORT` | `8007` | no | HTTP server port (only when `TRANSPORT=http`) |

## Transport Modes

- **stdio** (default) — for Claude Desktop or Orchestrator stdio spawning
- **http** / **sse** — standalone HTTP server with these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/tools/list` | List available tools |
| POST | `/tools/call` | Call a tool (`{ name, arguments }`) |
| GET | `/sse` | SSE connection |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run the server |
| `npm run dev` | Watch mode (rebuilds on change) |
| `npm test` | Run test suite |
| `npm run test:web` | Run web search tests only |
| `npm run test:news` | Run news search tests only |

## Testing

55 integration tests across 12 categories. See [testing.md](testing.md) for the full test plan, client helpers, and troubleshooting guide.

```bash
# Start the server first (in another terminal)
TRANSPORT=http npm start

# Run tests
npm test
```

## Annabelle Integration

Auto-discovered via the `annabelle` field in `package.json`:

```json
{
  "mcpName": "searcher",
  "transport": "http",
  "sensitive": false,
  "httpPort": 8007
}
```

The Orchestrator connects over HTTP and proxies `web_search` / `news_search` to downstream consumers.
