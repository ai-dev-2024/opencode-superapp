// upstream.mjs — pure helpers for scripts/check-upstream.mjs: work out which package or
// image a server's command[] refers to, and how to judge an HTTP status. No network here,
// so this file is unit-tested offline.

// docker run options that consume the following argument.
const DOCKER_VALUE_OPTS = new Set([
  "-e", "--env", "--env-file", "-v", "--volume", "--mount", "-p", "--publish", "--name",
  "--network", "--net", "-w", "--workdir", "-u", "--user", "--entrypoint", "--platform", "-l", "--label",
]);
// uvx options that consume the following argument.
const UVX_VALUE_OPTS = new Set(["--with", "--python", "-p", "--index", "--index-url", "--extra-index-url"]);

// "@scope/name@1.2.3" -> "@scope/name"; "name@latest" -> "name".
function stripNpmVersion(spec) {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

// "pkg[extra]==1.0", "pkg@latest" -> "pkg".
function stripPyVersion(spec) {
  return spec.replace(/\[.*$/, "").replace(/(@|==|>=|<=|~=|>|<).*$/, "");
}

function dockerImage(image) {
  const noDigest = image.split("@")[0];
  const lastSlash = noDigest.lastIndexOf("/");
  const colon = noDigest.indexOf(":", lastSlash + 1);
  const path = colon === -1 ? noDigest : noDigest.slice(0, colon);
  const parts = path.split("/");
  const hasHost = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]);
  if (hasHost) return { ecosystem: parts[0] === "ghcr.io" ? "ghcr" : "oci", host: parts[0], name: parts.slice(1).join("/") };
  return { ecosystem: "dockerhub", name: parts.length === 1 ? `library/${parts[0]}` : path };
}

// Which published artefact does this command[] run? Returns { ecosystem, name } or null
// when the runner is not one we know how to check.
export function packageRef(command) {
  if (!Array.isArray(command) || !command.length) return null;
  const [runner, ...rest] = command;
  if (runner === "npx") {
    const spec = rest.find((a) => !a.startsWith("-"));
    return spec ? { ecosystem: "npm", name: stripNpmVersion(spec) } : null;
  }
  if (runner === "uvx") {
    const from = rest.indexOf("--from");
    if (from !== -1 && rest[from + 1]) return { ecosystem: "pypi", name: stripPyVersion(rest[from + 1]) };
    for (let i = 0; i < rest.length; i++) {
      if (UVX_VALUE_OPTS.has(rest[i])) { i++; continue; }
      if (!rest[i].startsWith("-")) return { ecosystem: "pypi", name: stripPyVersion(rest[i]) };
    }
    return null;
  }
  if (runner === "docker") {
    const run = rest.indexOf("run");
    if (run === -1) return null;
    for (let i = run + 1; i < rest.length; i++) {
      if (DOCKER_VALUE_OPTS.has(rest[i])) { i++; continue; }
      if (!rest[i].startsWith("-")) return dockerImage(rest[i]);
    }
    return null;
  }
  return null;
}

// URL whose HTTP status says whether the artefact exists. null when we cannot check it.
export function lookupUrl(ref) {
  if (!ref) return null;
  if (ref.ecosystem === "npm") return `https://registry.npmjs.org/${ref.name.replace("/", "%2f")}/latest`;
  if (ref.ecosystem === "pypi") return `https://pypi.org/pypi/${ref.name}/json`;
  if (ref.ecosystem === "dockerhub") return `https://hub.docker.com/v2/repositories/${ref.name}/`;
  if (ref.ecosystem === "ghcr") return `https://ghcr.io/v2/${ref.name}/tags/list`;
  return null;
}

// A package lookup: 200 means it exists, 404 means it does not; anything else is inconclusive.
export function packageVerdict(status) {
  if (status === 200) return "ok";
  if (status === 404) return "fail";
  return "warn";
}

// A remote MCP endpoint answering an `initialize` POST. 401/403/405 still prove something
// is listening there; 404 and 410 mean the path is gone; 5xx may be a passing outage.
export function endpointVerdict(status) {
  if (status === 404 || status === 410) return "fail";
  if (status >= 500) return "warn";
  return "ok";
}
