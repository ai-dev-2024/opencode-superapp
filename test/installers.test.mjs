// install.sh and install.ps1: static checks everywhere, and real runs where the shell exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KIT, listStacks, loadRegistry, stackIds } from "../scripts/lib/registry.mjs";

const SH = join(KIT, "install.sh");
const PS1 = join(KIT, "install.ps1");
const sh = readFileSync(SH, "utf8");
const ps1 = readFileSync(PS1, "utf8");

const which = (cmd) => {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
};
const bash = process.platform === "win32" ? null : which("bash");
const pwsh = which("pwsh");

function inTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "superapp-inst-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const runSh = (args, options = {}) => spawnSync(bash, [SH, ...args], { encoding: "utf8", input: "", ...options });

test("install.ps1 is pure ASCII so Windows PowerShell 5.1 can parse it", () => {
  // Without a BOM, 5.1 reads the file in the ANSI code page. The UTF-8 bytes of a dash then
  // end in a curly quote, which PowerShell accepts as a string delimiter: the script would
  // not parse at all.
  const lines = ps1.split("\n");
  const offenders = lines.map((l, n) => [n + 1, l]).filter(([, l]) => /[^\x00-\x7f]/.test(l)).map(([n]) => n);
  assert.deepEqual(offenders, [], `non-ASCII characters on line(s) ${offenders.join(", ")}`);
});

test("installers use LF line endings (a CRLF shebang breaks ./install.sh)", () => {
  assert.ok(!sh.includes("\r"));
  assert.ok(!ps1.includes("\r"));
  assert.ok(sh.startsWith("#!/usr/bin/env bash\n"));
  assert.match(sh, /^set -euo pipefail$/m);
});

test("both installers offer exactly the stacks that exist, with the right superapp size", () => {
  const stacks = listStacks();
  const essentials = stackIds("superapp").length;
  for (const [name, text] of [["install.sh", sh], ["install.ps1", ps1]]) {
    const menu = [...text.matchAll(/^\s*(?:echo|Write-Output) "  (\d)\) ([a-z-]+)/gm)].map((m) => m[2]);
    assert.deepEqual([...menu].sort(), stacks, `${name} menu`);
    assert.match(text, new RegExp(`\\(${essentials} zero-key essentials`), `${name} superapp size`);
    // every menu number maps to the stack printed next to it
    for (const [, n, stack] of text.matchAll(/^\s*(?:echo|Write-Output) "  (\d)\) ([a-z-]+)/gm)) {
      const mapped = name === "install.sh"
        ? new RegExp(`(?:^|[ |])${n}(?:\\|"")?\\) stack=${stack} ;;`, "m")
        : new RegExp(`"${n}" = "${stack}"`);
      assert.match(text, mapped, `${name}: choice ${n} -> ${stack}`);
    }
  }
  for (const s of stacks) assert.ok(sh.includes(s), `install.sh usage mentions ${s}`);
});

test("install.ps1 exposes the same options as the CLI and returns node's exit code", () => {
  for (const p of ["$Stack", "$Add", "$Superapp", "$Global", "$Config", "$Force", "$DryRun", "$List", "$Search", "$Validate"]) {
    assert.ok(ps1.includes(p), p);
  }
  assert.match(ps1, /exit \$LASTEXITCODE/);
  assert.match(ps1, /PositionalBinding = \$false/);
  assert.match(ps1, /Set-StrictMode -Version Latest/);
  // --global is only passed to commands that write a config; `list` rejects it
  assert.match(ps1, /if \(\$List\) \{ Invoke-Kit @\(\$manager, "list"\) \}/);
});

test("install.sh --help exits 0; unknown options and unknown stacks exit 1", { skip: !bash }, () => {
  const help = runSh(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: \.\/install\.sh/);
  assert.equal(runSh(["-h"]).status, 0);

  const bogus = runSh(["--bogus"]);
  assert.equal(bogus.status, 1);
  assert.match(bogus.stderr, /^error: unknown option '--bogus'/);
  assert.equal(bogus.stdout, "");

  const nope = runSh(["--stack", "nope"]);
  assert.equal(nope.status, 1);
  assert.match(nope.stderr, /Unknown stack 'nope'/);
});

test("install.sh passes commands and flags through to the CLI", { skip: !bash }, () => {
  const list = runSh(["--list", "--json"]);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).length, loadRegistry().length);
  assert.match(runSh(["--search", "postgres"]).stdout, /== postgres \[local\] ==/);
  assert.match(runSh(["--validate"]).stdout, /All checks passed/);

  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    const r = runSh(["--superapp", "--config", cfg]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(cfg, "utf8")).mcp), stackIds("superapp"));
    const add = runSh(["--add", "git", "time", "--config", cfg, "--dry-run"]);
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /\+ add 'git'/);
    assert.match(add.stdout, /Dry run/);
  });
});

test("install.sh menu: a choice installs that stack, flags apply, and no input is an error", { skip: !bash }, () => {
  inTempDir((dir) => {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    delete env.XDG_CONFIG_HOME;
    const picked = runSh(["--global"], { input: "6\n", env, cwd: dir });
    assert.equal(picked.status, 0, picked.stderr);
    assert.match(picked.stdout, /Stack 'testing' expands to/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, ".config", "opencode", "opencode.json"), "utf8")).mcp), stackIds("testing"));

    const cancelled = runSh([], { input: "q\n", cwd: dir });
    assert.equal(cancelled.status, 0);
    assert.match(cancelled.stdout, /cancelled/);

    const none = runSh([], { input: "", cwd: dir });
    assert.equal(none.status, 1);
    assert.match(none.stderr, /error: no input for the menu\. Name a stack instead/);
    assert.ok(!existsSync(join(dir, "opencode.json")));
  });
});

test("install.sh checks that node exists and is new enough", { skip: !bash }, () => {
  inTempDir((dir) => {
    const dirname = which("dirname");
    // a PATH with dirname but no node at all
    const empty = join(dir, "no-node");
    mkdirSync(empty);
    symlinkSync(dirname, join(empty, "dirname"));
    const missing = runSh(["--list"], { env: { PATH: empty } });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /error: node >=18 is required \(https:\/\/nodejs\.org\)/);

    // a node that reports version 16
    const old = join(dir, "old-node");
    mkdirSync(old);
    symlinkSync(dirname, join(old, "dirname"));
    writeFileSync(join(old, "node"), '#!/bin/sh\ncase "$1" in\n  -p) echo 16 ;;\n  --version) echo v16.20.2 ;;\n  *) echo "stub node must not run scripts" >&2; exit 99 ;;\nesac\n');
    chmodSync(join(old, "node"), 0o755);
    const tooOld = runSh(["--list"], { env: { PATH: old } });
    assert.equal(tooOld.status, 1);
    assert.match(tooOld.stderr, /error: node >=18 is required, found v16\.20\.2/);
    assert.equal(tooOld.stdout, "");
  });
});

test("install.sh finds its own directory even when CDPATH points somewhere else", { skip: !bash }, () => {
  inTempDir((dir) => {
    // work/kit -> the real kit; decoy/kit is an unrelated directory with the same name.
    mkdirSync(join(dir, "work"));
    mkdirSync(join(dir, "decoy", "kit"), { recursive: true });
    symlinkSync(KIT, join(dir, "work", "kit"));
    const r = spawnSync(bash, ["kit/install.sh", "--list", "--json"], {
      encoding: "utf8", cwd: join(dir, "work"), env: { ...process.env, CDPATH: join(dir, "decoy") },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).length, loadRegistry().length);
  });
});

test("install.ps1 runs under PowerShell 7 and returns the CLI's exit code", { skip: !pwsh }, () => {
  const run = (...args) => spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-File", PS1, ...args], { encoding: "utf8" });
  const list = run("-List");
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, new RegExp(`${loadRegistry().length} MCP servers`));
  assert.equal(run("-Stack", "nope").status, 1);
  inTempDir((dir) => {
    const cfg = join(dir, "opencode.json");
    const r = run("-Superapp", "-Config", cfg);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(cfg, "utf8")).mcp), stackIds("superapp"));
    assert.equal(run("-Add", "git,time", "-Config", cfg, "-DryRun").status, 0);
  });
});
