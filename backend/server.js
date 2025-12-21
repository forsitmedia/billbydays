// backend/server.js (CommonJS) — PDF.js extraction + robust parsing (no crashes)

require("dotenv").config();

const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");


const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { pathToFileURL } = require("url");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const { createCanvas } = require("@napi-rs/canvas");

const app = express();

// ------------------------------
// Azure Document Intelligence setup
// ------------------------------
const AZURE_DI_ENDPOINT = process.env.AZURE_DI_ENDPOINT;
const AZURE_DI_KEY = process.env.AZURE_DI_KEY;

const diClient =
  AZURE_DI_ENDPOINT && AZURE_DI_KEY
    ? new DocumentAnalysisClient(AZURE_DI_ENDPOINT, new AzureKeyCredential(AZURE_DI_KEY))
    : null;

async function analyzeWithAzureDI({ buffer, contentType, pages = "1-4" }) {
  if (!diClient) {
    throw new Error("Azure DI is not configured. Add AZURE_DI_ENDPOINT and AZURE_DI_KEY to .env");
  }

  const modelId = process.env.AZURE_MODEL_ID || "prebuilt-invoice";
  let finalBuffer = buffer;
  let finalContentType = contentType;

  // --- 1. SAFETY CHECK: RESIZE IF TOO BIG (> 4MB) ---
  const MAX_SIZE = 4 * 1024 * 1024; // 4MB
  
  if (buffer.length > MAX_SIZE) {
    console.log(`⚠️ File is too big (${(buffer.length / 1024 / 1024).toFixed(2)} MB). Resizing for Free Tier...`);
    
    // If it's a PDF, we render Page 1 as a standard JPEG (smaller than PNG)
    // If it's a PDF and too big, analyze ALL pages by rendering each page as a compact JPEG
if (contentType === "application/pdf") {
  const numPages = await getPdfNumPages(buffer);
  console.log(`   -> PDF has ${numPages} pages. Running Azure DI on ALL pages (page-by-page)...`);

  // We will merge the DI text from each page into one big text blob
  let mergedContent = "";

  for (let p = 1; p <= numPages; p++) {
    console.log(`   -> Converting PDF Page ${p} to compact JPEG...`);

    // Render page -> PNG -> compress to JPEG
    let pagePng = await renderPdfPageToPngBuffer(buffer, p, 1.5);
    let pageJpg = await sharp(pagePng).jpeg({ quality: 80 }).toBuffer();

    console.log(`Analyzing document with model: ${modelId} (page ${p}/${numPages})...`);
    const poller = await diClient.beginAnalyzeDocument(modelId, pageJpg, {
      contentType: "image/jpeg",
    });
    const result = await poller.pollUntilDone();

    const pageText = result?.content ? String(result.content) : "";
    mergedContent += `\n\n----- PAGE ${p} -----\n\n` + pageText;
  }

  // IMPORTANT: return early, because we already analyzed all pages
  return { content: mergedContent.trim() };
}

    // If it's already an image, resize it
    else if (String(contentType).startsWith("image/")) {
      console.log("   -> Resizing image...");
      finalBuffer = await sharp(buffer)
        .resize({ width: 1800 }) 
        .jpeg({ quality: 80 })
        .toBuffer();
      finalContentType = "image/jpeg";
    }
  }

  console.log(`Analyzing document with model: ${modelId} (${(finalBuffer.length/1024/1024).toFixed(2)} MB)...`);

  // --- 2. SEND TO AZURE ---
  try {
    const poller = await diClient.beginAnalyzeDocument(modelId, finalBuffer, {
      contentType: finalContentType,
      // If we converted to JPEG, we can't ask for specific PDF pages anymore
      pages: finalContentType === "application/pdf" ? pages : undefined, 
    });
    return await poller.pollUntilDone();
  } catch (e) {
    console.log("⚠️ AZURE ERROR DETAILS:", JSON.stringify(e, null, 2));
    throw e;
  }
}


// Post-fix for tricky “value below/right” cases like Potência Contratada
function pickLargestMoneyNear(text, keyword, windowSize = 2000) {
  const raw = String(text || "");
  const norm = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const lower = norm.toLowerCase();

  const idx = lower.indexOf(keyword);
  if (idx < 0) return null;

  const start = Math.max(0, idx - windowSize);
  const end = Math.min(norm.length, idx + windowSize);
  const chunk = norm.slice(start, end);

  const matches = chunk.match(/\d{1,5}(?:[.,]\d{2})/g) || [];
  const nums = matches
    .map((m) => m.replace(/\./g, "").replace(",", "."))
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));

  if (!nums.length) return null;
  return Number(Math.max(...nums).toFixed(2));
}


app.use(cors());

app.use((req, _res, next) => {
  console.log("REQ:", req.method, req.url);
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

function parseMoneyPT(str) {
  const cleaned = String(str).replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseMoneyEU(val) {
  if (!val) return null;
  let s = String(val).trim().replace(/[€\s]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");

  const n = Number(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

// ------------------------------
// ------------------------------
// Utility + OCR Quality Helpers
// ------------------------------
function isUsableText(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length < 250) return false;
  const letters = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters < 80) return false;
  return true;
}

function parsePtDate(str) {
  const s = String(str || "").trim().toLowerCase();

  // dd-mm-yyyy or dd/mm/yyyy or dd.mm.yyyy
  let m = s.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yy = m[3];
    if (yy.length === 2) yy = "20" + yy;
    return `${dd}-${mm}-${yy}`;
  }

  // dd mon yyyy (Portuguese)
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

  m = s.match(/(\d{1,2})\s+([a-zçãõáéíóú]+)\s+(\d{4})/i);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const monRaw = m[2].normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const monKey = monRaw.slice(0, 3);
    const mm = months[monRaw] || months[monKey];
    const yy = m[3];
    if (mm) return `${dd}-${mm}-${yy}`;
  }

  return null;
}

function extractBillingPeriod(text) {
  const raw = String(text || "");

  // "Período de faturação: 27 ago 2025 até 26 out 2025"
  let m = raw.match(/Per[ií]odo\s+de\s+fatura[cç][aã]o\s*:\s*([\s\S]{0,40}?)\s+(?:at[eé]|a)\s+([\s\S]{0,40}?)(?:\n|$)/i);
  if (m) {
    const a = parsePtDate(m[1]);
    const b = parsePtDate(m[2]);
    return { periodStart: a, periodEnd: b };
  }

  // "Período: 27/08/2025 a 26/10/2025"
  m = raw.match(/Per[ií]odo\s*[:\-]\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})\s*(?:a|at[eé])\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i);
  if (m) {
    return { periodStart: parsePtDate(m[1]), periodEnd: parsePtDate(m[2]) };
  }

  return { periodStart: null, periodEnd: null };
}

function detectUtilityType(text) {
  const t = String(text || "").toLowerCase();

  const electricityKw = [
    "kwh", "eletricidade", "energia elétrica", "energia eletrica",
    "potência", "potencia", "potência contratada", "potencia contratada",
    "dgeg", "cav", "contribuição audiovisual", "contribuicao audiovisual",
    "e-redes", "eredes", "cpe", "tarifa de acesso às redes", "tarifa de acesso as redes",
    "endesa", "edp", "galp", "iberdrola", "goldenergy", "repsol", "su eletricidade", "sueletricidade"
  ];

  const waterKw = [
    "m3", "m³", "água", "agua", "abastecimento", "saneamento",
    "resíduos", "residuos", "tarifa fixa", "tarifa de disponibilidade", "disponibilidade",
    "serviços de água", "servicos de agua", "ersar", "águas", "aguas", "smas", "simas", "indaqua"
  ];

  const gasKw = [
    "gás", "gas", "gás natural", "gas natural"
  ];

  let e = 0, w = 0, g = 0;
  for (const k of electricityKw) if (t.includes(k)) e++;
  for (const k of waterKw) if (t.includes(k)) w++;
  for (const k of gasKw) if (t.includes(k)) g++;

  if (t.includes("kwh")) e += 2;

  let utility = "unknown";
  const max = Math.max(e, w, g);
  if (max === 0) utility = "unknown";
  else if (max === e) utility = "electricity";
  else if (max === w) utility = "water";
  else utility = "gas";

  const sum = e + w + g;
  const confidence = sum === 0 ? 0 : Math.min(0.95, max / sum);

  if (confidence < 0.55 && utility !== "unknown") utility = "other";

  return { utility, confidence, scores: { electricity: e, water: w, gas: g } };
}

function clampPages(pagesStr, maxPages) {
  const p = String(pagesStr || "").trim();
  if (!p) return undefined;
  if (p.toLowerCase() === "all") return `1-${maxPages}`;

  const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    let a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    a = Math.max(1, Math.min(a, maxPages));
    b = Math.max(1, Math.min(b, maxPages));
    if (b < a) b = a;
    return `${a}-${b}`;
  }

  const parts = p.split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
  if (parts.length) {
    const clamped = Array.from(new Set(parts.map(n => Math.max(1, Math.min(n, maxPages))))).sort((a,b)=>a-b);
    return clamped.join(",");
  }

  return undefined;
}


function redactForAI(rawText) {
  let t = String(rawText || "");

  // Remove emails
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");

  // Remove Portuguese IBANs (PT + 23 digits)
  t = t.replace(/\bPT\d{23}\b/gi, "[REDACTED_IBAN]");

  // Remove likely phone numbers (very rough)
  t = t.replace(/\b(\+?\d[\d\s-]{7,}\d)\b/g, "[REDACTED_PHONE]");

  // Mask NIF-like 9 digit sequences (keeps provider NIFs if they match your allowlist)
  const providerNifs = new Set(
    Object.values(PROVIDERS || {})
      .flatMap(p => (p.nifs || []).map(x => String(x).replace(/\D/g, "")))
  );

  t = t.replace(/\b(\d{3})\s?(\d{3})\s?(\d{3})\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (providerNifs.has(digits)) return m; // keep supplier NIFs you use for detection
    return "[REDACTED_NIF]";
  });

  // Mask customer/account identifiers (common bill fields)
  t = t.replace(/(N[ºo]\s*Cliente|NIF|Contribuinte|NIPC|CPE|CUI|Contrato|Conta|Código\s*de\s*Cliente)\s*[:\-]?\s*\S+/gi,
    (m) => m.split(":")[0] + ": [REDACTED_ID]"
  );

  // Remove address-like lines (simple heuristic)
  t = t.split("\n").map(line => {
    const l = line.toLowerCase();
    if (
      l.includes("morada") || l.includes("endereço") || l.includes("endereco") ||
      l.includes("rua ") || l.includes("avenida") || l.includes("av.") ||
      l.includes("travessa") || l.includes("estrada") ||
      /\b\d{4}-\d{3}\b/.test(l) // PT postal code
    ) return "[REDACTED_ADDRESS_LINE]";
    return line;
  }).join("\n");

  return t;
}


async function applyAiFixedCosts(extracted, text) {
  const util = detectUtilityType(text);
  extracted.utilityType = util.utility;
  extracted.utilityConfidence = util.confidence;

  // Only electricity + water prompts exist right now.
  const promptType = (util.utility === "water") ? "water" : "electricity";

  const safeText = redactForAI(text);
const ai = await aiExtractFixedCostsFromText(safeText, promptType);


  if (ai && ai.confidence >= 0.6 && Array.isArray(ai.fixedItems) && ai.fixedItems.length) {
    const fixedItemsGross = ai.fixedItems
      .filter(it => it && typeof it.net === "number" && it.net !== 0)
      .map(it => {
        const vatRate = (typeof it.vatRate === "number" && it.vatRate >= 0) ? it.vatRate : 0;
        const gross = +(it.net * (1 + vatRate)).toFixed(2);
        return {
          evidence: it.label || "Fixed item",
          amount: gross,
          net: it.net,
          vatRate,
          evidenceLine: it.evidence || ""
        };
      });

    const fixedTotalGross = +fixedItemsGross.reduce((s, x) => s + (Number(x.amount) || 0), 0).toFixed(2);

    // Guardrail: don't allow fixed > total unless total missing
    if (!extracted.totalAmount || fixedTotalGross <= extracted.totalAmount + 0.01) {
      extracted.fixedItems = fixedItemsGross;
      extracted.fixedTotal = fixedTotalGross;
      extracted.fixedAI = true;
    }
  }

  return extracted;
}

// AI helper: extract fixed costs from bill text (Azure DI text)
// ------------------------------

// AI helper: extract fixed costs from bill text (Azure DI / OCR text)
// utilityType: "electricity" | "water" | "gas" | "unknown"
async function aiExtractFixedCostsFromText(diText, utilityType = "electricity") {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY in .env");

  const fetchFn =
    (typeof fetch !== "undefined")
      ? fetch
      : (await import("node-fetch")).default;

  const electricityPrompt = `
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

SPECIAL CASE: “Acesso às redes” fiscal adjustment pairs (IMPORTANT)
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
- Low (0.10–0.54) if you found only 1 uncertain fixed item or only generic “taxas/impostos” without breakdown.
NEVER invent items not present in text — if uncertain, omit and lower confidence.

Now analyze the provided OCR text and output the JSON.
BILL TEXT:
<<<
${diText}
>>>
`;

  const waterPrompt = `
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
`;

  const prompt = (utilityType === "water") ? waterPrompt : electricityPrompt;

  const r = await fetchFn("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      messages: [
        { role: "system", content: "Return valid JSON only. Be conservative and accurate." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`DeepSeek API error: ${r.status} ${errText}`);
  }

  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? "";

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI returned no JSON object");
  }

  const jsonStr = content.slice(start, end + 1);
  return JSON.parse(jsonStr);
}


/* ============================================================
   BRAND RECOGNITION & ROUTING SYSTEM
   ============================================================ */

const PROVIDERS = {
  SU_ELETRICIDADE: {
    id: "SU_ELETRICIDADE",
    nifs: ["507846044", "507 846 044"], 
    keywords: ["su eletricidade", "serviço universal"]
  },
  EDP_COMERCIAL: {
    id: "EDP_COMERCIAL",
    nifs: ["503504564", "503 504 564"],
    keywords: ["edp comercial"]
  },
  GALP: {
    id: "GALP",
    nifs: ["503996438", "504499772"],
    keywords: ["galp power", "petrogal"]
  }
};

function detectProvider(text) {
  const clean = text.replace(/[^a-zA-Z0-9]/g, ""); 
  const lower = text.toLowerCase();

  for (const key in PROVIDERS) {
    const p = PROVIDERS[key];
    // 1. Check NIFs (High Accuracy)
    if (p.nifs.some(nif => clean.includes(nif.replace(/\s/g, "")))) return p.id;
    // 2. Check Keywords (Fallback)
    if (p.keywords.some(k => lower.includes(k))) return p.id;
  }
  return "UNKNOWN";
}

/* ============================================================
   MODEL 1: SU ELETRICIDADE (Your Current Working System)
   ============================================================ */
function parse_SU_Eletricidade(text) {
  // --- PASTE OF YOUR EXACT CODE STARTS HERE ---
  const raw = String(text || "");
  const norm = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const t = norm.replace(/\s+/g, " ").trim();
  const lower = t.toLowerCase();

  // --- HELPERS ---

  function parseMoneyEU(val) {
    if (!val) return null;
    let s = String(val).trim().replace(/[€\s]/g, "");
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    
    if (!/^[\d]+(\.[\d]+)?$/.test(s)) return null;
    return Number(Number(s).toFixed(2));
  }

  // --- 1. TOTAL ---
  let totalAmount = null;
  const totalPatterns = [
    /valor\s+a\s+pagar[^0-9]{0,60}(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))/i,
    /total\s+a\s+pagar[^0-9]{0,60}(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))/i,
    /valor\s+da\s+fatura[^0-9]{0,60}(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))/i,
    /valor\s+a\s+debitar[^0-9]{0,60}(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))/i,
    /importancia\s+[^0-9]{0,60}(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))/i
  ];
  for (const re of totalPatterns) {
    const m = t.match(re);
    if (m) {
      const n = parseMoneyEU(m[1]);
      if (n != null) { totalAmount = n; break; }
    }
  }

  // --- 2. DATES ---
  let periodStart = null;
  let periodEnd = null;
  const mDash = t.match(/de\s*(\d{2}-\d{2}-\d{4})\s*a\s*(\d{2}-\d{2}-\d{4})/i);
  if (mDash) {
    periodStart = mDash[1];
    periodEnd = mDash[2];
  } else {
    // Fallback logic for full month names
    const months = { jan:"01", fev:"02", mar:"03", abr:"04", mai:"05", jun:"06", jul:"07", ago:"08", set:"09", out:"10", nov:"11", dez:"12", agosto:"08", setembro:"09", outubro:"10", novembro:"11", dezembro:"12" };
    const reLong = /(\d{1,2})\s+([a-zçãô]+)\s+(\d{4})\s+(?:ate|até|a)\s+(\d{1,2})\s+([a-zçãô]+)\s+(\d{4})/gi;
    let m = reLong.exec(lower);
    if (m) {
      const m1 = months[m[2].slice(0,3)] || months[m[2]];
      const m2 = months[m[5].slice(0,3)] || months[m[5]];
      if (m1 && m2) {
        periodStart = `${String(m[1]).padStart(2,"0")}-${m1}-${m[3]}`;
        periodEnd = `${String(m[4]).padStart(2,"0")}-${m2}-${m[6]}`;
      }
    }
  }

  // --- 3. FIXED ITEMS (Closest Valid Neighbor Strategy) ---
  const fixedItems = [];

  function findClosestValidValue(keyword, opts = {}) {
    const { 
      searchRadius = 200, 
      maxCap = 150, 
      minCap = 0.5, 
      blacklist = [] 
    } = opts;

    const safeKey = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const keyRe = new RegExp(safeKey, 'gi');
    
    let candidates = [];
    let match;

    while ((match = keyRe.exec(t)) !== null) {
      const keywordEndIdx = match.index + match[0].length;
      const startIdx = keywordEndIdx;
      const endIdx = Math.min(t.length, startIdx + searchRadius);
      const windowStr = t.slice(startIdx, endIdx);

      const numberRe = /(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2}))/g;
      let numMatch;
      
      while ((numMatch = numberRe.exec(windowStr)) !== null) {
        const val = parseMoneyEU(numMatch[0]);
        if (val === null) continue;

        if (Math.abs(val - totalAmount) < 0.05) continue; 
        if (val > maxCap) continue; 
        if (val < minCap) continue; 
        if (blacklist.some(b => Math.abs(val - b) < 0.05)) continue; 

        candidates.push({
          amount: val,
          distance: numMatch.index 
        });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].amount;
  }

  // --- A. POTÊNCIA ---
  const kvaRatings = [3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7];
  
  const potenciaVal = findClosestValidValue("potencia contratada", { 
    maxCap: 100, 
    blacklist: kvaRatings 
  });
  
  if (potenciaVal) {
    fixedItems.push({ evidence: "Potência Contratada", amount: potenciaVal });
  }

  // --- B. TAXAS ---
  const taxasVal = findClosestValidValue("taxas e impostos", { 
    maxCap: 60, 
    minCap: 2.0, 
    blacklist: potenciaVal ? [potenciaVal] : [] 
  });
  
  const finalTaxas = taxasVal || findClosestValidValue("total taxas", { maxCap: 60, minCap: 2.0 });
  
  if (finalTaxas) {
    fixedItems.push({ evidence: "Taxas e Impostos", amount: finalTaxas });
  }

  // --- C. CAV ---
  const cavVal = findClosestValidValue("jcav", { maxCap: 30 }) || findClosestValidValue(" cav ", { maxCap: 30 });
  if (cavVal) {
    fixedItems.push({ evidence: "CAV", amount: cavVal });
  }

  // --- D. Water/Gas ---
  const terms = ["tarifa disponibilidade", "saneamento fixo", "termo fixo"];
  terms.forEach(term => {
    const v = findClosestValidValue(term, { maxCap: 50 });
    if (v) fixedItems.push({ evidence: term, amount: v });
  });

  // Calculate Total Fixed
  let fixedTotal = 0;
  if (fixedItems.length) {
    fixedTotal = Number(fixedItems.reduce((a, b) => a + b.amount, 0).toFixed(2));
  }

  return { totalAmount, periodStart, periodEnd, fixedTotal, fixedItems, provider: "SU Eletricidade (User Model)" };
  // --- PASTE OF YOUR EXACT CODE ENDS HERE ---
}




/* ============================================================
   MODEL 2: EDP COMERCIAL (The New "Bulletproof" Logic)
   ============================================================ */
function normalizeEDPPeriodToDDMMYYYY(periodStartRaw, periodEndRaw) {
  if (!periodStartRaw || !periodEndRaw) return { periodStart: periodStartRaw, periodEnd: periodEndRaw };

  const months = {
    janeiro: "01", fevereiro: "02", marco: "03", março: "03",
    abril: "04", maio: "05", junho: "06", julho: "07",
    agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12"
  };

  function parsePtDayMonthYear(s, fallbackYear) {
    const t = String(s).toLowerCase().trim();
    // matches: "6 de agosto" OR "5 de setembro 2024"
    const m = t.match(/(\d{1,2})\s+de\s+([a-zçãô]+)(?:\s+(20\d{2}))?/i);
    if (!m) return null;

    const dd = String(m[1]).padStart(2, "0");
    const mm = months[m[2]];
    const yyyy = m[3] || fallbackYear;

    if (!mm || !yyyy) return null;
    return `${dd}-${mm}-${yyyy}`;
  }

  // end usually has the year → use it as fallback for start
  const endYear = (String(periodEndRaw).match(/(20\d{2})/) || [])[1] || null;

  const periodEnd = parsePtDayMonthYear(periodEndRaw, endYear);
  const periodStart = parsePtDayMonthYear(periodStartRaw, endYear);

  return {
    periodStart: periodStart || periodStartRaw,
    periodEnd: periodEnd || periodEndRaw
  };
}


function parse_EDP_Comercial(text) {
  const raw = String(text || "");
  const lines = raw.split(/\n/);
  
  // 1. TOTAL AMOUNT
  // EDP unique phrase: "Quanto tenho a pagar? ... 25,19 €"
  let totalAmount = 0.0;
  // This regex looks for the phrase, skips some chars, and grabs the price
  const totalMatch = raw.match(/Quanto\s+tenho\s+a\s+pagar[^\d]{0,50}(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (totalMatch) {
    totalAmount = parseMoneyEU(totalMatch[1]);
  } else {
    // Backup: Look for "Montante" if the first one fails
    const backupTotal = raw.match(/Montante:[\s\S]{0,20}?(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    if (backupTotal) totalAmount = parseMoneyEU(backupTotal[1]);
  }

  // 2. DATES
  // EDP unique phrase: "Período de faturação: 6 de agosto a 5 de setembro 2024"
  let periodStart = null;
  let periodEnd = null;
  const dateMatch = raw.match(/Período\s+de\s+faturação:[\s\S]{0,20}?(\d{1,2}.*?)\s+a\s+(\d{1,2}.*?20\d{2})/i);
  if (dateMatch) {
    periodStart = dateMatch[1]; // "6 de agosto"
    periodEnd = dateMatch[2];   // "5 de setembro 2024"
  }
  const normP = normalizeEDPPeriodToDDMMYYYY(periodStart, periodEnd);
periodStart = normP.periodStart;
periodEnd = normP.periodEnd;


  // 3. FIXED COSTS SCANNER

  // --- NEW (EDP): Fixed via IVA 23% bases (robust) ---
  // EDP bills usually show: "IVA (4,66 €) 23% ..." which corresponds to fixed charges base
  let base23 = 0;
  const re23 = /IVA\s*\(\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*€?\s*\)\s*23%/gi;
  let m23;

  while ((m23 = re23.exec(raw)) !== null) {
    const v = parseMoneyEU(m23[1]);
    if (v != null) base23 += v;
  }

  base23 = Number(base23.toFixed(2));

  if (base23 > 0) {
    const fixed23 = Number((base23 * 1.23).toFixed(2)); // add IVA 23%
    return {
      totalAmount,
      periodStart,
      periodEnd,
      fixedTotal: fixed23,
      fixedItems: [{ evidence: "EDP fixed (IVA 23% base + IVA)", amount: fixed23 }],
      provider: "EDP Comercial"
    };
  }


  // Strategy: Sum the NET amounts, then apply VAT.
  let netFixed_23 = 0.0; // Potência & DGEG (usually 23%)
  let netFixed_6 = 0.0;  // CAV (always 6%)
  let fixedItems = [];

  lines.forEach(line => {
    const l = line.toLowerCase();
    
    // Helper to find the price at the end of a line
    // Regex finds the last money value in the string
    const prices = line.match(/(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€?/g);
    if (!prices) return;
    
    // Get the last number found (Net value)
    let valStr = prices[prices.length - 1].replace("€","").trim();
    let val = parseMoneyEU(valStr);
    
    // Check if negative (discounts often appear as "-2,71")
    if (valStr.includes("-")) val = -Math.abs(val);

    // --- RULE A: TIME-BASED CHARGES (Potência / Discounts) ---
    // Must have "dias" or "mês", MUST NOT have "kwh"
    if ((l.includes("dias") || l.includes("mes") || l.includes("mês")) && !l.includes("kwh")) {
      
      // EXCEPTION: DGEG (Handle separately below)
      if (l.includes("dgeg")) return;
      // EXCEPTION: CAV (Handle separately below)
      if (l.includes("audiovisual") || l.includes("cav")) return;

      // Add to 23% bucket (Standard for Potência)
      netFixed_23 += val;
      fixedItems.push({ evidence: "Potência/Fixed (Net)", amount: val });
    }

    // --- RULE B: DGEG ---
    if (l.includes("dgeg")) {
      netFixed_23 += val;
      fixedItems.push({ evidence: "DGEG (Net)", amount: val });
    }

    // --- RULE C: CAV (Audiovisual) ---
    if (l.includes("audiovisual") || l.includes("cav")) {
      // Sometimes OCR reads the final line with VAT included, sometimes net.
      // Usually the line says: "CAV ... 1,00 €" (Net).
      netFixed_6 += val;
      fixedItems.push({ evidence: "CAV (Net)", amount: val });
    }
  });

  // 4. CALCULATE FINAL FIXED (WITH VAT)
  // We apply the tax rates to the sums.
  // Note: We use Math.abs to handle small rounding errors, but fixed costs are generally positive.
  const vat23 = netFixed_23 * 0.23;
  const vat6 = netFixed_6 * 0.06;
  
  const fixedTotal = (netFixed_23 + vat23) + (netFixed_6 + vat6);

  return { 
    totalAmount, 
    periodStart, 
    periodEnd, 
    fixedTotal: Number(fixedTotal.toFixed(2)), 
    fixedItems,
    provider: "EDP Comercial"
  };
}

/* ============================================================
   MAIN ROUTER: DECIDES WHICH FUNCTION TO USE
   ============================================================ */
function extractBillFieldsFromText(text) {
  const raw = String(text || "");

  // Basic fields (provider-agnostic)
  let totalAmount = 0.0;

  const totalPatterns = [
    /VALOR\s+DA\s+FATURA\s*[\s:]*([0-9]{1,3}(?:[\.\s][0-9]{3})*,[0-9]{2})/i,
    /Valor\s+a\s+debitar[\s\S]{0,40}?([0-9]{1,3}(?:[\.\s][0-9]{3})*,[0-9]{2})/i,
    /Quanto\s+tenho\s+a\s+pagar[\s\S]{0,60}?([0-9]{1,3}(?:[\.\s][0-9]{3})*,[0-9]{2})/i,
    /Total\s+a\s+pagar[\s\S]{0,60}?([0-9]{1,3}(?:[\.\s][0-9]{3})*,[0-9]{2})/i,
  ];

  for (const rx of totalPatterns) {
    const mm = raw.match(rx);
    if (mm) { totalAmount = parseMoneyEU(mm[1]); break; }
  }

  if (!totalAmount) {
    const all = Array.from(raw.matchAll(/([0-9]{1,3}(?:[\.\s][0-9]{3})*,[0-9]{2})\s*[€]/g));
    if (all.length) totalAmount = parseMoneyEU(all[all.length - 1][1]);
  }

  const { periodStart, periodEnd } = extractBillingPeriod(raw);

  // Initialize (AI will fill fixed fields)
  return {
    totalAmount: totalAmount || 0,
    periodStart: periodStart || null,
    periodEnd: periodEnd || null,
    fixedTotal: 0,
    fixedItems: [],
    utilityType: "unknown",
    utilityConfidence: 0
  };
}

async function getPdfNumPages(pdfBuffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const fontsDir = path.join(pdfjsPkgDir, "standard_fonts");
  const standardFontDataUrl = pathToFileURL(fontsDir + path.sep).href;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  return pdf.numPages;
}



async function extractTextWithPdfjs(pdfBuffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const fontsDir = path.join(pdfjsPkgDir, "standard_fonts");
  const standardFontDataUrl = pathToFileURL(fontsDir + path.sep).href;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  let out = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = (content.items || []).map(it => it.str).join(" ").replace(/\s+/g, " ").trim();
    out += `\n\n----- PAGE ${p} -----\n` + pageText;
  }

  return out.trim();
}

async function renderPdfPageToPngBuffer(pdfBuffer, pageNumber = 1, scale = 2.2) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const pdfjsPkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const fontsDir = path.join(pdfjsPkgDir, "standard_fonts");
  const standardFontDataUrl = pathToFileURL(fontsDir + path.sep).href;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const safePage = Math.max(1, Math.min(pageNumber, pdf.numPages));
  const page = await pdf.getPage(safePage);

  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );
  const ctx = canvas.getContext("2d");

  await page.render({ canvasContext: ctx, viewport }).promise;

  return canvas.toBuffer("image/png");
}

// Keep old name so the rest of your code still works for now
async function renderPdfFirstPageToPngBuffer(pdfBuffer) {
  return renderPdfPageToPngBuffer(pdfBuffer, 1);
}



async function ocrImageBufferToText(imgBuffer) {
  const prepped = await sharp(imgBuffer)
    .rotate()
    .grayscale()
    .normalize()
    .toBuffer();

  const { data } = await Tesseract.recognize(prepped, "por+eng", {
    logger: () => {},
  });

  return (data && data.text) ? data.text : "";
}


app.get("/health", (_req, res) => res.json({ ok: true }));

app.post(
  "/api/analyze-bill",
  upload.fields([
    { name: "file", maxCount: 1 },   // single PDF
    { name: "files", maxCount: 20 }  // multiple screenshots
  ]),
  async (req, res) => {
    try {
      const allFiles = [
        ...(req.files?.file || []),
        ...(req.files?.files || []),
      ];

      if (!allFiles.length) {
        return res.status(400).json({ ok: false, error: "No file(s) uploaded" });
      }

      const isPdf = (f) =>
        f.mimetype === "application/pdf" ||
        (f.originalname || "").toLowerCase().endsWith(".pdf");

      const isImage = (f) =>
        (f.mimetype || "").startsWith("image/") ||
        /\.(png|jpg|jpeg|webp)$/i.test(f.originalname || "");

      // Prefer PDF if present
      const pdfFile = allFiles.find(isPdf);

      // -------------------------
      // CASE A: PDF (single)
      // -------------------------
      if (pdfFile) {
        console.log("ANALYZE UPLOAD (PDF):", pdfFile.originalname, pdfFile.mimetype, pdfFile.size);

        let text = "";
        let ocrSource = "none";

        // 1) Try PDF.js
        console.log("Extracting text with PDF.js…");
        try {
          text = await extractTextWithPdfjs(pdfFile.buffer);
          if (isUsableText(text)) ocrSource = "pdfjs";
        } catch (e) {
          console.log("PDF.js extraction failed:", e?.message || e);
        }

        // 2) Azure DI fallback
        if (!isUsableText(text) && diClient) {
          const numPages = await getPdfNumPages(pdfFile.buffer);
          const pagesRaw = (req.query && req.query.pages) ? String(req.query.pages) : "1-4";
          const pages = clampPages(pagesRaw, numPages) || `1-${numPages}`;

          console.log("Azure DI…", { pages });

          const di = await analyzeWithAzureDI({
            buffer: pdfFile.buffer,
            contentType: "application/pdf",
            pages,
          });

          const diText = di?.content ? String(di.content) : "";
          if (isUsableText(diText)) {
            text = diText;
            ocrSource = "azure";
          }
        }

        // 3) Tesseract fallback
        if (!isUsableText(text)) {
          console.log("Tesseract fallback…");
          const img1 = await renderPdfPageToPngBuffer(pdfFile.buffer, 1);
          const img2 = await renderPdfPageToPngBuffer(pdfFile.buffer, 2);
          const t1 = await ocrImageBufferToText(img1);
          const t2 = await ocrImageBufferToText(img2);
          text = `${t1}\n\n${t2}`.trim();
          if (isUsableText(text)) ocrSource = "tesseract";
        }

        if (!isUsableText(text)) {
          return res.status(422).json({
            ok: false,
            error: "OCR failed: no usable text extracted.",
            debug: { ocrSource, textLength: (text || "").length }
          });
        }

        let extracted = extractBillFieldsFromText(text);
        extracted = await applyAiFixedCosts(extracted, text);

        return res.json({
          ok: true,
          extracted,
          evidence: { ocrSource }
        });
      }

      // -------------------------
      // CASE B: Multiple images
      // -------------------------
      const images = allFiles.filter(isImage);

      if (!images.length) {
        return res.status(415).json({
          ok: false,
          error: "Upload a PDF or image(s) (JPG/PNG/WEBP)."
        });
      }

      if (images.length > 12) {
        return res.status(413).json({
          ok: false,
          error: "Too many images. Please upload max 12 screenshots."
        });
      }

      console.log(`ANALYZE UPLOAD (IMAGES): ${images.length} file(s)`);

      let text = "";
      let ocrSource = "multi";

      // Prefer Azure DI if configured, otherwise Tesseract
      if (diClient) {
        ocrSource = "azure-multi";
        let merged = "";

        for (let i = 0; i < images.length; i++) {
          const img = images[i];

          // compress to jpeg (smaller + faster)
          const jpeg = await sharp(img.buffer)
            .resize({ width: 1800, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          const di = await analyzeWithAzureDI({
            buffer: jpeg,
            contentType: "image/jpeg",
          });

          const diText = di?.content ? String(di.content) : "";
          merged += `\n\n----- IMAGE ${i + 1} -----\n\n${diText}`;
        }

        text = merged.trim();
      } else {
        ocrSource = "tesseract-multi";
        let merged = "";

        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          const t = await ocrImageBufferToText(img.buffer);
          merged += `\n\n----- IMAGE ${i + 1} -----\n\n${t}`;
        }

        text = merged.trim();
      }

      if (!isUsableText(text)) {
        return res.status(422).json({
          ok: false,
          error: "OCR failed: no usable text extracted from images.",
          debug: { ocrSource, textLength: (text || "").length }
        });
      }

      let extracted = extractBillFieldsFromText(text);
      extracted = await applyAiFixedCosts(extracted, text);

      return res.json({
        ok: true,
        extracted,
        evidence: { ocrSource, images: images.length }
      });
    } catch (err) {
      console.error("ANALYZE SERVER ERROR:", err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);


app.post("/api/scan-bill", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    console.log("UPLOAD:", req.file.originalname, req.file.mimetype, req.file.size);

    const isPdf =
      req.file.mimetype === "application/pdf" ||
      (req.file.originalname || "").toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return res.status(415).json({ error: "Upload a PDF for now.", needsOCR: true });
    }

    console.log("Extracting text with PDF.js…");

    let text = "";
    try {
      text = await extractTextWithPdfjs(req.file.buffer);
    } catch (e) {
    // PRINT THE REAL ERROR CODE
    console.log("⚠️ AZURE ERROR DETAILS:", JSON.stringify(e, null, 2));

    const msg = e?.message || String(e);
    console.log("DI primary attempt failed:", msg);
      // treat as scanned / OCR-needed instead of crashing
      return res.status(422).json({
        error: "Could not extract text from PDF. Likely scanned → OCR needed.",
        needsOCR: true
      });
    }

    if (typeof text !== "string") text = "";
    console.log("Text length:", text.length);

    if (!isUsableText(text)) {
      return res.status(422).json({
        error: "This PDF looks scanned or has too little readable text. Next step is OCR (Azure / Tesseract).",
        needsOCR: true
      });
    }

    let extracted = extractBillFieldsFromText(text);
    extracted = await applyAiFixedCosts(extracted, text);
    return res.json({ ok: true, extracted, ocrSource: "pdfjs" });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
});


app.post("/api/ocr-bill", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    console.log(
      "OCR UPLOAD:",
      req.file.originalname,
      req.file.mimetype,
      req.file.size
    );

    const isPdf =
      req.file.mimetype === "application/pdf" ||
      (req.file.originalname || "").toLowerCase().endsWith(".pdf");

    const isImage =
      (req.file.mimetype || "").startsWith("image/") ||
      /\.(png|jpg|jpeg|webp)$/i.test(req.file.originalname || "");

    if (!isPdf && !isImage) {
      return res.status(415).json({
        error: "Upload a PDF or an image (JPG/PNG).",
        needsOCR: true,
      });
    }

    let imgBuffer;

    let text = "";

if (isPdf) {
  // OCR page 1 + 2 (many bills split info across pages)
  const img1 = await renderPdfPageToPngBuffer(req.file.buffer, 1);
  const txt1 = await ocrImageBufferToText(img1);

  const img2 = await renderPdfPageToPngBuffer(req.file.buffer, 2);
  const txt2 = await ocrImageBufferToText(img2);

  text = `${txt1}\n\n----- PAGE 2 -----\n\n${txt2}`;
} else {
  // Image uploaded directly
  text = await ocrImageBufferToText(req.file.buffer);
}


   
    if (process.env.LOG_FULL_TEXT === "1") {
  console.log("===== FULL OCR TEXT START =====");
  console.log(text);
  console.log("===== FULL OCR TEXT END =====");
} else {
  console.log("OCR text length:", String(text || "").length);
}





    if (!text || text.trim().length < 30) {
      return res.status(422).json({
        error: "OCR produced too little text. Try a clearer photo / scan.",
        needsOCR: true,
      });
    }

    // Reuse your existing parser
    let extracted = extractBillFieldsFromText(text);
    extracted = await applyAiFixedCosts(extracted, text);

    return res.json({ ok: true, ocr: true, extracted, ocrSource: "tesseract" });
  } catch (err) {
    console.error("OCR SERVER ERROR:", err);
    return res.status(500).json({
      error: "OCR server error",
      details: String(err?.message || err),
    });
  }
});

app.post("/api/di-bill", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const pagesRaw = (req.query && req.query.pages) ? String(req.query.pages) : ((req.body && req.body.pages) ? String(req.body.pages) : "1-4");
    let pages = pagesRaw;



    const isPdf =
      req.file.mimetype === "application/pdf" ||
      (req.file.originalname || "").toLowerCase().endsWith(".pdf");

    const isImage =
      (req.file.mimetype || "").startsWith("image/") ||
      /\.(png|jpg|jpeg|webp)$/i.test(req.file.originalname || "");

    if (!isPdf && !isImage) {
      return res.status(415).json({ error: "Upload a PDF or image." });
    }

    const contentType = isPdf ? "application/pdf" : (req.file.mimetype || "image/jpeg");

    if (isPdf) {
      const numPages = await getPdfNumPages(req.file.buffer);
      pages = clampPages(pages, numPages) || `1-${numPages}`;
    } else {
      pages = undefined;
    }


    console.log("DI UPLOAD:", req.file.originalname, contentType, req.file.size, "pages:", pages);

    const di = await analyzeWithAzureDI({
      buffer: req.file.buffer,
      contentType,
      pages,
    });

    // DI gives us strong extracted text:
    const diText = di?.content || "";

    if (process.env.LOG_FULL_TEXT === "1") {
  console.log("===== FULL AZURE DI TEXT START =====");
  console.log(diText);
  console.log("===== FULL AZURE DI TEXT END =====");
} else {
  console.log("Azure DI text length:", String(diText || "").length);
}




    // Reuse your existing parser (don’t rewrite everything):
    const extracted = extractBillFieldsFromText(diText);

    

    // ===== APPLY AI FIXED COSTS (NET + VAT -> GROSS) =====
extracted = await applyAiFixedCosts(extracted, diText);
// ===== END APPLY AI FIXED COSTS =====


    return res.json({
      ok: true,
      docai: "azure",
      extracted,
      evidence: {
        pages,
        used: "prebuilt-invoice",
      },
    });
  } catch (e) {
    console.log("DI error:", e?.message || e);
    return res.status(500).json({ error: e?.message || "Azure DI failed" });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("OCR backend running on", PORT));
