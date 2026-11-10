// Policy checks on the GitHub Actions workflows. These read the YAML as text (no parser,
// no dependency) and only assert things a regular expression can decide reliably.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT } from "../scripts/lib/registry.mjs";

const dir = join(KIT, ".github", "workflows");
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, readFileSync(join(dir, f), "utf8")]);
const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));

test("there is one CI workflow and it is not duplicated by another", () => {
  const names = workflows.map(([f]) => f).sort();
  assert.deepEqual(names, ["ci.yml", "upstream.yml"]);
  // only ci.yml runs on pushes and pull requests
  const onPush = workflows.filter(([, text]) => /^ {2}(push|pull_request):/m.test(text)).map(([f]) => f);
  assert.deepEqual(onPush, ["ci.yml"]);
});

test("every action is pinned to a full commit SHA with the version in a comment", () => {
  let count = 0;
  for (const [file, text] of workflows) {
    for (const [, ref] of text.matchAll(/^\s*(?:- )?uses:\s*(\S+.*)$/gm)) {
      count++;
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${file}: ${ref}`);
    }
  }
  assert.ok(count >= 5, "expected to find the workflows' uses: lines");
});

test("workflows run with a read-only token and never on pull_request_target", () => {
  for (const [file, text] of workflows) {
    assert.match(text, /^permissions:\n {2}contents: read$/m, `${file}: top-level permissions`);
    assert.doesNotMatch(text, /pull_request_target/, file);
    assert.doesNotMatch(text, /^\s*(contents|actions|packages|id-token|pull-requests|issues):\s*write/m, `${file}: no write scopes`);
    for (const [, block] of text.matchAll(/uses: actions\/checkout@[^\n]*\n((?:\s+.*\n)*?)(?=\s*- |\n)/g)) {
      assert.match(block, /persist-credentials: false/, `${file}: checkout must not persist credentials`);
    }
  }
});

test("CI tests every supported Node major and runs the checks the README promises", () => {
  const ci = workflows.find(([f]) => f === "ci.yml")[1];
  const matrix = /node: \[([\d, ]+)\]/.exec(ci);
  assert.ok(matrix, "node matrix");
  const versions = matrix[1].split(",").map((v) => Number(v.trim()));
  assert.deepEqual(versions.slice(0, 3), [18, 20, 22]);
  // the lowest version tested is the one package.json promises to support
  assert.equal(pkg.engines.node, `>=${Math.min(...versions)}`);
  for (const step of ["npm run validate", "npm run check:registry", "npm test", "shellcheck install.sh", "Invoke-ScriptAnalyzer", "gitleaks", "shell: powershell", "shell: pwsh"]) {
    assert.ok(ci.includes(step), `ci.yml runs: ${step}`);
  }
  assert.match(ci, /fetch-depth: 0/, "gitleaks scans the full history");
  assert.match(ci, /sha256sum --check/, "the gitleaks download is checksum-verified");
});

test("every npm script a workflow calls exists", () => {
  for (const [file, text] of workflows) {
    for (const [, script] of text.matchAll(/npm run ([\w:-]+)/g)) assert.ok(pkg.scripts[script], `${file}: npm run ${script}`);
  }
});
