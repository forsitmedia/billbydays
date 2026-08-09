# BillByDays — project brief for AI coding agents

## What this is

A web app that splits shared household utility bills between roommates based on how many days
each person was actually at home. If you were away for two weeks, you don't pay for those days
of electricity. Live at https://billbydays.com

Target users: university students and young people in shared flats, starting in Portugal.

## Stack (as it actually is — do not "modernise" it)

- **Frontend:** three plain HTML pages with inline CSS and plain JavaScript. No build step, no
  bundler, no framework, no npm on the frontend. Deployed by **GitHub Pages** (see `CNAME`).
- **Backend:** a single Express server in `backend/server.js`, deployed on **Render** at
  `https://billbydays-backend.onrender.com`. Handles bill scanning only.
- **State:** passed between the three pages entirely through `localStorage`. There is no
  database and no user accounts.
- **PWA:** `sw.js` + `site.webmanifest`, installable to iOS home screen.

## DEPLOYMENT WARNING

The `main` branch auto-deploys to the live site. Never commit directly to `main`. All work
happens on a branch and is merged only after being tested.

## Files

| File | Responsibility |
|---|---|
| `index.html` / `index.js` | Step 1 — bill amount, fixed part, period, expenses, roommates. Bill upload/scan lives here. |
| `step2.html` / `step2.js` | Step 2 — calendar where days away are marked, one roommate at a time. |
| `step3.html` / `step3.js` | Step 3 — the calculation and results breakdown. |
| `backend/server.js` | Bill scanning API. One endpoint, one Gemini vision call — see "Bill extraction" below. |
| `sw.js` | Service worker — offline caching. |
| `classic/` | Prototype 0, kept for reference. Do not modify. |

## localStorage keys (the contract between the three pages)

| Key | Written by | Read by | Shape |
|---|---|---|---|
| `splitroomRoommates` | index.js | step2.js, step3.js | array of name strings |
| `splitroomRoommateIds` | index.js | step2.js | array of stable roommate ids, same order/length as `splitroomRoommates` |
| `splitroomRoommatesVersion` | index.js | step2.js | version string (currently `"2"`); step2.js clears roommate data and bounces to Step 1 if this doesn't match |
| `splitroomAbsences` | step2.js | step3.js | array of arrays of "YYYY-MM-DD", indexed by roommate position |
| `splitroomBill` | index.js | step2.js, step3.js | number |
| `splitroomExpenses` | index.js | step3.js | array of {id, name, icon, total, fixed, from, to} |
| `splitroomStart` / `splitroomEnd` | index.js | step2.js, step3.js | full ISO timestamp string |
| `splitroomTheme` | all | all | "light" or "dark" |
| `splitroomMode` | — | — | legacy, being removed |

IMPORTANT: `splitroomAbsences` is written by step2 and read by step3. Any change to how day keys
are generated MUST be made in both files in the same commit, or every result silently breaks.

## The splitting algorithm — DO NOT CHANGE THIS

Implemented in `step3.js`. It is correct and deliberate. Do not "simplify" or "optimise" it.

For each expense:
1. Split its own billing period (`from`/`to`), clamped inside the overall period.
2. For **each day** in that period, count who was home that day. That day's variable cost is
   shared **only among the people present that day**. If nobody was home, it is shared equally
   among everyone.
3. The **fixed part** (standing charges, power term, taxes) is split **equally per person**,
   never by days — the household owes it regardless of who was there.
4. Per-roommate shares are then summed across all expenses.

This per-day allocation is the core differentiator of the product. Preserve it exactly.

## Bill extraction (backend)

One endpoint, one model call. `POST /api/extract-bill` sends the uploaded PDF or photo
**directly** to a Gemini vision model. No OCR, no PDF text layer, no per-supplier parsers — the
page layout is the signal. `POST /api/scan-bill` is a thin alias to the same handler, kept only
so older cached clients still reach something live. Several photos of one bill go into a single
call as multiple pages.

- The model name lives in **one** constant, `GEMINI_MODEL`, at the top of `backend/server.js`.
  Check Google's deprecation list before changing it — `gemini-2.0-flash` and
  `gemini-2.0-flash-lite` were shut down on 2026-06-01. If accuracy falls short,
  `gemini-3.6-flash` is the drop-in upgrade.
- `BILL_PROMPT` carries the Portuguese domain knowledge: fixed vs variable terms, VAT rates per
  component, the DL 60/2019 cancelling pair, the "período ideal de comunicação de leituras"
  decoy, the kVA-rating trap, European number format. It is the specification, extracted in
  `BILL-KNOWLEDGE.md`. Do not trim it to "clean it up" — every rule in it came from a real bill
  that broke an earlier parser.
- **Never trust the model's arithmetic.** `buildResult()` re-validates everything in JavaScript:
  total in (0, 5000), fixedPart in [0, total], both dates parse, periodEnd after periodStart,
  period 15–100 days. Any failure nulls that field and appends to `issues`.
- **Low-confidence policy — a product decision, do not soften it.** Below 0.75 confidence a
  field comes back as `null` with an issue explaining what went wrong, never as a guess. The
  person uploading is often not the bill's owner and cannot sanity-check a pre-filled number, so
  a wrong number they never questioned is worse than a blank field. The frontend shows which
  field failed and why, and offers *retake the photo* and *type it manually* as two equal
  options. Manual entry is a first-class path — never block the user from just typing three
  numbers.
- `redactForAI` is kept in the file but never called: we now send the image itself, so there is
  no intermediate text to scrub.
- Requires `GEMINI_API_KEY`. Runs against the Gemini Developer API, which gives no EU
  data-residency guarantee; moving to Vertex AI on `europe-west1` is the fix if that is ever
  required.

## Conventions

- Plain HTML/CSS/JS on the frontend. Do NOT introduce React, Vue, TypeScript, or a bundler.
- Money is in euros. Round only at the final display step, never mid-calculation.
- Never edit anything inside `node_modules`.
- Never commit `.env` or any API key.
- Portuguese and English user-facing text should both read naturally; the first market is Portugal.

## Privacy rules (non-negotiable)

Users often upload a bill belonging to their LANDLORD, containing a third party's name,
address, NIF and sometimes IBAN.

- Uploads are held in memory only (`multer.memoryStorage()`). Never write an upload to disk.
  The buffer is nulled in a `finally` block on every path. 10 MB limit; PDF, JPEG, PNG, HEIC only.
- The API response must contain only: total, fixedPart, periodStart, periodEnd, supplier,
  billType, currency, kwh, confidence, issues. Never name, address, NIF, IBAN, account or meter
  ID — not even as a debug field. `buildResult()` constructs the response key by key from that
  fixed list and never spreads the model's object, so an extra key the model invents has no path
  to the client. `cd backend && npm test` asserts this; keep it passing.
- Never log file contents, extracted text, raw model responses, or filenames. Log only:
  timestamp, endpoint, status, duration in ms, file size in bytes.
- AI calls must use a paid provider that does not train on submitted data. Gemini's paid tier
  does not train on submitted data; note the EU-region caveat under "Bill extraction" above.

## Known issues (in priority order)

1. The same CSS is duplicated inline in all three HTML files.
2. Dark mode flashes white on load: the theme is read in `index.js` (line ~316) but the script
   tag sits at the end of `<body>`, so the class lands after first paint.
3. Calendar days are divs with onclick — no keyboard or screen-reader support.

Fixed, kept here so nobody "re-discovers" them:

- Day counting and day keys — `dateUtils.js` now shares `toISO` (local, not UTC) and
  `countDaysInclusive` between step2 and step3, so the old `Math.ceil`/`Math.floor` mismatch
  and the UTC off-by-one are gone.
- Absences keyed by roommate name — step2 now tracks by stable roommate id and serialises to an
  array in `roommates` order, so duplicate names stay independent.
- Four overlapping upload endpoints with a fallback chain in `index.js` — replaced by the single
  `/api/extract-bill`, which is why scanning no longer takes about a minute.
- Per-supplier text parsers, the five copies of the `APPLY AI FIXED COSTS` block, and the
  `LOG_FULL_TEXT` flag — all deleted with the old pipeline.
- `fixedPerRoommate` unused — it is used in the step3 breakdown text.

## How to work here

- One task per session. Show the full diff before writing anything.
- After each change, state what the user should manually test to confirm it worked.
- If a change affects both `step2.js` and `step3.js`, say so explicitly before starting.
