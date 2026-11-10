// Offline tests for the pure parts of scripts/check-upstream.mjs. The network check itself
// is run by hand / on a schedule, never from `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { packageRef, lookupUrl, packageVerdict, endpointVerdict } from "../scripts/lib/upstream.mjs";
import { loadRegistry } from "../scripts/lib/registry.mjs";

test("packageRef reads npm packages from npx commands", () => {
  assert.deepEqual(packageRef(["npx", "-y", "@modelcontextprotocol/server-memory"]), { ecosystem: "npm", name: "@modelcontextprotocol/server-memory" });
  assert.deepEqual(packageRef(["npx", "-y", "@supabase/mcp-server-supabase@latest", "--read-only"]), { ecosystem: "npm", name: "@supabase/mcp-server-supabase" });
  assert.deepEqual(packageRef(["npx", "chrome-devtools-mcp@latest"]), { ecosystem: "npm", name: "chrome-devtools-mcp" });
  assert.deepEqual(packageRef(["npx", "shadcn@latest", "mcp"]), { ecosystem: "npm", name: "shadcn" });
});

test("packageRef reads PyPI packages from uvx commands", () => {
  assert.deepEqual(packageRef(["uvx", "mcp-server-git"]), { ecosystem: "pypi", name: "mcp-server-git" });
  assert.deepEqual(packageRef(["uvx", "awslabs.aws-documentation-mcp-server@latest"]), { ecosystem: "pypi", name: "awslabs.aws-documentation-mcp-server" });
  assert.deepEqual(packageRef(["uvx", "--from", "some-dist==1.2", "some-bin"]), { ecosystem: "pypi", name: "some-dist" });
  assert.deepEqual(packageRef(["uvx", "--python", "3.12", "pkg[extra]"]), { ecosystem: "pypi", name: "pkg" });
});

test("packageRef reads the image from docker run, skipping options and their values", () => {
  assert.deepEqual(packageRef(["docker", "run", "-i", "--rm", "-e", "TOKEN", "ghcr.io/github/github-mcp-server"]), { ecosystem: "ghcr", host: "ghcr.io", name: "github/github-mcp-server" });
  assert.deepEqual(packageRef(["docker", "run", "-i", "--rm", "-e", "A", "-e", "B", "grafana/mcp-grafana:latest", "-t", "stdio"]), { ecosystem: "dockerhub", name: "grafana/mcp-grafana" });
  assert.deepEqual(packageRef(["docker", "run", "--rm", "redis:7"]), { ecosystem: "dockerhub", name: "library/redis" });
  assert.deepEqual(packageRef(["docker", "run", "registry.example.com:5000/team/img@sha256:abc"]), { ecosystem: "oci", host: "registry.example.com:5000", name: "team/img" });
});

test("packageRef returns null for runners it cannot check", () => {
  assert.equal(packageRef(["node", "server.js"]), null);
  assert.equal(packageRef([]), null);
  assert.equal(packageRef(undefined), null);
  assert.equal(packageRef(["docker", "compose", "up"]), null);
});

test("lookupUrl builds the registry URL for each ecosystem", () => {
  assert.equal(lookupUrl({ ecosystem: "npm", name: "@scope/pkg" }), "https://registry.npmjs.org/@scope%2fpkg/latest");
  assert.equal(lookupUrl({ ecosystem: "pypi", name: "mcp-server-time" }), "https://pypi.org/pypi/mcp-server-time/json");
  assert.equal(lookupUrl({ ecosystem: "dockerhub", name: "hashicorp/terraform-mcp-server" }), "https://hub.docker.com/v2/repositories/hashicorp/terraform-mcp-server/");
  assert.equal(lookupUrl({ ecosystem: "ghcr", name: "github/github-mcp-server" }), "https://ghcr.io/v2/github/github-mcp-server/tags/list");
  assert.equal(lookupUrl({ ecosystem: "oci", name: "x" }), null);
  assert.equal(lookupUrl(null), null);
});

test("verdicts: a missing package or a gone endpoint fails, auth challenges do not", () => {
  assert.equal(packageVerdict(200), "ok");
  assert.equal(packageVerdict(404), "fail");
  assert.equal(packageVerdict(429), "warn");
  for (const alive of [200, 400, 401, 403, 405, 406]) assert.equal(endpointVerdict(alive), "ok", String(alive));
  for (const gone of [404, 410]) assert.equal(endpointVerdict(gone), "fail", String(gone));
  assert.equal(endpointVerdict(503), "warn");
});

test("every local server in the registry uses a runner the upstream check understands", () => {
  for (const r of loadRegistry().filter((r) => r.type === "local")) {
    const ref = packageRef(r.command);
    assert.ok(ref && lookupUrl(ref), `${r.id}: ${r.command.join(" ")}`);
  }
});
