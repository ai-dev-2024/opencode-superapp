// config-io.mjs — find, read and safely replace the user's OpenCode config file.
//
// Guarantees:
//   - the target is only ever replaced by a complete new file (temp file in the same
//     directory, fsync, rename), so a crash cannot leave a half-written config;
//   - before an existing file is changed, its exact bytes are copied to "<file>.bak"
//     (then ".bak.1", ".bak.2", ...). An earlier backup is never overwritten;
//   - symlinks are followed, not replaced; read-only files, non-files and files that are
//     not UTF-8 are refused; the file's mode is kept;
//   - if the file changes while the command runs, nothing is written.
import {
  accessSync, chmodSync, closeSync, constants, existsSync, fchmodSync, fchownSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { UserError } from "./errors.mjs";

// Which file `add` / `stack` should edit.
//   --config PATH   that file (relative to cwd)
//   --global        $XDG_CONFIG_HOME/opencode or ~/.config/opencode
//   neither         the current directory
// In a directory, an existing opencode.jsonc is used when there is no opencode.json, so the
// kit does not create a second config file next to the one OpenCode already reads.
export function resolveTarget(opts, { cwd, env, home }) {
  if (opts["--global"] && opts["--config"]) throw new UserError("use either --global or --config, not both");
  if (opts["--config"]) return resolve(cwd, opts["--config"]);
  let dir = cwd;
  if (opts["--global"]) {
    const xdg = env.XDG_CONFIG_HOME;
    dir = join(xdg && isAbsolute(xdg) ? xdg : join(home, ".config"), "opencode");
  }
  const json = join(dir, "opencode.json");
  const jsonc = join(dir, "opencode.jsonc");
  return !existsSync(json) && existsSync(jsonc) ? jsonc : json;
}

// Read the target. Returns { path, exists: false } for a file that is not there yet, else
// { path (symlinks resolved), exists: true, bytes, text, mode, uid, gid }.
export function readTarget(path) {
  let st;
  try { st = lstatSync(path); } catch (e) {
    if (e.code === "ENOENT") return { path, exists: false };
    throw new UserError(`cannot read ${path} (${e.code})`);
  }
  let real = path;
  if (st.isSymbolicLink()) {
    try { real = realpathSync(path); st = statSync(real); } catch {
      throw new UserError(`${path} is a symlink to a file that does not exist; not replacing the link`);
    }
  }
  if (!st.isFile()) throw new UserError(`${path} is not a regular file`);
  try { accessSync(real, constants.W_OK); } catch { throw new UserError(`${path} is read-only; not modifying it`); }
  const bytes = readFileSync(real);
  const text = bytes.toString("utf8");
  // Bytes that do not survive a UTF-8 round trip, or NULs (UTF-16 without a BOM), mean the
  // file is in another encoding; editing it as UTF-8 would corrupt it.
  if (!Buffer.from(text, "utf8").equals(bytes) || text.includes("\u0000")) {
    throw new UserError(`${path} is not valid UTF-8 (UTF-16 files are not supported); re-save it as UTF-8`);
  }
  return { path: real, exists: true, bytes, text, mode: st.mode & 0o777, uid: st.uid, gid: st.gid };
}

// First of "<path>.bak", "<path>.bak.1", ... that does not exist yet.
function freeBackupPath(path) {
  for (let n = 0; n < 10_000; n++) {
    const candidate = n === 0 ? `${path}.bak` : `${path}.bak.${n}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new UserError(`too many backups next to ${path}; delete some *.bak files`);
}

// Windows refuses to rename over a file another process has open; that usually clears.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return renameSync(from, to); } catch (e) {
      const transient = process.platform === "win32" && ["EPERM", "EBUSY", "EACCES"].includes(e.code);
      if (!transient || attempt >= 5) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

// Replace `target` (as returned by readTarget) with `text`. Returns { backup }: the path of
// the backup that was written, or null when there was nothing to back up.
export function writeAtomic(target, text) {
  const { path, exists } = target;
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let backup = null;
  let fd;
  try {
    mkdirSync(dir, { recursive: true });
    if (exists && target.bytes.length) {
      const candidate = freeBackupPath(path);
      // From the bytes we parsed, not a second read, and never over an existing file.
      writeFileSync(candidate, target.bytes, { flag: "wx", mode: target.mode });
      backup = candidate; // only ours to clean up once we have created it
      if (process.platform !== "win32") chmodSync(backup, target.mode);
    }
    fd = openSync(tmp, "wx", exists ? target.mode : 0o666);
    writeFileSync(fd, text);
    if (exists && process.platform !== "win32") {
      fchmodSync(fd, target.mode); // open()'s mode is narrowed by the umask
      try { fchownSync(fd, target.uid, target.gid); } catch { /* not the owner (e.g. sudo): keep going */ }
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    const changed = exists ? !readFileSync(path).equals(target.bytes) : existsSync(path);
    if (changed) throw new UserError(`${path} was changed by another process while this command ran; nothing was written`);
    renameWithRetry(tmp, path);
    return { backup };
  } catch (e) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(tmp); } catch { /* never created */ }
    if (backup) try { unlinkSync(backup); } catch { /* never created */ }
    if (e instanceof UserError) throw e;
    throw new UserError(`cannot write ${path} (${e.code || e.name}); nothing was changed`);
  }
}
