/* ============================================================
   INDEX.JS — FREE + PRO MODES
============================================================ */

let isPro = false;

// DOM
const modeSwitch = document.getElementById("modeSwitch");
const totalSub = document.getElementById("totalSub");
const billTotalDisplay = document.getElementById("billTotalDisplay");
const resetBill = document.getElementById("resetBill");



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

  if (isPro) {
    document.body.classList.add("pro-mode");
    modeSwitch.textContent = "Pro mode";
    totalSub.textContent =
      "In Pro mode, you can use all expenses. The total is automatically calculated below.";
  } else {
    document.body.classList.remove("pro-mode");
    modeSwitch.textContent = "Free mode";
    totalSub.textContent =
      "In Free mode you can use only one expense per time. The total is still calculated from the expense you digit.";
  }

  updateTotalBillFromExpenses();
}



modeSwitch.onclick = () => {
  isPro = !isPro;
  applyModeUI();
};

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
    item.innerHTML = `
      ${exp.total > 0 ? '<div class="exp-reset">×</div>' : ''}
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

function openExpenseModal(exp) {
  editingExpense = exp;
  modalTitle.textContent = exp.name;
  expTotal.value = exp.total || "";
  expFixed.value = exp.fixed || "";
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

