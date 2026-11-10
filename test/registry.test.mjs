import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIT, SECRET_PATTERNS, loadRegistry, listStacks, stackIds, searchRegistry, missingEnvFor, mergeServers, positionalArgs,
  projectEntry, validateKit,
} from "../scripts/lib/registry.mjs";

const registry = loadRegistry();

// Copy the kit's data files to a temp dir so tests can corrupt them safely.
function tempKit(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "superapp-kit-"));
  for (const d of ["registry.json", "schema", "templates", "stacks", "opencode.example.json"]) cpSync(join(KIT, d), join(dir, d), { recursive: true });
  mutate(dir);
  return dir;
}
const readJ = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJ = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

// Errors validateKit reports after `mutate` has damaged a copy of the kit.
function errorsAfter(mutate) {
  const dir = tempKit(mutate);
  try { return validateKit(dir).errors; } finally { rmSync(dir, { recursive: true }); }
}
// Edit one registry entry (by id) in a temp kit.
const editRegistry = (id, fn) => (d) => {
  const p = join(d, "registry.json");
  const r = readJ(p);
  fn(r.find((e) => e.id === id), r);
  writeJ(p, r);
};
const editJson = (rel, fn) => (d) => { const p = join(d, rel); const v = readJ(p); fn(v); writeJ(p, v); };

// Token-shaped strings are assembled at runtime so this file never contains one.
const FAKE = {
  github: "ghp_" + "a".repeat(36),
  slack: "xoxb-" + "1".repeat(12),
  aws: "AKIA" + "A".repeat(16),
  stripe: "sk_live_" + "0".repeat(24),
  privateKey: "-----BEGIN " + "RSA PRIVATE KEY-----",
};

test("the shipped kit validates cleanly", () => {
  const { errors, stats } = validateKit();
  assert.deepEqual(errors, []);
  // counts are measured from the files, so they must agree with each other
  assert.equal(stats.servers, registry.length);
  assert.equal(stats.templates, readdirSync(join(KIT, "templates")).filter((f) => f.endsWith(".json")).length);
  assert.equal(stats.local + stats.remote, stats.servers);
  assert.equal(Object.keys(stats.stacks).length, readdirSync(join(KIT, "stacks")).length);
});

test("registry ids are unique and every id has a matching template", () => {
  const ids = registry.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(readJ(join(KIT, "templates", `${id}.json`)).mcp[id], id);
});

test("every template is exactly the entry its registry record describes", () => {
  for (const r of registry) {
    const tpl = readJ(join(KIT, "templates", `${r.id}.json`));
    assert.deepEqual(Object.keys(tpl), ["$schema", "mcp"], r.id);
    assert.deepEqual(tpl.mcp, { [r.id]: projectEntry(r) }, r.id);
  }
});

test("every stack entry is identical to its template, and registry stacks mirror the stack files", () => {
  const membership = {};
  for (const name of listStacks()) {
    const stack = readJ(join(KIT, "stacks", `${name}.json`));
    for (const [id, entry] of Object.entries(stack.mcp)) {
      assert.deepEqual(entry, readJ(join(KIT, "templates", `${id}.json`)).mcp[id], `${name}/${id}`);
      (membership[id] ??= []).push(name);
    }
  }
  for (const r of registry) assert.deepEqual([...r.stacks].sort(), (membership[r.id] || []).sort(), r.id);
});

test("every required secret reaches the server as an {env:VAR} placeholder", () => {
  for (const r of registry) {
    const s = readFileSync(join(KIT, "templates", `${r.id}.json`), "utf8");
    for (const v of r.envVars.filter((v) => v.required)) assert.ok(s.includes(`{env:${v.name}}`), `${r.id}: ${v.name}`);
  }
});

test("no shell-style placeholders: OpenCode only expands {env:VAR}", () => {
  // "${VAR}", "$VAR" and "%VAR%" reach the server as literal text, so the server cannot start.
  const shellish = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%/;
  for (const r of registry) {
    const fields = JSON.stringify([r.command, r.environment, r.url, r.headers]);
    assert.doesNotMatch(fields, shellish, `registry.json: ${r.id}`);
  }
  for (const dir of ["templates", "stacks"]) {
    for (const f of readdirSync(join(KIT, dir)).filter((f) => f.endsWith(".json"))) {
      assert.doesNotMatch(JSON.stringify(readJ(join(KIT, dir, f)).mcp), shellish, `${dir}/${f}`);
    }
  }
});

test("toolsPrefix follows OpenCode's <server>_<tool> naming for every server", () => {
  for (const r of registry) assert.equal(r.toolsPrefix, `${r.id}_*`, r.id);
});

test("superapp stack is keyless (no required env vars)", () => {
  assert.deepEqual(missingEnvFor(registry, stackIds("superapp")), []);
});

// --- validateKit negative cases: each rule must fire on a damaged copy of the kit --------

test("validateKit detects a duplicate id", () => {
  const errors = errorsAfter((d) => { const r = readJ(join(d, "registry.json")); r.push({ ...r[0] }); writeJ(join(d, "registry.json"), r); });
  assert.ok(errors.includes(`duplicate id ${registry[0].id}`));
});

test("validateKit detects a missing template and an orphan template", () => {
  const errors = errorsAfter((d) => {
    rmSync(join(d, "templates", "git.json"));
    writeJ(join(d, "templates", "orphan.json"), { $schema: "https://opencode.ai/config.json", mcp: { orphan: { enabled: true, type: "local", command: ["x"] } } });
  });
  assert.ok(errors.includes("git: missing templates/git.json"));
  assert.ok(errors.includes("templates/orphan.json has no registry entry"));
});

test("validateKit detects a template that drifts from registry.json", () => {
  const errors = errorsAfter((d) => {
    editJson("templates/time.json", (t) => { t.mcp.time.type = "remote"; })(d);
    editJson("templates/git.json", (t) => { t.mcp.git.command = ["uvx", "something-else"]; })(d);
    editJson("templates/github.json", (t) => { t.mcp.github.environment.GITHUB_PERSONAL_ACCESS_TOKEN = "hunter2"; })(d);
    editJson("templates/memory.json", (t) => { t.mcp.memory.enabled = false; })(d);
  });
  assert.ok(errors.includes("time: template type remote != registry local"));
  assert.ok(errors.includes("git: template command differs from registry.json"));
  assert.ok(errors.includes("github: template environment differs from registry.json"));
  assert.ok(errors.includes("memory: template enabled differs from registry.json"));
});

test("validateKit checks every template against schema/config.schema.json", () => {
  const errors = errorsAfter((d) => {
    editJson("templates/git.json", (t) => { t.mcp.git.cwdd = "/tmp"; t.mcp.other = { enabled: true, type: "local", command: ["x"] }; })(d);
    editJson("templates/memory.json", (t) => { t.$schema = "https://example.com/other.json"; t.model = "x"; })(d);
    editJson("templates/sentry.json", (t) => { t.mcp.sentry.url = "http://mcp.sentry.dev/mcp"; delete t.mcp.sentry.enabled; })(d);
  });
  assert.ok(errors.includes('templates/git.json.mcp.git: unexpected property "cwdd"'));
  assert.ok(errors.includes('templates/git.json: must define only "git", found "other"'));
  assert.ok(errors.includes('templates/memory.json.$schema: must be "https://opencode.ai/config.json"'));
  assert.ok(errors.includes('templates/memory.json: unexpected property "model"'));
  assert.ok(errors.some((e) => e.startsWith("templates/sentry.json.mcp.sentry.url: does not match")));
  assert.ok(errors.includes('templates/sentry.json.mcp.sentry: missing required "enabled"'));
});

test("validateKit checks stack contents, not just stack ids", () => {
  const errors = errorsAfter((d) => {
    editJson("stacks/testing.json", (s) => {
      s.mcp.nope = { enabled: true, type: "local", command: ["x"] };
      s.mcp.time.command = ["uvx", "not-the-template"];
      s.model = "x";
    })(d);
    editJson("stacks/devops.json", (s) => { s.mcp.github.environment.GITHUB_PERSONAL_ACCESS_TOKEN = FAKE.github; })(d);
    editJson("stacks/ai-search.json", (s) => { s.mcp = {}; })(d);
  });
  assert.ok(errors.includes("stack testing references unknown id nope"));
  assert.ok(errors.includes("stack testing: entry time differs from templates/time.json"));
  assert.ok(errors.includes('stacks/testing.json: unexpected property "model"'));
  assert.ok(errors.includes("stack devops: entry github differs from templates/github.json"));
  assert.ok(errors.includes("stacks/devops.json: appears to contain a literal secret (GitHub token)"));
  assert.ok(errors.includes("stacks/ai-search.json.mcp: fewer than 1 properties"));
});

test("validateKit requires registry stacks to mirror the stack files", () => {
  const errors = errorsAfter((d) => {
    editRegistry("git", (r) => { r.stacks = []; })(d);
    editRegistry("memory", (r) => { r.stacks.push("no-such-stack"); })(d);
    editRegistry("time", (r) => { r.stacks.push(r.stacks[0]); })(d);
  });
  assert.ok(errors.includes("git: registry stacks [] != stack files [web-dev]"));
  assert.ok(errors.some((e) => e.startsWith("memory: registry stacks [") && e.includes("no-such-stack")));
  assert.ok(errors.some((e) => /^registry\[\d+\]\.stacks\[\d+\]: duplicate item/.test(e)));
});

test("validateKit enforces toolsPrefix, reserved ids and local/remote field rules", () => {
  const errors = errorsAfter((d) => {
    editRegistry("kubernetes", (r) => { r.toolsPrefix = "k8s_*"; })(d);
    editRegistry("git", (r) => { r.url = "https://example.com/mcp"; r.oauth = {}; })(d);
    editRegistry("sentry", (r) => { r.command = ["npx", "x"]; r.oauth = true; })(d);
    editRegistry("memory", (r, all) => { all.push({ ...r, id: "servers", toolsPrefix: "servers_*", stacks: [] }); })(d);
    writeJ(join(d, "templates", "servers.json"), { $schema: "https://opencode.ai/config.json", mcp: { servers: projectEntry(registry.find((r) => r.id === "memory")) } });
  });
  assert.ok(errors.includes('kubernetes: toolsPrefix must be "kubernetes_*" (OpenCode names tools <server>_<tool>), got "k8s_*"'));
  assert.ok(errors.includes("git: local server must not set url"));
  assert.ok(errors.includes("git: local server must not set oauth"));
  assert.ok(errors.includes("sentry: remote server must not set command"));
  assert.ok(errors.includes('sentry: oauth must be false or an object (OpenCode has no "oauth": true)'));
  assert.ok(errors.includes('servers: id is reserved by OpenCode under "mcp"'));
});

test("validateKit enforces placeholder rules on registry entries", () => {
  const errors = errorsAfter((d) => {
    editRegistry("filesystem", (r) => { r.command[r.command.length - 1] = "${ALLOWED_DIR}"; })(d);
    editRegistry("postgres", (r) => { r.command[r.command.length - 1] = "{env:PG_URL}"; })(d);
    editRegistry("github", (r) => { r.environment.GITHUB_PERSONAL_ACCESS_TOKEN = "hunter2"; })(d);
    editRegistry("exa", (r) => { r.headers.Authorization = "Bearer abc123"; })(d);
    editRegistry("git", (r) => { r.envVars.push({ name: "UNUSED_VAR", required: false, desc: "never referenced" }); })(d);
    editRegistry("mysql", (r) => { r.environment.LOG_LEVEL = "debug"; })(d);
  });
  assert.ok(errors.includes("filesystem: command[3] uses a shell-style placeholder; OpenCode only expands {env:VAR}"));
  assert.ok(errors.includes("postgres: command[3] references {env:PG_URL}, which is not declared in envVars"));
  assert.ok(errors.includes("github: environment.GITHUB_PERSONAL_ACCESS_TOKEN holds a literal value; credentials must be {env:VAR} placeholders"));
  assert.ok(errors.includes("exa: headers.Authorization holds a literal value; credentials must be {env:VAR} placeholders"));
  assert.ok(errors.includes("git: envVars declares UNUSED_VAR, but nothing references {env:UNUSED_VAR}"));
  // a non-credential setting may be a literal
  assert.ok(!errors.some((e) => e.includes("LOG_LEVEL holds a literal")));
});

test("validateKit finds token-shaped literals in every kind of kit file", () => {
  const errors = errorsAfter((d) => {
    editRegistry("slack", (r) => { r.description += ` e.g. ${FAKE.slack}`; })(d);
    editJson("templates/aws-docs.json", (t) => { t.mcp["aws-docs"].command.push(FAKE.aws); })(d);
    editJson("opencode.example.json", (e) => { e.provider = { stripe: FAKE.stripe }; })(d);
    writeFileSync(join(d, "stacks", "testing.json"), readFileSync(join(d, "stacks", "testing.json"), "utf8").replace("{", `{ "_k": "${FAKE.privateKey}",`));
  });
  assert.ok(errors.includes("registry.json: appears to contain a literal secret (Slack token)"));
  assert.ok(errors.includes("templates/aws-docs.json: appears to contain a literal secret (AWS access key id)"));
  assert.ok(errors.includes("opencode.example.json: appears to contain a literal secret (Stripe live key)"));
  assert.ok(errors.includes("stacks/testing.json: appears to contain a literal secret (private key)"));
});

test("secret patterns match real token shapes but not the prose in descriptions", () => {
  const hit = (s) => SECRET_PATTERNS.filter(([, re]) => re.test(s)).map(([name]) => name);
  assert.deepEqual(hit(FAKE.github), ["GitHub token"]);
  assert.deepEqual(hit(FAKE.slack), ["Slack token"]);
  assert.deepEqual(hit(FAKE.aws), ["AWS access key id"]);
  assert.deepEqual(hit(FAKE.stripe), ["Stripe live key"]);
  assert.deepEqual(hit(FAKE.privateKey), ["private key"]);
  assert.deepEqual(hit("sk-ant-" + "b".repeat(30)), ["sk- API key"]);
  assert.deepEqual(hit("glpat-" + "c".repeat(20)), ["GitLab token"]);
  assert.deepEqual(hit("github_pat_" + "d".repeat(30)), ["GitHub fine-grained token"]);
  for (const prose of ["ghp_ token with repo scope", "xoxb- bot token", "glpat- token", "sk_test_... (never commit live keys)", "{env:STRIPE_SECRET_KEY}", "AKIA"]) {
    assert.deepEqual(hit(prose), [], prose);
  }
});

test("validateKit reports opencode.example.json entries that differ from the templates", () => {
  const errors = errorsAfter(editJson("opencode.example.json", (e) => { e.mcp.filesystem.command = ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/"]; }));
  assert.deepEqual(errors, ["opencode.example.json: entry filesystem differs from templates/filesystem.json"]);
});

test("validateKit reports unreadable or malformed files instead of throwing", () => {
  let errors = errorsAfter((d) => {
    writeFileSync(join(d, "templates", "git.json"), "{ not json");
    writeFileSync(join(d, "stacks", "testing.json"), "[1, 2");
    writeFileSync(join(d, "opencode.example.json"), "// comment\n{}");
    rmSync(join(d, "schema", "config.schema.json"));
  });
  assert.ok(errors.some((e) => e.startsWith("templates/git.json: invalid JSON")));
  assert.ok(errors.some((e) => e.startsWith("stacks/testing.json: invalid JSON")));
  assert.ok(errors.some((e) => e.startsWith("opencode.example.json: invalid JSON")));
  assert.ok(errors.includes("schema/config.schema.json: file is missing"));

  errors = errorsAfter((d) => writeFileSync(join(d, "registry.json"), "{ nope"));
  assert.ok(errors.length === 1 && errors[0].startsWith("registry.json: invalid JSON"));

  errors = errorsAfter((d) => writeJ(join(d, "registry.json"), { not: "an array" }));
  assert.deepEqual(errors, ["registry: expected array, got object"]);

  // non-object items are reported by the schema and then skipped, not dereferenced
  errors = errorsAfter((d) => { const r = readJ(join(d, "registry.json")); r.push(null, "x", { title: "no id" }); writeJ(join(d, "registry.json"), r); });
  assert.ok(errors.includes(`registry[${registry.length}]: expected object, got null`));
  assert.ok(errors.includes(`registry[${registry.length + 1}]: expected object, got string`));
  assert.ok(errors.includes(`registry[${registry.length + 2}]: missing required "id"`));
});

// --- helpers ------------------------------------------------------------------------------

test("listStacks and stackIds read stacks/*.json", () => {
  assert.ok(listStacks().includes("superapp"));
  assert.equal(stackIds("does-not-exist"), null);
  assert.ok(stackIds("superapp").includes("context7"));
});

test("searchRegistry is case-insensitive across id/title/description", () => {
  const hits = searchRegistry(registry, "POSTGRES").map((r) => r.id);
  assert.ok(hits.includes("postgres"));
  assert.deepEqual(searchRegistry(registry, "zzz-no-such-thing"), []);
});

test("missingEnvFor de-duplicates and only returns required vars", () => {
  const fake = [
    { id: "a", envVars: [{ name: "K", required: true, desc: "k" }, { name: "OPT", required: false, desc: "o" }] },
    { id: "b", envVars: [{ name: "K", required: true, desc: "k" }] },
  ];
  assert.deepEqual(missingEnvFor(fake, ["a", "b", "unknown"]), [["K", "k"]]);
});

test("mergeServers adds/overwrites mcp keys and preserves everything else", () => {
  const before = { model: "x", mcp: { keep: { type: "local" }, git: { old: true } } };
  const { config, added, overwritten } = mergeServers(before, { git: { type: "local" }, time: { type: "local" } });
  assert.deepEqual(added, ["time"]);
  assert.deepEqual(overwritten, ["git"]);
  assert.equal(config.model, "x");
  assert.deepEqual(Object.keys(config.mcp).sort(), ["git", "keep", "time"]);
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.deepEqual(before.mcp.git, { old: true }, "input is not mutated");
});

test("positionalArgs skips flags and flag values", () => {
  assert.deepEqual(positionalArgs(["github", "--config", "x.json", "sentry", "--global"]), ["github", "sentry"]);
  assert.deepEqual(positionalArgs(["--config", "github"]), []);
});
