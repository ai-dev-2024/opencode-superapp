import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSchema } from "../scripts/lib/schema.mjs";
import { KIT, loadRegistry, loadSchema } from "../scripts/lib/registry.mjs";

const schema = loadSchema();
const local = {
  id: "demo", title: "Demo", description: "d", type: "local", category: "Core", stacks: ["web-dev"],
  command: ["npx", "demo"], envVars: [], toolsPrefix: "demo_*", install: "npx demo",
};

test("real registry.json conforms to schema/registry.schema.json", () => {
  assert.deepEqual(validateSchema(loadRegistry(), schema), []);
});

test("valid minimal entry passes", () => {
  assert.deepEqual(validateSchema([local], schema), []);
});

test("missing required field is reported", () => {
  const { title, ...noTitle } = local;
  assert.match(validateSchema([noTitle], schema).join("\n"), /missing required "title"/);
});

test("bad enum, pattern and unexpected property are reported", () => {
  const errs = validateSchema([{ ...local, type: "stdio", id: "Bad ID", extra: 1 }], schema).join("\n");
  assert.match(errs, /\$\[0\]\.type: "stdio" not in/);
  assert.match(errs, /\$\[0\]\.id: does not match/);
  assert.match(errs, /unexpected property "extra"/);
});

test("wrong types are reported with a path", () => {
  const errs = validateSchema([{ ...local, command: "npx demo", envVars: [{ name: "lower", required: "yes", desc: "" }] }], schema);
  assert.ok(errs.includes("$[0].command: expected array, got string"));
  assert.ok(errs.some((e) => e.startsWith("$[0].envVars[0].name: does not match")));
  assert.ok(errs.includes("$[0].envVars[0].required: expected boolean, got string"));
});

test("remote url must be https and oauth may be boolean or object", () => {
  const remote = { ...local, type: "remote", command: undefined, url: "http://x", oauth: {} };
  delete remote.command;
  assert.match(validateSchema([remote], schema).join(), /url: does not match/);
  assert.deepEqual(validateSchema([{ ...remote, url: "https://x", oauth: false }], schema), []);
  assert.match(validateSchema([{ ...remote, url: "https://x", oauth: "yes" }], schema).join(), /oauth: expected boolean\|object/);
});

// --- holes in the validator itself -------------------------------------------------------

test("additionalProperties:false cannot be bypassed with Object.prototype names", () => {
  for (const key of ["toString", "constructor", "hasOwnProperty", "valueOf", "isPrototypeOf"]) {
    const errs = validateSchema([{ ...local, [key]: 1 }], schema);
    assert.deepEqual(errs, [`$[0]: unexpected property "${key}"`], key);
  }
  // JSON.parse creates an OWN "__proto__" key; it is an extra property like any other.
  const sneaky = JSON.parse(JSON.stringify(local).replace(/}$/, ',"__proto__":{"evil":1}}'));
  assert.deepEqual(validateSchema([sneaky], schema), ['$[0]: unexpected property "__proto__"']);
});

test("a declared property named like a prototype member is still validated", () => {
  const s = { type: "object", additionalProperties: false, properties: { constructor: { type: "string" } } };
  assert.deepEqual(validateSchema({ constructor: 5 }, s), ["$.constructor: expected string, got integer"]);
  assert.deepEqual(validateSchema({ constructor: "ok" }, s), []);
});

test("required is not satisfied by inherited properties", () => {
  const s = { type: "object", required: ["toString", "constructor"] };
  assert.deepEqual(validateSchema({}, s), ['$: missing required "toString"', '$: missing required "constructor"']);
  assert.deepEqual(validateSchema({ toString: 1, constructor: 2 }, s), []);
});

test("unsupported or misspelt keywords throw instead of being silently ignored", () => {
  const cases = [
    { maximum: 5 },
    { oneOf: [{ type: "string" }] },
    { anyOf: [{ type: "string" }] },
    { not: { type: "integer" } },
    { if: { properties: {} }, then: { required: ["command"] } },
    { type: "string", format: "uri" },
    { type: "string", maxLength: 2 },
    { type: "object", requried: ["id"] },
    { type: "strng" },
    { type: "array", items: [{ type: "string" }] },
    { type: "object", properties: { a: { maximum: 1 } } },
    { type: "array", items: { type: "object", properties: { deep: { format: "date" } } } },
    { type: "object", additionalProperties: { exclusiveMinimum: 0 } },
    { type: "object", propertyNames: { maxLength: 3 } },
    { type: "string", pattern: "(" },
  ];
  for (const s of cases) assert.throws(() => validateSchema({}, s), /schema cannot be enforced/, JSON.stringify(s));
  for (const s of [true, false, null, "string", []]) assert.throws(() => validateSchema({}, s), /schema must be an object/);
});

test("const, uniqueItems, minProperties and propertyNames are enforced", () => {
  assert.deepEqual(validateSchema("a", { const: "a" }), []);
  assert.deepEqual(validateSchema("b", { const: "a" }), ['$: must be "a"']);
  assert.deepEqual(validateSchema(false, { const: false }), []);
  assert.deepEqual(validateSchema(0, { const: false }), ["$: must be false"]);

  const unique = { type: "array", uniqueItems: true, items: { type: "string" } };
  assert.deepEqual(validateSchema(["a", "b"], unique), []);
  assert.deepEqual(validateSchema(["a", "b", "a"], unique), ['$[2]: duplicate item "a"']);
  assert.deepEqual(validateSchema([{ n: 1 }, { n: 1 }], { type: "array", uniqueItems: true }), ['$[1]: duplicate item {"n":1}']);

  assert.deepEqual(validateSchema({ a: 1 }, { type: "object", minProperties: 1 }), []);
  assert.deepEqual(validateSchema({}, { type: "object", minProperties: 1 }), ["$: fewer than 1 properties"]);

  const names = { type: "object", propertyNames: { pattern: "^[a-z]+$" } };
  assert.deepEqual(validateSchema({ ok: 1 }, names), []);
  assert.deepEqual(validateSchema({ "Not OK": 1 }, names), ['${"Not OK"}: does not match ^[a-z]+$']);
});

test("every keyword used by the schema files in schema/ is implemented", () => {
  const files = readdirSync(join(KIT, "schema")).filter((f) => f.endsWith(".json"));
  assert.ok(files.includes("registry.schema.json"));
  // validateSchema walks the whole schema up front and throws on anything it cannot enforce.
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(KIT, "schema", f), "utf8"));
    assert.doesNotThrow(() => validateSchema(null, s), f);
  }
});
