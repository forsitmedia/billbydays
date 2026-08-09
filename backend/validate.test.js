// Exercises buildResult() — requirements 6 (JS validation) and 7 (confidence floor).
const { buildResult } = require("./server.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + JSON.stringify(extra) : "")); }
}

const good = {
  total: 82.15, fixedPart: 14.54,
  periodStart: "2026-03-15", periodEnd: "2026-04-14",
  supplier: "EDP Comercial", billType: "electricity", currency: "EUR", kwh: 380,
  confidence: { total: 0.95, fixedPart: 0.88, period: 0.93 },
  issues: [],
};
const withGood = (o) => Object.assign({}, good, o);
const conf = (o) => Object.assign({}, good.confidence, o);

console.log("\nhappy path");
{
  const r = buildResult(good);
  check("total kept", r.total === 82.15, r.total);
  check("fixedPart kept", r.fixedPart === 14.54, r.fixedPart);
  check("dates kept", r.periodStart === "2026-03-15" && r.periodEnd === "2026-04-14", r);
  check("kwh kept", r.kwh === 380, r.kwh);
  check("billType kept", r.billType === "electricity", r.billType);
  check("no issues", r.issues.length === 0, r.issues);
}

console.log("\nrequirement 7 — confidence floor 0.75");
{
  const r = buildResult(withGood({ confidence: conf({ total: 0.74 }) }));
  check("0.74 total -> null", r.total === null, r.total);
  check("...with an issue", r.issues.some(i => i.field === "total"), r.issues);
  check("fixedPart survives", r.fixedPart === 14.54, r.fixedPart);
}
{
  const r = buildResult(withGood({ confidence: conf({ total: 0.75 }) }));
  check("exactly 0.75 total kept", r.total === 82.15, r.total);
}
{
  const r = buildResult(withGood({ confidence: conf({ fixedPart: 0.5 }) }));
  check("low fixedPart -> null", r.fixedPart === null, r.fixedPart);
}
{
  const r = buildResult(withGood({ confidence: conf({ period: 0.6 }) }));
  check("low period -> both dates null", r.periodStart === null && r.periodEnd === null, r);
  check("...with a period issue", r.issues.some(i => i.field === "period"), r.issues);
}
{
  const r = buildResult(withGood({ confidence: {} }));
  check("missing confidence object -> all null", r.total === null && r.fixedPart === null && r.periodStart === null, r);
}

console.log("\nrequirement 6 — total range");
for (const [v, want] of [[0, null], [-5, null], [5000, null], [5001, null], [0.01, 0.01], [4999.99, 4999.99]]) {
  const r = buildResult(withGood({ total: v, fixedPart: 0 }));
  check(`total ${v} -> ${want}`, r.total === want, r.total);
}

console.log("\nrequirement 6 — fixedPart");
{
  const r = buildResult(withGood({ total: 50, fixedPart: 60 }));
  check("fixedPart > total -> null", r.fixedPart === null, r.fixedPart);
  check("total untouched", r.total === 50, r.total);
  check("issue explains it", r.issues.some(i => i.field === "fixedPart" && /larger than the total/.test(i.reason)), r.issues);
}
{
  const r = buildResult(withGood({ total: 50, fixedPart: 50 }));
  check("fixedPart == total kept", r.fixedPart === 50, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedPart: -1 }));
  check("negative fixedPart -> null", r.fixedPart === null, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedPart: 0 }));
  check("fixedPart 0 kept", r.fixedPart === 0, r.fixedPart);
}
{
  // total killed by range; fixedPart must not be silently compared against null
  const r = buildResult(withGood({ total: 99999, fixedPart: 14.54 }));
  check("total null, fixedPart survives", r.total === null && r.fixedPart === 14.54, r);
}

console.log("\nrequirement 6 — dates");
const dateCases = [
  ["2026-04-14", "2026-03-15", "reversed"],
  ["2026-03-15", "2026-03-15", "same day"],
  ["2026-03-15", "2026-03-25", "10 days (under 15)"],
  ["2026-03-15", "2026-07-15", "122 days (over 100)"],
  ["15-03-2026", "14-04-2026", "wrong format"],
  ["2026-02-31", "2026-03-20", "impossible date"],
  ["", null, "empty"],
];
for (const [s, e, label] of dateCases) {
  const r = buildResult(withGood({ periodStart: s, periodEnd: e }));
  check(`${label} -> null`, r.periodStart === null && r.periodEnd === null, [r.periodStart, r.periodEnd]);
}
{
  const r = buildResult(withGood({ periodStart: "2026-03-15", periodEnd: "2026-03-30" }));
  check("exactly 15 days kept", r.periodStart === "2026-03-15", r);
}
{
  const r = buildResult(withGood({ periodStart: "2026-01-01", periodEnd: "2026-04-11" }));
  check("exactly 100 days kept", r.periodStart === "2026-01-01", r);
}
{
  // period crossing the March DST change must still count as 30 days
  const r = buildResult(withGood({ periodStart: "2026-03-15", periodEnd: "2026-04-14" }));
  check("DST-crossing period kept", r.periodStart === "2026-03-15" && r.periodEnd === "2026-04-14", r);
}

console.log("\nrequirement 8 — privacy: nothing extra can reach the client");
{
  const r = buildResult(withGood({
    customerName: "Maria Silva Santos",
    address: "Rua das Flores 12, 1200-192 Lisboa",
    nif: "234567891",
    iban: "PT50000201231234567890154",
    meterId: "PT0002000123456789XY",
    debug: { rawText: "the whole bill" },
  }));
  const keys = Object.keys(r).sort().join(",");
  check("exact key set", keys === "billType,confidence,currency,fixedPart,issues,kwh,periodEnd,periodStart,supplier,total", keys);
  const blob = JSON.stringify(r);
  check("no name", !/Maria|Santos/.test(blob));
  check("no address", !/Flores|Lisboa/.test(blob));
  check("no NIF", !/234567891/.test(blob));
  check("no IBAN", !/PT50000201/.test(blob));
  check("no meter id", !/PT0002000123/.test(blob));
  check("no debug", !/rawText|whole bill/.test(blob));
}

console.log("\nmisc hardening");
{
  const r = buildResult(null);
  check("null input -> all null, no throw", r.total === null && r.issues.length >= 3, r.issues.length);
}
{
  const r = buildResult(withGood({ billType: "solar" }));
  check("unknown billType -> other", r.billType === "other", r.billType);
}
{
  const r = buildResult(withGood({ currency: "gbp" }));
  check("currency uppercased", r.currency === "GBP", r.currency);
}
{
  const r = buildResult(withGood({ currency: "euros!!" }));
  check("bad currency -> EUR", r.currency === "EUR", r.currency);
}
{
  const r = buildResult(withGood({ total: "82,15" }));
  check("comma decimal string coerced", r.total === 82.15, r.total);
}
{
  const r = buildResult(withGood({ total: NaN }));
  check("NaN total -> null", r.total === null, r.total);
}
{
  const r = buildResult(withGood({ kwh: -3 }));
  check("negative kwh -> null silently", r.kwh === null && !r.issues.some(i => i.field === "kwh"), r);
}
{
  const r = buildResult(withGood({ supplier: "x".repeat(500) }));
  check("supplier capped at 60", r.supplier.length === 60, r.supplier.length);
}
{
  const r = buildResult(withGood({
    confidence: conf({ total: 0.2 }),
    issues: [{ field: "total", reason: "The photo was blurry." }],
  }));
  const totalIssues = r.issues.filter(i => i.field === "total");
  check("model reason preserved", totalIssues.some(i => /blurry/.test(i.reason)), r.issues);
  check("no duplicate-reason spam", totalIssues.length <= 2, totalIssues);
}

console.log("\ndebug fixedBreakdown (temporary, gated by DEBUG_EXTRACT)");
{
  const breakdown = [
    { label: "Tarifa Disponibilidade", net: 10.14, vatRate: 6, gross: 10.75 },
    { label: "RSU Fixo", net: 4.13, vatRate: 0, gross: 4.13 },
  ];
  delete process.env.DEBUG_EXTRACT;
  const calls = [];
  const origLog = console.log;
  console.log = (...args) => calls.push(args);
  let r;
  try {
    r = buildResult(withGood({ fixedBreakdown: breakdown }));
  } finally {
    console.log = origLog;
  }
  check("no console output when DEBUG_EXTRACT is unset", calls.length === 0, calls);
  check("fixedBreakdown absent from response", !("fixedBreakdown" in r), r);
}
{
  const breakdown = [
    { label: "Tarifa Disponibilidade", net: 10.14, vatRate: 6, gross: 10.75 },
  ];
  process.env.DEBUG_EXTRACT = "1";
  const calls = [];
  const origLog = console.log;
  console.log = (...args) => calls.push(args);
  let r;
  try {
    r = buildResult(withGood({ fixedBreakdown: breakdown }));
  } finally {
    console.log = origLog;
    delete process.env.DEBUG_EXTRACT;
  }
  check("logs exactly once when DEBUG_EXTRACT=1", calls.length === 1, calls.length);
  check(
    "logged content includes the breakdown",
    JSON.stringify(calls[0] || []).includes("Tarifa Disponibilidade"),
    calls[0]
  );
  check("still absent from response even when logging", !("fixedBreakdown" in r), r);
}
{
  // malformed input must not throw and must not leak
  process.env.DEBUG_EXTRACT = "1";
  const origLog = console.log;
  console.log = () => {};
  let r;
  try {
    r = buildResult(withGood({ fixedBreakdown: "not an array" }));
  } finally {
    console.log = origLog;
    delete process.env.DEBUG_EXTRACT;
  }
  check("non-array fixedBreakdown doesn't throw", !("fixedBreakdown" in r), r);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
