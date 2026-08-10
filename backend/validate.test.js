// Exercises buildResult() — requirements 6 (JS validation) and 7 (confidence floor).
const { buildResult } = require("./server.js");

let pass = 0, fail = 0;
// Adding floats back up reintroduces the float error the cent allocation just
// removed (10.75 + 6.56 + 4.13 is 21.439999999999998), so sums are compared at
// cent precision.
const round2 = (n) => Math.round(n * 100) / 100;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + JSON.stringify(extra) : "")); }
}

// The Águas de Cascais bill that exposed both bugs: 10,14 + 6,19 = 16,33 at 6%
// is 17,31, plus RSU FIXO 4,13 at 0% gives 21,44. The model's own fixedPart on
// that bill was 16,33 — wrong, and kept in `good` below so the tests prove it
// is ignored.
const cascaisBreakdown = () => [
  { label: "TARIFA DISPONIBILIDADE", net: 10.14, vatRate: 6, gross: 10.75, qty: 32, unit: "dias", unitPrice: 0.3169 },
  { label: "SANEAMENTO FIXO", net: 6.19, vatRate: 6, gross: 6.56, qty: 32, unit: "dias", unitPrice: 0.1936 },
  { label: "RSU FIXO", net: 4.13, vatRate: 0, gross: 4.13, qty: 32, unit: "dias", unitPrice: 0.129 },
];
const CASCAIS_FIXED = 21.44;

// One line at 0% VAT, so a test can pin fixedPart to an exact number.
const flatBd = (net) => [{ label: "Quota de Serviço", net, vatRate: 0, gross: net }];

const good = {
  total: 82.15, fixedPart: 16.33,
  periodStart: "2026-03-15", periodEnd: "2026-04-14",
  supplier: "EDP Comercial", billType: "electricity", currency: "EUR", kwh: 380,
  confidence: { total: 0.95, fixedPart: 0.88, period: 0.93 },
  issues: [],
  fixedBreakdown: cascaisBreakdown(),
};
const withGood = (o) => Object.assign({}, good, o);
const conf = (o) => Object.assign({}, good.confidence, o);

console.log("\nhappy path");
{
  const r = buildResult(good);
  check("total kept", r.total === 82.15, r.total);
  check("fixedPart summed from the breakdown", r.fixedPart === CASCAIS_FIXED, r.fixedPart);
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
  check("fixedPart survives", r.fixedPart === CASCAIS_FIXED, r.fixedPart);
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
  const r = buildResult(withGood({ total: v, fixedBreakdown: flatBd(0) }));
  check(`total ${v} -> ${want}`, r.total === want, r.total);
}

console.log("\nrequirement 6 — fixedPart");
{
  const r = buildResult(withGood({ total: 50, fixedBreakdown: flatBd(60) }));
  check("fixedPart > total -> null", r.fixedPart === null, r.fixedPart);
  check("total untouched", r.total === 50, r.total);
  check("issue explains it", r.issues.some(i => i.field === "fixedPart" && /larger than the total/.test(i.reason)), r.issues);
}
{
  const r = buildResult(withGood({ total: 50, fixedBreakdown: flatBd(50) }));
  check("fixedPart == total kept", r.fixedPart === 50, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedBreakdown: flatBd(-1) }));
  check("negative fixedPart -> null", r.fixedPart === null, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedBreakdown: flatBd(0) }));
  check("fixedPart 0 kept", r.fixedPart === 0, r.fixedPart);
}
{
  // total killed by range; fixedPart must not be silently compared against null
  const r = buildResult(withGood({ total: 99999 }));
  check("total null, fixedPart survives", r.total === null && r.fixedPart === CASCAIS_FIXED, r);
}

console.log("\nbug 1 — fixedPart is the sum of fixedBreakdown, not the model's figure");
{
  const r = buildResult(good);
  check("Águas de Cascais bill -> 21.44", r.fixedPart === CASCAIS_FIXED, r.fixedPart);
  check("...and the model's 16.33 never appears", r.fixedPart !== 16.33, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedPart: 999 }));
  check("absurd model fixedPart ignored", r.fixedPart === CASCAIS_FIXED, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedPart: null }));
  check("null model fixedPart ignored", r.fixedPart === CASCAIS_FIXED, r.fixedPart);
}
{
  const asFraction = cascaisBreakdown().map(l => Object.assign({}, l, { vatRate: l.vatRate / 100 }));
  const r = buildResult(withGood({ fixedBreakdown: asFraction }));
  check("vatRate 0.06 means the same as vatRate 6", r.fixedPart === CASCAIS_FIXED, r.fixedPart);
}
{
  const lies = cascaisBreakdown().map(l => Object.assign({}, l, { gross: 1 }));
  const r = buildResult(withGood({ fixedBreakdown: lies }));
  check("model's gross column ignored, recomputed from net", r.fixedPart === CASCAIS_FIXED, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedBreakdown: [] }));
  check("empty breakdown -> null", r.fixedPart === null, r.fixedPart);
  check("...with an issue", r.issues.some(i => i.field === "fixedPart"), r.issues);
}
{
  const r = buildResult(withGood({ fixedBreakdown: undefined }));
  check("missing breakdown -> null", r.fixedPart === null, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedBreakdown: "16,73" }));
  check("non-array breakdown -> null", r.fixedPart === null, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedBreakdown: [{ label: "Quota", net: 5, vatRate: 500, gross: 5 }] }));
  check("impossible vat rate -> line dropped", r.fixedPart === null, r.fixedPart);
}
{
  const r = buildResult(withGood({ fixedBreakdown: [{ label: "Quota", net: "10,14", vatRate: 6, gross: 0 }] }));
  check("comma-decimal net coerced then grossed up", r.fixedPart === 10.75, r.fixedPart);
}

console.log("\nbug 2 — net must equal quantity x unit price");
{
  // SANEAMENTO FIXO read as 1,75 — the total of a different row. 32 x 0,1936
  // is 6,19, so the line is thrown away rather than quietly understating.
  const misread = cascaisBreakdown();
  misread[1] = Object.assign({}, misread[1], { net: 1.75, gross: 1.86 });
  const r = buildResult(withGood({ fixedBreakdown: misread }));
  check("misaligned row dropped", r.fixedPart === 14.88, r.fixedPart);
  check(
    "...with a fixedPart issue",
    r.issues.some(i => i.field === "fixedPart" && /daily rate/.test(i.reason)),
    r.issues
  );
  check("...and no bill text echoed back", !/SANEAMENTO/i.test(JSON.stringify(r)), r.issues);
}
{
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "L", net: 10.01, vatRate: 0, gross: 10.01, qty: 100, unit: "dias", unitPrice: 0.1 }],
  }));
  check("exactly 1 cent out is kept", r.fixedPart === 10.01, r.fixedPart);
}
{
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "L", net: 10.02, vatRate: 0, gross: 10.02, qty: 100, unit: "dias", unitPrice: 0.1 }],
  }));
  check("2 cents out is dropped", r.fixedPart === null, r.fixedPart);
}
{
  // nothing to check against -> the line stands
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "CAV", net: 2.85, vatRate: 6, gross: 3.02, qty: 30, unit: "dias" }],
  }));
  check("qty without unitPrice -> line kept", r.fixedPart === 3.02, r.fixedPart);
}
{
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "Tarifa Fixa", net: 6.19, vatRate: 6, gross: 6.56, unitPrice: 0.1936 }],
  }));
  check("unitPrice without qty -> line kept", r.fixedPart === 6.56, r.fixedPart);
}
{
  // the same check has to hold for a line billed per month, not per day
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "CAV", net: 5.7, vatRate: 6, gross: 6.04, qty: 2, unit: "meses", unitPrice: 2.85 }],
  }));
  check("months x unit price validated too", r.fixedPart === 6.04, r.fixedPart);
}
{
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "CAV", net: 5.7, vatRate: 6, gross: 6.04, qty: 2, unit: "meses", unitPrice: 1.5 }],
  }));
  check("months that don't multiply out are dropped", r.fixedPart === null, r.fixedPart);
}
{
  // a fixed discount is negative and must survive the same check
  const r = buildResult(withGood({
    fixedBreakdown: [
      { label: "Tarifa Fixa", net: 10, vatRate: 0, gross: 10, qty: 100, unit: "dias", unitPrice: 0.1 },
      { label: "Desconto mensal", net: -3.2, vatRate: 0, gross: -3.2, qty: 32, unit: "dias", unitPrice: -0.1 },
    ],
  }));
  check("negative per-day discount kept", r.fixedPart === 6.8, r.fixedPart);
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
  check("exact key set", keys === "billType,confidence,currency,fixedBreakdown,fixedPart,issues,kwh,periodEnd,periodStart,supplier,total", keys);
  const blob = JSON.stringify(r);
  check("no name", !/Maria|Santos/.test(blob));
  check("no address", !/Flores|Lisboa/.test(blob));
  check("no NIF", !/234567891/.test(blob));
  check("no IBAN", !/PT50000201/.test(blob));
  check("no meter id", !/PT0002000123/.test(blob));
  check("no debug", !/rawText|whole bill/.test(blob));
}
{
  // fixedBreakdown is the one field carrying text lifted off the bill, so it
  // gets its own fence: line labels and amounts, nothing else, whatever the
  // model tries to hang off a line.
  const r = buildResult(withGood({
    fixedBreakdown: [{
      label: "TARIFA DISPONIBILIDADE",
      net: 10.14, vatRate: 6, gross: 10.75, qty: 32, unit: "dias", unitPrice: 0.3169,
      customerName: "Maria Silva Santos",
      address: "Rua das Flores 12, 1200-192 Lisboa",
      nif: "234567891",
      iban: "PT50000201231234567890154",
      accountId: "CTA-99881",
      meterId: "PT0002000123456789XY",
      evidence: "line 14 of the scanned page",
    }],
  }));
  const lineKeys = Object.keys(r.fixedBreakdown[0]).sort().join(",");
  check("breakdown line: exact key set", lineKeys === "gross,label,net,qty,unit,vatRate", lineKeys);
  const blob = JSON.stringify(r.fixedBreakdown);
  check("breakdown: no name", !/Maria|Santos/.test(blob), blob);
  check("breakdown: no address", !/Flores|Lisboa/.test(blob), blob);
  check("breakdown: no NIF", !/234567891/.test(blob), blob);
  check("breakdown: no IBAN", !/PT50000201/.test(blob), blob);
  check("breakdown: no account id", !/CTA-99881/.test(blob), blob);
  check("breakdown: no meter id", !/PT0002000123/.test(blob), blob);
  check("breakdown: no free-form model text", !/evidence|scanned page/.test(blob), blob);
  check(
    "breakdown: safe charge label still there",
    r.fixedBreakdown[0].label === "Tarifa de disponibilidade",
    r.fixedBreakdown[0]
  );
}
{
  // Unknown labels must never be returned verbatim.
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "x".repeat(400), net: 1, vatRate: 0, gross: 1 }],
  }));
  check("unknown breakdown label is generic", r.fixedBreakdown[0].label === "Encargo fixo", r.fixedBreakdown[0]);
}

console.log("\nfixedBreakdown reaches the client");
{
  const r = buildResult(good);
  check("three kept lines returned", r.fixedBreakdown.length === 3, r.fixedBreakdown);
  check("labels are safe charge categories", r.fixedBreakdown[1].label === "Saneamento fixo", r.fixedBreakdown[1]);
  check("gross recomputed, rounded for display", r.fixedBreakdown[1].gross === 6.56, r.fixedBreakdown[1]);
  check("net kept", r.fixedBreakdown[0].net === 10.14, r.fixedBreakdown[0]);
  check("vatRate is a fraction", r.fixedBreakdown[0].vatRate === 0.06, r.fixedBreakdown[0]);
  check("zero-rated line marked 0, not dropped", r.fixedBreakdown[2].vatRate === 0, r.fixedBreakdown[2]);
  check("qty carried through for the table", r.fixedBreakdown[2].qty === 32, r.fixedBreakdown[2]);
  check("unit normalised to a safe enum", r.fixedBreakdown[2].unit === "day", r.fixedBreakdown[2]);
  // Exact, not a tolerance: the panel exists for the user to add the rows up
  // themselves, so a cent of drift is a visible defect, not a rounding detail.
  const shown = round2(r.fixedBreakdown.reduce((s, l) => s + l.gross, 0));
  check("shown lines add up to fixedPart exactly", shown === r.fixedPart, [shown, r.fixedPart]);
}
{
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "Maria Silva — NIF 123456789", net: 10, vatRate: 0 }],
  }));
  check(
    "raw personal data in a label is replaced by a safe category",
    r.fixedBreakdown[0].label === "Encargo fixo",
    r.fixedBreakdown
  );
  check(
    "a raw label cannot reach the client",
    !JSON.stringify(r.fixedBreakdown).includes("Maria Silva"),
    r.fixedBreakdown
  );
}
{
  const r = buildResult(withGood({ fixedBreakdown: [{ label: "CAV", net: 2.85, vatRate: 6, gross: 3.02 }] }));
  check("qty absent stays absent, not 0", r.fixedBreakdown[0].qty === null, r.fixedBreakdown[0]);
  check("unit absent stays absent", r.fixedBreakdown[0].unit === null, r.fixedBreakdown[0]);
}
{
  // a dropped line must not appear in the response, but must still be explained
  const misread = cascaisBreakdown();
  misread[1] = Object.assign({}, misread[1], { net: 1.75 });
  const r = buildResult(withGood({ fixedBreakdown: misread }));
  check("dropped line absent from response", r.fixedBreakdown.length === 2, r.fixedBreakdown);
  check("...and no trace of its value", !JSON.stringify(r.fixedBreakdown).includes("1.75"), r.fixedBreakdown);
  check("...but the issue survives", r.issues.some(i => /daily rate/.test(i.reason)), r.issues);
}
{
  // nothing to explain when the number itself was thrown away
  const r = buildResult(withGood({ confidence: conf({ fixedPart: 0.5 }) }));
  check("low confidence -> empty breakdown", r.fixedPart === null && r.fixedBreakdown.length === 0, r);
}
{
  const r = buildResult(withGood({ total: 50, fixedBreakdown: flatBd(60) }));
  check("fixedPart > total -> empty breakdown", r.fixedPart === null && r.fixedBreakdown.length === 0, r);
}
{
  const r = buildResult(withGood({ fixedBreakdown: "16,73" }));
  check("non-array breakdown -> empty array, not a string", Array.isArray(r.fixedBreakdown) && !r.fixedBreakdown.length, r.fixedBreakdown);
}
{
  const r = buildResult(null);
  check("null input -> empty array", Array.isArray(r.fixedBreakdown) && !r.fixedBreakdown.length, r.fixedBreakdown);
}

// ---------------------------------------------------------------------------
// The three defects an EDP bill showed in the "How this was calculated" panel:
// two charges both rendering as "Encargo fixo", "2 days" on lines billed per
// month, and rows that summed to 27,67 under a total of 27,68.
// ---------------------------------------------------------------------------
console.log("\nsafe labels cover every charge BILL_PROMPT asks for");
const labelOf = (label, extra) =>
  buildResult(withGood({
    fixedBreakdown: [Object.assign({ label, net: 5, vatRate: 0, gross: 5 }, extra)],
  })).fixedBreakdown[0].label;

const labelCases = [
  // the two that came back as "Encargo fixo" on the real bill
  ["CAV", "Contribuição audiovisual"],
  ["Taxa de Exploração DGEG", "Taxa DGEG"],
  // the rest of the prompt's list, which had the same gap
  ["JCAV", "Contribuição audiovisual"],
  ["Contribuição Audiovisual", "Contribuição audiovisual"],
  ["DGEG", "Taxa DGEG"],
  ["Aluguer de Contador", "Aluguer de contador"],
  ["Quota de Serviço", "Quota de serviço"],
  ["Quota", "Quota de serviço"],
  ["Tarifa Fixa", "Tarifa fixa"],
  ["TRF FIXA", "Tarifa fixa"],
  ["TRF FIXA SANEAM", "Saneamento fixo"],
  ["TRF FIXA GESTÃO RES. URB", "Resíduos urbanos (RSU)"],
  ["Serviço Urgências", "Serviço fixo"],
  // still-working cases: the existing rules must not shift meaning
  ["TARIFA DISPONIBILIDADE", "Tarifa de disponibilidade"],
  ["SANEAMENTO FIXO", "Saneamento fixo"],
  ["RSU FIXO", "Resíduos urbanos (RSU)"],
  ["Potência Contratada", "Potência contratada"],
  ["Tarifa de Comercialização", "Termo de comercialização"],
  ["Serviço Assistência", "Serviço fixo"],
  // a discount stays a discount, whatever charge it is tied to
  ["Desconto mensal", "Desconto fixo"],
  ["Desconto Tarifa Fixa", "Desconto fixo"],
];
for (const [raw, expected] of labelCases) {
  check(`"${raw}" -> ${expected}`, labelOf(raw) === expected, labelOf(raw));
}
{
  // the new rules must not widen the net around personal data
  check("a name still falls back", labelOf("Maria Silva Santos") === "Encargo fixo", labelOf("Maria Silva Santos"));
  check("an address still falls back", labelOf("Rua das Flores 12, Lisboa") === "Encargo fixo");
  check("an IBAN still falls back", labelOf("PT50000201231234567890154") === "Encargo fixo");
}

console.log("\na quantity carries the unit it was billed in");
{
  const r = buildResult(withGood({
    fixedBreakdown: [
      { label: "Potência Contratada", net: 5, vatRate: 0, gross: 5, qty: 61, unit: "dias" },
      { label: "CAV", net: 5.7, vatRate: 6, gross: 6.04, qty: 2, unit: "meses", unitPrice: 2.85 },
    ],
  }));
  check("dias -> day", r.fixedBreakdown[0].unit === "day", r.fixedBreakdown[0]);
  check("meses -> month", r.fixedBreakdown[1].unit === "month", r.fixedBreakdown[1]);
}
{
  const unitOf = (unit) =>
    buildResult(withGood({
      fixedBreakdown: [{ label: "Quota", net: 5, vatRate: 0, gross: 5, qty: 2, unit }],
    })).fixedBreakdown[0].unit;
  for (const u of ["dia", "dias", "day", "days", "DIAS"]) {
    check(`unit "${u}" -> day`, unitOf(u) === "day", unitOf(u));
  }
  for (const u of ["mes", "meses", "mensal", "month", "months", "mês"]) {
    check(`unit "${u}" -> month`, unitOf(u) === "month", unitOf(u));
  }
  // never guessed: an unreadable unit is null, and the frontend then shows no
  // quantity rather than a wrong one
  check("unknown unit -> null", unitOf("escalão") === null, unitOf("escalão"));
  check("m3 is not a month", unitOf("m3") === null, unitOf("m3"));
  check("kWh is not a unit we show", unitOf("kWh") === null, unitOf("kWh"));
}
{
  // the model's raw unit text is fenced exactly like its label text
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "Quota", net: 5, vatRate: 0, gross: 5, qty: 2, unit: "dias — Maria Silva" }],
  }));
  check("raw unit text cannot reach the client", !/Maria/.test(JSON.stringify(r)), r.fixedBreakdown);
}
{
  // a model still emitting the old field name must keep validating
  const r = buildResult(withGood({
    fixedBreakdown: [{ label: "Tarifa Fixa", net: 6.19, vatRate: 6, gross: 6.56, days: 32, unitPrice: 0.1936 }],
  }));
  check("legacy `days` still read as a quantity", r.fixedBreakdown[0].qty === 32, r.fixedBreakdown[0]);
  check("...and still arithmetic-checked", r.fixedPart === 6.56, r.fixedPart);
}

console.log("\nthe rows always add up to the fixed part");
{
  // The exact bill from the screenshot: 61 days of potência at 23%, then DGEG
  // and CAV billed per month. Unrounded these sum to 27,6777 -> 27,68, while
  // the rows rounded one by one gave 21,46 + 0,17 + 6,04 = 27,67.
  const r = buildResult(withGood({
    total: 96.4,
    fixedBreakdown: [
      { label: "Potência Contratada", net: 17.45, vatRate: 23, gross: 21.46, qty: 61, unit: "dias", unitPrice: 0.28607 },
      { label: "Taxa de Exploração DGEG", net: 0.14, vatRate: 23, gross: 0.17, qty: 2, unit: "meses", unitPrice: 0.07 },
      { label: "CAV", net: 5.7, vatRate: 6, gross: 6.04, qty: 2, unit: "meses", unitPrice: 2.85 },
    ],
  }));
  check("fixedPart stays the accurate figure", r.fixedPart === 27.68, r.fixedPart);
  const shown = round2(r.fixedBreakdown.reduce((s, l) => s + l.gross, 0));
  check("rows reconcile to it", shown === 27.68, [shown, r.fixedBreakdown.map(l => l.gross)]);
  check("the cent lands on the largest remainder", r.fixedBreakdown[0].gross === 21.47, r.fixedBreakdown[0]);
  check("no row is left generic", !r.fixedBreakdown.some(l => l.label === "Encargo fixo"), r.fixedBreakdown.map(l => l.label));
  check("months are not called days", r.fixedBreakdown[2].unit === "month", r.fixedBreakdown[2]);
}
{
  // rounding the other way: rows that overshoot must give a cent back
  const r = buildResult(withGood({
    fixedBreakdown: [
      { label: "Quota", net: 1.004, vatRate: 0, gross: 1.004 },
      { label: "Quota", net: 1.004, vatRate: 0, gross: 1.004 },
      { label: "Quota", net: 1.004, vatRate: 0, gross: 1.004 },
    ],
  }));
  check("3 x 1.004 -> fixedPart 3.01", r.fixedPart === 3.01, r.fixedPart);
  const shown = round2(r.fixedBreakdown.reduce((s, l) => s + l.gross, 0));
  check("rows give the cent back", shown === 3.01, [shown, r.fixedBreakdown.map(l => l.gross)]);
}
{
  // a negative line (fixed discount) must not break the allocation
  const r = buildResult(withGood({
    fixedBreakdown: [
      { label: "Tarifa Fixa", net: 10.005, vatRate: 0, gross: 10.005 },
      { label: "Desconto mensal", net: -3.333, vatRate: 0, gross: -3.333 },
    ],
  }));
  const shown = round2(r.fixedBreakdown.reduce((s, l) => s + l.gross, 0));
  check("rows with a discount still reconcile", shown === r.fixedPart, [shown, r.fixedPart]);
}
{
  // a single line must equal the total it explains
  const r = buildResult(withGood({ fixedBreakdown: [{ label: "Quota", net: 6.665, vatRate: 0, gross: 6.665 }] }));
  check("one line equals fixedPart", r.fixedBreakdown[0].gross === r.fixedPart, [r.fixedBreakdown[0], r.fixedPart]);
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

console.log("\nDEBUG_EXTRACT logging");
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
  check(
    "response carries the normalised copy, not the model's objects",
    r.fixedBreakdown.length === 2 && r.fixedBreakdown[0].vatRate === 0.06,
    r.fixedBreakdown
  );
}
{
  // malformed input must not throw and must not leak
  const r = buildResult(withGood({ fixedBreakdown: "not an array" }));
  check(
    "non-array fixedBreakdown doesn't throw",
    Array.isArray(r.fixedBreakdown) && !r.fixedBreakdown.length,
    r.fixedBreakdown
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
