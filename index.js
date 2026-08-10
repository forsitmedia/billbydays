/* ============================================================
   INDEX.JS — FREE + PRO MODES
============================================================ */

let isDark = false;
// App is fully free now: keep all PRO functionality enabled
const isPro = true;


// DOM
const modeSwitch = document.getElementById("modeSwitch");
const themeToggle = document.getElementById("themeToggle");
const totalSub = document.getElementById("totalSub");
const billTotalDisplay = document.getElementById("billTotalDisplay");
const resetBill = document.getElementById("resetBill");

// PDF DOM
const billUpload = document.getElementById("billUpload");
const scanStatus = document.getElementById("scanStatus");

// Full-page loading overlay DOM
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingTitle   = document.getElementById("loadingTitle");

const loadingStep    = document.getElementById("loadingStep");
const loadingProgress= document.getElementById("loadingProgress");
const loadingEta     = document.getElementById("loadingEta");
const loadingHint    = document.getElementById("loadingHint");

const loadingFacts = document.getElementById("loadingFacts");

let loadingFactsNextTimer = null;
let loadingFactsSwapTimer = null;


const uploadFilename = document.getElementById("uploadFilename");
const uploadSub = document.getElementById("uploadSub");

// STOP HERE GOOD //
let loadingTimer = null;
let loadingTick = null;

function setLoadingTheme(theme = "purple") {
  // default (purple / pro)
  let bg = "#ffffff";
  let fg = "#111827";
  let accent = "#b04cff";

  if (theme === "electricity") { accent = "#ffff00"; } // yellow
  if (theme === "water")       { accent = "#4aa3ff"; } // blue
  if (theme === "gas")         { accent = "#9ca3af"; } // grey

  document.documentElement.style.setProperty("--load-bg", bg);
  document.documentElement.style.setProperty("--load-fg", fg);
  document.documentElement.style.setProperty("--load-accent", accent);
  document.documentElement.style.setProperty("--load-muted", fg === "#ffffff" ? "rgba(255,255,255,0.65)" : "rgba(17,24,39,0.55)");
}

const BILL_FACTS = [
  "🔥 The Ghost Room: Heating rooms you aren't using accounts for up to 30% of your wasted winter budget.",
  "🌡️ Hidden Savings: Dropping your thermostat by just 1°C is barely noticeable but slashes your bill by 10%.",
  "🚿 Water Gold: Hot water eats up 20% of your home's energy—cutting showers to 8 mins saves 40% of that cost.",
  "🧺 The Efficiency Gap: Half-empty laundry loads waste 35% more energy. Wait for a full load to save big.",
  "🔌 Vampire Power: \"Off\" devices on standby are still alive, sucking up to 20% of your electricity bill.",
  "🍳 Oven Overkill: Your microwave and air fryer are 70% more efficient than a standard oven.",
  "💡 Immortal Light: LED bulbs last 10x longer than old ones while using 85% less juice.",
  "🪟 Thermal Leaks: Up to 25% of your heat is literally escaping through tiny gaps in windows and doors.",
  "🌬️ The AC Killer: Fans use 90% less energy than AC. In most weather, they do the same job for a fraction of the cost.",
  "📏 Ending the War: Simple house rules and coordination can stop 40% of utility waste from \"heating wars.\""
];

function pickRandomFacts() {
  const arr = [...BILL_FACTS];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
    const count = Math.min(6, arr.length); // show 6 facts (or less if not enough)
  return arr.slice(0, count);

}

function renderLoadingFact(text) {
  if (!loadingFacts) return;
  loadingFacts.innerHTML = "";

  const el = document.createElement("div");
  el.className = "loading-fact is-hidden";
  el.textContent = text;

  loadingFacts.appendChild(el);

  // fade in
  requestAnimationFrame(() => el.classList.remove("is-hidden"));
}



function showFullLoading({ theme = "purple", expectedMs = 60000 } = {}) {
  if (!loadingOverlay) return;

  if (document.body.classList.contains("pro-mode")) setLoadingTheme("pro");
  else setLoadingTheme(theme);

  if (loadingTitle) loadingTitle.textContent = "Analyzing your bill";
  if (loadingProgress) loadingProgress.style.width = "0%";

  const expectedSec = Math.max(1, Math.round(expectedMs / 1000));
  if (loadingEta) loadingEta.textContent = `This might take ~${expectedSec} seconds`;

  const stages = [
    { t: 0,     text: "Detecting text from your bill…", hint: "Tip: Uploading the full PDF improves accuracy." },
    { t: 10000,  text: "Keeping your privacy safe (removing confidential data)…", hint: "We remove personal details before sending text to AI." },
    { t: 25000, text: "AI analyzing the bill structure (fixed vs variable)…", hint: "Fixed costs = things you pay even with 0 consumption." },
    { t: 45000, text: "Finalizing results…", hint: "Almost there — thanks for your patience." },
  ];

  loadingOverlay.classList.add("show");
  document.body.classList.add("is-loading");

  // ---- FACTS: show 2–3 total, ONE at a time, spaced across expectedMs ----
  if (loadingFacts) {
    if (loadingFactsNextTimer) { clearTimeout(loadingFactsNextTimer); loadingFactsNextTimer = null; }
    if (loadingFactsSwapTimer) { clearTimeout(loadingFactsSwapTimer); loadingFactsSwapTimer = null; }

    const chosen = pickRandomFacts();
    const stepMs = Math.floor(expectedMs / chosen.length);
    let idx = 0;

    renderLoadingFact(chosen[idx]);

    const scheduleNext = () => {
      idx += 1;
      if (idx >= chosen.length) return;
      const current = loadingFacts.querySelector(".loading-fact");
      if (current) current.classList.add("is-hidden");
      loadingFactsSwapTimer = setTimeout(() => {
        renderLoadingFact(chosen[idx]);
        loadingFactsNextTimer = setTimeout(scheduleNext, stepMs);
      }, 480);
    };

    loadingFactsNextTimer = setTimeout(scheduleNext, stepMs);
  }

  const started = Date.now();

  if (loadingTick) clearInterval(loadingTick);
  loadingTick = setInterval(() => {
    const elapsed = Date.now() - started;
    const pct = Math.max(0, Math.min(100, (elapsed / expectedMs) * 100));
    if (loadingProgress) loadingProgress.style.width = pct.toFixed(1) + "%";

    const left = Math.max(0, Math.ceil((expectedMs - elapsed) / 1000));
    if (loadingEta) {
      const expectedSec = Math.max(1, Math.round(expectedMs / 1000));
      loadingEta.textContent =
        left > 0 ? `This might take ~${expectedSec} seconds · ${left}s left` : "Just finishing…";
    }

    let current = stages[0];
    for (const s of stages) if (elapsed >= s.t) current = s;
    if (loadingStep) loadingStep.textContent = current.text;
    if (loadingHint) loadingHint.textContent = current.hint;
  }, 250);

  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => {
    hideFullLoading();
  }, expectedMs + 5000);
}

function hideFullLoading() {
  if (!loadingOverlay) return;
  loadingOverlay.classList.remove("show");
  document.body.classList.remove("is-loading");

  if (loadingTick) { clearInterval(loadingTick); loadingTick = null; }
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }

  if (loadingFactsNextTimer) { clearTimeout(loadingFactsNextTimer); loadingFactsNextTimer = null; }
  if (loadingFactsSwapTimer) { clearTimeout(loadingFactsSwapTimer); loadingFactsSwapTimer = null; }
  if (loadingFacts) loadingFacts.innerHTML = "";

  if (loadingProgress) loadingProgress.style.width = "0%";
}





// Served from localhost → talk to the local backend, so testing never sends a
// real bill to production. Anywhere else → Render.
const API_BASE =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://billbydays-backend.onrender.com";

// One endpoint, one model call. There is deliberately no fallback chain:
// the old code tried four endpoints in sequence, which is why a scan used to
// take about a minute.
const EXTRACT_ENDPOINT = `${API_BASE}/api/extract-bill`;


// ===============================
// UI Helpers: spinner badge + continue blocking
// ===============================
function setExpenseCalculating(expenseId, isCalculating) {
  const card = document.querySelector(`.expense-item[data-type="${expenseId}"]`);
  if (!card) return;
  card.classList.toggle("calculating", !!isCalculating);
}

function setContinueEnabled(enabled) {
  if (!continueBtn) return; // continueBtn already exists in your file
  if (enabled) {
    continueBtn.classList.remove("is-disabled");
    continueBtn.disabled = false;
  } else {
    continueBtn.classList.add("is-disabled");
    continueBtn.disabled = true;
  }
}


const expenseGrid = document.getElementById("expenseGrid");
const rmGrid = document.getElementById("rmGrid");
const continueBtn = document.getElementById("continueBtn");

const expModal = document.getElementById("expModal");
const modalTitle = document.getElementById("modalTitle");
const expTotal = document.getElementById("expTotal");
const expFixed = document.getElementById("expFixed");
const cancelModal = document.getElementById("cancelModal");
const saveModal = document.getElementById("saveModal");

const upgradePopup = document.getElementById("upgradePopup");



function hideFixedDetails() {
  const detailsBox = document.getElementById("fixedDetails");
  if (!detailsBox) return;
  detailsBox.style.display = "none";
  detailsBox.innerHTML = "";
}

// If user clears Total (iPhone “x”), hide scanned breakdown immediately
expTotal.addEventListener("input", () => {
  if (expTotal.value === "" || Number(expTotal.value) <= 0) {
    hideFixedDetails();
  }
});

// A hand-typed fixed part has nothing to explain, so as soon as the user edits
// this field the scanned breakdown stops describing the number above it. Reset
// per modal opening; the breakdown is dropped from the expense only on save.
let fixedEditedManually = false;

expFixed.addEventListener("input", () => {
  fixedEditedManually = true;
  hideFixedDetails();
});


// Calendar DOM
const dateRangeField = document.getElementById("dateRangeField");
const dateRangeMain = document.getElementById("dateRangeMain");
const dateRangeSub = document.getElementById("dateRangeSub");
const resetDates = document.getElementById("resetDates");
const perExpensePeriods = document.getElementById("perExpensePeriods");
const applyToAllBtn = document.getElementById("applyToAllBtn");

const calendarOverlay = document.getElementById("calendarOverlay");
const calendarGrid = document.getElementById("calendarGrid");
const calendarMonthLabel = document.getElementById("calendarMonthLabel");
const prevMonthBtn = document.getElementById("prevMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");
const calendarCopyMain = document.getElementById("calendarCopyMain");



/* STATE */

// Expenses for Pro mode
// fixedBreakdown: the scanner's line-by-line workings behind `fixed`, shown in
// the expense modal. Empty whenever the fixed part was typed by hand.
let expenses = [
  { id: "electricity", name: "Electricity", icon: "⚡", total: 0, fixed: 0, from: null, to: null, fixedBreakdown: [] },
  { id: "water",       name: "Water",       icon: "💧", total: 0, fixed: 0, from: null, to: null, fixedBreakdown: [] },
  { id: "gas",         name: "Gas",         icon: "🔥", total: 0, fixed: 0, from: null, to: null, fixedBreakdown: [] },
  { id: "other",       name: "Other",       icon: "🛒", total: 0, fixed: 0, from: null, to: null, fixedBreakdown: [] }
];

let editingExpense = null;



// Roommates
// Each roommate is { id, name }. `id` is stable and never reused, even if
// two roommates share the same display name.
const ROOMMATES_DATA_VERSION = "2";
function generateRoommateId() {
  if (window.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "rm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
let roommates = [];

// Calendar state
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let tempStart = null;
let tempEnd = null;
let finalStart = null;
let finalEnd = null;
// "global" = main bill period; "expense" = editing one expense
let calendarMode = "global";
let calendarExpense = null;

function formatShort(dateOrISO) {
  if (!dateOrISO) return "";
  const d = typeof dateOrISO === "string" ? new Date(dateOrISO) : dateOrISO;
  if (isNaN(d)) return "";
  return d.toLocaleDateString();
}


// Restore previous data if the user is coming back from Step 2/3
(function restoreFromStorage() {
 // Theme: "light" or "dark"
const savedTheme = localStorage.getItem("splitroomTheme");

// Backward compatibility (old users might still have splitroomMode)
const legacyMode = localStorage.getItem("splitroomMode"); // "free" | "pro"

if (savedTheme) {
  isDark = savedTheme === "dark";
} else if (legacyMode) {
  isDark = legacyMode === "pro"; // old "pro" becomes dark theme
}


  // Roommates list (stored as plain names; ids live in a parallel key)
  const savedRoommates = localStorage.getItem("splitroomRoommates");
  if (savedRoommates) {
    try {
      const parsedNames = JSON.parse(savedRoommates);
      if (Array.isArray(parsedNames) && parsedNames.length > 0) {
        const savedVersion = localStorage.getItem("splitroomRoommatesVersion");
        const savedIds = JSON.parse(localStorage.getItem("splitroomRoommateIds") || "null");
        const idsUsable =
          savedVersion === ROOMMATES_DATA_VERSION &&
          Array.isArray(savedIds) &&
          savedIds.length === parsedNames.length;

        roommates = parsedNames.map((name, i) => ({
          id: idsUsable ? savedIds[i] : generateRoommateId(),
          name,
        }));
      }
    } catch (e) {
      console.error("Error reading roommates from storage", e);
    }
  }

  // Expenses (totals + fixed parts)
  const savedExpenses = localStorage.getItem("splitroomExpenses");
  if (savedExpenses) {
    try {
      const parsed = JSON.parse(savedExpenses);
      if (Array.isArray(parsed)) {
        parsed.forEach((saved) => {
          const target =
            expenses.find((e) => e.id === saved.id) ||
            expenses.find((e) => e.name === saved.name);
                  if (target) {
          if (typeof saved.total === "number") target.total = saved.total;

          
          if (typeof saved.fixed === "number") target.fixed = saved.fixed;
          if (saved.from) target.from = saved.from;
          if (saved.to)   target.to = saved.to;

          if (Array.isArray(saved.fixedBreakdown)) target.fixedBreakdown = saved.fixedBreakdown;

    if (saved.from) target.from = saved.from;
    if (saved.to)   target.to = saved.to;
        }

        });
      }
    } catch (e) {
      console.error("Error reading expenses from storage", e);
    }
  }

  // Date range
  const savedStart = localStorage.getItem("splitroomStart");
  const savedEnd = localStorage.getItem("splitroomEnd");
  if (savedStart && savedEnd) {
    const s = new Date(savedStart);
    const e = new Date(savedEnd);
    if (!isNaN(s) && !isNaN(e)) {
      tempStart = s;
      tempEnd = e;
      finalStart = new Date(s);
      finalEnd = new Date(e);

      // Calendar view starts again from the selected period
      currentMonth = s.getMonth();
      currentYear = s.getFullYear();

      // Update the visible text in the date field
      if (typeof dateRangeMain !== "undefined" && dateRangeMain) {
        dateRangeMain.textContent =
          s.toLocaleDateString() + " → " + e.toLocaleDateString();
      }
      if (typeof dateRangeSub !== "undefined" && dateRangeSub) {
        dateRangeSub.textContent = "Dates selected";
      }
    }
  }
})();

ensureYouRoommate();


/* ======================
   THEME SWITCH (Light / Dark)
====================== */

function applyThemeUI() {
  // ✅ apply to BOTH <body> and <html>
  document.body.classList.toggle("pro-mode", isDark);
  document.documentElement.classList.toggle("pro-mode", isDark);

  // sync the checkbox UI
  if (themeToggle) themeToggle.checked = isDark;

  // Re-render so UI updates instantly
  renderExpenses();
  updateTotalBillFromExpenses();
}


// 🔥 THIS was missing: react to user toggling the switch
if (themeToggle) {
  themeToggle.addEventListener("change", () => {
    isDark = themeToggle.checked;
    localStorage.setItem("splitroomTheme", isDark ? "dark" : "light");
    applyThemeUI();
  });
}

// Run once on load
applyThemeUI();





applyToAllBtn.onclick = () => {
  if (!finalStart || !finalEnd) return;

  const active = expenses.filter((exp) => exp.total && exp.total > 0);
  if (active.length <= 1) return;

  active.forEach((exp) => {
    exp.from = finalStart.toISOString();
    exp.to = finalEnd.toISOString();
  });

  renderPerExpensePeriods();
};

/* ======================
   EXPENSE GRID
====================== */

function renderExpenses() {
  expenseGrid.innerHTML = "";
  expenses.forEach((exp) => {
    const item = document.createElement("div");
item.className = "expense-item";
item.dataset.type = exp.id; // <-- IMPORTANT: lets spinner target the right card



 item.innerHTML = `
  ${exp.total > 0 ? '<div class="exp-reset">×</div>' : ''}

  <!-- Fixed part calculating badge (hidden unless card has .calculating) -->
  <div class="fixed-badge">
    <span class="fixed-spinner"></span>
    <span>Calculating…</span>
  </div>

  <div class="exp-icon">${exp.icon}</div>
<div class="exp-name">${exp.name}</div>
  <div class="exp-amount">
    ${exp.total > 0 ? "€" + exp.total.toFixed(2) : ""}
  </div>
`;



    // Handle reset "×"
    const resetBtn = item.querySelector(".exp-reset");
    if (resetBtn) {
      resetBtn.onclick = (event) => {
  event.stopPropagation();
  exp.total = 0;
  exp.fixed = 0;
  exp.fixedBreakdown = []; // the workings go with the number they explained


  renderExpenses();
  updateTotalBillFromExpenses();
};
    }

    item.onclick = () => {
  openExpenseModal(exp);
};

    expenseGrid.appendChild(item);
  });

  // After rebuilding grid, also update the Bill-period rows
  renderPerExpensePeriods();
}

function renderPerExpensePeriods() {
  if (!perExpensePeriods) return;

  const active = expenses.filter((exp) => exp.total && exp.total > 0);

  // Apply-to-all button only when global period exists and 2+ active
  if (finalStart && finalEnd && active.length > 1) {
    applyToAllBtn.style.display = "inline-flex";
  } else {
    applyToAllBtn.style.display = "none";
  }

  if (active.length <= 1) {
    perExpensePeriods.style.display = "none";
    perExpensePeriods.innerHTML = "";
    return;
  }

  perExpensePeriods.style.display = "flex";
  perExpensePeriods.innerHTML = "";

  const firstActive = active[0];

  active.forEach((exp) => {
    const row = document.createElement("div");
    row.className = "per-exp-row";

    let subText;

    if (exp === firstActive) {
      // First expense: always reflects the main period
      if (finalStart && finalEnd) {
        subText = `${formatShort(finalStart)} → ${formatShort(finalEnd)} (main period)`;
      } else {
        subText = "Tap to select main period";
      }
    } else {
      // Other expenses
      if (exp.from && exp.to) {
        subText = `${formatShort(exp.from)} → ${formatShort(exp.to)}`;
      } else {
        subText = "Tap to select period";
      }
    }

    row.innerHTML = `
      <div class="per-exp-icon">${exp.icon}</div>
      <div>
        <div class="per-exp-text-main">${exp.name}</div>
        <div class="per-exp-text-sub">${subText}</div>
      </div>
    `;

    // Click row → open calendar in expense mode
    row.onclick = () => {
      calendarMode = "expense";
      calendarExpense = exp;

      // Only pre-fill if this expense already has its own period
      if (exp.from && exp.to) {
        tempStart = new Date(exp.from);
        tempEnd = new Date(exp.to);
      } else {
        tempStart = null;
        tempEnd = null;
      }

      const base = tempStart || new Date();
      currentMonth = base.getMonth();
      currentYear = base.getFullYear();

      // Show Copy main period if we have a global period
      if (finalStart && finalEnd) {
        calendarCopyMain.style.display = "inline-flex";
      } else {
        calendarCopyMain.style.display = "none";
      }

      calendarOverlay.style.display = "flex";
      renderCalendar(currentYear, currentMonth);
    };

    perExpensePeriods.appendChild(row);
  });
}



renderExpenses();

  // After rebuilding the expense grid, update the period rows
  renderPerExpensePeriods();


/* EXPENSE MODAL */

// ... replace the existing openExpenseModal function ...

function openExpenseModal(exp) {
  editingExpense = exp;
  modalTitle.textContent = exp.name;
  expTotal.value = exp.total || "";
  expFixed.value = exp.fixed || "";
  
  fixedEditedManually = false;
  renderFixedBreakdown(exp);

  expModal.style.display = "flex";
}

// The lines the scanner added up to reach the fixed part, so the number is
// something the user can check rather than a single figure they have to trust.
// Collapsed by default. Hidden entirely when there is nothing to show — no
// scan, or a fixed part the user typed themselves.
function renderFixedBreakdown(exp) {
  const box = document.getElementById("fixedDetails");
  if (!box) return;

  const lines = Array.isArray(exp.fixedBreakdown) ? exp.fixedBreakdown : [];
  if (!lines.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const money = (n) => "€" + Number(n || 0).toFixed(2);

  const rows = lines.map((line) => {
    // Not every fixed charge is billed per day: the DGEG fee and the
    // audiovisual contribution are monthly, and calling those "2 days" is a
    // plain lie about the bill. The server sends the unit as "day" or "month",
    // or null when it could not read one — and then we show no quantity at all
    // rather than guessing, the same way a low-confidence field comes back
    // blank. `line.days` is the field's old name, still in localStorage for
    // anyone who scanned before this shipped.
    const q = Number(line.qty != null ? line.qty : line.days);
    const unit = line.unit || (line.days != null ? "day" : null);
    const noun = unit === "month" ? "month" : "day";
    const qty =
      Number.isFinite(q) && q > 0 && unit ? `${q} ${noun}${q === 1 ? "" : "s"}` : "";

    // vatRate arrives as a fraction: 0.06 is 6%, 0 is a charge the bill does
    // not tax at all (RSU standing charges, "não sujeito a IVA"). Saying so
    // beats a blank cell that reads like something went wrong.
    const vat = Number(line.vatRate) === 0 ? "no VAT" : "";

    return `
        <tr>
          <td class="fixed-calc-label">${escapeHtml(line.label || "")}</td>
          <td class="fixed-calc-days">${qty}</td>
          <td class="fixed-calc-amt">${money(line.gross)}</td>
          <td class="fixed-calc-vat">${vat}</td>
        </tr>`;
  }).join("");

  box.innerHTML = `
    <details class="fixed-calc">
      <summary class="fixed-calc-summary">
        <span>How this was calculated</span>
        <span class="fixed-calc-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="fixed-calc-body">
        <p class="fixed-calc-intro">
          These are charges you pay regardless of how much you use, so they're
          split equally between roommates.
        </p>
        <table class="fixed-calc-table">
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="fixed-calc-total">
              <td class="fixed-calc-label">Fixed part</td>
              <td class="fixed-calc-days"></td>
              <td class="fixed-calc-amt">${money(exp.fixed)}</td>
              <td class="fixed-calc-vat"></td>
            </tr>
          </tfoot>
        </table>
        <p class="fixed-calc-note">Amounts include IVA (VAT) where it applies.</p>
      </div>
    </details>
  `;
  box.style.display = "block";
}

cancelModal.onclick = () => {
  expModal.style.display = "none";
};

saveModal.onclick = () => {
  const t = Number(expTotal.value);
  let f = Number(expFixed.value);

  if (!t || t <= 0) {
    alert("Enter a valid total amount.");
    return;
  }
  if (isNaN(f) || f < 0) f = 0;
  if (f > t) {
    alert("Fixed part cannot be greater than total.");
    return;
  }

  editingExpense.total = t;
  editingExpense.fixed = f;
  if (fixedEditedManually) editingExpense.fixedBreakdown = [];


  expModal.style.display = "none";
  renderExpenses();
  updateTotalBillFromExpenses();
};

/* TOTAL BILL = MANUAL (FREE) OR FROM EXPENSES (PRO) */

function updateTotalBillFromExpenses() {
  const sum = expenses.reduce((acc, e) => acc + (e.total || 0), 0);
  const formatted = sum > 0 ? sum.toFixed(2) : "0.00";
  billTotalDisplay.textContent = "€ " + formatted;
}


resetBill.onclick = () => {
  // clear all expenses
  expenses.forEach(e => {
    e.total = 0;
    e.fixed = 0;
    e.fixedBreakdown = [];
  });
  freeActiveExpenseId = null;
  renderExpenses();
  updateTotalBillFromExpenses();
};

// ===== BILL HELP OVERLAY =====

const billHelpBtn      = document.getElementById("billHelpBtn");
const billHelpOverlay  = document.getElementById("billHelpOverlay");
const closeBillHelp    = document.getElementById("closeBillHelp");
const billHelpTitle    = document.getElementById("billHelpTitle");
const billHelpTypeSpan = document.getElementById("billHelpType");

// NUEVO: secciones específicas por tipo de factura
const electricityHelp = document.getElementById("electricityHelp");
const waterHelp       = document.getElementById("waterHelp");
const gasHelp         = document.getElementById("gasHelp");
const helpSections    = [electricityHelp, waterHelp, gasHelp];

if (billHelpBtn && billHelpOverlay && closeBillHelp) {
  billHelpBtn.onclick = () => {
    if (!editingExpense) return;

    // nombre del gasto que estás editando (Electricity, Water, Gas…)
    const rawName = (editingExpense.name || "bill").toLowerCase();

    // por defecto: electricidad
    let labelType = "electricity";
    let sectionToShow = electricityHelp;

    // si el gasto es agua
    if (rawName.includes("water")) {
      labelType = "water";
      sectionToShow = waterHelp || sectionToShow;
    }
    // si el gasto es gas
    else if (rawName.includes("gas")) {
      labelType = "gas";
      sectionToShow = gasHelp || sectionToShow;
    }
    // si es "other" o algo raro, se queda con electricidad por defecto

    // actualizar textos del overlay
    billHelpTypeSpan.textContent = labelType;
    billHelpTitle.textContent = `How to read your ${labelType} bill`;

    // ocultar todas las secciones primero
    helpSections.forEach((section) => {
      if (section) section.style.display = "none";
    });

    // mostrar solo la sección correcta
    if (sectionToShow) {
      sectionToShow.style.display = "block";
    }

    // abrir el overlay
    billHelpOverlay.style.display = "flex";
  };

  // cerrar con la X
  closeBillHelp.onclick = () => {
    billHelpOverlay.style.display = "none";
  };

  // cerrar haciendo click fuera de la tarjeta
  billHelpOverlay.onclick = (event) => {
    if (event.target === billHelpOverlay) {
      billHelpOverlay.style.display = "none";
    }
  };
}




/* ======================
   ROOMMATES
====================== */

// A "default" name is something like "Roommate 1", "Roommate 2", etc.
function isDefaultRoommateName(name) {
  if (!name) return false;
  return /^Roommate\s+\d+$/i.test(name.trim());
}

// Renumber ONLY the default names so they stay Roommate 1, 2, 3… in order
function renumberDefaultRoommates() {
  let index = 1;
  roommates = roommates.map((rm) => {
    if (isDefaultRoommateName(rm.name)) {
      return { ...rm, name: `Roommate ${index++}` };
    }
    return rm; // custom names (e.g. "Luna") stay untouched
  });
}


function ensureYouRoommate() {
  // If empty, always create the first visible card
  if (!Array.isArray(roommates) || roommates.length === 0) {
    roommates = [{ id: generateRoommateId(), name: "Me" }];
    return;
  }

  // If "You" is missing (old sessions), add it at the beginning
  const hasYou = roommates.some((r) => (r.name || "").trim().toLowerCase() === "me");
  if (!hasYou) roommates.unshift({ id: generateRoommateId(), name: "Me" });
}




function renderRoommates() {
  rmGrid.innerHTML = "";

  
  // add card
  const add = document.createElement("div");
  add.className = "rm-card add-rm";
  add.textContent = "+ Add";
  add.onclick = () => {
  // Count only default "Roommate X" names, so "You" doesn't affect numbering
  const nextNum =
    roommates.filter((r) => isDefaultRoommateName(r.name)).length + 1;

  roommates.push({ id: generateRoommateId(), name: `Roommate ${nextNum}` });
  renumberDefaultRoommates();
  renderRoommates();
};


  rmGrid.appendChild(add);

  roommates.forEach((rm, i) => {
    const card = document.createElement("div");
    card.className = "rm-card";
    card.textContent = rm.name;

    const isYou = (rm.name || "").trim().toLowerCase() === "me";
if (isYou) card.classList.add("rm-default");


    // rename (available for everyone)
card.onclick = () => {
  const newName = prompt("Rename roommate", rm.name);
  if (newName && newName.trim().length > 0) {
    roommates[i] = { ...roommates[i], name: newName.trim() };
    renderRoommates();
  }
};


   if (!isYou) {
  const del = document.createElement("div");
  del.className = "rm-delete";
  del.textContent = "×";
  del.onclick = (e) => {
    e.stopPropagation();
    roommates.splice(i, 1);       // remove selected roommate
    renumberDefaultRoommates();   // compact Roommate 1,2,3…
    renderRoommates();
  };

  card.appendChild(del);
}

    rmGrid.appendChild(card);
  });
}

renderRoommates();


function showUpgrade() {
  // App is fully free now — no upgrade messaging
  return;
}


/* ======================
   CALENDAR LOGIC
====================== */

dateRangeField.onclick = () => {
  calendarMode = "global";
  calendarExpense = null;

  // keep previously selected range if exists
  tempStart = finalStart;
  tempEnd = finalEnd;

  const base = tempStart || new Date();
  currentMonth = base.getMonth();
  currentYear = base.getFullYear();

  // In global mode we don't need "Copy main period"
  calendarCopyMain.style.display = "none";

  calendarOverlay.style.display = "flex";
  renderCalendar(currentYear, currentMonth);
};

// Clear ALL dates: global bill period + per-expense periods
resetDates.onclick = () => {
  // 1. Clear the global period
  finalStart = null;
  finalEnd = null;
  tempStart = null;
  tempEnd = null;

  // 2. Reset the main bill period text
  dateRangeMain.textContent = "Select your dates";
  dateRangeSub.textContent = "Past dates allowed";

  // 3. Clear ALL per-expense custom periods (but keep amounts)
  expenses.forEach((exp) => {
    exp.from = null;
    exp.to = null;
  });

  // 4. Re-render the rows so they show "Tap to select..."
  renderPerExpensePeriods();
};

calendarCopyMain.onclick = () => {
  // Only makes sense in expense mode and if we have a global period
  if (calendarMode !== "expense" || !calendarExpense) return;
  if (!finalStart || !finalEnd) return;

  tempStart = new Date(finalStart);
  tempEnd = new Date(finalEnd);

  applyDates(); // will save and close
};


calendarOverlay.onclick = (e) => {
  if (e.target === calendarOverlay) {
    calendarOverlay.style.display = "none";
  }
};

function renderCalendar(year, month) {
  calendarGrid.innerHTML = "";

  calendarMonthLabel.textContent = new Date(year, month, 1).toLocaleString(
    "default",
    { month: "long", year: "numeric" }
  );

  const dayNames = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  dayNames.forEach((n) => {
    const div = document.createElement("div");
    div.className = "calendar-day-name";
    div.textContent = n;
    calendarGrid.appendChild(div);
  });

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const offset = (first.getDay() + 6) % 7;

  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day-name";
    empty.style.opacity = 0;
    calendarGrid.appendChild(empty);
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    const div = document.createElement("div");
    div.className = "calendar-day";
    div.textContent = d;

    if (tempStart && tempEnd && date >= tempStart && date <= tempEnd) {
      div.classList.add("in-range");
    }
    if (isSameDate(date, tempStart)) div.classList.add("start");
    if (isSameDate(date, tempEnd)) div.classList.add("end");

    div.onclick = () => handleDayClick(date);
    calendarGrid.appendChild(div);
  }
}

function handleDayClick(date) {
  if (!tempStart || (tempStart && tempEnd)) {
    tempStart = new Date(date);
    tempEnd = null;
  } else {
    if (date < tempStart) {
      tempEnd = tempStart;
      tempStart = new Date(date);
    } else {
      tempEnd = new Date(date);
    }
    applyDates();
  }
  renderCalendar(currentYear, currentMonth);
}

function applyDates() {
  if (!tempStart || !tempEnd) return;

  if (calendarMode === "global") {
    // Main bill period
    finalStart = new Date(tempStart);
    finalEnd = new Date(tempEnd);

    dateRangeMain.textContent =
      finalStart.toLocaleDateString() + " → " + finalEnd.toLocaleDateString();
    dateRangeSub.textContent = "Dates selected";

    // If there is exactly ONE active expense, sync its period too
        const active = expenses.filter((e) => e.total && e.total > 0);
    if (active.length >= 1) {
      // First expense (first emoji with amount) always mirrors main period
      active[0].from = finalStart.toISOString();
      active[0].to = finalEnd.toISOString();
    }

  } else if (calendarMode === "expense" && calendarExpense) {
    // Period for a single expense
    calendarExpense.from = new Date(tempStart).toISOString();
    calendarExpense.to = new Date(tempEnd).toISOString();

    // Expand global range so Step 2 covers everything
    if (!finalStart || tempStart < finalStart) finalStart = new Date(tempStart);
    if (!finalEnd || tempEnd > finalEnd)     finalEnd = new Date(tempEnd);

    dateRangeMain.textContent =
      finalStart.toLocaleDateString() + " → " + finalEnd.toLocaleDateString();
    dateRangeSub.textContent = "Dates selected";
  }

  // Update rows / apply-to-all visibility
  renderPerExpensePeriods();

  calendarOverlay.style.display = "none";
}


function isSameDate(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

prevMonthBtn.onclick = () => {
  if (currentMonth === 0) {
    currentMonth = 11;
    currentYear--;
  } else currentMonth--;
  renderCalendar(currentYear, currentMonth);
};

nextMonthBtn.onclick = () => {
  if (currentMonth === 11) {
    currentMonth = 0;
    currentYear++;
  } else currentMonth++;
  renderCalendar(currentYear, currentMonth);
};

/* ======================
   CONTINUE → STEP 2
====================== */

continueBtn.onclick = () => {
  // Validate roommates
  if (roommates.length === 0) {
    alert("Add at least one roommate.");
    return;
  }

  // Validate dates
  if (!finalStart || !finalEnd) {
    alert("Select the bill period.");
    return;
  }

let billValue = expenses.reduce((acc, e) => acc + (e.total || 0), 0);

if (!billValue || billValue <= 0) {
  alert("Add at least one expense amount.");
  return;
}

// Save all expenses (some can be 0 — that’s fine)
let expensesToSave = expenses;



  // Save in localStorage
  localStorage.setItem("splitroomTheme", isDark ? "dark" : "light");
  localStorage.setItem("splitroomBill", String(billValue));
  localStorage.setItem("splitroomExpenses", JSON.stringify(expensesToSave));
  localStorage.setItem("splitroomRoommates", JSON.stringify(roommates.map((r) => r.name)));
  localStorage.setItem("splitroomRoommateIds", JSON.stringify(roommates.map((r) => r.id)));
  localStorage.setItem("splitroomRoommatesVersion", ROOMMATES_DATA_VERSION);
  localStorage.setItem("splitroomStart", finalStart.toISOString());
  localStorage.setItem("splitroomEnd", finalEnd.toISOString());

  window.location.href = "step2.html";
};



/* ========= PWA INSTALL BUTTON ========= */

let deferredPrompt = null;
const installBtn = document.getElementById("installAppBtn");
const installHint = document.getElementById("installHint");
const installSection = document.getElementById("installSection");
const classicLink = document.getElementById("classicLink");


const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isInStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

  // If the app is already installed/opened from Home Screen, hide install area
if (isInStandalone) {
  if (installSection) installSection.style.display = "none";
}


 
// Hide right after installation (Android + Desktop)
window.addEventListener("appinstalled", () => {
  if (installSection) installSection.style.display = "none";
});



// Chrome / Android: capture the real install prompt
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;

  if (installBtn) {
    const textSpan = installBtn.querySelector(".install-app-text");
    if (textSpan) {
      textSpan.textContent = "Install Bill by Days (app)";
    }
  }
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    // 1) Native prompt available (Chrome/Android)
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;

      if (outcome === "accepted") {
        const textSpan = installBtn.querySelector(".install-app-text");
        if (textSpan) {
          textSpan.textContent = "App installed ✔";
        }
      }
      return;
    }

    // 2) iOS Safari: show the written instructions instead of an alert
    if (isIos && !isInStandalone && installHint) {
      installHint.style.display = "block";
      installHint.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // 3) Other browsers: silent fallback
    if (!isInStandalone) {
      console.log(
        "To install, use your browser menu and choose 'Install app' or 'Add to Home Screen'."
      );
    }
  });
}



// 🧠 App version – change this when you ship breaking changes (e.g. Pro becomes paid)
const APP_VERSION = "1.0.0";

(function checkAppVersion() {
  const stored = localStorage.getItem("bbd_app_version");

  if (stored !== APP_VERSION) {
    // 👉 Put here the things that must reset when version changes

    // Example: reset mode so old free-Pro users don't stay unlocked
    localStorage.removeItem("splitroomMode");

    // You can also clear other old flags if needed:
    // localStorage.removeItem("someOldFlag");

    localStorage.setItem("bbd_app_version", APP_VERSION);
  }
})();

// helper for dates fortmat (last used in Step 2)


// The extractor returns ISO "YYYY-MM-DD". Build the Date from the parts so it
// lands on local midnight — new Date("2026-03-15") parses as UTC and can come
// back as the 14th for anyone west of Greenwich.
function parseISODateLocal(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}



// Apply scanned bill data (from Step 1 PDF upload)

// Applies whatever the extractor was confident about. Anything it returned as
// null is left untouched — the backend only sends a number when it is sure, so
// a null here means "ask the user", never "assume zero".
// Returns the expense card the scan was applied to.
function applyScannedBill(result) {
  if (!result) return null;

  // Route to the matching emoji when we know the bill type.
  const type = String(result.billType || "").toLowerCase();

  const preferredId =
    type === "water" ? "water" :
    type === "electricity" ? "electricity" :
    type === "gas" ? "gas" :
    null;

  const target =
    (preferredId && expenses.find(e => e.id === preferredId)) ||
    expenses.find(e => e.total === 0) ||
    expenses[0];

  // The lines behind fixedPart, shown under the Fixed part field. Always
  // reassigned, so a breakdown from an earlier scan cannot linger on this card.
  // The backend sends [] whenever fixedPart itself did not survive validation.
  target.fixedBreakdown = Array.isArray(result.fixedBreakdown)
    ? result.fixedBreakdown
    : [];

  // 1) TOTAL
  if (typeof result.total === "number") {
    target.total = result.total;
  }

  // 2) FIXED PART
  if (typeof result.fixedPart === "number") {
    target.fixed =
      typeof result.total === "number"
        ? Math.min(result.fixedPart, result.total)
        : result.fixedPart;
  }

  // 3) BILL PERIOD
  const s = parseISODateLocal(result.periodStart);
  const e = parseISODateLocal(result.periodEnd);

  if (s && e) {
    finalStart = s;
    finalEnd = e;
    tempStart = s;
    tempEnd = e;

    dateRangeMain.textContent =
      s.toLocaleDateString() + " → " + e.toLocaleDateString();
    dateRangeSub.textContent = "Dates selected";

    target.from = s.toISOString();
    target.to = e.toISOString();
  }

  renderExpenses();
  updateTotalBillFromExpenses();
  renderPerExpensePeriods();

  return target;
}

// ===============================
// Scan report — what we could not read, and what to do about it
// ===============================
const scanReport = document.getElementById("scanReport");

const SCAN_FIELD_LABELS = {
  total: "Total amount",
  fixedPart: "Fixed part",
  period: "Billing period",
  periodStart: "Billing period",
  periodEnd: "Billing period",
  file: "The bill",
};

function hideScanReport() {
  if (scanReport) {
    scanReport.hidden = true;
    scanReport.innerHTML = "";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function missingScanFields(result) {
  const missing = [];
  if (result.total === null) missing.push("total");
  if (result.fixedPart === null) missing.push("fixedPart");
  if (result.periodStart === null || result.periodEnd === null) missing.push("period");
  return missing;
}

// One reason per field. "period" covers both dates, so match either.
function scanReasonFor(result, field) {
  const hit = (result.issues || []).find((i) => {
    if (field === "period") return /^period/.test(String(i.field || ""));
    return String(i.field || "") === field;
  });
  return hit && hit.reason ? hit.reason : "We could not read this from the bill.";
}

// Shows one row per field we could not fill in, each with the reason, plus two
// equally-weighted next steps. Typing the values is a first-class path, not a
// fallback — the user is never blocked from just entering three numbers.
//
// entries: [{ result, target, label }] — one per scanned bill.
function renderScanReport(entries) {
  if (!scanReport) return;

  const incomplete = (entries || [])
    .filter((e) => e && e.result)
    .map((e) => Object.assign({}, e, { missing: missingScanFields(e.result) }))
    .filter((e) => e.missing.length);

  if (!incomplete.length) {
    hideScanReport();
    return;
  }

  const anythingFilled = (entries || []).some(
    (e) => e && e.result && missingScanFields(e.result).length < 3
  );

  const sections = incomplete
    .map((entry) => {
      const rows = entry.missing
        .map(
          (field) => `
          <li class="scan-issue">
            <span class="scan-issue-field">${escapeHtml(SCAN_FIELD_LABELS[field] || field)}</span>
            <span class="scan-issue-reason">${escapeHtml(scanReasonFor(entry.result, field))}</span>
          </li>`
        )
        .join("");

      const heading = entry.label
        ? `<div class="scan-issue-bill">${escapeHtml(entry.label)}</div>`
        : "";

      return `${heading}<ul class="scan-issue-list">${rows}</ul>`;
    })
    .join("");

  scanReport.innerHTML = `
    <div class="scan-report-title">
      ${anythingFilled
        ? "We filled in what we could read."
        : "We could not read this bill."}
    </div>
    ${sections}
    <div class="scan-actions">
      <button type="button" class="scan-action" id="scanRetake">Retake photo</button>
      <button type="button" class="scan-action" id="scanManual">Enter manually</button>
    </div>
    <div class="scan-report-note">Both work equally well — typing the numbers takes a few seconds.</div>
  `;
  scanReport.hidden = false;

  const retakeBtn = document.getElementById("scanRetake");
  if (retakeBtn) {
    retakeBtn.onclick = () => {
      hideScanReport();
      if (billUpload) billUpload.click();
    };
  }

  const manualBtn = document.getElementById("scanManual");
  if (manualBtn) {
    manualBtn.onclick = () => {
      const first = incomplete[0];
      hideScanReport();
      // Amounts live in the expense card; the period lives on the date picker.
      if (first.missing.includes("total") || first.missing.includes("fixedPart")) {
        openExpenseModal(first.target || expenses[0]);
      } else if (dateRangeMain) {
        dateRangeMain.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
  }
}

// ===============================
// PDF Upload → Scan bill (show spinner only while scanning)
// ===============================
if (billUpload) {
  billUpload.addEventListener("change", async () => {
    const files = Array.from(billUpload.files || []);
    if (!files.length) return;

    const isPdf = (f) =>
      f.type === "application/pdf" || (f.name || "").toLowerCase().endsWith(".pdf");

    const pdfFiles = files.filter(isPdf);
    const imageFiles = files.filter((f) => !isPdf(f));

    // ✅ Pro feature: if 2+ PDFs are selected, treat each PDF as a separate bill
   const multiPdfBills = pdfFiles.length >= 2;


    // ------------------------------
    // Upload UI text (filename)
    // ------------------------------
    if (uploadFilename) {
      if (files.length === 1) {
        uploadFilename.textContent = files[0].name || "File selected";
      } else if (multiPdfBills) {
        uploadFilename.textContent = `${pdfFiles.length} bills selected`;
      } else if (!pdfFiles.length && imageFiles.length > 1) {
        uploadFilename.textContent = `${imageFiles.length} screenshots selected`;
      } else {
        uploadFilename.textContent = `${files.length} files selected`;
      }
    }

    if (uploadSub) {
      if (multiPdfBills) {
        uploadSub.textContent = `Analyzing ${pdfFiles.length} PDFs (multiple bills)`;
      } else if (!pdfFiles.length && imageFiles.length > 1) {
        uploadSub.textContent = "Multiple screenshots selected (treated as 1 multi-page bill)";
      } else {
        uploadSub.textContent = "PDF recommended · or one/multiple screenshots";
      }
    }

    // Spinner should show on the "active" emoji in Free mode, otherwise default to electricity

    const scanningId = (expenses.find(e => (e.total || 0) > 0)?.id) || "electricity";


    // UI ON (full page loading)
    setContinueEnabled(false);
    showFullLoading({
      theme: scanningId,
      // One model call instead of four sequential OCR runs.
      expectedMs: 15000 * (multiPdfBills ? pdfFiles.length : 1),
    });

    // hide error text while working
    if (scanStatus) scanStatus.style.display = "none";
    hideScanReport();

    // ------------------------------
    // Analyze ONE bill — a single request, no fallback chain.
    // - pdfFile: one PDF bill
    // - screenshots: several images that are pages of ONE bill
    // Returns the parsed result so the caller can report what was missed.
    // ------------------------------
    const analyzeOneBill = async ({ pdfFile, screenshots }) => {
      const fd = new FormData();

      if (pdfFile) {
        fd.append("file", pdfFile);
      } else {
        (screenshots || []).forEach((img) => fd.append("files", img));
      }

      const res = await fetch(EXTRACT_ENDPOINT, { method: "POST", body: fd });

      // The backend answers with the same JSON shape on success and on failure,
      // so there is exactly one path to read here.
      const result = await res.json().catch(() => null);

      if (!result || typeof result !== "object") {
        throw new Error("Could not scan the bill. Try a clearer photo, or enter the values yourself.");
      }

      const target = applyScannedBill(result);
      return { result, target };
    };

    const outcomes = [];

    try {
      // ------------------------------
      // PRO: multiple PDFs → multiple bills
      // ------------------------------
      if (multiPdfBills) {
        // if they also selected screenshots, ignore them here (can't reliably map screenshots to bills)
        for (let i = 0; i < pdfFiles.length; i++) {
          if (loadingTitle) {
            loadingTitle.textContent = `Analyzing bill ${i + 1} of ${pdfFiles.length}`;
          }
          const outcome = await analyzeOneBill({ pdfFile: pdfFiles[i], screenshots: [] });
          outcomes.push(Object.assign({ label: pdfFiles[i].name || `Bill ${i + 1}` }, outcome));
        }
      } else {
        // ------------------------------
        // Default: ONE bill
        // Priority:
        //  - If there is a PDF, use the first PDF and ignore images
        //  - Otherwise, treat ALL selected images as pages of ONE bill
        // ------------------------------
        const pdfFile = pdfFiles[0] || null;
        const screenshots = pdfFile ? [] : imageFiles;

        outcomes.push(await analyzeOneBill({ pdfFile, screenshots }));
      }

      // Tell the user exactly which fields we could not read, and why.
      renderScanReport(outcomes);
    } catch (err) {
      console.error(err);

      if (scanStatus) {
        scanStatus.style.display = "block";
        scanStatus.textContent =
          err?.message || "Could not scan the bill. Try a clearer PDF or screenshot.";
      }
    } finally {
      hideFullLoading();
      setContinueEnabled(true);

      // allow re-uploading the same file(s)
      billUpload.value = "";

      if (loadingTitle) loadingTitle.textContent = "Analyzing your bill";
    }
  });
}


