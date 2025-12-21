/* ============================================================
   INDEX.JS — FREE + PRO MODES
============================================================ */

let isPro = false;

// DOM
const modeSwitch = document.getElementById("modeSwitch");
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

  if (theme === "electricity") { accent = "#22c55e"; } // green
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
  const count = Math.random() < 0.5 ? 2 : 3; // 2 or 3
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


function hideFullLoading() {
  if (!loadingOverlay) return;

  loadingOverlay.classList.remove("show");
  document.body.classList.remove("is-loading");

  if (loadingTick) { clearInterval(loadingTick); loadingTick = null; }
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }

  // reset bar so next scan starts clean
  if (loadingProgress) loadingProgress.style.width = "0%";
}




const API_BASE = "https://billbydays-backend.onrender.com";
const SCAN_ENDPOINT = `${API_BASE}/api/scan-bill`;
const DI_ENDPOINT = `${API_BASE}/api/di-bill?pages=1-4`;
const OCR_ENDPOINT = `${API_BASE}/api/ocr-bill`;
const ANALYZE_ENDPOINT = `${API_BASE}/api/analyze-bill`;


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
let expenses = [
  { id: "electricity", name: "Electricity", icon: "⚡", total: 0, fixed: 0, from: null, to: null },
  { id: "water",       name: "Water",       icon: "💧", total: 0, fixed: 0, from: null, to: null },
  { id: "gas",         name: "Gas",         icon: "🔥", total: 0, fixed: 0, from: null, to: null },
  { id: "other",       name: "Other",       icon: "🛒", total: 0, fixed: 0, from: null, to: null }
];

let editingExpense = null;


// 🔥 ADD THIS LINE HERE
let freeActiveExpenseId = null;   // which emoji is allowed in Free mode

// Roommates
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
  // Mode: "free" or "pro"
  const savedMode = localStorage.getItem("splitroomMode");
  if (savedMode) {
    isPro = savedMode === "pro";
  }

  // Roommates list
  const savedRoommates = localStorage.getItem("splitroomRoommates");
  if (savedRoommates) {
    try {
      const parsed = JSON.parse(savedRoommates);
      if (Array.isArray(parsed) && parsed.length > 0) {
        roommates = parsed;
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

          if (Array.isArray(saved.fixedItems)) target.fixedItems = saved.fixedItems;

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
   MODE SWITCH
====================== */

function applyModeUI() {
  // Switch theme
  if (isPro) {
    document.body.classList.add("pro-mode");

    // Top-right button becomes "Back to Free"
    modeSwitch.textContent = "Back to Free";
    modeSwitch.classList.remove("try-pro");
    modeSwitch.classList.add("back-free");

    totalSub.textContent =
      "Pro mode: add multiple expenses (electricity, water, gas, other). Total is calculated automatically.";
  } else {
    document.body.classList.remove("pro-mode");

    // Top-right button becomes "Try Pro"
    modeSwitch.textContent = "Try Pro mode";
    modeSwitch.classList.remove("back-free");
    modeSwitch.classList.add("try-pro");

    totalSub.textContent =
      "Free mode: add only ONE expense. Want electricity + water + gas? Tap “Try Pro mode”.";
  }

  // Re-render so locked visuals update immediately
  renderExpenses();
  updateTotalBillFromExpenses();
}

// Click behavior (with a safe confirm when leaving Pro)
modeSwitch.onclick = () => {
  if (isPro) {
    // If user already has multiple expenses, confirm before going back to Free
    const activeCount = expenses.filter(e => (e.total || 0) > 0).length;
    if (activeCount > 1) {
      const ok = confirm(
        "Free mode allows only ONE expense.\n\nIf you switch back to Free, only the first expense will be used when you continue.\n\nSwitch to Free anyway?"
      );
      if (!ok) return;
    }
  }

  isPro = !isPro;

  // Persist immediately so refresh keeps the same mode
  localStorage.setItem("splitroomMode", isPro ? "pro" : "free");

  applyModeUI();
};

// Run once on load
applyModeUI();



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


// FREE mode: if one expense is already filled, visually lock the others
const used = expenses.find(e => (e.total || 0) > 0);
if (!isPro && used && exp.id !== used.id) {
  item.classList.add("locked");
}

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
        event.stopPropagation(); // do NOT open modal
        exp.total = 0;
        exp.fixed = 0;

        // Reset free-mode lock if this was the active expense
        if (freeActiveExpenseId === exp.id) {
          freeActiveExpenseId = null;
        }

        renderExpenses();
        updateTotalBillFromExpenses();
      };
    }

    // Click on the card
    item.onclick = () => {
      if (!isPro) {
        // Free mode:
        // Allow opening the modal as long as no OTHER emoji already has a value
        const anotherUsed = expenses.some(
          (e) => e.id !== exp.id && e.total > 0
        );

        if (anotherUsed) {
          // Another emoji already has a value -> Pro only
          showUpgrade();
          return;
        }

        // Either:
        // - no expense has a value yet, or
        // - only THIS emoji has a value
        // → always allow opening the modal
        openExpenseModal(exp);
        return;
      }

      // Pro mode: all emojis are editable
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
  
  // --- NEW LOGIC: Show Breakdown ---
  const detailsBox = document.getElementById("fixedDetails");
  if (detailsBox) {
    if (exp.fixedItems && exp.fixedItems.length > 0) {
      // Build the HTML list (aligned right column + small IVA line)
// Choose one label (Portugal-first):
const taxLabel = "IVA"; // Portuguese bills say IVA (VAT)

const rows = exp.fixedItems.map(item => {
  const amount = `€${Number(item.amount).toFixed(2)}`;

  const vr = Number(item.vatRate);
  const pct =
    Number.isFinite(vr) && vr > 0
      ? Math.round(vr > 1 ? vr : vr * 100)
      : null;

  const taxText = pct ? `(${taxLabel} ${pct}%)` : "";

  return `
    <div class="fixed-item-row">
      <span class="fixed-item-label">${item.evidence}</span>

      <span class="fixed-item-right">
        <span class="fixed-item-amt">${amount}</span>
        <span class="fixed-item-vat">${taxText || "&nbsp;"}</span>
      </span>
    </div>
  `;
}).join("");

detailsBox.innerHTML = `
  <div style="margin-bottom:4px; font-weight:600;">Scanned breakdown:</div>
  ${rows}
  <div class="fixed-items-note">Amounts include ${taxLabel} when applicable.</div>
`;


      detailsBox.style.display = "block";
    } else {
      detailsBox.style.display = "none";
      detailsBox.innerHTML = "";
    }
  }
  // --------------------------------

  expModal.style.display = "flex";
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

  // 👇 Only now, after saving a valid amount, decide which emoji is the "free" one
  if (!isPro) {
    freeActiveExpenseId = editingExpense.id;
  }

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
  roommates = roommates.map((name) => {
    if (isDefaultRoommateName(name)) {
      return `Roommate ${index++}`;
    }
    return name; // custom names (e.g. "Luna") stay untouched
  });
}


function ensureYouRoommate() {
  // If empty, always create the first visible card
  if (!Array.isArray(roommates) || roommates.length === 0) {
    roommates = ["Me"];
    return;
  }

  // If "You" is missing (old sessions), add it at the beginning
  const hasYou = roommates.some((n) => (n || "").trim().toLowerCase() === "me");
  if (!hasYou) roommates.unshift("Me");
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
    roommates.filter((n) => isDefaultRoommateName(n)).length + 1;

  roommates.push(`Roommate ${nextNum}`);
  renumberDefaultRoommates();
  renderRoommates();
};


  rmGrid.appendChild(add);

  roommates.forEach((rm, i) => {
    const card = document.createElement("div");
    card.className = "rm-card";
    card.textContent = rm;

    const isYou = (rm || "").trim().toLowerCase() === "me";
if (isYou) card.classList.add("rm-default");


    // rename (Pro only)
    card.onclick = () => {
      if (!isPro) {
        showUpgrade();
        return;
      }
      const newName = prompt("Rename roommate", rm);
      if (newName && newName.trim().length > 0) {
        roommates[i] = newName.trim();
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

/* ======================
   UPGRADE TOAST
====================== */

function showUpgrade() {
  upgradePopup.style.display = "block";
  setTimeout(() => {
    upgradePopup.style.display = "none";
  }, 1600);
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

  let billValue = 0;
  let expensesToSave = [];

  if (isPro) {
    billValue = expenses.reduce((acc, e) => acc + (e.total || 0), 0);
    if (!billValue || billValue <= 0) {
      alert("Add at least one expense total in Pro mode.");
      return;
    }
    expensesToSave = expenses;
  } else {
  // FREE MODE:
  // total comes from the expenses (but only ONE expense is allowed)
  billValue = expenses.reduce((acc, e) => acc + (e.total || 0), 0);
  const usedExpense = expenses.find(e => e.total > 0);

  if (!billValue || billValue <= 0 || !usedExpense) {
    alert("Add your bill amount using one of the icons.");
    return;
  }

  // Save a single expense, keeping its name and icon
  expensesToSave = [
    {
      id: usedExpense.id,
      name: usedExpense.name,
      icon: usedExpense.icon,
      total: billValue,
      fixed: usedExpense.fixed || 0
    }
  ];
}


  // Save in localStorage
  localStorage.setItem("splitroomMode", isPro ? "pro" : "free");
  localStorage.setItem("splitroomBill", String(billValue));
  localStorage.setItem("splitroomExpenses", JSON.stringify(expensesToSave));
  localStorage.setItem("splitroomRoommates", JSON.stringify(roommates));
  localStorage.setItem("splitroomStart", finalStart.toISOString());
  localStorage.setItem("splitroomEnd", finalEnd.toISOString());

  window.location.href = "step2.html";
};



/* ========= PWA INSTALL BUTTON ========= */

let deferredPrompt = null;
const installBtn = document.getElementById("installAppBtn");
const installHint = document.getElementById("installHint");

const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isInStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

 

// Hide right after installation (Android + Desktop)
window.addEventListener('appinstalled', () => {
  const btn = document.getElementById("installAppBtn");
  if (btn) btn.style.display = "none";
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


function parsePTDate_DDMMYYYY(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  return isNaN(d) ? null : d;
}



// Apply scanned bill data (from Step 1 PDF upload)

function applyScannedBill(extracted) {
  if (!extracted) return;

  // 1) TOTAL + FIXED → first usable expense
  // 1) TOTAL + FIXED → route to the correct emoji when possible
const type = String(extracted.utilityType || "").toLowerCase();

const preferredId =
  type === "water" ? "water" :
  type === "electricity" ? "electricity" :
  type === "gas" ? "gas" :
  null;

const target =
  (preferredId && expenses.find(e => e.id === preferredId)) ||
  expenses.find(e => e.total === 0) ||
  expenses[0];


  if (typeof extracted.totalAmount === "number") {
    target.total = extracted.totalAmount;
  }

  if (typeof extracted.fixedTotal === "number") {
    target.fixed = Math.min(
      extracted.fixedTotal,
      extracted.totalAmount || extracted.fixedTotal
    );

    if (Array.isArray(extracted.fixedItems)) {
    target.fixedItems = extracted.fixedItems;
  }

    
  }

  // Free mode lock
  if (!isPro) {
    freeActiveExpenseId = target.id;
  }

  // 2) BILL PERIOD
 if (extracted.periodStart && extracted.periodEnd) {
  const s = parsePTDate_DDMMYYYY(extracted.periodStart);
  const e = parsePTDate_DDMMYYYY(extracted.periodEnd);

  if (s instanceof Date && !isNaN(s.getTime()) && e instanceof Date && !isNaN(e.getTime())) {
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
}


  renderExpenses();
  updateTotalBillFromExpenses();
  renderPerExpensePeriods();
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
    const multiPdfBills = isPro && pdfFiles.length >= 2;

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
        uploadSub.textContent = `Pro: analyzing ${pdfFiles.length} PDFs (multiple bills)`;
      } else if (!pdfFiles.length && imageFiles.length > 1) {
        uploadSub.textContent = "Multiple screenshots selected (treated as 1 multi-page bill)";
      } else {
        uploadSub.textContent = "PDF recommended · or one/multiple screenshots";
      }
    }

    // Spinner should show on the "active" emoji in Free mode, otherwise default to electricity
    const scanningId = freeActiveExpenseId || "electricity";

    // UI ON (full page loading)
    setContinueEnabled(false);
    showFullLoading({
      theme: scanningId,
      expectedMs: 60000 * (multiPdfBills ? pdfFiles.length : 1),
    });

    // hide error text while working
    if (scanStatus) scanStatus.style.display = "none";

    // ------------------------------
    // Helper: analyze ONE bill
    // - pdfFile: single PDF bill
    // - screenshots: multiple images (pages) for ONE bill
    // ------------------------------
    const analyzeOneBill = async ({ pdfFile, screenshots }) => {
      // 0) Universal endpoint (works for PDFs + screenshots)
      try {
        const fd0 = new FormData();

        if (pdfFile) {
          fd0.append("file", pdfFile);
        } else {
          (screenshots || []).forEach((img) => fd0.append("files", img));
        }

        const res0 = await fetch(ANALYZE_ENDPOINT, { method: "POST", body: fd0 });
        const data0 = await res0.json().catch(() => ({}));

        if (res0.ok && data0 && data0.extracted) {
          applyScannedBill(data0.extracted);
          return;
        }
      } catch (e) {
        // continue to PDF-only fallbacks below (if it's a PDF)
      }

      // If we only had screenshots and the universal endpoint failed, stop here.
      if (!pdfFile) {
        throw new Error("Could not scan the screenshots. Try clearer images or a PDF.");
      }

      // 1) PDF-only fallback chain (keeps your old behavior)
      const fd = new FormData();
      fd.append("file", pdfFile);

      // 1A) Try fast PDF text extraction first
      const res = await fetch(SCAN_ENDPOINT, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data && data.extracted) {
        applyScannedBill(data.extracted);
        return;
      }

      // 1B) If backend says "needsOCR", run Azure DI automatically
      if (data && data.needsOCR) {
        const fd2 = new FormData();
        fd2.append("file", pdfFile);

        const res2 = await fetch(DI_ENDPOINT, { method: "POST", body: fd2 });
        const data2 = await res2.json().catch(() => ({}));

        if (res2.ok && data2 && data2.extracted) {
          applyScannedBill(data2.extracted);
          return;
        }

        // 1C) Last fallback: Tesseract
        const res3 = await fetch(OCR_ENDPOINT, { method: "POST", body: fd2 });
        const data3 = await res3.json().catch(() => ({}));

        if (res3.ok && data3 && data3.extracted) {
          applyScannedBill(data3.extracted);
          return;
        }

        throw new Error(data3.error || data2.error || "OCR failed.");
      }

      throw new Error(data.error || "Scan failed.");
    };

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
          await analyzeOneBill({ pdfFile: pdfFiles[i], screenshots: [] });
        }
      } else {
        // ------------------------------
        // Default: ONE bill
        // Priority:
        //  - If there is a PDF, use the first PDF and ignore images
        //  - Otherwise, treat ALL selected images as screenshots for ONE bill
        // ------------------------------
        const pdfFile = pdfFiles[0] || null;
        const screenshots = pdfFile ? [] : imageFiles;

        await analyzeOneBill({ pdfFile, screenshots });
      }
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


