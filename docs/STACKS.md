# Stacks

Pre-composed `opencode.json` fragments in `stacks/`. Each file is a complete
`{ "$schema", "mcp": { … } }` object — merge it with the installer, don't hand-edit.

| Stack file | Use when | Servers |
|---|---|---|
| `superapp.json` ⭐ | **start here** — zero-API-key essentials, the super-app loop | filesystem, memory, sequential-thinking, fetch, time, context7, gh_grep, playwright (8) |
| `web-dev.json` | full-stack web apps | filesystem, git, github, fetch, playwright, puppeteer, chrome-devtools, figma, vercel, netlify, shadcn, context7, gh_grep, supabase (14) |
| `data-analysis.json` | SQL/NoSQL + analysis | postgres, sqlite, mysql, mongodb, redis, supabase, prisma, neon, sequential-thinking, memory (10) |
| `devops.json` | containers, IaC, clouds, on-call | docker, kubernetes, terraform, aws-docs, azure, cloudflare, digitalocean, grafana, datadog, sentry, github, gitlab (12) |
| `ai-search.json` | ground answers in live docs/web | brave-search, tavily, exa, firecrawl, fetch, context7, gh_grep, sequential-thinking, memory, youtube-transcript (10) |
| `productivity.json` | tickets, docs, chat | slack, discord, linear, notion, atlassian-jira, atlassian-confluence, google-drive, obsidian, time (9) |
| `testing.json` | browser QA + perf | playwright, puppeteer, chrome-devtools, firecrawl, everything, time, fetch, agent-qa (8) |

[agent-qa](https://vostride.com) adds natural-language web and mobile QA with persistent memidex memory and validated self-improvement. It requires Node.js 24+, a configured agent-qa project, a compatible model and a browser/device environment; see the [official setup guide](https://vostride.com/docs/agent-qa/agent-quickstart). FSL-1.1-ALv2 applies, with model/device costs separate.

Install:

```bash
node scripts/mcp-manager.mjs stack superapp          # zero-key essentials -> ./opencode.json
node scripts/mcp-manager.mjs stack web-dev           # add a full stack on top
node scripts/mcp-manager.mjs stack devops --global   # ~/.config/opencode/opencode.json
```

Combine stacks by running the command twice — new servers are added, nothing is deleted.
If two stacks share an id (e.g. `github` in web-dev + devops) the one already in your
config stays, which is safe because every stack entry is identical to its template (the
validator checks this). A server you have customised is never replaced unless you pass
`--force`.

Keep sessions lean: after installing a stack, disable the heavy hitters globally
and re-enable per-agent (pattern in `opencode.example.json`):

```json
{ "tools": { "github_*": false }, "agent": { "dev": { "tools": { "github_*": true } } } }
```
