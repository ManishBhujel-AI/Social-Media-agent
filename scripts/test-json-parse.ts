#!/usr/bin/env tsx
/**
 * Unit checks for parseModelJson / stripJsonFences (no API calls).
 */
import assert from "node:assert/strict";
import { parseModelJson, stripJsonFences } from "../lib/ai/parseJson";

function testStripFences() {
  const fenced = '```json\n{"a":1}\n```';
  assert.equal(stripJsonFences(fenced), '{"a":1}');

  const plain = '  {"b": 2}  ';
  assert.equal(stripJsonFences(plain), '{"b": 2}');

  const codeFence = '```\n{"c":3}\n```';
  assert.equal(stripJsonFences(codeFence), '{"c":3}');
}

function testParseModelJson() {
  const obj = parseModelJson<{ name: string }>('```json\n{"name":"test"}\n```');
  assert.equal(obj.name, "test");

  const direct = parseModelJson<{ n: number }>('{"n":42}');
  assert.equal(direct.n, 42);
}

function testEmptyThrows() {
  assert.throws(() => parseModelJson("   "), /Empty JSON/);
  assert.throws(() => parseModelJson("```json\n\n```"), /Empty JSON/);
}

function testInvalidLogsAndThrows() {
  assert.throws(() => parseModelJson("not json"), SyntaxError);
}

function main() {
  testStripFences();
  testParseModelJson();
  testEmptyThrows();
  testInvalidLogsAndThrows();
  console.log("PASS: test-json-parse (4 checks)");
}

main();
