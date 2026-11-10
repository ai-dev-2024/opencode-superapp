# Contributing

Thanks for helping grow the kit! A new MCP server is a great first PR.

## Adding a server (checklist)

1. **Research the official transport.** Prefer the maintainer's own package/image.
   Local = `command[]` (npx / uvx / docker). Remote = `url` (+ `headers` or `oauth`).
2. **Add one entry to `registry.json`** — `id` (kebab-case, matches the `mcp` key),
   `title`, `description`, `type`, `category`, `stacks`, `command` **or** `url`,
   `envVars` (never real secrets), `install` one-liner, `toolsPrefix`.
3. **Add `templates/<id>.json`** — a minimal `{ "$schema", "mcp": { "<id>": … } }`
   snippet. Secrets only as `{env:VAR}` placeholders. Key-based remotes get
   `"oauth": false`; OAuth remotes get `"oauth": {}`.
4. **Join at least one stack** in `stacks/*.json` (or justify a new stack).
5. **Run `npm run validate && npm test`** — both must pass. The validator checks
   `registry.json` against `schema/registry.schema.json` and measures counts from the
   files, so there is no hardcoded count to bump.
6. Regenerate `registry.md` with `npm run gen:registry` (never edit it by hand), and update
   the `README.md` counts and `docs/STACKS.md` if they changed. The tests fail if they did
   and you did not.

## Rules

- No API keys, tokens, or personal paths in any committed file. CI greps for common
  secret patterns; the validator rejects obvious literals.
- Pin versions (`pkg@x.y.z`) when `latest` is known-flaky; otherwise `latest` is fine.
- One concern per PR. Small diffs get reviewed fast.

## Local dev

```bash
npm run validate          # schema + cross-file consistency
npm test                  # unit + CLI smoke tests (node:test, no dependencies)
node scripts/mcp-manager.mjs list
node scripts/mcp-manager.mjs stack superapp --config ./test-opencode.json
```
