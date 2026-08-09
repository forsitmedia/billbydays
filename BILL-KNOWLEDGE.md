# Portuguese bill-reading domain knowledge (extracted from `backend/server.js`)

This document is a read-only extraction, made ahead of a rewrite of the extraction pipeline, so
that nothing learned from real invoices gets lost. All code/comments are quoted verbatim from
`backend/server.js` as it exists on this branch. Line numbers refer to that file.

**Important architectural note found during extraction:** `detectProvider()`, `parse_SU_Eletricidade()`
and `parse_EDP_Comercial()` (lines 1118–1472) are defined but **never called** by any of the four
API endpoints. The live pipeline is `extractBillFieldsFromText()` (generic, provider-agnostic regex)
plus the DeepSeek AI prompts. Grepping the whole file for `detectProvider(`, `parse_SU_Eletricidade(`
and `parse_EDP_Comercial(` shows each name appears only at its own `function` declaration — no call
sites. So everything in sections 2 and 6 below that comes from those two parser functions is
knowledge that is currently **dormant**, not knowledge currently in production. Worth knowing before
you decide whether to port it forward or let it go.

---

## 1. Full text of every AI prompt (DeepSeek)

There are three prompts sent to DeepSeek (`model: "deepseek-chat"`, `temperature: 0`), all with a
system message forcing raw JSON. Two are "fixed cost" extractors (electricity/water), one is a
billing-period extractor.

### 1.1 System messages

Fixed-cost prompts (`aiExtractFixedCostsFromText`, line 1089):
```
Return valid JSON only. Be conservative and accurate.
```

Billing-period prompt (`aiExtractBillingPeriodFromText`, line 803):
```
Return valid JSON only. No markdown. No extra text.
```

### 1.2 Electricity fixed-cost prompt (`electricityPrompt`, lines 910–1007)

```
You are FixedCostPT — the best-in-the-world analyzer of Portuguese utility bills from OCR TEXT.

INPUT:
You will receive raw OCR text extracted from one or more bill pages (messy spacing, broken lines, duplicated numbers, missing €).

GOAL:
Extract ONLY the FIXED COST ITEMS (non-consumption based) and return them as JSON.
Fixed costs = charges you still pay with 0 kWh (assuming the contract stays active).

WHAT COUNTS AS FIXED (include):
A) Standing power / capacity terms (per day/month):
- "Potência", "Potência Contratada", "Termo de potência", "Termo Potência", "kVA" (when charged by days/month)
B) Fixed access / standing network terms (per day/month):
- "Termo fixo", "Termo Fixo Acesso às Redes", "Tarifa Fixa", "Tarifa Fixa de Acesso", "Acesso às Redes (Potência Contratada)"
- "Tarifa de Comercialização" (usually fixed)
C) Mandatory fixed fees:
- "DGEG", "Taxa Exploração DGEG" (often 0,07 €/mês)
- "CAV", "Contribuição Audiovisual" (often 2,85 €/mês or 1,00 €)
D) Subscription-like services (fixed add-ons):
- "Serviço", "Assistência", "Urgências", "Seguro", "Plano", "Proteção", when billed per month (NOT per kWh)
E) Fixed social tariff discounts / fixed discounts:
- "Desconto Tarifa Social" (ONLY when not tied to kWh)
- "Desconto" related to potência/termo fixo/tarifa fixa/comercialização, especially when mentions "dias", "mês", "mensal", "month"

WHAT DOES NOT COUNT (exclude):
- Any line tied to consumption: contains "kWh", "€/kWh", "kW h", "consumo", "energia", "vazio/cheias/ponta" with kWh
- Variable mechanisms/taxes if tied to kWh (examples often variable): "Mecanismo DL 33/2022", "IEC", "Imposto Especial", "acerto" when based on kWh
- VAT summary lines: "IVA", "Total IVA", "Taxa IVA", "Base tributável", "Resumo IVA" (those are not fixed items themselves)

CRITICAL OCR RULES (robustness):
1) OCR may break columns and duplicate totals. Prefer the monetary value that represents the LINE TOTAL (not unit price).
2) If a VAT rate is present in the same line (e.g., "23%" or "6%"), choose the monetary value CLOSEST IMMEDIATELY BEFORE that VAT rate.
   Example pattern: "... 29 dias 0,2405 6,97 6,97 23%" -> pick 6,97
3) Accept amounts with comma or dot decimals: "6,97" or "6.97". Ignore thousand separators.
4) If the amount has a clear negative sign or is described as discount/credit, return net as a NEGATIVE number.

VAT RATE:
- Extract VAT rate from the same evidence line when possible: "23%", "6%", "13%".
- Output as decimal: 0.23 / 0.06 / 0.13
- If missing but the label is very standard, you may infer:
  - Potência / Termo de potência / Comercialização / DGEG / services -> usually 23% (0.23)
  - CAV -> usually 6% (0.06)
  - Network access fixed terms often 6% (0.06), BUT if the line itself shows 23% use that.
- If still uncertain, set 0.00 and lower confidence.

SPECIAL CASE: "Acesso às redes" fiscal adjustment pairs (IMPORTANT)
Sometimes OCR shows a pair like:
- "Tarifa de acesso às redes -X ... 23%" AND "(DL 60/2019) +X ... 6%"
or two lines with the same base value X but opposite signs and different VAT rates.
In that case:
- IGNORE BOTH lines (they cancel in net base and are not a real fixed service charge item).
- Do NOT include either in fixedItems.

DISCOUNTS (include only when fixed):
Include discounts ONLY if at least one of these is true:
- mentions "dias", "mês", "mensal", "month"
- or explicitly references potência / termo fixo / tarifa fixa / comercialização / acesso às redes (potência)
Exclude discounts if the line mentions "kWh" or a €/kWh price.

PROVIDER HINTS (do not hallucinate, just use to recognize labels):
- EDP often: "Potência", "DGEG", "Desconto Tarifa Social", and the DL60/2019 access pair (ignore the pair).
- Endesa often: "Termo de Potência", "Termo Fixo Acesso às Redes", plus CAV and DGEG.
- Goldenergy often: "Acesso às Redes (Potência Contratada)", "Desconto Tarifa Social", CAV, DGEG.
- Iberdrola often: "Potência Contratada", discount on potência, CAV/DGEG, and a service add-on like "Serviço de Urgências".
- Galp often: "Tarifa de Comercialização", "Tarifa Fixa de Acesso", time-based "Desconto".
- SU often: clear "Potência Contratada", CAV, DGEG.

OUTPUT (JSON ONLY — STRICT):
Return STRICT JSON EXACTLY in this format and NOTHING ELSE:
{
  "fixedItems": [
    {
      "label": "…",
      "net": 0.00,
      "vatRate": 0.00,
      "evidence": "exact substring/line from OCR text used to extract the amount"
    }
  ],
  "confidence": 0.00
}

LABEL RULES:
- Use clear labels like: "Potência Contratada", "Termo Fixo Acesso às Redes", "Tarifa de Comercialização", "CAV", "DGEG", "Serviço (…)", "Desconto Tarifa Social", "Desconto (…)".
- If the same fixed concept appears for different sub-periods (e.g., 29 dias + 2 dias), include separate items.

CONFIDENCE (0 to 1):
- High (0.85–0.99) if you found at least Potência/Termo de potência + (CAV or DGEG) and evidence lines are clear.
- Medium (0.55–0.84) if you found some fixed items but OCR is messy or VAT rates missing.
- Low (0.10–0.54) if you found only 1 uncertain fixed item or only generic "taxas/impostos" without breakdown.
NEVER invent items not present in text — if uncertain, omit and lower confidence.

Now analyze the provided OCR text and output the JSON.
BILL TEXT:
<<<
${diText}
>>>
```

### 1.3 Water fixed-cost prompt (`waterPrompt`, lines 1009–1075)

```
You are WaterFixedPT — the best-in-the-world analyzer of PORTUGUESE WATER / SANITATION / WASTE bills from OCR TEXT.

INPUT:
You will receive raw OCR text extracted from one or more pages (messy spacing, broken lines, duplicated columns, missing €).

GOAL:
Extract ONLY the FIXED COST ITEMS (non-consumption based) and return them as JSON.
Fixed costs = charges you still pay even with 0 m³ consumption (assuming the service remains active).

WHAT COUNTS AS FIXED (include):
A) Water supply standing charges (usually per day/month):
- "Tarifa fixa", "Tarifa Fixa Água", "TRF FIXA", "Quota", "Quota Serviço", "Quota de Serviço"
- "Tarifa de disponibilidade", "Tarifa Disponibilidade", "Tar. Disp.", "Disponibilidade"
- "Tarifa mensal", "Mensal", "Tarifa Mensal"
B) Sanitation / wastewater standing charges:
- "Saneamento Fixo", "Tarifa Fixa Saneamento", "TRF FIXA SANEAM", "Disp Saneamento", "Tar. Disp. Saneamento"
- "Águas residuais" when it is a fixed/availability term (NOT per m³)
C) Urban waste / RSU standing charges:
- "RSU Fixo", "RSU Fixa", "Resíduos ... Fixos", "Resíduos Sólidos Urbanos Fixos"
- "Tarifa Fixa Resíduos", "Tarif. Dis. Resíduos", "Tar. Disp. RU", "Tarifa de disponibilidade de resíduos"
- "TRF FIXA GESTÃO RES. URB" / "Tarifa Fixa Gestão Resíduos"
D) Fixed meter / contract fees:
- "Aluguer de contador", "Aluguer do contador", "Contador", "Calibre/Diâmetro" when billed by days/month
- "Taxa Rede ... Fixa" / "Taxa Rede Saneamento Fixa" (when clearly fixed)
E) Fixed adjustments/credits related to the above fixed items:
- "Acerto períodos" / "Acerto de períodos" ONLY if it clearly refers to a fixed item
- If negative, return net as NEGATIVE

WHAT DOES NOT COUNT (exclude):
- Any line tied to consumption: contains "m3", "m³", "m^3", "€/m3", "consumo", "escalão", "tarifa variável", "TRF VAR"
- Variable resource/environment taxes when tied to volume (exclude if line contains m³/consumo), e.g.:
  - "Taxa Recursos Hídricos", "TRH", "ARH", "TGR", "Taxa Gestão Resíduos" when billed per m³
- VAT summary lines: "IVA", "Total IVA", "Resumo IVA", "Base tributável"

CRITICAL OCR RULES:
1) Prefer the LINE TOTAL amount, not unit price.
2) If VAT rate exists in line (e.g. "6%"), pick amount immediately before it.
3) Accept comma/dot decimals. Ignore thousand separators.
4) Discounts/credits -> negative net.

VAT RATE:
- Extract "23% / 13% / 6%" when present (0.23/0.13/0.06).
- If VAT is shown as codes like "(1)" and there is a legend "(1) IVA 6%" -> use that.
- "(2) Não sujeito IVA" / "IVA n. suj." -> vatRate 0.00
- If missing and you must infer: standing charges often 6% (0.06), meter/services can be 23% (0.23). If unsure, 0.00 + lower confidence.

OUTPUT (JSON ONLY — STRICT):
{
  "fixedItems": [
    {
      "label": "…",
      "net": 0.00,
      "vatRate": 0.00,
      "evidence": "exact substring/line from OCR text used to extract the amount"
    }
  ],
  "confidence": 0.00
}

Now analyze the provided OCR text and output the JSON.

BILL TEXT:
<<<
${diText}
>>>
```

Selection logic (line 1077): `const prompt = (utilityType === "water") ? waterPrompt : electricityPrompt;` — note there
is no dedicated gas prompt; gas bills fall through to the electricity prompt.

### 1.4 Billing-period prompt (`aiExtractBillingPeriodFromText`, lines 767–791)

```
You are BillPeriodExtractor.
Task: From OCR text of a utility bill, extract the BILLING/SERVICE PERIOD covered by the charges.

Rules:
- Return ONLY JSON.
- Pick the date range that represents the billing period / service period / statement period.
- Do NOT pick "periodo ideal de comunicacao de leituras" or anything about meter-reading submission windows.
- Output dates as ISO YYYY-MM-DD.

JSON schema:
{
  "periodStart": "YYYY-MM-DD",
  "periodEnd": "YYYY-MM-DD",
  "confidence": 0.0,
  "evidence": "short exact line/snippet used"
}

Language hint: ${langHint}

BILL TEXT:
<<<
${diText}
>>>
```

`langHint` is `"English"`, `"Spanish"`, or `"Portuguese"` depending on the `country` field passed
by the frontend (see `getReqCountry`, line 551) — so this prompt is templated per-country even
though the fixed-cost prompts are Portugal-only in their wording.

---

## 2. Supplier parsers — Portuguese terms → fields

Only two supplier-specific parsers exist in code: `parse_SU_Eletricidade` (lines 1153–1304) and
`parse_EDP_Comercial` (lines 1348–1472). As noted above, **neither is currently called** by any
endpoint — both are dead code today. `GALP` is registered as a known provider (line 1129) but has
no parser function at all.

| Supplier | Portuguese term searched | What it means | Field it fills |
|---|---|---|---|
| SU Eletricidade | `valor a pagar` | amount due | `totalAmount` |
| SU Eletricidade | `total a pagar` | amount due | `totalAmount` |
| SU Eletricidade | `valor da fatura` | invoice value | `totalAmount` |
| SU Eletricidade | `valor a debitar` | amount to be debited | `totalAmount` |
| SU Eletricidade | `importancia` (accent-stripped `importância`) | "amount" | `totalAmount` |
| SU Eletricidade | `de DD-MM-YYYY a DD-MM-YYYY` | explicit dash-form date range | `periodStart` / `periodEnd` |
| SU Eletricidade | `<day> <month-name> <year> (ate\|até\|a) <day> <month-name> <year>` | long-form Portuguese date range | `periodStart` / `periodEnd` |
| SU Eletricidade | `potencia contratada` (accent-stripped) | contracted power charge | fixed item `"Potência Contratada"`, amount capped at €100, blacklisted against known kVA ratings `[3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7]` so the kVA rating number itself isn't mistaken for the euro amount |
| SU Eletricidade | `taxas e impostos` | "taxes and duties" | fixed item `"Taxas e Impostos"`, capped €2–€60 |
| SU Eletricidade | `total taxas` | fallback for above if `taxas e impostos` not found | fixed item `"Taxas e Impostos"` |
| SU Eletricidade | `jcav` or ` cav ` | Contribuição Audiovisual (audiovisual levy), OCR sometimes reads "CAV" as "JCAV" | fixed item `"CAV"`, capped €30 |
| SU Eletricidade | `tarifa disponibilidade` | water/gas availability tariff | fixed item, capped €50 |
| SU Eletricidade | `saneamento fixo` | fixed sanitation charge | fixed item, capped €50 |
| SU Eletricidade | `termo fixo` | fixed term charge | fixed item, capped €50 |
| EDP Comercial | `Quanto tenho a pagar?` | EDP's own phrasing for "how much do I have to pay" | `totalAmount` (primary pattern) |
| EDP Comercial | `Montante:` | "amount" | `totalAmount` (backup pattern if the above fails) |
| EDP Comercial | `Período de faturação: <D> de <mês> a <D> de <mês> <yyyy>` | EDP's own phrasing for billing period, month spelled out in words, only the end date carries the year | `periodStart` / `periodEnd` (normalized via `normalizeEDPPeriodToDDMMYYYY`) |
| EDP Comercial | `IVA (X €) 23%` | a subtotal explicitly tagged as taxed at 23% | summed into `base23`; if `base23 > 0`, this alone becomes the *entire* fixed total (`base23 * 1.23`), short-circuiting the line-by-line strategy below |
| EDP Comercial | any line containing `dias` or `mes`/`mês` and NOT `kwh` | time-based (per-day/per-month) charge — the generic marker of "this is a standing charge, not consumption" | added to `netFixed_23` bucket, unless it also matches DGEG or CAV (see next two rows) |
| EDP Comercial | `dgeg` | DGEG exploitation fee | added to `netFixed_23` bucket, itemized as `"DGEG (Net)"` |
| EDP Comercial | `audiovisual` or `cav` | Contribuição Audiovisual | added to `netFixed_6` bucket (6% VAT), itemized as `"CAV (Net)"` |

Cross-parser term reuse worth flagging: `detectUtilityType` (lines 384–400) and the AI "PROVIDER
HINTS" section both independently list supplier names — `edp`, `galp`, `endesa`, `iberdrola`,
`goldenergy`, `repsol`, `su eletricidade` / `sueletricidade` — as electricity-market signals, not
as routing keys to a specific parser. Those are separate from the `PROVIDERS` object below.

---

## 3. FIXED vs VARIABLE — every rule, quoted

The clearest, most authoritative statement of the fixed/variable boundary is inside the AI prompts
(quoted in full in section 1), specifically:

> "Fixed costs = charges you still pay with 0 kWh (assuming the contract stays active)."
> (electricity prompt)

> "Fixed costs = charges you still pay even with 0 m³ consumption (assuming the service remains active)."
> (water prompt)

**Rule-based echoes of the same boundary in code** (not AI, deterministic):

`parse_EDP_Comercial`, line 1429 — the single line-classifier rule that stands in for the whole
"fixed vs variable" distinction when not using AI:
```js
// --- RULE A: TIME-BASED CHARGES (Potência / Discounts) ---
// Must have "dias" or "mês", MUST NOT have "kwh"
if ((l.includes("dias") || l.includes("mes") || l.includes("mês")) && !l.includes("kwh")) {
```
i.e. "billed by days/months and not mentioning kWh" is code's working proxy for "fixed."

`aiExtractFixedCostsFromText` header comment, line 900:
```js
// AI helper: extract fixed costs from bill text (Azure DI / OCR text)
// utilityType: "electricity" | "water" | "gas" | "unknown"
```

Full include/exclude lists are the `WHAT COUNTS AS FIXED` / `WHAT DOES NOT COUNT` sections of each
AI prompt in section 1 — they are the actual specification and are not paraphrased here to avoid
drift from the source text.

**The specific exclusion/cancellation rule** for a known false-positive pattern (electricity
prompt only):
```
SPECIAL CASE: "Acesso às redes" fiscal adjustment pairs (IMPORTANT)
Sometimes OCR shows a pair like:
- "Tarifa de acesso às redes -X ... 23%" AND "(DL 60/2019) +X ... 6%"
or two lines with the same base value X but opposite signs and different VAT rates.
In that case:
- IGNORE BOTH lines (they cancel in net base and are not a real fixed service charge item).
- Do NOT include either in fixedItems.
```

---

## 4. Date, period, and European number parsing — regexes and rules

### 4.1 European money format

`parseMoneyPT` (lines 161–165) — thousands dot, decimal comma:
```js
function parseMoneyPT(str) {
  const cleaned = String(str).replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
```

`parseMoneyEU` (lines 167–175, and a slightly different duplicate inside `parse_SU_Eletricidade`
at lines 1162–1170) — handles `€` symbol and stray spaces too:
```js
function parseMoneyEU(val) {
  if (!val) return null;
  let s = String(val).trim().replace(/[€\s]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");

  const n = Number(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}
```
Note: this treats `.` as always a thousands separator once a `,` is also present, and treats a
lone `.` (no comma) as passing straight to `Number()` unmodified — i.e. it assumes a lone `.`
means a decimal point already in machine format, not a European thousands separator. The
`parse_SU_Eletricidade` copy additionally validates the cleaned string against
`/^[\d]+(\.[\d]+)?$/` before converting, so malformed strings return `null` there but not in the
top-level version.

### 4.2 Date parsing — `parsePtDate` (lines 189–238)

Three date shapes are tried in order:

1. ISO-ish `yyyy-mm-dd` / `yyyy/mm/dd` / `yyyy.mm.dd`, with the comment noting *why* this is
   checked first:
   ```js
   // yyyy-mm-dd or yyyy/mm/dd or yyyy.mm.dd  (common in many Portuguese water bills)
   let mi = s.match(/(20\d{2})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})/);
   ```
2. `dd-mm-yyyy` / `dd/mm/yyyy` / `dd.mm.yyyy`, with 2-digit years coerced to `20xx`:
   ```js
   let m = s.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
   ...
   if (yy.length === 2) yy = "20" + yy;
   ```
3. `dd <mês por extenso> yyyy` (Portuguese month names, with and without accents), via a fixed
   lookup table:
   ```js
   const months = {
     jan: "01", janeiro: "01",
     fev: "02", fevereiro: "02",
     mar: "03", março: "03", marco: "03",
     abr: "04", abril: "04",
     mai: "05", maio: "05",
     jun: "06", junho: "06",
     jul: "07", julho: "07",
     ago: "08", agosto: "08",
     set: "09", setembro: "09",
     out: "10", outubro: "10",
     nov: "11", novembro: "11",
     dez: "12", dezembro: "12"
   };
   ```
   Matching regex: `/(\d{1,2})\s+([a-zçãõáéíóú]+)\s+(\d{4})/i`, and the matched month word is
   accent-stripped and truncated to its first 3 letters as a fallback lookup key:
   ```js
   const monRaw = m[2].normalize("NFD").replace(/\p{Diacritic}/gu, "");
   const monKey = monRaw.slice(0, 3);
   const mm = months[monRaw] || months[monKey];
   ```

Output is always normalized to `DD-MM-YYYY` string form.

### 4.3 Billing-period extraction — `extractBillingPeriod` (lines 240–377)

The function comments itself as split into two tiers, kept deliberately separate:

```js
// ==========================
// KEEP YOUR EXISTING RULES (unchanged)
// ==========================
```
Tier 1, tried first, two hand-written patterns:
- `Período de faturação: <date> até/a <date>` —
  `/Per[ií]odo\s+de\s+fatura[cç][aã]o\s*:\s*([\s\S]{0,40}?)\s+(?:at[eé]|a)\s+([\s\S]{0,40}?)(?:\n|$)/i`
- `Período: <dd/mm/yyyy> a/até <dd/mm/yyyy>` —
  `/Per[ií]odo\s*[:\-]\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})\s*(?:a|at[eé])\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i`

```js
// ==========================
// ROBUST PROVIDER-PROOF FALLBACKS
// ==========================
```
Tier 2 is a scored-candidate system, explicitly designed to survive supplier-format changes. Key
pieces:

- Accent-stripping and en/em-dash normalization up front:
  ```js
  const flat = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-");
  ```
- A plausibility filter rejecting any candidate period longer than ~13 months:
  ```js
  function plausibleRange(a, b) {
    if (!a || !b) return false;
    const da = dmyToDate(a);
    const db = dmyToDate(b);
    const diffDays = (db - da) / (1000 * 60 * 60 * 24);
    return Number.isFinite(diffDays) && diffDays >= 0 && diffDays <= 400;
  }
  ```
- An explicit exclusion for a known false-positive label, meter-reading submission windows rather
  than the actual billing period:
  ```js
  function looksLikeCommunication(labelText) {
    return String(labelText || "").includes("comunic");
  }
  ```
- A scoring function that prefers ranges close to 30 days, i.e. a typical monthly cycle:
  ```js
  // score prefers ~30 day periods (typical billing cycles)
  const da = dmyToDate(a);
  const db = dmyToDate(b);
  const diff = (db - da) / (1000 * 60 * 60 * 24);
  const closeness = 30 - Math.abs(diff - 30); // higher is better
  const score = baseScore + closeness;
  ```
- Six pattern families, tried in this priority order (`baseScore` shown, higher wins ties):

  | Label | Regex core | baseScore |
  |---|---|---|
  | A | `periodo (de)? (faturacao\|facturacao\|faturado) ... (N dias de)? DATE (a\|ate) DATE` | 100 |
  | B | `periodo (de)? (faturacao\|facturacao\|faturado): DATE - DATE` | 95 |
  | C | `periodo: DATE (a\|ate\|-) DATE` (generic) | 90 |
  | D | `inicio DATE ... fim DATE` (table-style) | 80 |
  | E | `data: DATE (a\|ate\|-) DATE` (line-item style) | 70 |
  | F | `data: <D> <mon> a <D> <mon>` with no year, year inferred from elsewhere on the bill | 60 |

  Pattern F's fallback-year discovery, with its own comment explaining the scenario it exists for:
  ```js
  // Try to discover a fallback year (used when bill says "15 ago a 14 set" without year)
  let fallbackYear = null;
  const yEmit = lower.match(/data\s+de\s+emiss[aã]o[^0-9]{0,30}(...)/i);
  ```

  The shared `DATE_ANY` token pattern used across all six regex families:
  ```js
  const DATE_ANY =
    "(?:20\\d{2}[\\/\\.\\-]\\d{1,2}[\\/\\.\\-]\\d{1,2}|\\d{1,2}[\\/\\.\\-]\\d{1,2}[\\/\\.\\-]\\d{2,4}|\\d{1,2}\\s+[a-z]{3,}\\s+20\\d{2})";
  ```

- Final selection: `candidates.sort((x, y) => y.score - x.score); return candidates[0]`.

**Ambiguity flagged, not guessed:** `DATE_ANY` (line 304) is declared with `const` *inside*
`extractBillingPeriod`'s function body, so it is block-scoped to that function only. It is also
referenced at line 625 (`buildPeriodContextForAI`) and line 662
(`guessBillingPeriodFromAnyDateRange`) — two entirely separate top-level functions where no
`DATE_ANY` is in scope. As written, calling either of those two functions should throw
`ReferenceError: DATE_ANY is not defined`. I did not find a second, module-level declaration of
`DATE_ANY` anywhere in the file. Whether this has actually been hit in production (vs. always
short-circuited before reaching that code) is not something I can determine by reading alone —
flagging it rather than assuming either way.

### 4.4 A second, independent period-guessing pass — `guessBillingPeriodFromAnyDateRange` (lines 653–717)

This is a fallback used only when the AI billing-period call is skipped or fails, and only when
`extractBillingPeriod` found nothing (see `ensureBillingPeriod`, section 5). It re-derives a
period from *any* two dates on the page that look like a range, with its own scoring:
```js
let score = 0;
if (/periodo|faturac|facturac|consumo|servic|billing|statement|service\s+period/.test(ctx)) score += 6;
if (days >= 27 && days <= 35) score += 3;
else if (days >= 20 && days <= 45) score += 2;
```
and the same meter-reading exclusion as tier 2 above:
```js
// exclude communication-of-readings period
if (/comunicac[aã]o\s+de\s+leituras?/.test(ctx)) continue;
```

---

## 5. Special cases, exceptions, and workarounds (with the reasoning quoted)

- **"Never return a null period" guarantee** — `ensureBillingPeriod` (lines 719–751) is a
  three-tier cascade: real extraction → generic date-range guess → `billDate - 30 days` → `today -
  30 days`. The comment marking the caller site states the intent plainly:
  ```js
  // ✅ GUARANTEE: never return null period
  extracted = ensureBillingPeriod(extracted, billText);
  ```
  Every fallback sets `extracted.periodEstimated = true` and `extracted.periodSource` so a
  consumer can tell a guess from a real read.

- **AI calls are always optional, never a hard dependency.** Both `applyAiFixedCosts` and
  `applyAiBillingPeriod` return the input unchanged if `DEEPSEEK_API_KEY` is missing, or if the AI
  call throws:
  ```js
  // 👉 If there's no DeepSeek API key, skip AI and just return what we already extracted
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return extracted;
  }
  ```
  ```js
  } catch (e) {
    console.log("AI fixed-costs error:", e?.message || e);
    // If AI fails for any reason, don't break the scan
    return extracted;
  }
  ```

- **A hard 20-second timeout wraps both AI calls together**, with the request continuing on a
  degraded (non-AI) result rather than hanging:
  ```js
  const AI_TIMEOUT_MS = 20000;
  ...
  } catch (err) {
    console.log("⚠️ AI skipped:", err?.message || err);
    extracted.aiSkipped = true;
    extracted.aiError = String(err?.message || err);
  }
  ```

- **A guardrail against AI hallucinating a fixed total bigger than the whole bill:**
  ```js
  // Guardrail: don't allow fixed > total unless total missing
  if (!extracted.totalAmount || fixedTotalGross <= extracted.totalAmount + 0.01) {
    extracted.fixedItems = fixedItemsGross;
    extracted.fixedTotal = fixedTotalGross;
    extracted.fixedAI = true;
  }
  ```

- **OCR "is this text even usable" gate**, applied before any parsing is attempted, with a
  threshold that appears to come from hard experience with near-empty OCR output rather than any
  documented reasoning:
  ```js
  function isUsableText(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length < 250) return false;
    const letters = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (letters < 80) return false;
    return true;
  }
  ```

- **kVA rating blacklist in `parse_SU_Eletricidade`** — a defensive check that exists specifically
  because a nearby *unrelated* number (the contracted power rating in kVA) could otherwise be
  mistaken for the euro amount of the "Potência Contratada" line:
  ```js
  const kvaRatings = [3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7];

  const potenciaVal = findClosestValidValue("potencia contratada", {
    maxCap: 100,
    blacklist: kvaRatings
  });
  ```

- **"jcav" as a search term** — direct evidence of an observed OCR misread of "CAV":
  ```js
  const cavVal = findClosestValidValue("jcav", { maxCap: 30 }) || findClosestValidValue(" cav ", { maxCap: 30 });
  ```

- **EDP's fiscal-pair cancellation rule** (quoted in full in section 3) exists specifically because
  a real EDP bill layout produces two lines — one showing a network-access tariff as negative at
  23% VAT, another showing a DL 60/2019 adjustment as positive at 6% VAT — that must NOT be counted
  as a real fixed charge if included naively.

- **`redactForAI` provider-NIF allowlist** — when masking 9-digit sequences that look like a
  Portuguese NIF, known supplier NIFs are explicitly exempted so the AI prompt (which relies on
  provider hints) doesn't lose that signal:
  ```js
  const providerNifs = new Set(
    Object.values(PROVIDERS || {})
      .flatMap(p => (p.nifs || []).map(x => String(x).replace(/\D/g, "")))
  );

  t = t.replace(/\b(\d{3})\s?(\d{3})\s?(\d{3})\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (providerNifs.has(digits)) return m; // keep supplier NIFs you use for detection
    return "[REDACTED_NIF]";
  });
  ```

- **Multi-endpoint OCR fallback chain** (`/api/analyze-bill`), tried in this exact order, each
  gated by `isUsableText`: PDF.js text layer → Google Vision (`documentTextDetection`) → Tesseract
  (`por+eng`, pages 1 and 2 rendered to PNG and OCR'd separately). This matches known issue #4 in
  CLAUDE.md (one upload can trigger multiple OCR runs).

- **`LOG_FULL_TEXT` env flag** gates whether raw OCR text is ever printed to logs at all (used in
  `/api/ocr-bill` and `/api/di-bill`):
  ```js
  if (process.env.LOG_FULL_TEXT === "1") {
    console.log("===== FULL OCR TEXT START =====");
    console.log(text);
    console.log("===== FULL OCR TEXT END =====");
  } else {
    console.log("OCR text length:", String(text || "").length);
  }
  ```
  This is directly relevant to the CLAUDE.md privacy rule "Never log file contents, extracted
  text, or raw model responses" — as written, setting this env var in production would violate
  that rule.

---

## 6. Suppliers the code currently recognises

Three distinct places name suppliers, for three different purposes, and they don't fully agree
with each other:

**A. `PROVIDERS` registry** (lines 1118–1134) — used only for NIF-based/keyword-based routing via
`detectProvider()`, which itself is never called by a live endpoint (see architectural note at
top). Also feeds the NIF allowlist in `redactForAI`.

| id | NIFs | keywords |
|---|---|---|
| `SU_ELETRICIDADE` | `507846044`, `507 846 044` | `su eletricidade`, `serviço universal` |
| `EDP_COMERCIAL` | `503504564`, `503 504 564` | `edp comercial` |
| `GALP` | `503996438`, `504499772` | `galp power`, `petrogal` |

**B. `detectUtilityType` electricity keyword list** (lines 384–390) — used to guess the *type* of
utility (electricity/water/gas), supplier names appear only as electricity signals, not as routing
targets:
```js
"endesa", "edp", "galp", "iberdrola", "goldenergy", "repsol", "su eletricidade", "sueletricidade"
```

**C. AI prompt "PROVIDER HINTS"** (electricity prompt only, section 1.2) — informal hints given to
the model, explicitly *not* meant to be trusted blindly ("do not hallucinate, just use to recognize
labels"): EDP, Endesa, Goldenergy, Iberdrola, Galp, SU.

Water suppliers/regulator terms appear only inside `detectUtilityType`'s water keyword list, as
generic Portuguese water-sector vocabulary rather than named commercial suppliers: `ersar`, `smas`,
`simas`, `indaqua`.

---

## 7. Evidence that a real bill broke this once

- The `jcav` search term (section 5) — direct fossil evidence of an actual OCR misread of "CAV"
  that had to be special-cased.
- The kVA-rating blacklist for "Potência Contratada" (section 5) — evidence that a real bill's
  layout put the kVA rating number close enough to the euro amount that the parser once picked up
  the wrong number.
- The EDP "Acesso às redes" fiscal-pair cancellation rule (sections 3 and 5) — evidence that a real
  EDP bill produced a pair of same-value, opposite-sign, differently-VAT-rated lines that had to be
  explicitly suppressed rather than summed.
- The "communication of readings" exclusion, present in *three separate places*
  (`extractBillingPeriod`'s `looksLikeCommunication`, `buildPeriodContextForAI`, and
  `guessBillingPeriodFromAnyDateRange`) — evidence that a real bill's "período ideal de comunicação
  de leituras" (the window during which the customer can self-report a meter reading) was once
  mistaken for the actual billing period, badly enough that the fix was applied redundantly in
  three independent code paths rather than once.
- The fallback-year logic for "Data: 15 ago a 14 set" (section 4.3, pattern F) — evidence that a
  real bill printed a date range without a year at all, forcing year inference from a separate
  "data de emissão" field elsewhere on the page.
- `isUsableText`'s specific thresholds (250 chars, 80 letters) — round numbers with no accompanying
  derivation in comments; almost certainly tuned empirically against bad scans, but the comment
  trail doesn't say what the original bad case looked like, so I'm not asserting a specific incident
  here, only that the thresholds look hand-tuned rather than principled.
- The Azure-DI-labelled functions (`analyzeWithAzureDI`, `diClient`) are now Google Vision under the
  hood — `analyzeWithAzureDI` is described in its own comment as a shim:
  ```js
  // Compatibility wrapper: keep old function name used elsewhere
  async function analyzeWithAzureDI(opts) {
    return analyzeWithGcpVision(opts);
  }
  ```
  and `diClient` similarly:
  ```js
  // Compatibility alias: your file still references diClient in other places
  const diClient = gcpVisionClient;
  ```
  This tells you the OCR *provider* was swapped (Azure Document Intelligence → Google Cloud
  Vision) at some point without renaming everything downstream — not a bill-content issue, but
  worth knowing before assuming "Azure" anywhere in this file means Azure is actually still in use.
- The comment `// PRINT THE REAL ERROR CODE` (line 1823, in `/api/scan-bill`) followed by
  `console.log("⚠️ AZURE ERROR DETAILS:", JSON.stringify(e, null, 2));` reads as a debugging
  addition left in from tracking down a specific past failure, though the original incident isn't
  named.

---

## Not covered here

Per the request, this document only covers Portuguese-bill domain knowledge: prompts, supplier
term tables, fixed/variable rules, date/number parsing, special-case workarounds, recognised
suppliers, and defensive checks. It does not cover the Express routing/multer/OCR-provider
plumbing except where a piece of plumbing (e.g. the OCR fallback chain, the `LOG_FULL_TEXT` flag)
was itself evidence of a workaround relevant to bill reading.
