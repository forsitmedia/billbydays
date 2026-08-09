// backend/server.js (CommonJS)
//
// Bill extraction: ONE endpoint, ONE call to Google's Gemini API.
// The uploaded PDF/image is sent to the model as-is — no OCR, no text layer,
// no per-supplier parsers. The page layout is the signal.
//
// Everything the model returns is re-validated in JavaScript below. The model
// is treated as an untrusted reader, never as a calculator.

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();

// ---------------------------------------------------------------------------
// MODEL
// ---------------------------------------------------------------------------
// Single source of truth for the model name.
//
// Verified against Google's published model + deprecation lists on 2026-08-09:
// gemini-3.5-flash-lite is a current, stable, fast/cheap-tier multimodal model
// with no announced retirement date, and it is enabled on our API key.
//
// Do NOT put gemini-2.0-flash / gemini-2.0-flash-lite here: both were shut
// down on 2026-06-01.
//
// If extraction quality is too low (fields keep coming back null because
// confidence sits under CONFIDENCE_FLOOR), "gemini-3.6-flash" is a drop-in
// upgrade — more accurate on dense invoice tables, costs more per scan.
// Changing this one string is the whole migration.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TIMEOUT_MS = 45000;

// ---------------------------------------------------------------------------
// UPLOAD LIMITS
// ---------------------------------------------------------------------------
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_PAGES = 8;

// Gemini accepts all of these as native vision input.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
]);

// Below this, a field is returned as null instead of as a number.
// Product decision, see README of this change: the person uploading is often
// not the bill's owner and cannot sanity-check a pre-filled number, so a wrong
// number they never questioned is worse than a blank field.
const CONFIDENCE_FLOOR = 0.75;

// Validation bounds (requirement 6).
const MIN_TOTAL = 0;      // exclusive
const MAX_TOTAL = 5000;   // exclusive
const MIN_PERIOD_DAYS = 15;
const MAX_PERIOD_DAYS = 100;

// ---------------------------------------------------------------------------
// PRIVACY-SAFE LOGGING
// ---------------------------------------------------------------------------
// The only things we are allowed to log: timestamp, endpoint, status, duration,
// file size. Never a filename, never file contents, never extracted text,
// never a raw model response.
function logRequest(endpoint, status, durationMs, bytes) {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      endpoint,
      status,
      ms: durationMs,
      bytes,
    })
  );
}

app.use(cors());

// ---------------------------------------------------------------------------
// MULTER — memory only. An upload must never touch disk.
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: MAX_IMAGE_PAGES,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(String(file.mimetype || "").toLowerCase())) {
      return cb(null, true);
    }
    const err = new Error("Unsupported file type. Upload a PDF, JPEG, PNG or HEIC.");
    err.code = "UNSUPPORTED_TYPE";
    cb(err);
  },
});

const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },            // a single PDF or photo
  { name: "files", maxCount: MAX_IMAGE_PAGES }, // several photos = one bill
]);

// ---------------------------------------------------------------------------
// THE PROMPT
// ---------------------------------------------------------------------------
// This carries forward the domain knowledge in BILL-KNOWLEDGE.md — months of
// analysis of real Portuguese bills. Everything here was learned from an actual
// invoice that broke an earlier parser. Do not trim it to "clean it up".
const BILL_PROMPT = `You are reading a household utility bill, most likely Portuguese. You are looking at the
actual page image, so use the layout: columns, table rows, totals in bold, the summary box.

Extract only the fields in the response schema. Report what is printed on the page.
If a value is not clearly on the page, return null for it. Never estimate, never
average, never infer a number that is not written. A null is a correct answer.

=============================================================================
TOTAL
=============================================================================
"total" is the amount the customer must actually pay for this bill, including VAT.
On Portuguese bills this is labelled: "Total a pagar", "Valor a pagar", "Valor da
fatura", "Valor a debitar", "Importância a pagar", or on EDP bills the question
"Quanto tenho a pagar?", or simply "Montante:".

Take the final payable amount, not a subtotal, not the taxable base
("base tributável"), not a previous balance, not a direct-debit notice.

=============================================================================
FIXED PART — the important one
=============================================================================
"fixedPart" is the sum of every FIXED charge on the bill, INCLUDING the VAT
charged on those fixed charges.

Definition: a fixed cost is a charge you still pay with 0 kWh consumed (or 0 m³
of water) as long as the contract stays active. It does not depend on how much
was used.

ELECTRICITY — count these as fixed:
- "Potência Contratada", "Potência", "Termo de Potência", "Termo Potência"
  (the standing power/capacity charge, billed per day or per month)
- "Termo Fixo", "Termo Fixo Acesso às Redes", "Tarifa Fixa",
  "Tarifa Fixa de Acesso", "Acesso às Redes (Potência Contratada)"
- "Tarifa de Comercialização"
- "Taxa de Exploração DGEG", "DGEG" (often 0,07 €/mês)
- "Contribuição Audiovisual", "CAV" (often 2,85 €/mês or 1,00 €).
  Poor scans sometimes render CAV as "JCAV" — same thing.
- Fixed service add-ons billed per month, not per kWh: "Serviço",
  "Assistência", "Urgências", "Seguro", "Plano", "Proteção"
- Fixed discounts, only when they are tied to a fixed item: a discount counts
  as fixed if it mentions "dias", "mês", "mensal", or refers to potência /
  termo fixo / tarifa fixa / comercialização. "Desconto Tarifa Social" counts
  as fixed only when it is not tied to kWh. A discount reduces fixedPart.

WATER / SANITATION / WASTE — count these as fixed:
- "Tarifa Fixa", "Tarifa Fixa Água", "TRF FIXA", "Quota", "Quota de Serviço"
- "Tarifa de Disponibilidade", "Tarifa Disponibilidade", "Tar. Disp.", "Disponibilidade"
- "Saneamento Fixo", "Tarifa Fixa Saneamento", "TRF FIXA SANEAM", "Disp Saneamento"
- "RSU Fixo", "RSU Fixa", "Resíduos Sólidos Urbanos Fixos", "Tarifa Fixa Resíduos",
  "Tar. Disp. RU", "TRF FIXA GESTÃO RES. URB"
- "Aluguer de Contador", "Aluguer do contador" (meter rental, billed by days/month)
- "Taxa Rede Saneamento Fixa", when clearly fixed

NEVER count as fixed (these are variable):
- Anything priced per kWh or per m³ — any line containing "kWh", "€/kWh",
  "m3", "m³", "€/m3", "consumo", "energia", "escalão", "TRF VAR", or the
  time bands "vazio", "cheias", "ponta" with a kWh quantity
- "IEC", "Imposto Especial de Consumo", and the "Mecanismo DL 33/2022"
  adjustment, when tied to consumption
- "Taxa de Recursos Hídricos" / "TRH", "TGR", "Taxa Gestão Resíduos" when
  billed per m³
- VAT summary lines themselves: "IVA", "Total IVA", "Taxa IVA",
  "Base tributável", "Resumo IVA". These describe tax on other lines; they
  are not a fixed item of their own.

VAT ON THE FIXED PART:
fixedPart must be the GROSS figure — the fixed charges plus the VAT applied to
them. Bills usually list fixed lines net (sem IVA), so add the VAT yourself.
Always prefer the VAT rate printed on that line, or resolved from the bill's own
footnote legend (e.g. "(1) IVA 6%"). Only when the bill shows no rate at all,
fall back to these typical Portuguese rates:
  - Contribuição Audiovisual (CAV): 6%
  - Potência / Termo de Potência / Tarifa de Comercialização / DGEG: 23%
  - Network access fixed terms ("acesso às redes"): often 6%
  - "Não sujeito a IVA" / "IVA n. suj.": 0%

THE DL 60/2019 RULE (EDP bills, important):
Some EDP bills show an "Acesso às redes" pair: two lines with the SAME base
value, OPPOSITE signs, and DIFFERENT VAT rates — typically one negative at 23%
and one positive, referencing "DL 60/2019", at 6%. IGNORE BOTH LINES. They
cancel out and are not a real charge. Do not put either into fixedPart.

OTHER TRAPS SEEN ON REAL BILLS:
- Next to "Potência Contratada" there is usually a kVA rating, not a price.
  3,45 / 4,6 / 5,75 / 6,9 / 10,35 / 13,8 / 17,25 / 20,7 are contracted-power
  ratings in kVA. Never read one of those as the euro amount.
- Where a table row shows unit price, quantity and line total, take the LINE
  TOTAL, not the unit price.
- The same fixed charge can be split across sub-periods (e.g. 29 dias at one
  rate + 2 dias at another). Add all the parts together.

fixedPart must never be larger than total.

=============================================================================
BILLING PERIOD
=============================================================================
periodStart and periodEnd are the period the CHARGES cover — labelled
"Período de faturação", "Período de consumo", "Período", or shown as
"de DD-MM-YYYY a DD-MM-YYYY" / "15 ago a 14 set".

NEVER use the "período ideal de comunicação de leituras" — that is the window
in which the customer may self-report a meter reading, not the billing period.
Also ignore the invoice date ("Data de emissão"), the due date
("Data de vencimento"), and any meter-reading dates.

Typical billing cycles are about 30 days. A candidate range of a few days, or
of many months, is almost certainly the wrong field — return null instead.

Some bills print the range without a year ("Data: 15 ago a 14 set"). Take the
year from elsewhere on the page (e.g. the issue date), and remember the period
can cross a year boundary. Output both dates as YYYY-MM-DD.

Portuguese month names: janeiro, fevereiro, março, abril, maio, junho, julho,
agosto, setembro, outubro, novembro, dezembro (often abbreviated to 3 letters).

=============================================================================
NUMBER FORMAT
=============================================================================
European format. The COMMA is the decimal separator and the dot is the
thousands separator: "1.234,56" is one thousand two hundred thirty-four point
five six. "6,97" is six point nine seven. Return all numbers as plain JSON
numbers using a dot: 1234.56, 6.97.

=============================================================================
OTHER FIELDS
=============================================================================
- supplier: the utility company's trading name only (EDP Comercial, Galp,
  Endesa, Iberdrola, Goldenergy, Repsol, SU Eletricidade, Águas de..., etc).
  The company, never the customer.
- billType: electricity, water, gas, internet, or other.
- currency: ISO code, "EUR" on a Portuguese bill.
- kwh: total electricity consumption for the period in kWh, if the bill states
  it. Sum the time bands (vazio/cheias/ponta) if it is only given per band.
  null for non-electricity bills or if not shown.

=============================================================================
PRIVACY — non-negotiable
=============================================================================
Never output the customer's or account holder's name, the address, NIF/
contribuinte number, IBAN, bank details, client number, contract number, CPE,
CUI, or meter ID. Not in any field, not in "issues", not anywhere. The person
scanning this bill is often not the person named on it.

=============================================================================
CONFIDENCE
=============================================================================
Report honest per-field confidence from 0 to 1.
- 0.9+  : the value is printed plainly and you are certain you read the right line.
- 0.75+ : you are confident, minor ambiguity in layout.
- below 0.75 : you had to reason, guess, pick between candidates, or the scan is
  unclear. Say so. Anything under 0.75 will be DISCARDED and shown to the user
  as "we could not read this", which is the outcome we want — a blank field is
  much better than a wrong number the user cannot check.
Do not inflate confidence. An honest 0.4 is more useful than an optimistic 0.8.

confidence.period covers periodStart and periodEnd together.

For every field you return as null or with low confidence, add an entry to
"issues" with the field name and one short plain-English sentence a
non-technical person would understand, e.g. "The total was cut off at the edge
of the photo." Do not quote bill text in the reason.`;

// ---------------------------------------------------------------------------
// RESPONSE SCHEMA — forces the model to answer in exactly this shape
// ---------------------------------------------------------------------------
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    total: { type: "number", nullable: true },
    fixedPart: { type: "number", nullable: true },
    periodStart: { type: "string", nullable: true },
    periodEnd: { type: "string", nullable: true },
    supplier: { type: "string", nullable: true },
    billType: {
      type: "string",
      enum: ["electricity", "water", "gas", "internet", "other"],
    },
    currency: { type: "string" },
    kwh: { type: "number", nullable: true },
    confidence: {
      type: "object",
      properties: {
        total: { type: "number" },
        fixedPart: { type: "number" },
        period: { type: "number" },
      },
      required: ["total", "fixedPart", "period"],
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          reason: { type: "string" },
        },
        required: ["field", "reason"],
      },
    },
  },
  required: [
    "total",
    "fixedPart",
    "periodStart",
    "periodEnd",
    "supplier",
    "billType",
    "currency",
    "kwh",
    "confidence",
    "issues",
  ],
};

// ---------------------------------------------------------------------------
// THE SINGLE MODEL CALL
// ---------------------------------------------------------------------------
async function callGemini(parts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("Bill scanning is not configured on the server.");
    err.status = 503;
    throw err;
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          ...parts.map((p) => ({
            inline_data: { mime_type: p.mimeType, data: p.buffer.toString("base64") },
          })),
          { text: BILL_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 8192,
      // Temperature is deliberately left at the model default. Google
      // documents that lowering it on Gemini 3 thinking models can cause
      // looping; the response schema already constrains the output.
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(
      e && e.name === "AbortError"
        ? "The bill scan took too long. Try again, or enter the values yourself."
        : "Could not reach the bill scanning service."
    );
    err.status = 504;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Deliberately not logging or forwarding the provider's response body:
    // it can echo back request content.
    const rateLimited = res.status === 429;
    const err = new Error(
      rateLimited
        ? "The bill scanner is busy right now. Try again in a moment, or enter the values yourself."
        : "The bill scanning service could not process this file."
    );
    err.status = rateLimited ? 429 : 502;
    throw err;
  }

  const payload = await res.json();

  const text = payload &&
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    Array.isArray(payload.candidates[0].content.parts)
      ? payload.candidates[0].content.parts.map((p) => p.text || "").join("")
      : "";

  if (!text.trim()) {
    const err = new Error("The bill could not be read. Try a clearer photo or the PDF.");
    err.status = 422;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error("The bill could not be read. Try a clearer photo or the PDF.");
    err.status = 422;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// VALIDATION — never trust the model's arithmetic
// ---------------------------------------------------------------------------
function toNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toConfidence(v) {
  const n = toNumber(v);
  if (n === null) return 0;
  return Math.max(0, Math.min(1, n));
}

// Strict YYYY-MM-DD → UTC Date. Rejects "2026-02-31" and friends.
function parseIsoDate(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function isoString(dt) {
  return dt.toISOString().slice(0, 10);
}

const BILL_TYPES = new Set(["electricity", "water", "gas", "internet", "other"]);

// Builds the response from scratch, field by field. The model's object is never
// spread or merged in, so an unexpected key it invents (a name, an address, an
// IBAN) has no path into the response.
function buildResult(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const issues = [];
  const seen = new Set();

  const addIssue = (field, reason) => {
    const key = field + "|" + reason;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ field, reason });
  };

  // Carry over the model's own explanations first, sanitised.
  if (Array.isArray(src.issues)) {
    for (const it of src.issues.slice(0, 10)) {
      if (!it || typeof it !== "object") continue;
      const field = String(it.field || "").trim().slice(0, 40);
      const reason = String(it.reason || "").trim().slice(0, 200);
      if (field && reason) addIssue(field, reason);
    }
  }

  const conf = src.confidence && typeof src.confidence === "object" ? src.confidence : {};
  const confTotal = toConfidence(conf.total);
  const confFixed = toConfidence(conf.fixedPart);
  const confPeriod = toConfidence(conf.period);

  // --- total ---------------------------------------------------------------
  let total = toNumber(src.total);

  if (total !== null && confTotal < CONFIDENCE_FLOOR) {
    total = null;
    addIssue("total", "We could not read the total with enough certainty to fill it in.");
  }
  if (total !== null && !(total > MIN_TOTAL && total < MAX_TOTAL)) {
    total = null;
    addIssue("total", `The total we read was outside the plausible range (€0–€${MAX_TOTAL}).`);
  }
  if (total === null && !issues.some((i) => i.field === "total")) {
    addIssue("total", "We could not find the total amount on this bill.");
  }

  // --- fixedPart -----------------------------------------------------------
  let fixedPart = toNumber(src.fixedPart);

  if (fixedPart !== null && confFixed < CONFIDENCE_FLOOR) {
    fixedPart = null;
    addIssue(
      "fixedPart",
      "We could not identify the fixed charges on this bill with enough certainty."
    );
  }
  if (fixedPart !== null && fixedPart < 0) {
    fixedPart = null;
    addIssue("fixedPart", "The fixed part we read was negative, which cannot be right.");
  }
  // Only checkable when the total survived validation.
  if (fixedPart !== null && total !== null && fixedPart > total) {
    fixedPart = null;
    addIssue("fixedPart", "The fixed part we read was larger than the total, so we discarded it.");
  }
  if (fixedPart === null && !issues.some((i) => i.field === "fixedPart")) {
    addIssue("fixedPart", "We could not find the fixed charges on this bill.");
  }

  // --- period --------------------------------------------------------------
  let periodStart = null;
  let periodEnd = null;
  const startDt = parseIsoDate(src.periodStart);
  const endDt = parseIsoDate(src.periodEnd);

  if (startDt && endDt) {
    if (confPeriod < CONFIDENCE_FLOOR) {
      addIssue("period", "We could not read the billing period with enough certainty.");
    } else if (endDt <= startDt) {
      addIssue("period", "The billing period we read ended before it started.");
    } else {
      const days = Math.round((endDt - startDt) / 86400000);
      if (days < MIN_PERIOD_DAYS || days > MAX_PERIOD_DAYS) {
        addIssue(
          "period",
          `The billing period we read was ${days} days, which is not a normal billing cycle.`
        );
      } else {
        periodStart = isoString(startDt);
        periodEnd = isoString(endDt);
      }
    }
  }

  if (periodStart === null && !issues.some((i) => i.field === "period")) {
    addIssue("period", "We could not find the billing period on this bill.");
  }

  // --- the rest ------------------------------------------------------------
  let supplier = null;
  if (typeof src.supplier === "string" && src.supplier.trim()) {
    supplier = src.supplier.trim().slice(0, 60);
  }

  const billType = BILL_TYPES.has(src.billType) ? src.billType : "other";

  let currency = "EUR";
  if (typeof src.currency === "string" && /^[A-Za-z]{3}$/.test(src.currency.trim())) {
    currency = src.currency.trim().toUpperCase();
  }

  // Optional, for a future price-comparison feature. Not shown to the user, so
  // a bad value is simply dropped rather than reported as an issue.
  let kwh = toNumber(src.kwh);
  if (kwh !== null && !(kwh > 0 && kwh < 100000)) kwh = null;

  return {
    total,
    fixedPart,
    periodStart,
    periodEnd,
    supplier,
    billType,
    currency,
    kwh,
    confidence: { total: confTotal, fixedPart: confFixed, period: confPeriod },
    issues,
  };
}

// Same shape as a successful extraction, so the frontend has one code path.
function emptyResult(field, reason) {
  return {
    total: null,
    fixedPart: null,
    periodStart: null,
    periodEnd: null,
    supplier: null,
    billType: "other",
    currency: "EUR",
    kwh: null,
    confidence: { total: 0, fixedPart: 0, period: 0 },
    issues: [{ field, reason }],
  };
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ ok: true, model: GEMINI_MODEL }));

async function handleExtract(req, res, endpoint) {
  const started = Date.now();
  const files = [
    ...((req.files && req.files.file) || []),
    ...((req.files && req.files.files) || []),
  ];
  const bytes = files.reduce((n, f) => n + (f.size || 0), 0);
  let status = 200;

  try {
    if (!files.length) {
      status = 400;
      return res.status(status).json(emptyResult("file", "No file was uploaded."));
    }

    if (bytes > MAX_UPLOAD_BYTES) {
      status = 413;
      return res
        .status(status)
        .json(emptyResult("file", "That upload is larger than 10 MB. Try a smaller photo."));
    }

    // A PDF is a complete bill on its own; photos are pages of one bill.
    const pdf = files.find((f) => f.mimetype === "application/pdf");
    const parts = pdf
      ? [{ buffer: pdf.buffer, mimeType: "application/pdf" }]
      : files.map((f) => ({
          buffer: f.buffer,
          mimeType: f.mimetype === "image/jpg" ? "image/jpeg" : f.mimetype,
        }));

    const raw = await callGemini(parts);
    return res.json(buildResult(raw));
  } catch (err) {
    status = err && err.status ? err.status : 500;
    return res
      .status(status)
      .json(
        emptyResult(
          "file",
          (err && err.message) || "Something went wrong while reading the bill."
        )
      );
  } finally {
    // Drop the bill from memory as soon as we are done with it.
    for (const f of files) f.buffer = null;
    logRequest(endpoint, status, Date.now() - started, bytes);
  }
}

app.post("/api/extract-bill", uploadFields, (req, res) =>
  handleExtract(req, res, "/api/extract-bill")
);

// Thin alias so clients still running the old frontend keep reaching a live
// endpoint. Same handler, same response shape.
app.post("/api/scan-bill", uploadFields, (req, res) =>
  handleExtract(req, res, "/api/scan-bill")
);

// Multer rejections (file too large, wrong type) arrive here.
app.use((err, req, res, next) => {
  if (!err) return next();

  let status = 400;
  let message = "That file could not be accepted.";

  if (err.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "That file is larger than 10 MB. Try a smaller photo, or the PDF.";
  } else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
    message = `Too many files. Upload one PDF, or up to ${MAX_IMAGE_PAGES} photos of one bill.`;
  } else if (err.code === "UNSUPPORTED_TYPE") {
    status = 415;
    message = err.message;
  }

  logRequest(req.path, status, 0, 0);
  return res.status(status).json(emptyResult("file", message));
});

// ---------------------------------------------------------------------------
// KEPT, BUT NO LONGER CALLED
// ---------------------------------------------------------------------------
// We used to OCR the bill to text and redact personal data out of that text
// before sending it to a language model. We now send the page image itself
// straight to a vision model, so there is no intermediate text to scrub and
// this function has nothing to act on — redacting pixels is a different problem.
//
// Privacy is instead enforced at the other end: the prompt forbids returning
// personal data, and buildResult() constructs the response field by field from
// a fixed whitelist, so nothing the model invents can reach the client.
//
// Kept for reference in case a text path is ever reintroduced.
// eslint-disable-next-line no-unused-vars
function redactForAI(rawText) {
  let t = String(rawText || "");

  // Supplier NIFs are public company numbers, not personal data; an earlier
  // version kept them so provider detection still worked after redaction.
  const providerNifs = new Set(["507846044", "503504564", "503996438", "504499772"]);

  // Emails
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");

  // Portuguese IBANs (PT + 23 digits)
  t = t.replace(/\bPT\d{23}\b/gi, "[REDACTED_IBAN]");

  // Likely phone numbers (rough)
  t = t.replace(/\b(\+?\d[\d\s-]{7,}\d)\b/g, "[REDACTED_PHONE]");

  // NIF-like 9 digit sequences
  t = t.replace(/\b(\d{3})\s?(\d{3})\s?(\d{3})\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (providerNifs.has(digits)) return m;
    return "[REDACTED_NIF]";
  });

  // Customer/account identifiers
  t = t.replace(
    /(N[ºo]\s*Cliente|NIF|Contribuinte|NIPC|CPE|CUI|Contrato|Conta|Código\s*de\s*Cliente)\s*[:\-]?\s*\S+/gi,
    (m) => m.split(":")[0] + ": [REDACTED_ID]"
  );

  // Address-like lines
  t = t
    .split("\n")
    .map((line) => {
      const l = line.toLowerCase();
      if (
        l.includes("morada") ||
        l.includes("endereço") ||
        l.includes("endereco") ||
        l.includes("rua ") ||
        l.includes("avenida") ||
        l.includes("av.") ||
        l.includes("travessa") ||
        l.includes("estrada") ||
        /\b\d{4}-\d{3}\b/.test(l)
      )
        return "[REDACTED_ADDRESS_LINE]";
      return line;
    })
    .join("\n");

  return t;
}

// Only listen when run directly, so the validation logic can be required and
// tested without opening a port.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`bill backend running on ${PORT} (${GEMINI_MODEL})`));
}

module.exports = { app, buildResult, parseIsoDate, CONFIDENCE_FLOOR, GEMINI_MODEL };
