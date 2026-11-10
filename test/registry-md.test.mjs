// registry.md is generated from registry.json; these tests keep the two in step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KIT, loadRegistry } from "../scripts/lib/registry.mjs";
import { renderRegistryMd } from "../scripts/lib/registry-md.mjs";

const GEN = join(KIT, "scripts", "gen-registry-md.mjs");
const registry = loadRegistry();
const md = renderRegistryMd(registry);
// The table row for one server id, split into its cells.
const row = (text, id) => {
  const line = text.split("\n").find((l) => l.includes(`| \`${id}\` |`));
  assert.ok(line, `no row for ${id}`);
  return line.split(" | ").map((c) => c.replace(/^\| | \|$/g, ""));
};

test("the committed registry.md is exactly what the generator produces", () => {
  assert.equal(readFileSync(join(KIT, "registry.md"), "utf8"), md, "run: npm run gen:registry");
});

test("registry.md has one table row and one note per server, in registry order", () => {
  assert.match(md, new RegExp(`^# Registry — ${registry.length} MCP servers\\n`));
  const ids = [...md.matchAll(/^\| \d+ \| `([^`]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(ids, registry.map((r) => r.id));
  const notes = [...md.matchAll(/^- \*\*([^*]+)\*\* \((local|remote)\)/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(notes, registry.map((r) => [r.id, r.type]));
});

test("the Secrets column says OAuth only for servers that sign in with OAuth", () => {
  for (const r of registry) {
    const secrets = row(md, r.id)[5];
    const required = r.envVars.filter((v) => v.required).map((v) => v.name);
    if (required.length) assert.equal(secrets, required.join(", "), r.id);
    else if (r.type === "remote" && typeof r.oauth === "object") assert.equal(secrets, "OAuth", r.id);
    else assert.equal(secrets, "—", r.id);
  }
  // keyless remotes ("oauth": false) used to be labelled OAuth
  assert.equal(row(md, "gh_grep")[5], "—");
  assert.equal(row(md, "context7")[5], "—");
  assert.equal(row(md, "sentry")[5], "OAuth");
});

test("a server in no stack shows a dash, and pipes in text cannot break the table", () => {
  const fake = [{
    id: "x", title: "A | B", description: "d", type: "local", category: "Core", stacks: [], command: ["npx", "x"],
    envVars: [], toolsPrefix: "x_*", install: "npx x | tee log",
  }];
  const cells = row(renderRegistryMd(fake), "x");
  assert.equal(cells[3], "A \\| B");
  assert.equal(cells[4], "—");
  assert.equal(cells[6], "`npx x \\| tee log`");
});

test("gen-registry-md --check fails on a stale file and the generator repairs it", () => {
  const dir = mkdtempSync(join(tmpdir(), "superapp-md-"));
  const run = (...args) => spawnSync(process.execPath, [GEN, ...args, dir], { encoding: "utf8" });
  try {
    for (const f of ["registry.json", "registry.md"]) cpSync(join(KIT, f), join(dir, f));
    assert.equal(run("--check").status, 0);

    const edited = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8"));
    edited[0].title = "Renamed";
    writeFileSync(join(dir, "registry.json"), JSON.stringify(edited));
    const stale = run("--check");
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /registry\.md is out of date.*npm run gen:registry/);
    assert.ok(!readFileSync(join(dir, "registry.md"), "utf8").includes("Renamed"), "--check does not write");

    assert.equal(run().status, 0);
    assert.ok(readFileSync(join(dir, "registry.md"), "utf8").includes("| Renamed |"));
    assert.equal(run("--check").status, 0);

    rmSync(join(dir, "registry.md"));
    assert.equal(run("--check").status, 1, "a missing registry.md is out of date");
    assert.equal(spawnSync(process.execPath, [GEN, "--bogus"], { encoding: "utf8" }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
