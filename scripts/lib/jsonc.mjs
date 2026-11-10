// jsonc.mjs — read JSON-with-comments and make minimal edits to its text.
//
// OpenCode configs may contain // and /* */ comments and trailing commas. To add a server we
// must not parse-and-reserialise the file: that drops comments, reformats everything, loses
// duplicate keys and rounds large numbers. Instead the text is parsed into a tree that
// remembers where every value starts and ends, and new text is spliced in. Every byte the
// user wrote stays where it was.
//
// Error messages carry a line and column but never an excerpt of the text: a config file
// may hold secrets.

const MAX_DEPTH = 200;
const SCALAR = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

export class JsoncError extends Error {
  constructor(reason, text, offset) {
    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    super(`${reason} at line ${line}, column ${column}`);
    this.name = "JsoncError";
    Object.assign(this, { reason, line, column, offset });
  }
}

// Parse `text` into a tree. Nodes: { type: "object", start, end, close, members, lastComma },
// { type: "array", start, end, items }, { type: "scalar", start, end, value }.
// `members` are { key, keyStart, value }. `close` is the offset of the "}" and `lastComma`
// the offset of a comma after the last member (-1 when there is none).
export function parseTree(text) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let depth = 0;
  const fail = (reason, at = i) => { throw new JsoncError(reason, text, at); };

  function skip() {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else if (c === "/" && text[i + 1] === "/") {
        i += 2;
        while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
      } else if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) fail("unterminated comment");
        i = end + 2;
      } else return;
    }
  }

  // At an opening quote: decode the string and move past its closing quote.
  function string() {
    const start = i;
    let j = i + 1;
    for (;;) {
      const c = text[j];
      if (c === undefined || c === "\n" || c === "\r") fail("unterminated string", start);
      if (c === "\\") { j += 2; continue; }
      if (c === '"') break;
      j++;
    }
    i = j + 1;
    try { return JSON.parse(text.slice(start, i)); } catch { return fail("invalid string", start); }
  }

  function value() {
    skip();
    const start = i;
    const c = text[i];
    if (c === undefined) fail("unexpected end of file");
    if (c === "{" || c === "[") {
      if (++depth > MAX_DEPTH) fail("nesting is too deep");
      const node = c === "{" ? object() : array();
      depth--;
      return node;
    }
    if (c === '"') return { type: "scalar", start, value: string(), end: i };
    SCALAR.lastIndex = i;
    const m = SCALAR.exec(text);
    if (!m) fail("unexpected character");
    i += m[0].length;
    if (i < text.length && !/[\s,\]}/]/.test(text[i])) fail("unexpected character");
    return { type: "scalar", start, end: i, value: JSON.parse(m[0]) };
  }

  function object() {
    const node = { type: "object", start: i, end: -1, close: -1, members: [], lastComma: -1 };
    i++;
    let needComma = false;
    for (;;) {
      skip();
      if (text[i] === "}") { node.close = i; node.end = ++i; return node; }
      if (needComma) {
        if (text[i] !== ",") fail("expected ',' or '}'");
        node.lastComma = i++;
        needComma = false;
        continue;
      }
      if (text[i] !== '"') fail("expected a property name in double quotes");
      const keyStart = i;
      const key = string();
      skip();
      if (text[i] !== ":") fail("expected ':'");
      i++;
      node.members.push({ key, keyStart, value: value() });
      node.lastComma = -1;
      needComma = true;
    }
  }

  function array() {
    const node = { type: "array", start: i, end: -1, items: [] };
    i++;
    let needComma = false;
    for (;;) {
      skip();
      if (text[i] === "]") { node.end = ++i; return node; }
      if (needComma) {
        if (text[i] !== ",") fail("expected ',' or ']'");
        i++;
        needComma = false;
        continue;
      }
      node.items.push(value());
      needComma = true;
    }
  }

  const root = value();
  skip();
  if (i < text.length) fail("unexpected content after the JSON value");
  return root;
}

// The plain JS value of a tree node. Like JSON.parse: the last duplicate key wins, and
// "__proto__" becomes an ordinary own property.
export function nodeValue(node) {
  if (node.type === "array") return node.items.map(nodeValue);
  if (node.type !== "object") return node.value;
  const out = {};
  for (const m of node.members) {
    Object.defineProperty(out, m.key, { value: nodeValue(m.value), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

export function parseJsonc(text) { return nodeValue(parseTree(text)); }

// The member JSON.parse would keep for `key`: the last one.
function findMember(objectNode, key) {
  for (let n = objectNode.members.length - 1; n >= 0; n--) if (objectNode.members[n].key === key) return objectNode.members[n];
  return undefined;
}

function lineStart(text, offset) {
  return Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1)) + 1;
}
// Leading spaces/tabs of the line containing `offset`.
function lineIndent(text, offset) {
  const start = lineStart(text, offset);
  let end = start;
  while (text[end] === " " || text[end] === "\t") end++;
  return text.slice(start, Math.min(end, offset));
}
const startsItsLine = (text, offset) => text.slice(lineStart(text, offset), offset).trim() === "";

// Line ending and indent unit the file already uses.
function detectStyle(text) {
  const m = /^([ \t]+)"/m.exec(text);
  return { eol: text.includes("\r\n") ? "\r\n" : "\n", unit: m ? m[1] : "  " };
}

// `value` as JSON whose continuation lines are indented to `indent`.
function render(value, indent, { eol, unit }) {
  return JSON.stringify(value, null, unit).split("\n").join(eol + indent);
}

// Edits that append `pairs` ([key, value]) to an object. The comma goes straight after the
// last existing value: placed before "}" it could land inside a trailing // comment. The
// new members go just before the closing brace, after any comments that follow.
function insertionEdits(text, obj, pairs, style) {
  const { eol, unit } = style;
  const closeLine = lineStart(text, obj.close);
  const braceOnOwnLine = closeLine > obj.start && startsItsLine(text, obj.close);
  const closeIndent = braceOnOwnLine ? text.slice(closeLine, obj.close) : lineIndent(text, obj.start);
  const last = obj.members[obj.members.length - 1];
  const indent = last && startsItsLine(text, last.keyStart) ? lineIndent(text, last.keyStart) : closeIndent + unit;
  const trailingCommas = obj.lastComma !== -1;
  const body = pairs.map(([k, v]) => `${indent}${JSON.stringify(k)}: ${render(v, indent, style)}`).join(`,${eol}`) + (trailingCommas ? "," : "");
  const edits = [];
  if (last && !trailingCommas) edits.push({ start: last.value.end, end: last.value.end, text: "," });
  if (braceOnOwnLine) edits.push({ start: closeLine, end: closeLine, text: body + eol });
  else edits.push({ start: obj.close, end: obj.close, text: eol + body + eol + closeIndent });
  return edits;
}

// Apply from the end of the text backwards so earlier offsets stay valid. Two insertions at
// the same offset (a comma and new members, when "}" follows the last value directly) must
// come out in the order they were requested, so the later one is applied first.
function applyEdits(text, edits) {
  let out = text;
  const ordered = edits.map((e, n) => ({ ...e, n })).sort((a, b) => b.start - a.start || b.n - a.n);
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// Add servers to (and with `replace`, overwrite servers in) the top-level "mcp" object of a
// config text. `add` and `replace` map server id -> entry. Everything else in the text is
// left exactly as it was. The caller is responsible for checking that the root and "mcp"
// are objects and that `add` ids are new and `replace` ids exist.
export function editMcpServers(text, { add = {}, replace = {} } = {}) {
  const root = parseTree(text);
  const style = detectStyle(text);
  const addPairs = Object.entries(add);
  const mcp = findMember(root, "mcp");
  const edits = [];
  if (!mcp) {
    if (addPairs.length) edits.push(...insertionEdits(text, root, [["mcp", Object.fromEntries(addPairs)]], style));
  } else {
    for (const [id, entry] of Object.entries(replace)) {
      const member = findMember(mcp.value, id);
      const indent = startsItsLine(text, member.keyStart) ? lineIndent(text, member.keyStart) : lineIndent(text, mcp.value.start) + style.unit;
      edits.push({ start: member.value.start, end: member.value.end, text: render(entry, indent, style) });
    }
    if (addPairs.length) edits.push(...insertionEdits(text, mcp.value, addPairs, style));
  }
  return applyEdits(text, edits);
}
