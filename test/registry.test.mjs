import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIT, loadRegistry, listStacks, stackIds, searchRegistry, missingEnvFor, mergeServers, positionalArgs, validateKit,
} from "../scripts/lib/registry.mjs";

const registry = loadRegistry();

// Copy the kit's data files to a temp dir so tests can corrupt them safely.
function tempKit(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "superapp-kit-"));
  for (const d of ["registry.json", "schema", "templates", "stacks"]) cpSync(join(KIT, d), join(dir, d), { recursive: true });
  mutate(dir);
  return dir;
}
const readJ = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJ = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

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

test("templates never contain literal secrets; secrets use {env:VAR} placeholders", () => {
  for (const r of registry) {
    const s = readFileSync(join(KIT, "templates", `${r.id}.json`), "utf8");
    for (const v of r.envVars.filter((v) => v.required)) {
      // a required var is referenced as a placeholder or passed through by name (docker -e)
      assert.ok(s.includes(`{env:${v.name}}`) || s.includes(`"${v.name}"`) || r.type === "remote", `${r.id}: ${v.name}`);
    }
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

test("superapp stack is keyless (no required env vars)", () => {
  assert.deepEqual(missingEnvFor(registry, stackIds("superapp")), []);
});

test("validateKit detects a duplicate id", () => {
  const dir = tempKit((d) => { const r = readJ(join(d, "registry.json")); r.push({ ...r[0] }); writeJ(join(d, "registry.json"), r); });
  try { assert.ok(validateKit(dir).errors.includes(`duplicate id ${registry[0].id}`)); } finally { rmSync(dir, { recursive: true }); }
});

test("validateKit detects a missing template and an orphan template", () => {
  const dir = tempKit((d) => {
    rmSync(join(d, "templates", "git.json"));
    writeJ(join(d, "templates", "orphan.json"), { mcp: { orphan: { type: "local", command: ["x"] } } });
  });
  try {
    const { errors } = validateKit(dir);
    assert.ok(errors.includes("git: missing templates/git.json"));
    assert.ok(errors.includes("templates/orphan.json has no registry entry"));
  } finally { rmSync(dir, { recursive: true }); }
});

test("validateKit detects a literal secret and a template/registry type mismatch", () => {
  const dir = tempKit((d) => {
    const p = join(d, "templates", "github.json");
    const t = readJ(p);
    t.mcp.github.environment.GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_notarealtoken";
    writeJ(p, t);
    const q = join(d, "templates", "time.json");
    const u = readJ(q); u.mcp.time.type = "remote"; writeJ(q, u);
  });
  try {
    const { errors } = validateKit(dir);
    assert.ok(errors.some((e) => e.startsWith("github: template appears to contain a literal secret")));
    assert.ok(errors.includes("time: template type remote != registry local"));
  } finally { rmSync(dir, { recursive: true }); }
});

test("validateKit detects a stack referencing an unknown id", () => {
  const dir = tempKit((d) => { const p = join(d, "stacks", "testing.json"); const s = readJ(p); s.mcp.nope = {}; writeJ(p, s); });
  try { assert.ok(validateKit(dir).errors.includes("stack testing references unknown id nope")); } finally { rmSync(dir, { recursive: true }); }
});

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
