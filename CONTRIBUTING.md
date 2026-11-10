# Contributing

Thanks for helping grow the kit! A new MCP server is a great first PR.

## Adding a server (checklist)

1. **Research the official transport.** Prefer the maintainer's own package/image.
   Local = `command[]` (npx / uvx / docker). Remote = `url` (+ `headers` or `oauth`).
2. **Add one entry to `registry.json`** — `id` (kebab-case, matches the `mcp` key),
   `title`, `description`, `type`, `category`, `stacks`, `command` **or** `url`,
   `envVars` (never real secrets), `install` one-liner, and `toolsPrefix`, which must be
   `<id>_*` because that is how OpenCode names a server's tools. Every `{env:VAR}` you use
   must be declared in `envVars`, and every declared variable must be used.
3. **Add `templates/<id>.json`** — a minimal `{ "$schema", "mcp": { "<id>": … } }`
   snippet holding exactly what the registry entry describes. Secrets only as `{env:VAR}`
   placeholders (OpenCode does not expand `${VAR}` or `$VAR`). Key-based remotes get
   `"oauth": false`; OAuth remotes get `"oauth": {}`.
4. **Add it to a stack** in `stacks/*.json` if it belongs in one, with an entry identical to
   the template, and list the same stack names in the registry entry's `stacks`.
5. **Run `npm run validate && npm test`** — both must pass. The validator checks
   `registry.json`, every template and every stack against the schemas in `schema/`, and
   that the three agree with each other. Then run `npm run check:upstream <id>` to confirm
   the package or endpoint really exists.
6. Regenerate `registry.md` with `npm run gen:registry` (never edit it by hand), and update
   the `README.md` counts and `docs/STACKS.md` if they changed. The tests fail if they did
   and you did not.

## Rules

- No API keys, tokens, or personal paths in any committed file. CI runs gitleaks over the
  full history, and the validator rejects literal credentials and token-shaped strings.
- Pin versions (`pkg@x.y.z`) when `latest` is known-flaky; otherwise `latest` is fine.
- One concern per PR. Small diffs get reviewed fast.

## Local dev

```bash
npm run validate          # schemas + cross-file consistency + secret scan
npm test                  # unit, CLI and installer tests (node:test, no dependencies)
npm run gen:registry      # regenerate registry.md after editing registry.json
npm run check:upstream    # network: packages and endpoints still exist
node scripts/mcp-manager.mjs list
node scripts/mcp-manager.mjs stack superapp --config ./test-opencode.json
```
