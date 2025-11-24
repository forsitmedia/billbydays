/* ============================================================
   STEP 2 – FULL LOGIC (range, double-tap, colors, summary)
   ============================================================ */

// DOM – summary
const sumBill = document.getElementById("sumBill");
const sumDays = document.getElementById("sumDays");
const sumRmCount = document.getElementById("sumRmCount");
const sumPeriod = document.getElementById("sumPeriod");
const daysAwayText = document.getElementById("daysAwayText");

// DOM – roommate header + calendar
const rmDot = document.getElementById("rmDot");
const rmNameEl = document.getElementById("rmName");
const rmSubEl = document.getElementById("rmSub");

const monthLabel = document.getElementById("monthLabel");
const calendarGrid = document.getElementById("calendarGrid");

const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");
const nextBtn = document.getElementById("nextBtn");

// MODE (same key used in index & step3)
const mode = localStorage.getItem("splitroomMode") || "free";
// Show the pro-mode explanation text only in Pro mode
const proExplain = document.getElementById("proPeriodExplanation");
if (proExplain) {
  proExplain.style.display = (mode === "pro") ? "block" : "none";
}

const modePill = document.getElementById("modePill");

// DATA FROM STEP 1
const roommates = JSON.parse(
  localStorage.getItem("splitroomRoommates") || "[]"
);
const bill = localStorage.getItem("splitroomBill") || 0;

const start = new Date(localStorage.getItem("splitroomStart"));
const end = new Date(localStorage.getItem("splitroomEnd"));

// If opened directly without Step 1 data, go back
if (!roommates.length || isNaN(start) || isNaN(end)) {
  window.location.href = "index.html";
}

// Apply mode styling (just like step3)
if (mode === "pro") {
  document.body.classList.add("pro-mode");
  if (modePill) modePill.textContent = "Pro mode";
} else {
  if (modePill)
    modePill.textContent = "Free mode";
}

/* ============================================================
   SUMMARY SETUP
   ============================================================ */

sumBill.textContent = `€ ${bill}`;
sumRmCount.textContent = roommates.length;

const diff =
  Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
sumDays.textContent = `${diff} days`;

sumPeriod.textContent = `${start.toLocaleString("default", {
  month: "short",
})} ${start.getDate()} — ${end.toLocaleString("default", {
  month: "short",
})} ${end.getDate()}, ${end.getFullYear()}`;

// Colors per roommate
const colors = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#f97316", // orange
  "#14b8a6", // teal
  "#eab308", // yellow
];

// Selections: roommate -> Set of ISO strings (YYYY-MM-DD) = DAYS AWAY
let selections = {};
roommates.forEach((rm) => (selections[rm] = new Set()));

// State
let rmIndex = 0;
let currentMonth = start.getMonth();
let currentYear = start.getFullYear();
let pendingStart = null;

const dayNames = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/* ============================================================
   ROOMMATE HEADER
   ============================================================ */

function updateRoommateHeader() {
  const rm = roommates[rmIndex];
  rmNameEl.textContent = rm;
  rmSubEl.textContent = `Mark the days ${rm} was not at home.`;
  rmDot.style.background = colors[rmIndex % colors.length];

  nextBtn.textContent =
    rmIndex === roommates.length - 1 ? "Continue →" : "Next →";

  updateSummaryCount();
}

/* ============================================================
   CALENDAR RENDER
   ============================================================ */

function renderCalendar(year, month) {
  calendarGrid.innerHTML = "";

  monthLabel.textContent = new Date(year, month).toLocaleString(
    "default",
    {
      month: "long",
      year: "numeric",
    }
  );

  // Day labels
  dayNames.forEach((n) => {
    const lbl = document.createElement("div");
    lbl.className = "day-label";
    lbl.textContent = n;
    calendarGrid.appendChild(lbl);
  });

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const last = new Date(year, month + 1, 0);

  // Empty
  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("div");
    empty.className = "day-label";
    empty.style.opacity = 0;
    calendarGrid.appendChild(empty);
  }

  // Real days
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    const iso = toISO(date);

    const div = document.createElement("div");
    div.className = "day";
    div.textContent = d;

    // Only days INSIDE selected period are active
    const insidePeriod = date >= start && date <= end;

    if (!insidePeriod) {
      // greyed-out, not clickable
      div.style.opacity = 0.3;
      div.style.cursor = "default";
    } else {
      // Selected (away)
      if (selections[roommates[rmIndex]].has(iso)) {
        div.classList.add("selected");
        div.style.background = colors[rmIndex % colors.length];
        div.style.color = "white";
      }

      // Pending start indicator
      if (pendingStart && isSameDate(date, pendingStart)) {
        div.classList.add("start-hint");
      }

      attachDayLogic(div, date);
    }

    calendarGrid.appendChild(div);
  }

  updateSummaryCount();
}

/* ============================================================
   CLICK LOGIC – RANGE + DOUBLE TAP
   ============================================================ */

let clickTimeout = null;

function attachDayLogic(div, date) {
  div.onclick = () => {
    if (clickTimeout) {
      clearTimeout(clickTimeout);
      clickTimeout = null;
      toggleSingle(date); // double tap
    } else {
      clickTimeout = setTimeout(() => {
        clickTimeout = null;
        selectRange(date); // single tap
      }, 210);
    }
  };
}

function toggleSingle(date) {
  const iso = toISO(date);
  const set = selections[roommates[rmIndex]];

  if (set.has(iso)) set.delete(iso);
  else set.add(iso);

  renderCalendar(currentYear, currentMonth);
}

function selectRange(date) {
  if (!pendingStart) {
    pendingStart = date;
    renderCalendar(currentYear, currentMonth);
    return;
  }

  let s = pendingStart < date ? pendingStart : date;
  let e = pendingStart < date ? date : pendingStart;

  pendingStart = null;

  let cursor = new Date(s);
  const set = selections[roommates[rmIndex]];

  while (cursor <= e) {
    set.add(toISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  renderCalendar(currentYear, currentMonth);
}

/* ============================================================
   HELPERS
   ============================================================ */

function toISO(date) {
  return date.toISOString().split("T")[0];
}

function isSameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* ============================================================
   SUMMARY UPDATE
   ============================================================ */

function updateSummaryCount() {
  const rm = roommates[rmIndex];
  const count = selections[rm].size;
  daysAwayText.textContent = `${count} day${
    count !== 1 ? "s" : ""
  } marked as away for ${rm}`;
}

/* ============================================================
   MONTH NAVIGATION (clamped to period)
   ============================================================ */

prevMonthBtn.onclick = () => {
  const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const startMonth = new Date(
    start.getFullYear(),
    start.getMonth(),
    1
  );
  if (prevMonthDate < startMonth) return; // don't go before start period

  if (currentMonth === 0) {
    currentMonth = 11;
    currentYear--;
  } else currentMonth--;

  renderCalendar(currentYear, currentMonth);
};

nextMonthBtn.onclick = () => {
  const nextMonthDate = new Date(currentYear, currentMonth + 1, 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  if (nextMonthDate > endMonth) return; // don't go past end period

  if (currentMonth === 11) {
    currentMonth = 0;
    currentYear++;
  } else currentMonth++;

  renderCalendar(currentYear, currentMonth);
};

/* ============================================================
   NEXT / CONTINUE – SAVE IN OLD FORMAT
   ============================================================ */

nextBtn.onclick = () => {
  if (rmIndex < roommates.length - 1) {
    rmIndex++;
    pendingStart = null;

    // 👇 Reset calendar view to the start of the selected period
    currentMonth = start.getMonth();
    currentYear  = start.getFullYear();

    updateRoommateHeader();
    renderCalendar(currentYear, currentMonth);
    return;
  }

  // Convert selections (Sets) into array-of-arrays (one per roommate)
  const absencesArray = roommates.map((rm) =>
    Array.from(selections[rm]) // list of YYYY-MM-DD strings (days AWAY)
  );

  localStorage.setItem(
    "splitroomAbsences",
    JSON.stringify(absencesArray)
  );

  window.location.href = "step3.html";
};


/* ============================================================
   INIT
   ============================================================ */

updateRoommateHeader();
renderCalendar(currentYear, currentMonth);
