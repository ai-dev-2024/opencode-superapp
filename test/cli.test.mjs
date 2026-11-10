// Smoke tests: run the real CLIs as child processes against a temp config file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KIT, loadRegistry, loadTemplate, stackIds } from "../scripts/lib/registry.mjs";

const MANAGER = join(KIT, "scripts", "mcp-manager.mjs");
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const cli = (...args) => run(MANAGER, ...args);
// Same, with spawn options (cwd, env).
const cliWith = (options, ...args) => spawnSync(process.execPath, [MANAGER, ...args], { encoding: "utf8", ...options });

// Run `fn(dir)` in a fresh temp directory that is removed afterwards.
function inTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "superapp-cli-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
// A failed command: exit 1, a single "error:" line, and no stack trace.
function assertCleanFailure(r, pattern) {
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^error: /);
  assert.match(r.stderr, pattern);
  assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
}

test("--help prints usage and exits 0", () => {
  for (const flag of ["--help", "-h", "help"]) {
    const r = cli(flag);
    assert.equal(r.status, 0, flag);
    assert.match(r.stdout, /opencode MCP manager/);
    assert.match(r.stdout, /superapp/);
  }
});

test("no command or unknown command exits 1", () => {
  assert.equal(cli().status, 1);
  assertCleanFailure(cli("frobnicate"), /Unknown command 'frobnicate'/);
});

test("list --json returns the whole registry", () => {
  const r = cli("list", "--json");
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).length, loadRegistry().length);
});

test("list --stack uses the stack file and --type filters", () => {
  const rows = JSON.parse(cli("list", "--stack", "superapp", "--json").stdout);
  assert.deepEqual(rows.map((r) => r.id).sort(), stackIds("superapp").sort());
  const remote = JSON.parse(cli("list", "--type", "remote", "--json").stdout);
  assert.ok(remote.length > 0 && remote.every((r) => r.type === "remote"));
  assertCleanFailure(cli("list", "--stack", "nope"), /Unknown stack 'nope'/);
  assertCleanFailure(cli("list", "--type", "bogus"), /--type must be 'local' or 'remote'/);
  assertCleanFailure(cli("list", "--type"), /'--type' needs a value/);
  assertCleanFailure(cli("list", "--stack", "../templates/git"), /Unknown stack/);
});

test("search finds a server, joins multi-word queries, and requires a query", () => {
  const r = cli("search", "postgres");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /== postgres \[local\] ==/);
  assert.match(cli("search", "brave", "search").stdout, /== brave-search \[local\] ==/);
  assertCleanFailure(cli("search"), /Usage: search <query>/);
});

test("stack writes a config, merges with existing keys, and never writes secret values", () => {
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    writeFileSync(cfg, JSON.stringify({ model: "opencode/big-pickle", mcp: { mine: { type: "local", command: ["x"] } } }));
    const r = cli("stack", "superapp", "--config", cfg);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(readFileSync(cfg, "utf8"));
    assert.equal(out.model, "opencode/big-pickle");
    assert.ok(out.mcp.mine);
    for (const id of stackIds("superapp")) assert.ok(out.mcp[id], id);

    // a real-looking token in the environment must never reach the file or the output
    const token = "ghp_" + "z".repeat(36);
    const a = cliWith({ env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: token } }, "add", "github", "--config", cfg);
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /GITHUB_PERSONAL_ACCESS_TOKEN/);
    const after = readFileSync(cfg, "utf8");
    assert.match(after, /\{env:GITHUB_PERSONAL_ACCESS_TOKEN\}/);
    assert.ok(!after.includes(token) && !a.stdout.includes(token) && !a.stderr.includes(token));
  });
});

test("a fresh config gets $schema and exactly the template entries", () => {
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    const r = cli("stack", "superapp", "--config", cfg);
    assert.equal(r.status, 0, r.stderr);
    const expected = { $schema: "https://opencode.ai/config.json", mcp: Object.fromEntries(stackIds("superapp").map((id) => [id, loadTemplate(id).mcp[id]])) };
    assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")), expected);
    // the README quick start must install servers that can start: no shell placeholders
    assert.doesNotMatch(readFileSync(cfg, "utf8"), /\$\{/);
  });
});

test("add rejects unknown ids and unknown stacks without writing", () => {
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    assertCleanFailure(cli("add", "not-a-server", "--config", cfg), /Unknown id 'not-a-server'/);
    assertCleanFailure(cli("stack", "not-a-stack", "--config", cfg), /Unknown stack 'not-a-stack'/);
    assertCleanFailure(cli("stack", "../templates/git", "--config", cfg), /Unknown stack/);
    assertCleanFailure(cli("add", "--config", cfg), /Usage: add <id\.\.\.>/);
    assert.ok(!existsSync(cfg));
  });
});

test("a server the user already configured is kept; --force replaces it", () => {
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    const mine = { type: "local", enabled: false, command: ["my-wrapper", "github"], environment: { GITHUB_HOST: "ghe.corp" } };
    const original = JSON.stringify({ $schema: "./my-schema.json", theme: "dark", mcp: { github: mine } }, null, 2) + "\n";
    writeFileSync(cfg, original);

    const kept = cli("add", "github", "--config", cfg);
    assert.equal(kept.status, 0, kept.stderr);
    assert.match(kept.stdout, /= keep your 'github'/);
    assert.match(kept.stdout, /Nothing to change/);
    assert.equal(readFileSync(cfg, "utf8"), original, "file is byte-identical");

    // a whole stack adds the missing servers and still leaves the customised one alone
    const stack = cli("stack", "devops", "--config", cfg);
    assert.equal(stack.status, 0, stack.stderr);
    let now = JSON.parse(readFileSync(cfg, "utf8"));
    assert.deepEqual(now.mcp.github, mine);
    assert.equal(now.$schema, "./my-schema.json");
    assert.equal(now.theme, "dark");
    assert.ok(now.mcp.docker && now.mcp.sentry);

    const forced = cli("add", "github", "--force", "--config", cfg);
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /~ replace 'github'/);
    now = JSON.parse(readFileSync(cfg, "utf8"));
    assert.deepEqual(now.mcp.github, loadTemplate("github").mcp.github);
    assert.equal(now.$schema, "./my-schema.json");
  });
});

test("running the same stack twice changes nothing the second time", () => {
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    assert.equal(cli("stack", "superapp", "--config", cfg).status, 0);
    const first = readFileSync(cfg, "utf8");
    const again = cli("stack", "superapp", "--config", cfg);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Nothing to change/);
    assert.doesNotMatch(again.stdout, /\+ add/);
    assert.equal(readFileSync(cfg, "utf8"), first);
  });
});

test("a config that is not a JSON object is refused and left untouched", () => {
  const cases = {
    "[]": /root must be a JSON object/,
    '"just a string"': /root must be a JSON object/,
    "null": /root must be a JSON object/,
    '{"mcp": "abc"}': /"mcp" must be a JSON object/,
    '{"mcp": [{"a": 1}]}': /"mcp" must be a JSON object/,
    '{"mcp": {"servers": {"git": {"type": "local", "command": ["x"]}}}}': /mcp\.servers/,
  };
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    for (const [content, pattern] of Object.entries(cases)) {
      writeFileSync(cfg, content);
      const r = cli("add", "git", "--config", cfg);
      assertCleanFailure(r, pattern);
      assert.match(r.stderr, /nothing was changed/);
      assert.equal(readFileSync(cfg, "utf8"), content, content);
    }
  });
});

test("a parse failure never quotes the config file (it may hold secrets)", () => {
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    const secret = "sk-SECRET-" + "9".repeat(20);
    const content = `{ "provider": { "apiKey": ${secret} } }`; // unquoted value: invalid JSON
    writeFileSync(cfg, content);
    const r = cli("add", "git", "--config", cfg);
    assertCleanFailure(r, /nothing was changed/);
    assert.ok(!r.stderr.includes(secret) && !r.stdout.includes(secret));
    assert.ok(!r.stderr.includes("apiKey"));
    assert.equal(readFileSync(cfg, "utf8"), content);
  });
});

test("--config=path is honoured and mistyped options are errors, never silently ignored", () => {
  inTempDir((dir) => {
    const cwd = join(dir, "project");
    const other = join(dir, "elsewhere.json");
    mkdirSync(cwd);

    const eq = cliWith({ cwd }, "add", "git", `--config=${other}`);
    assert.equal(eq.status, 0, eq.stderr);
    assert.ok(JSON.parse(readFileSync(other, "utf8")).mcp.git);
    assert.deepEqual(readdirSync(cwd), [], "nothing was written to ./opencode.json");

    assertCleanFailure(cliWith({ cwd }, "add", "git", "--gloabl"), /unknown option '--gloabl'/);
    assertCleanFailure(cliWith({ cwd }, "add", "git", "-g"), /unknown option '-g'/);
    assertCleanFailure(cliWith({ cwd }, "add", "git", "--config"), /'--config' needs a value/);
    assertCleanFailure(cliWith({ cwd }, "add", "git", "--config", other, "--global"), /either --global or --config/);
    assertCleanFailure(cliWith({ cwd }, "list", "--global"), /unknown option '--global'/);
    assert.deepEqual(readdirSync(cwd), []);
  });
});

test("--dry-run reports the plan and writes nothing", () => {
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    const r = cli("stack", "superapp", "--dry-run", "--config", cfg);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\+ add 'filesystem'/);
    assert.match(r.stdout, /Dry run: nothing written/);
    assert.ok(!existsSync(cfg));
  });
});

test("the CLI scripts never call process.exit()", () => {
  // Exiting straight after writing to a pipe truncates the output at 64 KB, so the scripts
  // set process.exitCode and return instead.
  for (const f of readdirSync(join(KIT, "scripts")).filter((f) => f.endsWith(".mjs"))) {
    const code = readFileSync(join(KIT, "scripts", f), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /process\.exit\s*\(/, f);
  }
});

test("validate.mjs passes on the shipped kit", () => {
  const r = run(join(KIT, "scripts", "validate.mjs"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /All checks passed/);
});
