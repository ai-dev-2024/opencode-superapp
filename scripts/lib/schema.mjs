// schema.mjs — tiny zero-dependency JSON Schema (draft-07 subset) validator.
//
// Validation keywords implemented: type (string or array), enum, const, pattern, minLength,
// minItems, uniqueItems, items (single schema), required, properties, additionalProperties
// (boolean or schema), propertyNames, minProperties.
// Annotations ($schema, $id, $comment, title, description, default, examples) are ignored.
//
// Fail closed: any other keyword, a misspelt keyword or an unknown type name THROWS. A schema
// must never contain a rule that looks enforced but is silently skipped.
//
// validateSchema returns a list of "path: message" strings; empty means valid.

const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "default", "examples"]);
const KEYWORDS = new Set([
  "type", "enum", "const", "pattern", "minLength", "minItems", "uniqueItems", "items",
  "required", "properties", "additionalProperties", "propertyNames", "minProperties",
]);
const TYPES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

// Every problem that would make this validator under-enforce `schema`, as "pointer: reason".
function schemaProblems(schema, at = "#") {
  if (!isPlainObject(schema)) return [`${at}: schema must be an object`];
  const problems = [];
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) problems.push(`${at}: unsupported keyword "${key}"`);
  }
  if (schema.type !== undefined) {
    for (const t of [].concat(schema.type)) if (!TYPES.has(t)) problems.push(`${at}/type: unknown type ${JSON.stringify(t)}`);
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) problems.push(`${at}/enum: must be an array`);
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((k) => typeof k === "string"))) {
    problems.push(`${at}/required: must be an array of strings`);
  }
  if (schema.pattern !== undefined) {
    try { new RegExp(schema.pattern); } catch { problems.push(`${at}/pattern: invalid regular expression`); }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) problems.push(`${at}/properties: must be an object`);
    else for (const [k, sub] of Object.entries(schema.properties)) problems.push(...schemaProblems(sub, `${at}/properties/${k}`));
  }
  for (const key of ["items", "propertyNames"]) {
    if (schema[key] !== undefined) problems.push(...schemaProblems(schema[key], `${at}/${key}`));
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    problems.push(...schemaProblems(schema.additionalProperties, `${at}/additionalProperties`));
  }
  return problems;
}

function check(value, schema, path) {
  const errors = [];
  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => typeMatches(value, t))) {
      return [`${path}: expected ${types.join("|")}, got ${typeOf(value)}`];
    }
  }
  if (schema.enum && !schema.enum.some((e) => same(e, value))) {
    errors.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  }
  if (Object.hasOwn(schema, "const") && !same(schema.const, value)) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, i) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${path}[${i}]: duplicate item ${key}`);
        seen.add(key);
      });
    }
    if (schema.items) value.forEach((item, i) => errors.push(...check(item, schema.items, `${path}[${i}]`)));
  }
  if (isPlainObject(value)) {
    // Own properties only: "toString" or "__proto__" must not satisfy `required`, and must
    // not be mistaken for a declared property.
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) errors.push(`${path}: missing required "${k}"`);
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(`${path}: fewer than ${schema.minProperties} properties`);
    const props = schema.properties || {};
    for (const k of keys) {
      if (schema.propertyNames) errors.push(...check(k, schema.propertyNames, `${path}{${JSON.stringify(k)}}`));
      if (Object.hasOwn(props, k)) errors.push(...check(value[k], props[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
      else if (isPlainObject(schema.additionalProperties)) errors.push(...check(value[k], schema.additionalProperties, `${path}.${k}`));
    }
  }
  return errors;
}

export function validateSchema(value, schema, path = "$") {
  const problems = schemaProblems(schema);
  if (problems.length) throw new Error(`schema cannot be enforced by scripts/lib/schema.mjs:\n  ${problems.join("\n  ")}`);
  return check(value, schema, path);
}
