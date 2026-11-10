// registry-md.mjs — render registry.md, the human-readable index, from registry.json.
// Pure: takes the parsed registry and returns the file's text.

const DASH = "—";
const cell = (s) => String(s).replace(/\|/g, "\\|");

// What the user has to supply: the required env vars, or "OAuth" for a remote server that
// signs in through the browser. A keyless remote ("oauth": false, no required vars) needs
// nothing.
function secrets(r) {
  const required = r.envVars.filter((v) => v.required).map((v) => v.name);
  if (required.length) return required.join(", ");
  return r.type === "remote" && r.oauth !== null && typeof r.oauth === "object" ? "OAuth" : DASH;
}

const install = (r) => (r.install.includes("`") ? r.install : `\`${r.install}\``);

export function renderRegistryMd(registry) {
  const lines = [
    `# Registry ${DASH} ${registry.length} MCP servers`,
    "",
    "<!-- Generated from registry.json by scripts/gen-registry-md.mjs. Do not edit by hand: run `npm run gen:registry`. -->",
    "",
    "Search: Ctrl+F this file, or run `node scripts/mcp-manager.mjs search <query>`. Templates: `templates/<id>.json`.",
    "",
    "| # | ID | Type | Title | Stacks | Secrets | Install |",
    "|---|---|---|---|---|---|---|",
  ];
  registry.forEach((r, i) => {
    lines.push(`| ${i + 1} | \`${r.id}\` | ${r.type} | ${cell(r.title)} | ${r.stacks.join(", ") || DASH} | ${secrets(r)} | ${cell(install(r))} |`);
  });
  lines.push("", "## Notes", "");
  for (const r of registry) {
    lines.push(`- **${r.id}** (${r.type}) ${DASH} ${r.description}  `);
    lines.push(`  \`${r.type === "remote" ? r.url : r.command.join(" ")}\` ${DASH} template \`templates/${r.id}.json\``);
  }
  return lines.join("\n") + "\n";
}
