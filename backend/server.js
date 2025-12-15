import express from "express";
import cors from "cors";
import multer from "multer";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse"); // ✅ CommonJS safe import (Node v22 compatible)

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

function parseMoneyPT(str) {
  // "33,58" -> 33.58  |  "1.234,56" -> 1234.56
  const cleaned = str.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractBillFieldsFromText(text) {
  const t = text.replace(/\u00A0/g, " "); // non-breaking spaces
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1) TOTAL AMOUNT
  const moneyRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*€?/;
  let totalAmount = null;
  let totalEvidence = null;

  for (const line of lines) {
    const up = line.toUpperCase();
    if (up.includes("TOTAL A PAGAR") || up.includes("A PAGAR") || up === "TOTAL") {
      const m = line.match(moneyRegex);
      if (m) {
        totalAmount = parseMoneyPT(m[1]);
        totalEvidence = line;
        break;
      }
    }
  }

  // fallback: last money value in document
  if (totalAmount == null) {
    const all = [...t.matchAll(new RegExp(moneyRegex, "g"))]
      .map((m) => parseMoneyPT(m[1]))
      .filter((n) => n != null);
    if (all.length) totalAmount = all[all.length - 1];
  }

  // 2) BILL PERIOD
  const periodRegex = /de\s*(\d{2}-\d{2}-\d{4})\s*a\s*(\d{2}-\d{2}-\d{4})/i;
  let periodStart = null, periodEnd = null, periodEvidence = null;

  for (const line of lines) {
    const up = line.toUpperCase();
    if (up.includes("PERÍODO") || up.includes("PERIODO")) {
      const m = line.match(periodRegex);
      if (m) {
        periodStart = m[1];
        periodEnd = m[2];
        periodEvidence = line;
        break;
      }
    }
  }

  // 3) FIXED PART (heuristic v1)
  const fixedKeywords = ["FIXO", "DISPONIBILIDADE", "ASSINATURA", "MENSALIDADE", "POTÊNCIA", "POTENCIA", "ALUGUER"];
  const fixedItems = [];

  for (const line of lines) {
    const up = line.toUpperCase();
    const hasKeyword = fixedKeywords.some((k) => up.includes(k));
    const looksDaily = up.includes("DIAS");

    if ((hasKeyword || looksDaily) && moneyRegex.test(line)) {
      const m = line.match(moneyRegex);
      const amount = m ? parseMoneyPT(m[1]) : null;
      if (amount != null && amount > 0) {
        fixedItems.push({
          label: line.slice(0, 60),
          amount,
          evidence: line
        });
      }
    }
  }

  // Provider-specific boost for Águas de Cascais style bills (still safe as a heuristic)
  const preferred = ["TARIFA DISPONIBILIDADE", "SANEAMENTO FIXO", "RSU FIXO"];
  const boosted = fixedItems.filter((it) =>
    preferred.some((p) => it.evidence.toUpperCase().includes(p))
  );
  const finalFixedItems = boosted.length ? boosted : fixedItems;

  const fixedTotal = finalFixedItems.reduce((sum, it) => sum + it.amount, 0);

  return {
    totalAmount,
    periodStart,
    periodEnd,
    fixedTotal: Number(fixedTotal.toFixed(2)),
    fixedItems: finalFixedItems.slice(0, 10),
    evidence: {
      total: totalEvidence,
      period: periodEvidence
    }
  };
}

app.post("/api/scan-bill", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const pdfData = await pdfParse(req.file.buffer);
    const text = (pdfData.text || "").trim();

    // If text is empty, likely scanned → needs OCR (next step)
    if (text.length < 50) {
      return res.status(422).json({
        error: "This PDF looks scanned (no readable text). Next step is OCR.",
        needsOCR: true
      });
    }

    const extracted = extractBillFieldsFromText(text);
    return res.json({ ok: true, extracted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("OCR backend running on", PORT));
