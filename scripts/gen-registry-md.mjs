// gen-registry-md.mjs — registry.md is generated from registry.json. Do not edit it by hand.
//   node scripts/gen-registry-md.mjs [kitDir]           rewrite registry.md
//   node scripts/gen-registry-md.mjs --check [kitDir]   exit 1 if registry.md is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KIT, loadRegistry } from "./lib/registry.mjs";
import { renderRegistryMd } from "./lib/registry-md.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const unknown = args.filter((a) => a.startsWith("-") && a !== "--check");
const dirs = args.filter((a) => !a.startsWith("-"));

if (unknown.length || dirs.length > 1) {
  console.error("Usage: gen-registry-md.mjs [--check] [kitDir]");
  process.exitCode = 2;
} else {
  const kit = dirs[0] ? resolve(dirs[0]) : KIT;
  const target = resolve(kit, "registry.md");
  const wanted = renderRegistryMd(loadRegistry(kit));
  let current = null;
  try { current = readFileSync(target, "utf8"); } catch { /* missing: treated as out of date */ }

  if (current === wanted) console.log("registry.md is up to date");
  else if (check) {
    console.error("registry.md is out of date with registry.json. Run: npm run gen:registry");
    process.exitCode = 1;
  } else {
    writeFileSync(target, wanted);
    console.log(`Wrote ${target}`);
  }
}
