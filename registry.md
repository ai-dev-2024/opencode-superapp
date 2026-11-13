# Registry — 50 MCP servers

<!-- Generated from registry.json by scripts/gen-registry-md.mjs. Do not edit by hand: run `npm run gen:registry`. -->

Search: Ctrl+F this file, or run `node scripts/mcp-manager.mjs search <query>`. Templates: `templates/<id>.json`.

| # | ID | Type | Title | Stacks | Secrets | Install |
|---|---|---|---|---|---|---|
| 1 | `filesystem` | local | Filesystem | web-dev, superapp | — | `npx -y @modelcontextprotocol/server-filesystem` |
| 2 | `git` | local | Git | web-dev | — | `uvx mcp-server-git` |
| 3 | `github` | local | GitHub | web-dev, devops | GITHUB_PERSONAL_ACCESS_TOKEN | `docker pull ghcr.io/github/github-mcp-server` |
| 4 | `gitlab` | local | GitLab | devops | GITLAB_PERSONAL_ACCESS_TOKEN | `npx -y @modelcontextprotocol/server-gitlab` |
| 5 | `postgres` | local | PostgreSQL | data-analysis | POSTGRES_CONNECTION_STRING | `npx -y @modelcontextprotocol/server-postgres` |
| 6 | `sqlite` | local | SQLite | data-analysis | SQLITE_DB_PATH | `uvx mcp-server-sqlite` |
| 7 | `mysql` | local | MySQL / MariaDB | data-analysis | MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE | `npx -y @benborla29/mcp-server-mysql` |
| 8 | `mongodb` | local | MongoDB | data-analysis | MONGODB_URI | `npx -y mongodb-mcp-server` |
| 9 | `redis` | local | Redis | data-analysis | REDIS_URL | `npx -y @gongrzhe/server-redis-mcp` |
| 10 | `supabase` | local | Supabase | data-analysis, web-dev | SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF | `npx -y @supabase/mcp-server-supabase@latest` |
| 11 | `prisma` | remote | Prisma Postgres | data-analysis | OAuth | (remote — `opencode mcp auth prisma`) |
| 12 | `neon` | remote | Neon Postgres | data-analysis | NEON_API_KEY | `(remote — no install)` |
| 13 | `playwright` | local | Playwright | web-dev, testing, superapp | — | `npx -y @playwright/mcp@latest --install` |
| 14 | `puppeteer` | local | Puppeteer | web-dev, testing | — | `npx -y @modelcontextprotocol/server-puppeteer` |
| 15 | `chrome-devtools` | local | Chrome DevTools | web-dev, testing | — | `npx -y chrome-devtools-mcp@latest` |
| 16 | `sentry` | remote | Sentry | devops | OAuth | (remote — no install; run `opencode mcp auth sentry`) |
| 17 | `context7` | remote | Context7 | web-dev, ai-search, superapp | — | `(remote — no install)` |
| 18 | `gh_grep` | remote | Grep by Vercel | web-dev, ai-search, superapp | — | `(remote — no install)` |
| 19 | `brave-search` | local | Brave Search | ai-search | BRAVE_API_KEY | `npx -y @modelcontextprotocol/server-brave-search` |
| 20 | `tavily` | local | Tavily Search | ai-search | TAVILY_API_KEY | `npx -y tavily-mcp@latest` |
| 21 | `exa` | remote | Exa Search | ai-search | EXA_API_KEY | `(remote — no install)` |
| 22 | `firecrawl` | remote | Firecrawl | ai-search, testing | FIRECRAWL_API_KEY | `(remote — no install)` |
| 23 | `fetch` | local | Fetch | web-dev, ai-search, superapp, testing | — | `uvx mcp-server-fetch` |
| 24 | `memory` | local | Memory (KG) | data-analysis, ai-search, superapp | — | `npx -y @modelcontextprotocol/server-memory` |
| 25 | `sequential-thinking` | local | Sequential Thinking | data-analysis, ai-search, superapp | — | `npx -y @modelcontextprotocol/server-sequential-thinking` |
| 26 | `time` | local | Time | productivity, superapp, testing | — | `uvx mcp-server-time` |
| 27 | `everything` | local | Everything (test) | testing | — | `npx -y @modelcontextprotocol/server-everything` |
| 28 | `slack` | local | Slack | productivity | SLACK_BOT_TOKEN, SLACK_TEAM_ID | `npx -y @zencoderai/slack-mcp-server` |
| 29 | `discord` | local | Discord | productivity | DISCORD_TOKEN | `npx -y mcp-discord` |
| 30 | `linear` | remote | Linear | productivity | OAuth | (remote — `opencode mcp auth linear`) |
| 31 | `notion` | local | Notion | productivity | NOTION_API_KEY | `npx -y @notionhq/notion-mcp-server` |
| 32 | `figma` | remote | Figma | web-dev | OAuth | (remote — `opencode mcp auth figma`) |
| 33 | `stripe` | remote | Stripe | — | OAuth | (remote — `opencode mcp auth stripe`) |
| 34 | `vercel` | remote | Vercel | web-dev | OAuth | (remote — `opencode mcp auth vercel`) |
| 35 | `netlify` | local | Netlify | web-dev | NETLIFY_AUTH_TOKEN | `npx -y @netlify/mcp` |
| 36 | `cloudflare` | local | Cloudflare | devops | CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID | `npx -y @cloudflare/mcp-server-cloudflare@latest run <account-id>` |
| 37 | `aws-docs` | local | AWS Docs | devops | — | `uvx awslabs.aws-documentation-mcp-server@latest` |
| 38 | `azure` | local | Azure | devops | — | `npx -y @azure/mcp@latest server start` |
| 39 | `docker` | local | Docker | devops | — | `uvx mcp-server-docker` |
| 40 | `kubernetes` | local | Kubernetes | devops | — | `npx -y mcp-server-kubernetes` |
| 41 | `terraform` | local | Terraform | devops | — | `docker pull hashicorp/terraform-mcp-server` |
| 42 | `digitalocean` | local | DigitalOcean | devops | DIGITALOCEAN_API_TOKEN | `npx -y @digitalocean/mcp --services apps,droplets,databases` |
| 43 | `grafana` | local | Grafana | devops | GRAFANA_URL, GRAFANA_API_KEY | `docker pull grafana/mcp-grafana:latest` |
| 44 | `datadog` | remote | Datadog | devops | DD_API_KEY, DD_APP_KEY | `(remote — no install)` |
| 45 | `atlassian-jira` | remote | Jira | productivity | OAuth | (remote — `opencode mcp auth atlassian-jira`) |
| 46 | `atlassian-confluence` | remote | Confluence | productivity | OAuth | (remote — `opencode mcp auth atlassian-confluence`) |
| 47 | `google-drive` | local | Google Drive | productivity | GDRIVE_OAUTH_PATH, GDRIVE_CREDS_PATH | `npx -y @modelcontextprotocol/server-gdrive` |
| 48 | `obsidian` | local | Obsidian | productivity | OBSIDIAN_VAULT_PATH | `npx -y mcp-obsidian` |
| 49 | `shadcn` | local | shadcn/ui | web-dev | — | `npx -y shadcn@latest mcp` |
| 50 | `youtube-transcript` | local | YouTube Transcript | ai-search | — | `uvx mcp-youtube-transcript` |

## Notes

- **filesystem** (local) — Secure scoped file read/write, search and directory listing. The safest default local MCP.  
  `npx -y @modelcontextprotocol/server-filesystem .` — template `templates/filesystem.json`
- **git** (local) — Branch, diff, log, status and commit operations on a local repo.  
  `uvx mcp-server-git` — template `templates/git.json`
- **github** (local) — Repos, issues, PRs, reviews, CI runs. Highest-token server — enable per-agent.  
  `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server` — template `templates/github.json`
- **gitlab** (local) — Projects, MRs, pipelines and issues for GitLab.com / self-hosted.  
  `npx -y @modelcontextprotocol/server-gitlab` — template `templates/gitlab.json`
- **postgres** (local) — Run read-only SQL, inspect schema, explain queries.  
  `npx -y @modelcontextprotocol/server-postgres {env:POSTGRES_CONNECTION_STRING}` — template `templates/postgres.json`
- **sqlite** (local) — Local .sqlite/.db querying without a server. Great for prototypes.  
  `uvx mcp-server-sqlite --db-path {env:SQLITE_DB_PATH}` — template `templates/sqlite.json`
- **mysql** (local) — Schema inspection and SELECT queries against MySQL.  
  `npx -y @benborla29/mcp-server-mysql` — template `templates/mysql.json`
- **mongodb** (local) — List collections, run aggregations, sample documents.  
  `npx -y mongodb-mcp-server --connectionString {env:MONGODB_URI}` — template `templates/mongodb.json`
- **redis** (local) — Inspect keys, read values, check memory and slowlog.  
  `npx -y @gongrzhe/server-redis-mcp {env:REDIS_URL}` — template `templates/redis.json`
- **supabase** (local) — Manage Postgres, auth, storage and edge functions via Supabase API.  
  `npx -y @supabase/mcp-server-supabase@latest --read-only --project-ref={env:SUPABASE_PROJECT_REF}` — template `templates/supabase.json`
- **prisma** (remote) — Prisma-managed Postgres: migrate, query and inspect via Prisma's hosted MCP. OAuth remote.  
  `https://mcp.prisma.io/mcp` — template `templates/prisma.json`
- **neon** (remote) — Serverless Postgres branches, branching and SQL via Neon remote MCP.  
  `https://mcp.neon.tech/mcp` — template `templates/neon.json`
- **playwright** (local) — Headless browser automation: navigate, click, fill, screenshot, a11y snapshot.  
  `npx -y @playwright/mcp@latest` — template `templates/playwright.json`
- **puppeteer** (local) — Lightweight Chrome automation fallback when Playwright is too heavy.  
  `npx -y @modelcontextprotocol/server-puppeteer` — template `templates/puppeteer.json`
- **chrome-devtools** (local) — Official Chrome DevTools MCP: performance traces, network, console.  
  `npx -y chrome-devtools-mcp@latest` — template `templates/chrome-devtools.json`
- **sentry** (remote) — Query issues, releases, traces. OAuth remote — `opencode mcp auth sentry`.  
  `https://mcp.sentry.dev/mcp` — template `templates/sentry.json`
- **context7** (remote) — Up-to-date library docs lookup. Add `use context7` to prompts.  
  `https://mcp.context7.com/mcp` — template `templates/context7.json`
- **gh_grep** (remote) — Regex search across millions of public GitHub repos.  
  `https://mcp.grep.app` — template `templates/gh_grep.json`
- **brave-search** (local) — Web + local search with rate-limit friendly API.  
  `npx -y @modelcontextprotocol/server-brave-search` — template `templates/brave-search.json`
- **tavily** (local) — Answer-engine search + extract, tuned for RAG.  
  `npx -y tavily-mcp@latest` — template `templates/tavily.json`
- **exa** (remote) — Neural web search + crawl. Remote with API-key header.  
  `https://mcp.exa.ai/mcp` — template `templates/exa.json`
- **firecrawl** (remote) — Scrape, crawl and extract JS-rendered pages to markdown.  
  `https://mcp.firecrawl.dev/mcp` — template `templates/firecrawl.json`
- **fetch** (local) — Minimal URL -> markdown fetcher. No key, tiny context footprint.  
  `uvx mcp-server-fetch` — template `templates/fetch.json`
- **memory** (local) — Persistent knowledge-graph memory across sessions.  
  `npx -y @modelcontextprotocol/server-memory` — template `templates/memory.json`
- **sequential-thinking** (local) — Structured step-by-step reasoning tool. Zero config.  
  `npx -y @modelcontextprotocol/server-sequential-thinking` — template `templates/sequential-thinking.json`
- **time** (local) — Timezone-aware now/convert. Fixes 'what time is it' bugs.  
  `uvx mcp-server-time` — template `templates/time.json`
- **everything** (local) — Reference/test server (add, echo, prompts). Use to debug MCP wiring.  
  `npx -y @modelcontextprotocol/server-everything` — template `templates/everything.json`
- **slack** (local) — Read/post messages, threads, channels.  
  `npx -y @zencoderai/slack-mcp-server` — template `templates/slack.json`
- **discord** (local) — Read/send channel messages, threads.  
  `npx -y mcp-discord` — template `templates/discord.json`
- **linear** (remote) — Issues, cycles, projects. OAuth remote.  
  `https://mcp.linear.app/mcp` — template `templates/linear.json`
- **notion** (local) — Pages, databases, comments via official Notion MCP.  
  `npx -y @notionhq/notion-mcp-server` — template `templates/notion.json`
- **figma** (remote) — Read designs, variables, components (Dev Mode). OAuth remote.  
  `https://mcp.figma.com/mcp` — template `templates/figma.json`
- **stripe** (remote) — Products, prices, invoices, payment links via Stripe's hosted MCP. OAuth remote.  
  `https://mcp.stripe.com` — template `templates/stripe.json`
- **vercel** (remote) — Deployments, domains, logs. OAuth remote.  
  `https://mcp.vercel.com` — template `templates/vercel.json`
- **netlify** (local) — Sites, deploys, env vars, forms.  
  `npx -y @netlify/mcp` — template `templates/netlify.json`
- **cloudflare** (local) — Workers, KV, R2, DNS, Pages bindings.  
  `npx -y @cloudflare/mcp-server-cloudflare@latest run {env:CLOUDFLARE_ACCOUNT_ID}` — template `templates/cloudflare.json`
- **aws-docs** (local) — Official AWS documentation + CFN guidance (awslabs, uvx).  
  `uvx awslabs.aws-documentation-mcp-server@latest` — template `templates/aws-docs.json`
- **azure** (local) — Official Azure MCP: azd, resources, logs.  
  `npx -y @azure/mcp@latest server start` — template `templates/azure.json`
- **docker** (local) — Containers, images, volumes, compose (socket-mounted).  
  `uvx mcp-server-docker` — template `templates/docker.json`
- **kubernetes** (local) — Pods, deploys, logs, exec via current kubeconfig.  
  `npx -y mcp-server-kubernetes` — template `templates/kubernetes.json`
- **terraform** (local) — Official HashiCorp registry docs + provider lookup (Docker).  
  `docker run -i --rm hashicorp/terraform-mcp-server` — template `templates/terraform.json`
- **digitalocean** (local) — Droplets, apps, databases via the official DigitalOcean MCP server.  
  `npx -y @digitalocean/mcp --services apps,droplets,databases` — template `templates/digitalocean.json`
- **grafana** (local) — Dashboards, datasources, incidents, alerts.  
  `docker run -i --rm -e GRAFANA_URL -e GRAFANA_API_KEY grafana/mcp-grafana:latest -t stdio` — template `templates/grafana.json`
- **datadog** (remote) — Monitors, logs, APM lookup (API-key header, OAuth disabled).  
  `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp` — template `templates/datadog.json`
- **atlassian-jira** (remote) — Atlassian Rovo MCP: search/create/transition Jira issues (OAuth).  
  `https://mcp.atlassian.com/v1/sse` — template `templates/atlassian-jira.json`
- **atlassian-confluence** (remote) — Same Atlassian host as Jira; search/read/update pages (OAuth).  
  `https://mcp.atlassian.com/v1/sse` — template `templates/atlassian-confluence.json`
- **google-drive** (local) — Docs, sheets, drive search via OAuth credentials file.  
  `npx -y @modelcontextprotocol/server-gdrive` — template `templates/google-drive.json`
- **obsidian** (local) — Read/append markdown notes in a vault directory.  
  `npx -y mcp-obsidian {env:OBSIDIAN_VAULT_PATH}` — template `templates/obsidian.json`
- **shadcn** (local) — Registry-aware component scaffolding for React + Tailwind.  
  `npx -y shadcn@latest mcp` — template `templates/shadcn.json`
- **youtube-transcript** (local) — Fetch captions/transcripts for summarization (uvx, Python).  
  `uvx mcp-youtube-transcript` — template `templates/youtube-transcript.json`
