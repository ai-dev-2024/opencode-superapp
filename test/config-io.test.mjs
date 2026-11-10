// Finding, reading and atomically replacing the user's config file.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget, readTarget, writeAtomic } from "../scripts/lib/config-io.mjs";
import { UserError } from "../scripts/lib/errors.mjs";

const posix = process.platform !== "win32";
const notRoot = posix && process.getuid() !== 0; // root ignores file permissions

function inTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "superapp-io-"));
  try { return fn(dir); } finally {
    try { chmodSync(dir, 0o700); } catch { /* best effort */ }
    rmSync(dir, { recursive: true, force: true });
  }
}
const userError = (pattern) => (e) => e instanceof UserError && pattern.test(e.message);

test("resolveTarget: --config, --global, the current directory, and an existing opencode.jsonc", () => {
  inTempDir((dir) => {
    const cwd = join(dir, "project"), home = join(dir, "home"), xdg = join(dir, "xdg");
    for (const d of [cwd, home, xdg]) mkdirSync(d);
    const ctx = (env = {}) => ({ cwd, env, home });

    assert.equal(resolveTarget({}, ctx()), join(cwd, "opencode.json"));
    assert.equal(resolveTarget({ "--config": "sub/my.json" }, ctx()), join(cwd, "sub", "my.json"));
    assert.equal(resolveTarget({ "--config": join(dir, "abs.jsonc") }, ctx()), join(dir, "abs.jsonc"));
    assert.equal(resolveTarget({ "--global": true }, ctx()), join(home, ".config", "opencode", "opencode.json"));
    assert.equal(resolveTarget({ "--global": true }, ctx({ XDG_CONFIG_HOME: xdg })), join(xdg, "opencode", "opencode.json"));
    // a relative XDG_CONFIG_HOME is invalid per the XDG spec and is ignored
    assert.equal(resolveTarget({ "--global": true }, ctx({ XDG_CONFIG_HOME: "relative/dir" })), join(home, ".config", "opencode", "opencode.json"));
    assert.throws(() => resolveTarget({ "--global": true, "--config": "x.json" }, ctx()), userError(/either --global or --config/));

    // an existing opencode.jsonc is edited rather than creating opencode.json beside it
    writeFileSync(join(cwd, "opencode.jsonc"), "{}");
    assert.equal(resolveTarget({}, ctx()), join(cwd, "opencode.jsonc"));
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(join(home, ".config", "opencode", "opencode.jsonc"), "{}");
    assert.equal(resolveTarget({ "--global": true }, ctx()), join(home, ".config", "opencode", "opencode.jsonc"));
    // when both exist, opencode.json is the one edited
    writeFileSync(join(cwd, "opencode.json"), "{}");
    assert.equal(resolveTarget({}, ctx()), join(cwd, "opencode.json"));
  });
});

test("readTarget: a missing file, a normal file, and a BOM", () => {
  inTempDir((dir) => {
    const p = join(dir, "opencode.json");
    assert.deepEqual(readTarget(p), { path: p, exists: false });
    assert.deepEqual(readTarget(join(dir, "no", "such", "dir", "opencode.json")).exists, false);
    writeFileSync(p, "﻿{\"a\": \"é\"}");
    const t = readTarget(p);
    assert.equal(t.exists, true);
    assert.equal(t.text, "﻿{\"a\": \"é\"}");
    assert.ok(t.bytes.equals(readFileSync(p)));
  });
});

test("readTarget refuses things it must not replace", () => {
  inTempDir((dir) => {
    mkdirSync(join(dir, "a-directory"));
    assert.throws(() => readTarget(join(dir, "a-directory")), userError(/is not a regular file/));

    writeFileSync(join(dir, "utf16.json"), Buffer.from("﻿{\"a\": 1}", "utf16le"));
    assert.throws(() => readTarget(join(dir, "utf16.json")), userError(/not valid UTF-8/));
    writeFileSync(join(dir, "utf16-no-bom.json"), Buffer.from("{\"a\": 1}", "utf16le"));
    assert.throws(() => readTarget(join(dir, "utf16-no-bom.json")), userError(/not valid UTF-8/));
    writeFileSync(join(dir, "latin1.json"), Buffer.from([0x7b, 0x22, 0xe9, 0x22, 0x7d]));
    assert.throws(() => readTarget(join(dir, "latin1.json")), userError(/not valid UTF-8/));

    // a path whose parent is a file: nothing to read; the write is what fails (see below)
    writeFileSync(join(dir, "file"), "x");
    assert.equal(readTarget(join(dir, "file", "opencode.json")).exists, false);
  });
});

test("readTarget follows a symlink and refuses a dangling one", { skip: !posix }, () => {
  inTempDir((dir) => {
    const real = join(dir, "dotfiles", "opencode.json");
    mkdirSync(join(dir, "dotfiles"));
    writeFileSync(real, "{}");
    const link = join(dir, "opencode.json");
    symlinkSync(real, link);
    assert.equal(readTarget(link).path, real);

    const dangling = join(dir, "dangling.json");
    symlinkSync(join(dir, "gone.json"), dangling);
    assert.throws(() => readTarget(dangling), userError(/symlink to a file that does not exist/));
    assert.ok(lstatSync(dangling).isSymbolicLink(), "the link is left in place");
  });
});

test("readTarget refuses a read-only file", { skip: !notRoot }, () => {
  inTempDir((dir) => {
    const p = join(dir, "opencode.json");
    writeFileSync(p, "{}");
    chmodSync(p, 0o444);
    assert.throws(() => readTarget(p), userError(/read-only/));
    assert.equal(readFileSync(p, "utf8"), "{}");
  });
});

test("writeAtomic creates a new file (and its directories) with no backup and no litter", () => {
  inTempDir((dir) => {
    const p = join(dir, "deep", "er", "opencode.json");
    const { backup } = writeAtomic(readTarget(p), "{\"new\": true}\n");
    assert.equal(backup, null);
    assert.equal(readFileSync(p, "utf8"), "{\"new\": true}\n");
    assert.deepEqual(readdirSync(join(dir, "deep", "er")), ["opencode.json"]);
  });
});

test("writeAtomic backs up the exact previous bytes and never overwrites a backup", () => {
  inTempDir((dir) => {
    const p = join(dir, "opencode.json");
    writeFileSync(p, "version 1");
    const first = writeAtomic(readTarget(p), "version 2");
    assert.equal(first.backup, `${p}.bak`);
    const second = writeAtomic(readTarget(p), "version 3");
    assert.equal(second.backup, `${p}.bak.1`);
    const third = writeAtomic(readTarget(p), "version 4");
    assert.equal(third.backup, `${p}.bak.2`);

    assert.equal(readFileSync(p, "utf8"), "version 4");
    assert.equal(readFileSync(`${p}.bak`, "utf8"), "version 1", "the pristine copy survives later runs");
    assert.equal(readFileSync(`${p}.bak.1`, "utf8"), "version 2");
    assert.equal(readFileSync(`${p}.bak.2`, "utf8"), "version 3");
    assert.deepEqual(readdirSync(dir).sort(), ["opencode.json", "opencode.json.bak", "opencode.json.bak.1", "opencode.json.bak.2"]);
  });
});

test("writeAtomic keeps the file mode, also on the backup", { skip: !posix }, () => {
  inTempDir((dir) => {
    const p = join(dir, "opencode.json");
    writeFileSync(p, "secret-ish");
    chmodSync(p, 0o600);
    const { backup } = writeAtomic(readTarget(p), "updated");
    assert.equal(statSync(p).mode & 0o777, 0o600);
    assert.equal(statSync(backup).mode & 0o777, 0o600);

    // a wider mode than the umask would grant is restored too
    chmodSync(p, 0o666);
    writeAtomic(readTarget(p), "again");
    assert.equal(statSync(p).mode & 0o777, 0o666);
  });
});

test("writeAtomic writes through a symlink instead of replacing it", { skip: !posix }, () => {
  inTempDir((dir) => {
    const real = join(dir, "dotfiles", "opencode.json");
    mkdirSync(join(dir, "dotfiles"));
    writeFileSync(real, "old");
    const link = join(dir, "opencode.json");
    symlinkSync(real, link);
    const { backup } = writeAtomic(readTarget(link), "new");
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readFileSync(real, "utf8"), "new");
    assert.equal(backup, `${real}.bak`);
    assert.deepEqual(readdirSync(dir).sort(), ["dotfiles", "opencode.json"]);
  });
});

test("writeAtomic is not blocked by a temp file left behind by a crashed run", () => {
  inTempDir((dir) => {
    const p = join(dir, "opencode.json");
    writeFileSync(p, "old");
    writeFileSync(join(dir, ".opencode.json.99999.deadbeef0000.tmp"), "half written");
    writeAtomic(readTarget(p), "new");
    assert.equal(readFileSync(p, "utf8"), "new");
  });
});

test("writeAtomic refuses when the file changed after it was read, and leaves no trace", () => {
  inTempDir((dir) => {
    const p = join(dir, "opencode.json");
    writeFileSync(p, "as read");
    const target = readTarget(p);
    writeFileSync(p, "edited by someone else");
    assert.throws(() => writeAtomic(target, "ours"), userError(/changed by another process/));
    assert.equal(readFileSync(p, "utf8"), "edited by someone else");
    assert.deepEqual(readdirSync(dir), ["opencode.json"], "no temp file and no backup left behind");

    // same for a file that appeared where there was none
    const q = join(dir, "new.json");
    const missing = readTarget(q);
    writeFileSync(q, "appeared");
    assert.throws(() => writeAtomic(missing, "ours"), userError(/changed by another process/));
    assert.equal(readFileSync(q, "utf8"), "appeared");
    assert.deepEqual(readdirSync(dir).sort(), ["new.json", "opencode.json"]);
  });
});

test("writeAtomic fails cleanly when the directory is not writable", { skip: !notRoot }, () => {
  inTempDir((dir) => {
    const locked = join(dir, "locked");
    mkdirSync(locked);
    const p = join(locked, "opencode.json");
    writeFileSync(p, "old");
    const target = readTarget(p);
    chmodSync(locked, 0o555);
    try {
      assert.throws(() => writeAtomic(target, "new"), userError(/cannot write .*nothing was changed/));
      assert.equal(readFileSync(p, "utf8"), "old");
      assert.deepEqual(readdirSync(locked), ["opencode.json"]);
    } finally { chmodSync(locked, 0o755); }
  });
});

test("writeAtomic reports an unusable parent path as an error, not a crash", () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, "file"), "x");
    const target = { path: join(dir, "file", "sub", "opencode.json"), exists: false };
    assert.throws(() => writeAtomic(target, "new"), userError(/cannot write/));
    assert.ok(!existsSync(join(dir, "file", "sub")));
  });
});
