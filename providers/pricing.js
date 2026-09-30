// providers/pricing.js — one price list for every provider's models.
// Prices are USD per million tokens, standard (non-batch) tier, short context.

// Anthropic first-party API.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-09-30)
// cacheWrite is the 5-minute write (1.25x input); cacheRead is 0.1x input except
// Opus 5.5 (0.05x) and Fable 5.1 (0.025x).
const CLAUDE = {
  'claude-fable-5-1':   { input: 10,  output: 50, cacheRead: 0.25, cacheWrite: 12.5  },
  'claude-fable-5':     { input: 10,  output: 50, cacheRead: 1,    cacheWrite: 12.5  },
  'claude-opus-5-5':    { input: 4,   output: 20, cacheRead: 0.2,  cacheWrite: 5     },
  'claude-opus-5':      { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-8':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-7':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-6':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-5':    { input: 5,   output: 25, cacheRead: 0.5,  cacheWrite: 6.25  },
  'claude-opus-4-1':    { input: 15,  output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4':      { input: 15,  output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-sonnet-5-5':  { input: 2,   output: 10, cacheRead: 0.2,  cacheWrite: 2.5   },
  'claude-sonnet-5':    { input: 2,   output: 10, cacheRead: 0.2,  cacheWrite: 2.5   },
  'claude-sonnet-4-6':  { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-sonnet-4-5':  { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-sonnet-4':    { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-haiku-4-5':   { input: 1,   output: 5,  cacheRead: 0.1,  cacheWrite: 1.25  },
  // Retired models, still found in old Cursor/Claude logs
  'claude-sonnet-3-7':  { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-sonnet-3-5':  { input: 3,   output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-opus-3':      { input: 15,  output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-haiku-3-5':   { input: 0.8, output: 4,  cacheRead: 0.08, cacheWrite: 1     },
  'claude-haiku-3':     { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
};

// OpenAI API. Source: https://developers.openai.com/api/docs/pricing (checked 2026-09-30)
const OPENAI = {
  'gpt-6-astra':   { input: 10,   output: 50,   cacheRead: 1,     cacheWrite: 12.5  },
  'gpt-6.1-sol':   { input: 2,    output: 10,   cacheRead: 0.1,   cacheWrite: 2.5   },
  'gpt-6-sol':     { input: 2,    output: 10,   cacheRead: 0.2,   cacheWrite: 2.5   },
  'gpt-6-luna':    { input: 0.1,  output: 0.5,  cacheRead: 0.01,  cacheWrite: 0.125 },
  'gpt-5.6-sol':   { input: 4,    output: 20,   cacheRead: 0.4,   cacheWrite: 5     },
  'gpt-5.6-terra': { input: 2,    output: 12,   cacheRead: 0.2,   cacheWrite: 2.5   },
  'gpt-5.6-luna':  { input: 0.2,  output: 1.2,  cacheRead: 0.02,  cacheWrite: 0.25  },
  'gpt-5.5':       { input: 5,    output: 30,   cacheRead: 0.5,   cacheWrite: 0 },
  'gpt-5.4':       { input: 2.5,  output: 15,   cacheRead: 0.25,  cacheWrite: 0 },
  'gpt-5.4-mini':  { input: 0.75, output: 4.5,  cacheRead: 0.075, cacheWrite: 0 },
  'gpt-5.4-nano':  { input: 0.2,  output: 1.25, cacheRead: 0.02,  cacheWrite: 0 },
  'gpt-5.3-codex': { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.2':       { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 0 },
  'gpt-5.1':       { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5':         { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 0 },
  'gpt-5-mini':    { input: 0.25, output: 2,    cacheRead: 0.025, cacheWrite: 0 },
  'gpt-5-nano':    { input: 0.05, output: 0.4,  cacheRead: 0.005, cacheWrite: 0 },
  'gpt-4.1':       { input: 2,    output: 8,    cacheRead: 0.5,   cacheWrite: 0 },
  'gpt-4.1-mini':  { input: 0.4,  output: 1.6,  cacheRead: 0.1,   cacheWrite: 0 },
  'gpt-4o':        { input: 2.5,  output: 10,   cacheRead: 1.25,  cacheWrite: 0 },
  'gpt-4o-mini':   { input: 0.15, output: 0.6,  cacheRead: 0.075, cacheWrite: 0 },
  'o4-mini':       { input: 1.1,  output: 4.4,  cacheRead: 0.275, cacheWrite: 0 },
  'o3':            { input: 2,    output: 8,    cacheRead: 0.5,   cacheWrite: 0 },
  'o3-mini':       { input: 1.1,  output: 4.4,  cacheRead: 0.55,  cacheWrite: 0 },
  'o1':            { input: 15,   output: 60,   cacheRead: 7.5,   cacheWrite: 0 },
};

// Gemini Developer API, paid tier, prompts <= 200k.
// Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-09-30)
// Gemini 3.6–3.8 Flash prices double on 2027-01-01.
const GEMINI = {
  'gemini-3.8-flash':       { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-3.7-flash':       { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-3.6-flash':       { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-3.5-flash':       { input: 1.5,  output: 9,    cacheRead: 0.15,  cacheWrite: 0 },
  'gemini-3.5-flash-lite':  { input: 0.3,  output: 2.5,  cacheRead: 0.03,  cacheWrite: 0 },
  'gemini-3.1-pro':         { input: 2,    output: 12,   cacheRead: 0.2,   cacheWrite: 0 },
  'gemini-3.1-flash-lite':  { input: 0.25, output: 1.5,  cacheRead: 0.025, cacheWrite: 0 },
  'gemini-3-pro':           { input: 2,    output: 12,   cacheRead: 0.2,   cacheWrite: 0 },
  'gemini-3-flash':         { input: 0.5,  output: 3,    cacheRead: 0.05,  cacheWrite: 0 },
  'gemini-2.5-pro':         { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 0 },
  'gemini-2.5-flash':       { input: 0.3,  output: 2.5,  cacheRead: 0.03,  cacheWrite: 0 },
  'gemini-2.5-flash-lite':  { input: 0.1,  output: 0.4,  cacheRead: 0.01,  cacheWrite: 0 },
  'gemini-2.0-flash':       { input: 0.1,  output: 0.4,  cacheRead: 0.025, cacheWrite: 0 },
};

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Unknown models of a known family fall back to that family's mainstream model
const FAMILIES = [
  { test: m => m.startsWith('claude-'),       table: CLAUDE, fallback: 'claude-sonnet-5-5' },
  { test: m => /^(gpt-|o\d)/.test(m),         table: OPENAI, fallback: 'gpt-5.4' },
  { test: m => m.startsWith('gemini-'),       table: GEMINI, fallback: 'gemini-2.5-flash' },
];

// Cursor and older tools name Claude models "claude-3.5-sonnet" / "claude-4-opus";
// the API ids are "claude-sonnet-3-5" / "claude-opus-4".
function normalize(model) {
  const m = model.toLowerCase();
  const legacy = m.match(/^claude-(\d)(?:[.-](\d))?-(opus|sonnet|haiku)(.*)$/);
  if (legacy) return `claude-${legacy[3]}-${legacy[1]}${legacy[2] ? '-' + legacy[2] : ''}${legacy[4]}`;
  return m;
}

// Longest table key that is the whole id or a prefix ending at "-"
// ("gpt-5.1-codex-max" -> "gpt-5.1", "claude-haiku-4-5-20251001" -> "claude-haiku-4-5")
function lookup(table, model) {
  let best = null;
  for (const key of Object.keys(table)) {
    if ((model === key || model.startsWith(key + '-')) && (!best || key.length > best.length)) best = key;
  }
  return best && table[best];
}

function pricingFor(model) {
  if (!model || model.startsWith('<')) return ZERO; // e.g. Claude Code's "<synthetic>"
  const m = normalize(model);
  const family = FAMILIES.find(f => f.test(m));
  if (!family) return ZERO;
  return lookup(family.table, m) || family.table[family.fallback];
}

function calcCost(model, inputTokens, outputTokens, cacheRead, cacheWrite) {
  const p = pricingFor(model);
  return (
    ((inputTokens  || 0) / 1e6) * p.input +
    ((outputTokens || 0) / 1e6) * p.output +
    ((cacheRead    || 0) / 1e6) * p.cacheRead +
    ((cacheWrite   || 0) / 1e6) * p.cacheWrite
  );
}

module.exports = { pricingFor, calcCost, CLAUDE, OPENAI, GEMINI };
