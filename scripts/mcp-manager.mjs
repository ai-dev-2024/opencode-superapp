// mcp-manager.mjs — zero-dependency searchable installer for the starter kit.
// Usage:
//   node scripts/mcp-manager.mjs list [--stack <name>] [--type local|remote] [--json]
//   node scripts/mcp-manager.mjs search <query>
//   node scripts/mcp-manager.mjs add <id...> [--config <path> | --global] [--force] [--dry-run]
//   node scripts/mcp-manager.mjs stack <name> [--config <path> | --global] [--force] [--dry-run]
//
// Config rule: your config wins. Only servers that are not in it yet are added. A server
//   that is already there is kept as it is unless you pass --force. No other key is touched,
//   and an existing file is edited in place: comments, formatting and key order survive.
// Write rule: the old file is copied to <file>.bak first (never over an earlier backup), then
//   replaced atomically. See scripts/lib/config-io.mjs.
// Env rule: NEVER writes secret values — only `{env:VAR}` placeholders + prints export hints.
// Failures are one "error: ..." line (exit 1) and never quote the config file's contents.
import { homedir } from "node:os";
import { UserError } from "./lib/errors.mjs";
import { resolveTarget, readTarget, writeAtomic } from "./lib/config-io.mjs";
import { JsoncError, parseJsonc, editMcpServers } from "./lib/jsonc.mjs";
import {
  CONFIG_SCHEMA_URL, loadRegistry, loadTemplate, listStacks, stackIds, searchRegistry, missingEnvFor, mergeServers, parseArgs,
  sameJson,
} from "./lib/registry.mjs";

const WRITE_OPTIONS = { "--config": "value", "--global": "flag", "--force": "flag", "--dry-run": "flag" };

function usage(stacks) {
  return `opencode MCP manager

  list [--stack NAME] [--type local|remote] [--json]
  search <query>
  add <id...> [--config ./opencode.json | --global] [--force] [--dry-run]
  stack <name> [--config ./opencode.json | --global] [--force] [--dry-run]

Servers already in your config are kept as they are; --force replaces them.

Stacks: ${stacks.join(", ")}
Example: node scripts/mcp-manager.mjs stack superapp
         node scripts/mcp-manager.mjs search postgres
         node scripts/mcp-manager.mjs add github sentry context7 --global`;
}

// Parse an existing config. An empty file is treated as a config with nothing in it.
function parseConfig(dest, target) {
  if (!target.exists || target.text.replace(/^\uFEFF/, "").trim() === "") return { blank: true, config: {} };
  try { return { blank: false, config: parseJsonc(target.text) }; } catch (e) {
    if (!(e instanceof JsoncError)) throw e;
    // Position only. The parser's message never quotes the file, which may hold secrets.
    throw new UserError(`${dest} is not valid JSON or JSONC (${e.message}); nothing was changed`);
  }
}

// The new file contents. A missing or empty file gets a fresh document; an existing one is
// edited in place, then re-parsed to prove the edit produced exactly the intended config.
function renderConfig(dest, target, blank, merged, entries) {
  if (blank) return JSON.stringify({ $schema: CONFIG_SCHEMA_URL, ...merged.config }, null, 2) + "\n";
  const pick = (ids) => Object.fromEntries(ids.map((id) => [id, entries[id]]));
  const text = editMcpServers(target.text, { add: pick(merged.added), replace: pick(merged.overwritten) });
  let ok = false;
  try { ok = sameJson(parseJsonc(text), merged.config); } catch { ok = false; }
  if (!ok) throw new UserError(`could not edit ${dest} safely (internal check failed); nothing was changed. Add the servers by hand from templates/<id>.json`);
  return text;
}

function list(registry, stacks, args) {
  const { opts, positionals } = parseArgs(args, { "--stack": "value", "--type": "value", "--json": "flag" });
  if (positionals.length) throw new UserError(`list takes no arguments (got '${positionals[0]}')`);
  const stack = opts["--stack"], type = opts["--type"];
  let rows = registry;
  if (stack) {
    const members = stackIds(stack);
    if (!members) throw new UserError(`Unknown stack '${stack}'. Available: ${stacks.join(", ")}`);
    rows = rows.filter((r) => members.includes(r.id));
  }
  if (type) {
    if (!["local", "remote"].includes(type)) throw new UserError(`--type must be 'local' or 'remote' (got '${type}')`);
    rows = rows.filter((r) => r.type === type);
  }
  if (opts["--json"]) { console.log(JSON.stringify(rows, null, 2)); return 0; }
  console.log(`\n${rows.length} MCP servers${stack ? ` in stack '${stack}'` : ""}${type ? ` [${type}]` : ""}:\n`);
  for (const r of rows) console.log(`  ${(r.id).padEnd(22)} [${r.type.padEnd(6)}] ${(r.stacks || []).join(",").padEnd(28)} ${r.title} — ${r.description.slice(0, 80)}`);
  console.log(`\nTip: node scripts/mcp-manager.mjs search <query>`);
  return 0;
}

function search(registry, args) {
  const { positionals } = parseArgs(args);
  const q = positionals.join(" ");
  if (!q) throw new UserError("Usage: search <query>  (e.g. search postgres)");
  const hits = searchRegistry(registry, q);
  if (!hits.length) { console.log(`No matches for '${q}'. Try: node scripts/mcp-manager.mjs list`); return 0; }
  for (const r of hits) {
    console.log(`\n== ${r.id} [${r.type}] ==`);
    console.log(`   ${r.title} — ${r.description}`);
    console.log(`   stacks: ${(r.stacks || []).join(", ")} | install: ${r.install}`);
    if (r.type === "remote") console.log(`   url: ${r.url}`);
    else console.log(`   command: ${(r.command || []).join(" ")}`);
    const req = (r.envVars || []).filter((v) => v.required).map((v) => v.name).join(", ");
    if (req) console.log(`   required env: ${req}`);
  }
  console.log(`\nAdd one: node scripts/mcp-manager.mjs add <id> [--global]`);
  return 0;
}

function install(registry, stacks, cmd, args) {
  const { opts, positionals } = parseArgs(args, WRITE_OPTIONS);
  let ids;
  if (cmd === "add") {
    ids = [...new Set(positionals)];
    if (!ids.length) throw new UserError("Usage: add <id...>  (e.g. add github postgres context7)");
  } else {
    if (positionals.length !== 1) throw new UserError(`Usage: stack <name>  (${stacks.join("|")})`);
    const name = positionals[0];
    ids = stackIds(name);
    if (!ids) throw new UserError(`Unknown stack '${name}'. Available: ${stacks.join(", ")}`);
    console.log(`Stack '${name}' expands to: ${ids.join(", ")}`);
  }
  for (const id of ids) if (!registry.some((r) => r.id === id)) throw new UserError(`Unknown id '${id}'. Run list/search first.`);

  const dest = resolveTarget(opts, { cwd: process.cwd(), env: process.env, home: homedir() });
  const entries = Object.fromEntries(ids.map((id) => [id, loadTemplate(id).mcp[id]]));
  const target = readTarget(dest);
  const { blank, config } = parseConfig(dest, target);
  let merged;
  try { merged = mergeServers(config, entries, { force: Boolean(opts["--force"]) }); } catch (e) {
    if (e instanceof UserError) throw new UserError(`${dest}: ${e.message}; nothing was changed`);
    throw e;
  }
  const { added, unchanged, kept, overwritten } = merged;
  for (const id of unchanged) console.log(`= '${id}' is already in ${dest}`);
  for (const id of kept) console.log(`= keep your '${id}' in ${dest} (it differs from the template; --force replaces it)`);
  for (const id of overwritten) console.log(`~ replace '${id}' in ${dest}`);
  for (const id of added) console.log(`+ add '${id}' -> ${dest}`);

  if (!added.length && !overwritten.length) console.log(`\nNothing to change in ${dest}`);
  else if (opts["--dry-run"]) console.log(`\nDry run: nothing written to ${dest}`);
  else {
    // "$schema" is only set on a file this command creates, never added to an existing one.
    const { backup } = writeAtomic(target, renderConfig(dest, target, blank, merged, entries));
    console.log(`\nWrote ${dest}`);
    if (backup) console.log(`Backup of the previous version: ${backup}`);
  }

  const missing = missingEnvFor(registry, ids);
  if (missing.length) {
    console.log("\nRequired environment variables (values NOT written to config — set them in your shell):");
    const isWin = process.platform === "win32";
    for (const [k, d] of missing) {
      console.log(`  - ${k}  # ${d}`);
      console.log(isWin ? `    $env:${k}="..."` : `    export ${k}="..."`);
    }
    console.log("\nOpenCode resolves them via \"{env:VAR}\" placeholders (see docs/TROUBLESHOOTING.md).");
  }
  const oauthIds = ids.filter((id) => { const e = registry.find((r) => r.id === id); return e?.type === "remote" && e?.oauth !== false && "oauth" in e; });
  if (oauthIds.length) console.log(`\nOAuth next step:\n  ${oauthIds.map((id) => `opencode mcp auth ${id}`).join("\n  ")}`);
  console.log("\nVerify: opencode mcp list");
  return 0;
}

// Returns the exit code. Never calls process.exit(): exiting straight after writing to a
// pipe truncates the output at 64 KB.
function main(argv) {
  const registry = loadRegistry();
  const stacks = listStacks();
  const [cmd, ...rest] = argv;
  if (!cmd || ["help", "--help", "-h"].includes(cmd)) { console.log(usage(stacks)); return cmd ? 0 : 1; }
  if (cmd === "list") return list(registry, stacks, rest);
  if (cmd === "search") return search(registry, rest);
  if (cmd === "add" || cmd === "stack") return install(registry, stacks, cmd, rest);
  throw new UserError(`Unknown command '${cmd}'.\n\n${usage(stacks)}`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UserError) console.error(`error: ${e.message}`);
  else if (process.env.DEBUG) console.error(e.stack);
  else console.error(`error: unexpected failure (${e.name}). Re-run with DEBUG=1 for details.`);
  process.exitCode = 1;
}
