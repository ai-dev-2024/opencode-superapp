// The docs quote numbers and names that live in the data files. These tests fail when the
// two drift apart, so a count in the README is never just a number someone typed once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KIT, listStacks, loadRegistry, stackIds } from "../scripts/lib/registry.mjs";

const read = (rel) => readFileSync(join(KIT, rel), "utf8");
const readme = read("README.md");
const pkg = JSON.parse(read("package.json"));
const registry = loadRegistry();
const stacks = listStacks();
const servers = registry.length;
const local = registry.filter((r) => r.type === "local").length;
const remote = registry.filter((r) => r.type === "remote").length;
const slug = /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(pkg.repository.url)[1];

// Every number captured by `pattern` in `text` must equal `expected`.
function assertAll(text, pattern, expected, label) {
  const found = [...text.matchAll(pattern)].map((m) => Number(m[1]));
  assert.ok(found.length > 0, `${label}: pattern not found, update the test if the wording changed`);
  for (const n of found) assert.equal(n, expected, label);
}

test("README server and stack counts match the data files", () => {
  assert.match(readme, new RegExp(`\\*\\*${servers} MCP servers\\*\\* \\(${local} local, ${remote} remote\\)`));
  assert.match(readme, new RegExp(`\\*\\*${stacks.length} ready-made stacks\\*\\*`));
  assertAll(readme, /badge\/MCP-(\d+)_servers/g, servers, "servers badge");
  assertAll(readme, /alt="(\d+) MCP servers"/g, servers, "servers badge alt text");
  assertAll(readme, /badge\/stacks-(\d+)-/g, stacks.length, "stacks badge");
  assertAll(readme, /alt="(\d+) stacks"/g, stacks.length, "stacks badge alt text");
  assertAll(readme, /# all (\d+) servers/g, servers, "usage comment");
  assertAll(readme, /registry\.json<br\/>(\d+) entries/g, servers, "architecture diagram");
  assertAll(readme, /catalog of (\d+) MCP servers/g, servers, "project structure");
  assertAll(readme, /snippet per server \((\d+)\)/g, servers, "project structure templates");
  assertAll(readme, /# (\d+) named server bundles/g, stacks.length, "project structure stacks");
  assertAll(readme, /\*\*(\d+) stacks\*\*:/g, stacks.length, "key features");
});

test("README stack table lists every stack with its real size", () => {
  const rows = [...readme.matchAll(/^\| (?:⭐ )?`([a-z-]+)` \| (\d+) \|/gm)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(rows.map(([name]) => name).sort(), stacks);
  for (const [name, count] of rows) assert.equal(count, stackIds(name).length, name);
});

test("README quick start describes exactly the superapp stack", () => {
  const superapp = stackIds("superapp");
  assertAll(readme, /The `superapp` stack is (\d+) servers/g, superapp.length, "key features");
  assertAll(readme, /This adds (\d+) servers to/g, superapp.length, "quick start");
  const start = readme.indexOf("| Tool | Your agent can now");
  const table = readme.slice(start, readme.indexOf("\n\n", start));
  const listed = [...table.matchAll(/^\| `([a-z0-9_-]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(listed, superapp);
  // the runtimes the quick start promises are the ones the stack really needs
  const runners = new Set(superapp.map((id) => registry.find((r) => r.id === id)).filter((r) => r.type === "local").map((r) => r.command[0]));
  assert.deepEqual([...runners].sort(), ["npx", "uvx"]);
  const viaUvx = superapp.filter((id) => registry.find((r) => r.id === id).command?.[0] === "uvx");
  assert.deepEqual(viaUvx, ["fetch", "time"], "the README names the servers that need uv");
});

test("docs/STACKS.md lists the members of every stack, in order, with the right count", () => {
  const doc = read("docs/STACKS.md");
  const rows = [...doc.matchAll(/^\| `([a-z-]+)\.json`[^|]*\|[^|]*\| ([a-z0-9_, -]+) \((\d+)\) \|$/gm)];
  assert.deepEqual(rows.map((m) => m[1]).sort(), stacks);
  for (const [, name, ids, count] of rows) {
    assert.deepEqual(ids.split(", "), stackIds(name), name);
    assert.equal(Number(count), stackIds(name).length, name);
  }
});

test("package.json and registry.md quote the same counts", () => {
  assert.match(pkg.description, new RegExp(`\\b${servers} MCP servers, ${stacks.length} one-command stacks\\b`));
  assert.match(read("registry.md"), new RegExp(`^# Registry — ${servers} MCP servers\\n`));
});

test("the README does not hard-code how many tests there are", () => {
  assert.doesNotMatch(readme.replace(/recorded at v1\.0\.0[^\n]*\n[^\n]*/, ""), /\b\d+ tests\b/);
});

test("badges and clone URL point at the repository named in package.json", () => {
  const referenced = [...readme.matchAll(/(?:github\.com|img\.shields\.io\/github\/[\w-]+(?:\/[\w-]+)?)\/([\w.-]+\/opencode-superapp)/g)].map((m) => m[1].replace(/\.git$/, ""));
  assert.ok(referenced.length >= 4, "expected licence, language, CI badges and the clone URL");
  for (const r of referenced) assert.equal(r, slug);
  assert.match(readme, new RegExp(`${slug}/actions/workflows/ci\\.yml/badge\\.svg`));
  assert.ok(existsSync(join(KIT, ".github", "workflows", "ci.yml")), "the CI badge needs ci.yml");
  assert.ok(existsSync(join(KIT, ".github", "workflows", "upstream.yml")), "the upstream badge needs upstream.yml");
});

test("relative links in the docs point at files that exist", () => {
  for (const rel of ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/STACKS.md", "docs/TROUBLESHOOTING.md", "docs/FREE-MODELS.md"]) {
    const text = read(rel);
    const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const target of targets) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = join(KIT, dirname(rel), target.split("#")[0]);
      assert.ok(existsSync(path), `${rel} links to ${target}`);
    }
  }
});

test("in-page links in the README point at headings that exist", () => {
  const anchors = new Set([...readme.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")));
  for (const [, anchor] of readme.matchAll(/\]\(#([^)]+)\)/g)) assert.ok(anchors.has(anchor), `#${anchor}`);
});

test("every npm script and CLI option the docs mention exists", () => {
  const docs = ["README.md", "CONTRIBUTING.md", "docs/STACKS.md", "docs/TROUBLESHOOTING.md"].map(read).join("\n");
  for (const [, script] of docs.matchAll(/npm run ([\w:-]+)/g)) assert.ok(pkg.scripts[script], `npm run ${script}`);
  const cli = read("scripts/mcp-manager.mjs");
  for (const [, option] of docs.matchAll(/mcp-manager\.mjs[^\n`]*?(--[a-z-]+)/g)) assert.ok(cli.includes(`"${option}"`), option);
});

test("the licence is still MIT", () => {
  assert.equal(pkg.license, "MIT");
  assert.match(read("LICENSE"), /^MIT License\n/);
  assert.match(readme, /\[MIT\]\(LICENSE\)/);
});
