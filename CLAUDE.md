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
| `backend/server.js` | Bill scanning API. ~2000 lines, currently four overlapping endpoints. |
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
- The API response must contain only: total, fixedPart, periodStart, periodEnd, supplier,
  billType, currency, confidence. Never name, address, NIF, IBAN, account or meter ID.
- Never log file contents, extracted text, or raw model responses. Log only status and duration.
- AI calls must use a paid, EU-region provider that does not train on submitted data.

## Known issues (in priority order)

1. `step2.js` counts period days with `Math.ceil`, `step3.js` with `Math.floor`. Across the
   March daylight-saving change they disagree by one day.
2. Day keys use `.toISOString()`, which is UTC, so keys are labelled one day earlier than the
   day the user clicked. Currently harmless because both files are wrong identically — but it
   will break the moment data is shared across timezones.
3. `step2.js` keys absences by roommate NAME; two roommates with the same name silently share
   one set of days. `step3.js` correctly uses index.
4. `backend/server.js` has four overlapping upload endpoints and `index.js` calls them in a
   fallback chain, so one upload can trigger four OCR runs. This is why scanning takes ~1 minute.
5. Hardcoded per-supplier text parsers (`parse_SU_Eletricidade`, `parse_EDP_Comercial`) break
   whenever a supplier changes their PDF layout.
6. A block commented `APPLY AI FIXED COSTS` is copy-pasted five times in server.js.
7. The same ~600 lines of CSS are duplicated inline in all three HTML files.
8. Dark mode flashes white on load because the theme class is applied by JS after first paint.
9. `fixedPerRoommate` is computed in step3.js but never used.
10. Calendar days are divs with onclick — no keyboard or screen-reader support.

## How to work here

- One task per session. Show the full diff before writing anything.
- After each change, state what the user should manually test to confirm it worked.
- If a change affects both `step2.js` and `step3.js`, say so explicitly before starting.
