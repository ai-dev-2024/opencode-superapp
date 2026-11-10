# Troubleshooting: dependency conflicts & environment-variable injection

This guide covers the two failure modes that cause ~90% of OpenCode MCP issues:
**runtimes colliding** (npx / uvx / docker) and **secrets wired into the wrong place**
(`environment` vs `headers`, local vs remote).

Config reference: OpenCode merges `~/.config/opencode/opencode.json` (global) with
`./opencode.json` (project). Project wins on conflicting keys; non-conflicting
keys merge. Validate any edit with `node scripts/validate.mjs` and `opencode mcp list`.

---

## 1. Local vs remote — which shape to use

|  | `type: "local"` | `type: "remote"` |
|---|---|---|
| Starts | OpenCode spawns `command[]` (stdio) on your machine | OpenCode POSTs to `url` (Streamable HTTP / SSE) |
| Secrets go in | `environment: { KEY: "{env:KEY}" }` | `headers: { Name: "Bearer {env:KEY}" }` |
| OAuth | not applicable | `oauth: {}` (auto) or `oauth: false` (API-key only) |
| Needs installed | Node 18+, Python 3.10+, Docker, or `uvx` | nothing (network only) |
| Template example | `templates/filesystem.json`, `templates/postgres.json` | `templates/sentry.json`, `templates/context7.json` |

Minimal local (`templates/fetch.json` pattern):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "fetch": { "type": "local", "command": ["uvx", "mcp-server-fetch"], "enabled": true }
  }
}
```

Minimal remote with optional key (`templates/context7.json` pattern):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "headers": { "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}" },
      "oauth": false
    }
  }
}
```

Minimal remote with OAuth (`templates/sentry.json` pattern):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sentry": { "type": "remote", "url": "https://mcp.sentry.dev/mcp", "oauth": {} }
  }
}
```

Then: `opencode mcp auth sentry` → `opencode mcp list` should show `authenticated`.

---

## 2. Environment-variable injection rules

OpenCode substitutes **`{env:VAR}` anywhere in `opencode.json`** — model names,
provider keys, `mcp[].environment`, `mcp[].headers`, `oauth.clientId/Secret`.
Unset vars become `""` (silent!). `{file:path}` inlines a file (good for
`~/.secrets/key`); relative paths resolve from the config file's directory.

### DO

```json
"environment": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_PERSONAL_ACCESS_TOKEN}" },
"headers": { "Authorization": "Bearer {env:EXA_API_KEY}" }
```

```bash
# bash/zsh
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
export POSTGRES_CONNECTION_STRING="postgresql://user:pass@localhost:5432/db"
```

```powershell
# PowerShell (current session)
$env:GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
$env:POSTGRES_CONNECTION_STRING="postgresql://user:pass@localhost:5432/db"
# persist for future shells:
# [System.Environment]::SetEnvironmentVariable("GITHUB_PERSONAL_ACCESS_TOKEN","ghp_...","User")
```

### DO NOT

- Commit real tokens into `opencode.json` / `.env` files that get pushed.
- Put secrets in `command[]` args as literals — use `{env:}` so `ps` output stays clean.
- Confuse the two maps: `environment` is **ignored** on remote servers;
  `headers` is **ignored** on local servers. Symptom: 401 on remote, or
  `KEY is not set` from a local process.
- Rely on shell `$VAR` expansion inside JSON — OpenCode only understands
  `{env:VAR}`, not `$VAR` / `%VAR%`.

### Per-server cheat sheet

| Server | Where | Example |
|---|---|---|
| `github` (local docker) | `environment.GITHUB_PERSONAL_ACCESS_TOKEN` + docker `-e` passthrough | see `templates/github.json` |
| `postgres` (local npx) | arg **and** `environment.POSTGRES_CONNECTION_STRING` | `postgresql://…` |
| `notion` (local) | `environment.OPENAPI_MCP_HEADERS` embeds `{env:NOTION_API_KEY}` | share pages with the integration first |
| `context7` (remote, optional key) | `headers.CONTEXT7_API_KEY` + `"oauth": false` | works keyless at low limits |
| `exa` / `firecrawl` / `neon` (remote, required key) | `headers.Authorization: "Bearer {env:X}"` + `"oauth": false` | 401 = unset var |
| `sentry` / `linear` / `figma` / `vercel` (remote OAuth) | `"oauth": {}` and **no** `headers` | `opencode mcp auth <name>` |
| `datadog` (remote, key — not OAuth) | `headers.DD-API-KEY` + `DD-APPLICATION-KEY`, `"oauth": false` | omitting `oauth:false` triggers a bogus browser flow |

Debug sequence for 401s: `echo $VAR` (is it set?) → `opencode mcp list` →
`opencode mcp debug <name>` → `opencode mcp logout <name> && opencode mcp auth <name>`.

---

## 3. Dependency conflicts (npx vs uvx vs docker)

Each local server needs **exactly one** runtime. Pin versions and isolate:

1. **Node servers (`npx -y …`)** need Node ≥ 18. `npx -y` auto-downloads; concurrent
   first-runs can corrupt the npm cache — pre-warm with `npm exec --yes <pkg> -- --help`.
   Pin: `npx @playwright/mcp@1.52.0` instead of `@latest` when a team shares a config.
2. **Python servers (`uvx …`)** need Python ≥ 3.10 and `uv` (`pip install uv` /
   `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`). If `uvx` is missing,
   `git`, `sqlite`, `docker`, `aws-docs`, `youtube-transcript` all fail with ENOENT.
   Fix: install uv, then `uvx mcp-server-git --help` once to warm the venv cache.
3. **Docker servers (`github`, `terraform`, `grafana`)** need a running daemon and
   the image pulled (`docker pull ghcr.io/github/github-mcp-server`). On Windows use
   WSL2 backend; `docker run -i --rm` must be non-interactive — never add `-it`.
4. **Never mix runtimes for one id.** If `playwright` flakes, don't add `puppeteer`
   *and* `chrome-devtools` globally — pick one per agent (see §4) to halve context.
5. **Timeouts:** default tool fetch is 5000 ms. Cold `npx`/`uvx` first starts exceed
   it. Either warm the cache or set `"timeout": 30000` on that server entry.
6. **`cwd`:** relative `cwd` resolves from the workspace root. Set it for
   `filesystem`/`git` when the repo isn't the OpenCode cwd.

Quick triage matrix:

| Symptom | Likely cause | Fix |
|---|---|---|
| `spawn npx ENOENT` | Node not on PATH in GUI-launched OpenCode | launch from terminal / set `shell` in config |
| `spawn uvx ENOENT` | uv not installed | install uv, warm `uvx <pkg> --help` |
| `docker: command not found` / pipe error | daemon down | start Docker Desktop / Colima |
| MCP times out on first run only | cold cache + 5 s default | `"timeout": 30000`, warm cache |
| 401 on remote | unset `{env:}` var or missing `oauth:false` | export var; set `oauth:false` for key-based remotes |
| Browser opens unexpectedly on key-based remote | OAuth auto-detect | add `"oauth": false` |
| `EADDRINUSE` / port clash | two local servers fixed to same port | run one, or override its `PORT` env in `environment` |

---

## 4. Context bloat & tool-name collisions

Every enabled MCP donates all its tools to the model context. `github` alone can
blow the budget. Pattern (see `opencode.example.json`):

```json
{ "tools": { "github_*": false }, "agent": { "dev": { "tools": { "github_*": true } } } }
```

i.e. disable heavy servers globally, opt in per-agent. `*` matches any suffix;
MCP tools are always `<server>_<tool>`. Keep ≤ 8 enabled servers per session;
prefer the small keyless `fetch`/`time` servers over heavier equivalents for trivial tasks.

## 5. Windows notes

- Prefer `npx`/`uvx` on PATH over `cmd /c` wrappers in `command[]`.
- Quote URLs with `&`/`?` — JSON strings are fine, but PowerShell `--add` args need quotes.
- `GDRIVE_CREDS_PATH` / `SQLITE_DB_PATH` / `OBSIDIAN_VAULT_PATH` must be absolute
  Windows paths with escaped backslashes (`C:\\notes\\vault`).
