// check-upstream.mjs — does every registry entry still point at something real?
// For local servers: the npm / PyPI / Docker Hub / GHCR artefact must exist (npm deprecation
// is reported as a warning). For remote servers: the URL must answer an MCP `initialize`
// POST with something other than 404/410.
//
// Needs the network, so it is NOT part of `npm test`. Run it by hand or on a schedule:
//   node scripts/check-upstream.mjs [--json] [id...]
// Exit code 1 when any entry fails, 0 otherwise (warnings do not fail).
import { loadRegistry } from "./lib/registry.mjs";
import { packageRef, lookupUrl, packageVerdict, endpointVerdict } from "./lib/upstream.mjs";

const TIMEOUT_MS = 20_000;
const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "opencode-superapp-check", version: "1" } },
});

async function request(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res;
}

async function ghcrToken(name) {
  const res = await request(`https://ghcr.io/token?scope=repository:${name}:pull`);
  return res.ok ? (await res.json()).token : null;
}

async function checkLocal(entry) {
  const ref = packageRef(entry.command);
  const url = lookupUrl(ref);
  if (!url) return { verdict: "warn", target: (entry.command || []).join(" "), detail: "runner not recognised; not checked" };
  const target = `${ref.ecosystem}:${ref.name}`;
  const headers = {};
  if (ref.ecosystem === "ghcr") {
    const token = await ghcrToken(ref.name);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await request(url, { headers });
  let verdict = packageVerdict(res.status);
  let detail = `HTTP ${res.status}`;
  if (verdict === "ok" && ref.ecosystem === "npm") {
    const meta = await res.json().catch(() => ({}));
    if (meta.deprecated) { verdict = "warn"; detail = `deprecated upstream: ${String(meta.deprecated).slice(0, 100)}`; }
  }
  return { verdict, target, detail };
}

async function checkRemote(entry) {
  const res = await request(entry.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: INIT_BODY,
  });
  return { verdict: endpointVerdict(res.status), target: entry.url, detail: `HTTP ${res.status}` };
}

async function checkEntry(entry) {
  try {
    const r = entry.type === "remote" ? await checkRemote(entry) : await checkLocal(entry);
    return { id: entry.id, type: entry.type, ...r };
  } catch (e) {
    return { id: entry.id, type: entry.type, verdict: "fail", target: entry.url || (entry.command || []).join(" "), detail: `unreachable: ${e.name}` };
  }
}

async function main(argv) {
  const json = argv.includes("--json");
  const ids = argv.filter((a) => !a.startsWith("--"));
  const unknownFlags = argv.filter((a) => a.startsWith("--") && a !== "--json");
  if (unknownFlags.length) { console.error(`error: unknown option ${unknownFlags[0]}\nUsage: check-upstream.mjs [--json] [id...]`); return 2; }
  let registry = loadRegistry();
  const unknown = ids.filter((id) => !registry.some((r) => r.id === id));
  if (unknown.length) { console.error(`error: unknown id ${unknown.join(", ")}`); return 2; }
  if (ids.length) registry = registry.filter((r) => ids.includes(r.id));

  const results = [];
  const queue = [...registry];
  const worker = async () => { for (let e = queue.shift(); e; e = queue.shift()) results.push(await checkEntry(e)); };
  await Promise.all(Array.from({ length: 6 }, worker));
  results.sort((a, b) => registry.findIndex((r) => r.id === a.id) - registry.findIndex((r) => r.id === b.id));

  const count = (v) => results.filter((r) => r.verdict === v).length;
  if (json) console.log(JSON.stringify(results, null, 2));
  else {
    for (const r of results) console.log(`${r.verdict.toUpperCase().padEnd(4)} ${r.id.padEnd(22)} ${r.target}  (${r.detail})`);
    console.log(`\n${count("ok")} ok, ${count("warn")} warning(s), ${count("fail")} failure(s) across ${results.length} servers`);
  }
  return count("fail") ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
