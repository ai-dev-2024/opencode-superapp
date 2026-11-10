// The JSONC reader and the in-place editor used to add servers to a user's config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JsoncError, parseJsonc, parseTree, editMcpServers } from "../scripts/lib/jsonc.mjs";

const GIT = { enabled: true, type: "local", command: ["uvx", "mcp-server-git"] };
const TIME = { enabled: true, type: "local", command: ["uvx", "mcp-server-time"] };

// `after` must be `before` with text inserted and nothing removed, changed or reordered:
// every character of `before` appears in `after`, in order.
function assertOnlyInsertions(before, after, label) {
  let j = 0;
  for (let i = 0; i < before.length; i++, j++) {
    j = after.indexOf(before[i], j);
    assert.notEqual(j, -1, `${label}: original text was removed or altered near offset ${i}`);
  }
}

test("parseJsonc agrees with JSON.parse on plain JSON, valid and invalid", () => {
  const valid = [
    "{}", "[]", "null", "true", "0", "-0", "1.5e-3", '"s"', '{"a":1}', '{"a":{"b":[1,2,{"c":null}]}}',
    '{"a":"\\u00e9\\n\\"q\\""}', '  {"a" : [ ] }  ', '{"a":1,"a":2}', '{"big":12345678901234567890}', '{"__proto__":{"x":1}}', '[[[[]]]]',
  ];
  for (const t of valid) assert.deepEqual(parseJsonc(t), JSON.parse(t), t);
  const invalid = [
    "", "   ", "{", "}", "{a:1}", "{'a':1}", '{"a":1,,}', '{,}', "[,]", '{"a"}', '{"a":}', '{"a":1 "b":2}', "[1 2]", "01", "1.", ".5", "+1",
    "truex", "nul", '"unterminated', '"line\nbreak"', '"bad \\x escape"', '{"a":1}}', '{"a":1} x', "NaN", "Infinity", "undefined", "[1,2", '{"a":[}',
  ];
  for (const t of invalid) {
    assert.throws(() => JSON.parse(t), SyntaxError, `JSON.parse should reject ${JSON.stringify(t)}`);
    assert.throws(() => parseJsonc(t), JsoncError, JSON.stringify(t));
  }
});

test("parseJsonc accepts comments, trailing commas and a BOM", () => {
  const text = [
    "﻿// leading comment",
    "{",
    '  "model": "x", // trailing comment',
    "  /* block",
    '     "mcp": "not a key, just a comment" */',
    '  "url": "https://example.com/a//b", /* inline */ "glob": "/* not a comment */",',
    '  "list": [1, 2, /* three */ 3,],',
    '  "quote": "say \\"hi\\" // still a string",',
    "}",
    "// trailing comment",
  ].join("\r\n");
  assert.deepEqual(parseJsonc(text), {
    model: "x", url: "https://example.com/a//b", glob: "/* not a comment */", list: [1, 2, 3], quote: 'say "hi" // still a string',
  });
});

test("parseJsonc keeps JSON.parse semantics for duplicate keys and __proto__", () => {
  assert.deepEqual(parseJsonc('{"a":1,"b":2,"a":3}'), { a: 3, b: 2 });
  const v = parseJsonc('{"__proto__":{"polluted":true},"constructor":1}');
  assert.ok(Object.hasOwn(v, "__proto__"));
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test("parse errors give a line and column and never quote the text", () => {
  const secret = "sk-SECRET-" + "9".repeat(20);
  const text = `{\n  "provider": {\n    "apiKey": ${secret}\n  }\n}`;
  let err;
  try { parseJsonc(text); } catch (e) { err = e; }
  assert.ok(err instanceof JsoncError);
  assert.equal(err.line, 3);
  assert.equal(err.column, 15);
  assert.equal(err.message, "unexpected character at line 3, column 15");
  assert.ok(!err.message.includes("SECRET") && !err.message.includes("apiKey"));
  assert.throws(() => parseJsonc("/* never closed"), /unterminated comment at line 1, column 1$/);
  assert.throws(() => parseJsonc("[".repeat(5000)), /nesting is too deep/);
});

test("parseTree records where the top-level mcp object and its members are", () => {
  const text = '{ "a": {"mcp": 1}, "mcp": { "x": [1], } }';
  const root = parseTree(text);
  const mcp = root.members[1];
  assert.equal(mcp.key, "mcp");
  assert.equal(text.slice(mcp.value.start, mcp.value.end), '{ "x": [1], }');
  assert.equal(text[mcp.value.close], "}");
  assert.equal(text[mcp.value.lastComma], ",");
  assert.equal(root.lastComma, -1);
});

// Each fixture is edited by adding `git` and `time`; the result must parse to the original
// value plus those two servers, and nothing the user wrote may be removed or altered.
const FIXTURES = {
  "commented config with an mcp block": [
    "{",
    '  "$schema": "https://opencode.ai/config.json",',
    "  // my default model",
    '  "model": "anthropic/claude-sonnet-4-5",',
    '  "mcp": {',
    "    // work GitHub, do not touch",
    '    "github": { "type": "local", "enabled": false, "command": ["my-wrapper"] }',
    "  }",
    "}",
    "",
  ].join("\n"),
  "comment after the last member": [
    "{",
    '  "mcp": {',
    '    "mine": { "type": "local", "command": ["x"] } // keep me attached to mine',
    "    // and a note before the brace",
    "  }",
    "}",
  ].join("\n"),
  "trailing commas everywhere": [
    "{",
    '  "theme": "dark",',
    '  "mcp": {',
    '    "mine": {',
    '      "type": "local",',
    '      "command": ["x",],',
    "    },",
    "  },",
    "}",
  ].join("\n"),
  "no mcp key": '{\n  "model": "x"\n}\n',
  "no mcp key, trailing comma and comment": '{\n  "model": "x", // which model\n}\n',
  "empty mcp object": '{\n  "mcp": {}\n}\n',
  "empty mcp object spread over lines with a comment": '{\n  "mcp": {\n    // nothing yet\n  }\n}\n',
  "empty root object": "{}",
  "empty root object with a block comment": "{ /* start here */ }\n",
  "minified": '{"model":"x","mcp":{"mine":{"type":"local","command":["x"]}}}',
  "minified with spaces": '{ "mcp": { "mine": { "type": "local", "command": ["x"] } } }',
  "tabs": '{\n\t"model": "x",\n\t"mcp": {\n\t\t"mine": { "type": "local", "command": ["x"] }\n\t}\n}\n',
  "four-space indent": '{\n    "mcp": {\n        "mine": {\n            "type": "local",\n            "command": ["x"]\n        }\n    }\n}\n',
  "CRLF line endings": '{\r\n  "model": "x",\r\n  "mcp": {\r\n    "mine": { "type": "local", "command": ["x"] }\r\n  }\r\n}\r\n',
  "BOM": '﻿{\n  "mcp": {\n    "mine": { "type": "local", "command": ["x"] }\n  }\n}\n',
  "mcp nested elsewhere and inside strings": [
    "{",
    '  "note": "the \\"mcp\\": { } key goes below",',
    '  "agent": { "dev": { "mcp": { "decoy": true } } },',
    "  // \"mcp\": { \"commented-out\": {} }",
    '  "mcp": {',
    '    "mine": { "type": "local", "command": ["x"] }',
    "  }",
    "}",
  ].join("\n"),
  "duplicate mcp keys (the last one wins, as in JSON.parse)": '{\n  "mcp": { "old": { "type": "local", "command": ["a"] } },\n  "mcp": {\n    "mine": { "type": "local", "command": ["b"] }\n  }\n}\n',
  "large numbers and duplicate keys elsewhere": '{\n  "limit": 12345678901234567890,\n  "x": 1,\n  "x": 2,\n  "mcp": {\n    "mine": { "type": "local", "command": ["x"] }\n  }\n}\n',
  "mcp is the first of several keys": '{\n  "mcp": {\n    "mine": { "type": "local", "command": ["x"] }\n  },\n  "model": "x"\n}\n',
};

for (const [name, before] of Object.entries(FIXTURES)) {
  test(`editMcpServers adds servers without disturbing the file: ${name}`, () => {
    const original = parseJsonc(before);
    const after = editMcpServers(before, { add: { git: GIT, time: TIME } });
    const expected = { ...original, mcp: { ...(original.mcp || {}), git: GIT, time: TIME } };
    assert.deepEqual(parseJsonc(after), expected);
    assertOnlyInsertions(before, after, name);
    // style is kept: no line ending or BOM is introduced or lost
    assert.equal(after.includes("\r\n"), before.includes("\r\n"));
    assert.equal(/(^|[^\r])\n/.test(after), /(^|[^\r])\n/.test(before) || !before.includes("\n"));
    assert.equal(after.startsWith("﻿"), before.startsWith("﻿"));
    // adding one at a time gives the same config
    const stepwise = editMcpServers(editMcpServers(before, { add: { git: GIT } }), { add: { time: TIME } });
    assert.deepEqual(parseJsonc(stepwise), expected);
    assertOnlyInsertions(before, stepwise, name);
  });
}

test("editMcpServers output is exactly the input plus insertions (golden examples)", () => {
  assert.equal(
    editMcpServers(FIXTURES["comment after the last member"], { add: { git: { a: 1 } } }),
    [
      "{",
      '  "mcp": {',
      '    "mine": { "type": "local", "command": ["x"] }, // keep me attached to mine',
      "    // and a note before the brace",
      '    "git": {',
      '      "a": 1',
      "    }",
      "  }",
      "}",
    ].join("\n"),
  );
  assert.equal(
    editMcpServers(FIXTURES["trailing commas everywhere"], { add: { git: { a: 1 } } }),
    [
      "{",
      '  "theme": "dark",',
      '  "mcp": {',
      '    "mine": {',
      '      "type": "local",',
      '      "command": ["x",],',
      "    },",
      '    "git": {',
      '      "a": 1',
      "    },",
      "  },",
      "}",
    ].join("\n"),
  );
  assert.equal(editMcpServers('{\n  "model": "x"\n}\n', { add: { git: { a: 1 } } }), '{\n  "model": "x",\n  "mcp": {\n    "git": {\n      "a": 1\n    }\n  }\n}\n');
  assert.equal(editMcpServers("{}", { add: { git: { a: 1 } } }), '{\n  "mcp": {\n    "git": {\n      "a": 1\n    }\n  }\n}');
  assert.equal(editMcpServers('{\n\t"mcp": {}\n}\n', { add: { git: { a: 1 } } }), '{\n\t"mcp": {\n\t\t"git": {\n\t\t\t"a": 1\n\t\t}\n\t}\n}\n');
  assert.equal(editMcpServers('{"mcp":{"m":1}}', { add: { git: { a: 1 } } }), '{"mcp":{"m":1,\n  "git": {\n    "a": 1\n  }\n}}');
});

test("editMcpServers with nothing to add returns the text unchanged", () => {
  for (const before of Object.values(FIXTURES)) assert.equal(editMcpServers(before, {}), before);
});

test("editMcpServers replaces one server's value and nothing else", () => {
  const before = FIXTURES["commented config with an mcp block"];
  const after = editMcpServers(before, { replace: { github: GIT } });
  assert.deepEqual(parseJsonc(after).mcp, { github: GIT });
  assert.ok(after.includes("// work GitHub, do not touch"));
  assert.ok(after.includes("// my default model"));
  assert.equal(after.split("\n")[6], '    "github": {');
  assert.equal(after.split("\n")[7], '      "enabled": true,');

  // replace the last member and add another in the same edit
  const both = editMcpServers(FIXTURES["minified"], { replace: { mine: GIT }, add: { time: TIME } });
  assert.deepEqual(parseJsonc(both), { model: "x", mcp: { mine: GIT, time: TIME } });

  // with duplicate ids the one JSON.parse keeps (the last) is the one replaced
  const dup = editMcpServers('{"mcp":{"a":{"v":1},"a":{"v":2}}}', { replace: { a: GIT } });
  assert.deepEqual(parseJsonc(dup).mcp.a, GIT);
  assert.ok(dup.includes('"a":{"v":1}'));
});
