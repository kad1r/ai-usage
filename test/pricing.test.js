const test = require('node:test');
const assert = require('node:assert');
const { pricingFor, calcCost, CLAUDE, OPENAI, GEMINI } = require('../providers/pricing');

test('exact and dated Claude ids', () => {
  assert.deepStrictEqual(pricingFor('claude-opus-5-5'), CLAUDE['claude-opus-5-5']);
  assert.deepStrictEqual(pricingFor('claude-haiku-4-5-20251001'), CLAUDE['claude-haiku-4-5']);
});

test('legacy Claude names used by Cursor', () => {
  assert.deepStrictEqual(pricingFor('claude-3.5-sonnet'), CLAUDE['claude-sonnet-3-5']);
  assert.deepStrictEqual(pricingFor('claude-4-sonnet-thinking'), CLAUDE['claude-sonnet-4']);
  assert.deepStrictEqual(pricingFor('claude-3-opus'), CLAUDE['claude-opus-3']);
});

test('OpenAI models are not priced as Claude', () => {
  assert.deepStrictEqual(pricingFor('gpt-4o'), OPENAI['gpt-4o']);
  assert.deepStrictEqual(pricingFor('gpt-4o-mini'), OPENAI['gpt-4o-mini']);
  assert.deepStrictEqual(pricingFor('gpt-5-codex'), OPENAI['gpt-5']);
  assert.deepStrictEqual(pricingFor('gpt-5.1-codex-max'), OPENAI['gpt-5.1']);
  assert.deepStrictEqual(pricingFor('o3-mini'), OPENAI['o3-mini']);
  assert.deepStrictEqual(pricingFor('gpt-9-unknown'), OPENAI['gpt-5.4']);
});

test('Gemini: longest matching prefix', () => {
  assert.deepStrictEqual(pricingFor('gemini-2.5-flash-lite'), GEMINI['gemini-2.5-flash-lite']);
  assert.deepStrictEqual(pricingFor('gemini-2.5-flash-preview-05-20'), GEMINI['gemini-2.5-flash']);
  assert.deepStrictEqual(pricingFor('gemini-3-flash-preview'), GEMINI['gemini-3-flash']);
});

test('prefix must end at a "-" boundary', () => {
  // "gpt-5.9" is not "gpt-5" with a suffix
  assert.deepStrictEqual(pricingFor('gpt-5.9'), OPENAI['gpt-5.4']);
});

test('unknown and synthetic models cost nothing', () => {
  assert.strictEqual(calcCost('<synthetic>', 1e6, 1e6, 0, 0), 0);
  assert.strictEqual(calcCost('default', 1e6, 1e6, 0, 0), 0);
  assert.strictEqual(calcCost(null, 1e6, 1e6, 0, 0), 0);
});

test('calcCost adds all four token kinds', () => {
  // gpt-4o: 2.5 in, 10 out, 1.25 cache read
  assert.strictEqual(calcCost('gpt-4o', 1e6, 1e6, 1e6, 0), 13.75);
  assert.strictEqual(calcCost('gpt-4o', null, undefined, 0, 0), 0);
});
