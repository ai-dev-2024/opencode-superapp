// registry.mjs — pure helpers shared by mcp-manager.mjs and validate.mjs (no I/O side effects
// beyond reading kit files).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "./schema.mjs";
import { UserError } from "./errors.mjs";

export const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_SCHEMA_URL = "https://opencode.ai/config.json";

// Keys OpenCode itself owns directly under "mcp"; a server must not be called either.
export const RESERVED_IDS = ["servers", "timeout"];

// Token-shaped literals. Every pattern needs a realistic tail, so prose such as
// "ghp_ token with repo scope" in a description is not flagged.
export const SECRET_PATTERNS = [
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["Slack token", /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/],
  ["AWS access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Stripe live key", /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/],
  ["sk- API key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

// An environment variable or header whose NAME says it carries a credential.
const CREDENTIAL_NAME = /TOKEN|KEY|SECRET|PASS|AUTH|CREDENTIAL/i;
// "${VAR}", "$VAR", "%VAR%": OpenCode passes these through literally.
const SHELL_PLACEHOLDER = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%/;
const ENV_PLACEHOLDER = /\{env:([^}]*)\}/g;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Stable JSON with sorted keys, for order-insensitive deep comparison.
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const sameJson = (a, b) => canon(a) === canon(b);

export function loadRegistry(kit = KIT) { return readJson(resolve(kit, "registry.json")); }
export function loadSchema(kit = KIT) { return readJson(resolve(kit, "schema", "registry.schema.json")); }
export function loadConfigSchema(kit = KIT) { return readJson(resolve(kit, "schema", "config.schema.json")); }

export function listStacks(kit = KIT) {
  return readdirSync(resolve(kit, "stacks")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

// Server ids a stack installs (stacks/<name>.json is the source of truth). null if unknown.
// The name must be one of the files in stacks/, so "../templates/git" is not a stack.
export function stackIds(name, kit = KIT) {
  if (!listStacks(kit).includes(name)) return null;
  return Object.keys(readJson(resolve(kit, "stacks", `${name}.json`)).mcp || {});
}

export function loadTemplate(id, kit = KIT) {
  const p = resolve(kit, "templates", `${id}.json`);
  if (!ID_PATTERN.test(String(id)) || !existsSync(p)) throw new Error(`unknown server id: ${id} (no templates/${id}.json)`);
  return readJson(p);
}

export function searchRegistry(registry, query) {
  const q = query.toLowerCase();
  return registry.filter((r) =>
    [r.id, r.title, r.description, r.category, (r.stacks || []).join(" ")].join(" ").toLowerCase().includes(q));
}

// Required env vars (deduplicated, in first-seen order) for a set of server ids.
export function missingEnvFor(registry, ids) {
  const out = new Map();
  for (const id of ids) {
    const e = registry.find((r) => r.id === id);
    for (const v of e?.envVars || []) if (v.required) out.set(v.name, v.desc);
  }
  return [...out.entries()];
}

// Decide what installing `entries` into an OpenCode config would change. Pure: returns a new
// config and never mutates the input.
//
// The user's config always wins. A server id that is already present is KEPT as it is, even
// if it differs from the template, unless `force` is set. Nothing else in the config is
// touched: no other key is added, removed or rewritten (not even "$schema").
//
// Throws UserError when the config is not something this kit can safely extend.
export function mergeServers(config, entries, { force = false } = {}) {
  if (!isPlainObject(config)) throw new UserError("the config root must be a JSON object");
  const hasMcp = Object.hasOwn(config, "mcp");
  if (hasMcp && !isPlainObject(config.mcp)) throw new UserError('"mcp" must be a JSON object');
  const mcp = hasMcp ? { ...config.mcp } : {};
  if (Object.hasOwn(mcp, "servers")) {
    throw new UserError('this config uses the newer "mcp.servers" layout, which this kit does not write yet; '
      + "add the servers under mcp.servers by hand (see templates/<id>.json) or with `opencode mcp add`");
  }
  const added = [], unchanged = [], kept = [], overwritten = [];
  for (const [id, entry] of Object.entries(entries)) {
    if (!Object.hasOwn(mcp, id)) { added.push(id); mcp[id] = entry; }
    else if (sameJson(mcp[id], entry)) unchanged.push(id);
    else if (force) { overwritten.push(id); mcp[id] = entry; }
    else kept.push(id);
  }
  return { config: { ...config, mcp }, added, unchanged, kept, overwritten };
}

// Strict command-line parsing. `spec` maps each accepted option to "flag" or "value".
// Accepts "--name value" and "--name=value". Anything starting with "-" that is not in the
// spec is an error, so a typo such as --gloabl can never be silently ignored.
export function parseArgs(argv, spec = {}) {
  const opts = {}, positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-") || arg === "-") { positionals.push(arg); continue; }
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!Object.hasOwn(spec, name)) throw new UserError(`unknown option '${name}'`);
    if (Object.hasOwn(opts, name)) throw new UserError(`option '${name}' given more than once`);
    if (spec[name] === "flag") {
      if (eq !== -1) throw new UserError(`option '${name}' does not take a value`);
      opts[name] = true;
    } else {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value === "" || (eq === -1 && value.startsWith("-"))) throw new UserError(`option '${name}' needs a value`);
      opts[name] = value;
    }
  }
  return { opts, positionals };
}

// The OpenCode config entry a registry entry stands for. templates/<id>.json must hold
// exactly this under mcp.<id>; stacks must hold the same entry again.
export function projectEntry(r) {
  const e = { enabled: true, type: r.type };
  if (r.type === "local") {
    e.command = r.command;
    if (isPlainObject(r.environment) && Object.keys(r.environment).length) e.environment = r.environment;
  } else {
    e.url = r.url;
    if (isPlainObject(r.headers) && Object.keys(r.headers).length) e.headers = r.headers;
    if (Object.hasOwn(r, "oauth")) e.oauth = r.oauth;
  }
  return e;
}

// Rules for one registry entry that the JSON Schema subset cannot express.
function entryRuleErrors(r) {
  const errors = [];
  const id = r.id;
  if (RESERVED_IDS.includes(id)) errors.push(`${id}: id is reserved by OpenCode under "mcp"`);
  if (r.toolsPrefix !== `${id}_*`) errors.push(`${id}: toolsPrefix must be "${id}_*" (OpenCode names tools <server>_<tool>), got ${JSON.stringify(r.toolsPrefix)}`);

  if (r.type === "local") {
    if (!Array.isArray(r.command)) errors.push(`${id}: local needs command[]`);
    for (const k of ["url", "headers", "oauth"]) if (Object.hasOwn(r, k)) errors.push(`${id}: local server must not set ${k}`);
  }
  if (r.type === "remote") {
    if (!r.url) errors.push(`${id}: remote needs url`);
    for (const k of ["command", "environment"]) if (Object.hasOwn(r, k)) errors.push(`${id}: remote server must not set ${k}`);
    if (r.oauth === true) errors.push(`${id}: oauth must be false or an object (OpenCode has no "oauth": true)`);
  }

  const strings = [
    ...(Array.isArray(r.command) ? r.command.map((v, i) => [`command[${i}]`, v]) : []),
    ...Object.entries(isPlainObject(r.environment) ? r.environment : {}).map(([k, v]) => [`environment.${k}`, v, k]),
    ...(typeof r.url === "string" ? [["url", r.url]] : []),
    ...Object.entries(isPlainObject(r.headers) ? r.headers : {}).map(([k, v]) => [`headers.${k}`, v, k]),
  ].filter(([, v]) => typeof v === "string");

  const declared = new Set((Array.isArray(r.envVars) ? r.envVars : []).map((v) => v?.name));
  const used = new Set();
  for (const [where, value, key] of strings) {
    if (SHELL_PLACEHOLDER.test(value)) errors.push(`${id}: ${where} uses a shell-style placeholder; OpenCode only expands {env:VAR}`);
    const names = [...value.matchAll(ENV_PLACEHOLDER)].map((m) => m[1]);
    for (const name of names) {
      used.add(name);
      if (!declared.has(name)) errors.push(`${id}: ${where} references {env:${name}}, which is not declared in envVars`);
    }
    if (key !== undefined && !names.length && CREDENTIAL_NAME.test(key)) {
      errors.push(`${id}: ${where} holds a literal value; credentials must be {env:VAR} placeholders`);
    }
  }
  for (const name of declared) {
    if (typeof name === "string" && !used.has(name)) errors.push(`${id}: envVars declares ${name}, but nothing references {env:${name}}`);
  }
  if (declared.size !== (r.envVars || []).length) errors.push(`${id}: envVars has duplicate names`);
  return errors;
}

// Full consistency check of a kit directory. Returns { errors, stats }. Never throws for
// bad kit data: unreadable or invalid files are reported as errors.
export function validateKit(kit = KIT) {
  const errors = [];
  const load = (label, ...parts) => {
    try { return readJson(resolve(kit, ...parts)); } catch (e) {
      errors.push(`${label}: ${e.code === "ENOENT" ? "file is missing" : `invalid JSON (${e.message})`}`);
      return undefined;
    }
  };
  const scanSecrets = (label, ...parts) => {
    let text;
    try { text = readFileSync(resolve(kit, ...parts), "utf8"); } catch { return; }
    for (const [what, re] of SECRET_PATTERNS) if (re.test(text)) errors.push(`${label}: appears to contain a literal secret (${what})`);
  };
  const jsonFiles = (dir) => {
    try { return readdirSync(resolve(kit, dir)).filter((f) => f.endsWith(".json")).sort(); } catch {
      errors.push(`${dir}/: directory is missing`);
      return [];
    }
  };

  const registrySchema = load("schema/registry.schema.json", "schema", "registry.schema.json");
  const configSchema = load("schema/config.schema.json", "schema", "config.schema.json");
  const registry = load("registry.json", "registry.json");
  if (registry === undefined) return { errors, stats: {} };
  if (registrySchema) errors.push(...validateSchema(registry, registrySchema, "registry"));
  if (!Array.isArray(registry)) return { errors, stats: {} };
  scanSecrets("registry.json", "registry.json");

  // Only well-formed entries take part in cross-file checks; the rest are already reported.
  const entries = registry.filter((r) => isPlainObject(r) && typeof r.id === "string");
  const byId = new Map();
  for (const r of entries) {
    if (byId.has(r.id)) errors.push(`duplicate id ${r.id}`);
    byId.set(r.id, r);
  }

  // registry entry rules + its template
  const templateEntries = new Map();
  for (const r of byId.values()) {
    errors.push(...entryRuleErrors(r));
    const rel = `templates/${r.id}.json`;
    if (!existsSync(resolve(kit, "templates", `${r.id}.json`))) { errors.push(`${r.id}: missing ${rel}`); continue; }
    const tpl = load(rel, "templates", `${r.id}.json`);
    if (tpl === undefined) continue;
    scanSecrets(rel, "templates", `${r.id}.json`);
    if (configSchema) errors.push(...validateSchema(tpl, configSchema, rel));
    const mcp = isPlainObject(tpl) && isPlainObject(tpl.mcp) ? tpl.mcp : {};
    const e = mcp[r.id];
    if (!isPlainObject(e)) { errors.push(`${r.id}: template missing mcp.${r.id}`); continue; }
    for (const other of Object.keys(mcp)) if (other !== r.id) errors.push(`${rel}: must define only "${r.id}", found "${other}"`);
    templateEntries.set(r.id, e);
    if (e.type !== r.type) { errors.push(`${r.id}: template type ${e.type} != registry ${r.type}`); continue; }
    const want = projectEntry(r);
    for (const field of ["enabled", "command", "environment", "url", "headers", "oauth"]) {
      if (!sameJson(e[field], want[field])) errors.push(`${r.id}: template ${field} differs from registry.json`);
    }
  }

  const templates = jsonFiles("templates");
  for (const f of templates) if (!byId.has(f.slice(0, -5))) errors.push(`templates/${f} has no registry entry`);

  // stacks: schema, known ids, entry identical to the template, membership mirrors registry.json
  const stacks = {};
  const membership = new Map();
  for (const f of jsonFiles("stacks")) {
    const name = f.slice(0, -5);
    const rel = `stacks/${f}`;
    const stack = load(rel, "stacks", f);
    if (stack === undefined) continue;
    scanSecrets(rel, "stacks", f);
    if (configSchema) errors.push(...validateSchema(stack, configSchema, rel));
    const mcp = isPlainObject(stack) && isPlainObject(stack.mcp) ? stack.mcp : {};
    stacks[name] = Object.keys(mcp).length;
    for (const [id, entry] of Object.entries(mcp)) {
      if (!byId.has(id)) { errors.push(`stack ${name} references unknown id ${id}`); continue; }
      membership.set(id, [...(membership.get(id) || []), name]);
      if (templateEntries.has(id) && !sameJson(entry, templateEntries.get(id))) {
        errors.push(`stack ${name}: entry ${id} differs from templates/${id}.json`);
      }
    }
  }
  for (const r of byId.values()) {
    const listed = Array.isArray(r.stacks) ? [...r.stacks].sort() : [];
    const actual = [...(membership.get(r.id) || [])].sort();
    if (!sameJson(listed, actual)) {
      errors.push(`${r.id}: registry stacks [${listed.join(", ")}] != stack files [${actual.join(", ")}]`);
    }
  }

  // opencode.example.json: servers it shows must be the ones the kit installs
  if (existsSync(resolve(kit, "opencode.example.json"))) {
    const example = load("opencode.example.json", "opencode.example.json");
    scanSecrets("opencode.example.json", "opencode.example.json");
    const mcp = isPlainObject(example) && isPlainObject(example.mcp) ? example.mcp : {};
    for (const [id, entry] of Object.entries(mcp)) {
      if (templateEntries.has(id) && !sameJson(entry, templateEntries.get(id))) {
        errors.push(`opencode.example.json: entry ${id} differs from templates/${id}.json`);
      }
    }
  }

  const stats = {
    servers: registry.length,
    local: entries.filter((r) => r.type === "local").length,
    remote: entries.filter((r) => r.type === "remote").length,
    templates: templates.length,
    stacks,
  };
  return { errors, stats };
}
