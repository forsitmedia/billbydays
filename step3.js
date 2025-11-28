/* ========= LOAD DATA FROM PREVIOUS STEPS ========= */

let roommates = [];
let absencesRaw = [];
let billAmount = 0;
let startDate = null;
let endDate = null;
let expenses = [];
let mode = "free";

try {
  roommates = JSON.parse(localStorage.getItem("splitroomRoommates") || "[]");
  absencesRaw = JSON.parse(localStorage.getItem("splitroomAbsences") || "[]");
  billAmount = parseFloat(localStorage.getItem("splitroomBill") || "0");
  expenses = JSON.parse(localStorage.getItem("splitroomExpenses") || "[]");
  mode = localStorage.getItem("splitroomMode") || "free";

  const startISO = localStorage.getItem("splitroomStart");
  const endISO = localStorage.getItem("splitroomEnd");
  if (startISO && endISO) {
    startDate = new Date(startISO);
    endDate = new Date(endISO);
  }
} catch (e) {
  console.error("Error reading data", e);
}

if (!roommates.length || !startDate || !endDate) {
  window.location.href = "index.html";
}

// Simple Pro upgrade toast (same as index)
const upgradePopup = document.getElementById("upgradePopup");

function showUpgrade() {
  if (!upgradePopup) return;
  upgradePopup.style.display = "block";
  setTimeout(() => {
    upgradePopup.style.display = "none";
  }, 1600);
}




// Calendar month state (for Step 3 presence calendar)
let calYear = startDate.getFullYear();
let calMonth = startDate.getMonth();
const minYear = startDate.getFullYear();
const minMonth = startDate.getMonth();
const maxYear = endDate.getFullYear();
const maxMonth = endDate.getMonth();

/* ========= FIXED + VARIABLE TOTALS ========= */

let fixedTotal = 0;
let variableTotal = 0;

if (Array.isArray(expenses) && expenses.length) {
  expenses.forEach((exp) => {
    const total = Number(exp.total) || 0;
    const fixed = Math.min(total, Math.max(0, Number(exp.fixed) || 0));
    const variable = total - fixed;
    fixedTotal += fixed;
    variableTotal += variable;
  });
  billAmount = fixedTotal + variableTotal;
} else {
  fixedTotal = 0;
  variableTotal = billAmount;
}

/* ========= PRESENCE POINTS ========= */

function dayKey(d) {
  return d.toISOString().split("T")[0];
}

const msPerDay = 1000 * 60 * 60 * 24;
const totalDays = Math.floor((endDate - startDate) / msPerDay) + 1;

const absences = roommates.map((_, i) => {
  const list = Array.isArray(absencesRaw[i]) ? absencesRaw[i] : [];
  return new Set(list);
});

const points = new Array(roommates.length).fill(0);
const daysPresent = new Array(roommates.length).fill(0);
const daysAway = new Array(roommates.length).fill(0);

let d = new Date(startDate);

while (d <= endDate) {
  const key = dayKey(d);

  const presentFlags = roommates.map((_, i) =>
    absences[i].has(key) ? 0 : 1
  );
  const presentCount = presentFlags.reduce((a, b) => a + b, 0);

  if (presentCount > 0) {
    const per = 1 / presentCount;
    presentFlags.forEach((flag, i) => {
      if (flag === 1) {
        points[i] += per;
        daysPresent[i] += 1;
      } else {
        daysAway[i] += 1;
      }
    });
  } else {
    const perAll = 1 / roommates.length;
    roommates.forEach((_, i) => {
      points[i] += perAll;
      daysAway[i] += 1;
    });
  }

  d.setDate(d.getDate() + 1);
}

const totalPoints = points.reduce((a, b) => a + b, 0);

/* ========= SPLIT VARIABLE + FIXED (SETUP) ========= */

// We will compute per-roommate variable + fixed AFTER
// we know how each individual expense is split.
let variableShares = new Array(roommates.length).fill(0);
let fixedShares = new Array(roommates.length).fill(0);
let totals = new Array(roommates.length).fill(0);

// Average fixed part per roommate (for explanations only)
const fixedPerRoommate = roommates.length ? fixedTotal / roommates.length : 0;


/* ========= PER-EXPENSE BREAKDOWN PER ROOMMATE ========= */

const perRoommateExpenses = roommates.map(() => []);

expenses.forEach((exp) => {
  const total = Number(exp.total) || 0;
  const fixed = Math.min(total, Math.max(0, Number(exp.fixed) || 0));
  const variable = total - fixed;

  if (!total) return;

  // 1) Determine this expense's own date range
  let expStart = exp.from ? new Date(exp.from) : startDate;
  let expEnd   = exp.to   ? new Date(exp.to)   : endDate;

  // Clamp inside the global presence range for safety
  if (expStart < startDate) expStart = new Date(startDate);
  if (expEnd   > endDate)   expEnd   = new Date(endDate);

  // 2) Compute presence points ONLY within this expense's period
  let localPoints = new Array(roommates.length).fill(0);
  let d = new Date(expStart);

  while (d <= expEnd) {
    const key = dayKey(d);

    const presentFlags = roommates.map((_, i) =>
      absences[i].has(key) ? 0 : 1
    );
    const presentCount = presentFlags.reduce((a, b) => a + b, 0);

    if (presentCount > 0) {
      const per = 1 / presentCount;
      presentFlags.forEach((flag, i) => {
        if (flag === 1) {
          localPoints[i] += per;
        }
      });
    } else {
      // Nobody home → share equally
      const perAll = 1 / roommates.length;
      roommates.forEach((_, i) => {
        localPoints[i] += perAll;
      });
    }

    d.setDate(d.getDate() + 1);
  }

  // 3) Use these local points to split THIS expense's variable part
  let varShares = new Array(roommates.length).fill(0);
  if (variable > 0) {
    const localTotalPoints = localPoints.reduce((a, b) => a + b, 0);
    if (localTotalPoints > 0) {
      varShares = localPoints.map((p) => variable * (p / localTotalPoints));
    } else {
      const eq = variable / roommates.length;
      varShares = varShares.map(() => eq);
    }
  }

  // 4) Fixed part of this expense is still split equally
  const fixedEach = roommates.length ? fixed / roommates.length : 0;

  roommates.forEach((_, i) => {
    perRoommateExpenses[i].push({
      id: exp.id,
      name: exp.name,
      icon: exp.icon || "",
      fixedShare: fixedEach,
      variableShare: varShares[i],
      totalShare: fixedEach + varShares[i],
      totalBill: total,
      fixed,
      variable,
      from: expStart.toISOString(),
      to: expEnd.toISOString(),
    });
  });
});

// After all expenses are processed, aggregate totals per roommate
for (let i = 0; i < roommates.length; i++) {
  let v = 0;
  let f = 0;
  perRoommateExpenses[i].forEach((entry) => {
    v += entry.variableShare;
    f += entry.fixedShare;
  });
  variableShares[i] = v;
  fixedShares[i] = f;
  totals[i] = v + f;
}



/* ========= SUMMARY TOP ========= */

const sumBillEl = document.getElementById("sumBill");
const summaryRoommatesEl = document.getElementById("summaryRoommates");
const summaryDaysEl = document.getElementById("summaryDays");
const summaryPeriodEl = document.getElementById("summaryPeriod");
const modePill = document.getElementById("modePill");

sumBillEl.textContent = "€" + billAmount.toFixed(2);
summaryRoommatesEl.textContent = roommates.length.toString();
summaryDaysEl.textContent = `${totalDays} day${totalDays !== 1 ? "s" : ""}`;
summaryPeriodEl.textContent =
  startDate.toLocaleDateString() + " → " + endDate.toLocaleDateString();

if (mode === "pro") {
  document.body.classList.add("pro-mode");
  modePill.textContent = "Pro mode";
}  else {
  document.body.classList.remove("pro-mode");
  if (modePill) modePill.textContent = "Free mode";
}

/* ========= ROOMMATE CARDS ========= */

const cardsGrid = document.getElementById("cardsGrid");
const palette = [
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#f97316",
  "#14b8a6",
  "#eab308",
];

roommates.forEach((name, i) => {
  const card = document.createElement("div");
  card.className = "person-card";

  const nameRow = document.createElement("div");
  nameRow.className = "person-name-row";

  const dot = document.createElement("div");
  dot.className = "person-dot";
  dot.style.background = palette[i % palette.length];
  

  const nameSpan = document.createElement("span");
  nameSpan.textContent = name || `Roommate ${i + 1}`;

  nameRow.appendChild(dot);
  nameRow.appendChild(nameSpan);

  const amountEl = document.createElement("div");
  amountEl.className = "person-amount";
  amountEl.textContent = "€" + totals[i].toFixed(2);

  const percEl = document.createElement("div");
  percEl.className = "person-perc";
  const perc = billAmount > 0 ? (totals[i] / billAmount) * 100 : 0;
  percEl.textContent = `${perc.toFixed(1)}% of bill`;

  const subline = document.createElement("div");
  subline.className = "person-subline";
  subline.textContent =
  `${daysPresent[i]} days at home · ${daysAway[i]} days away · ` +
  `${points[i].toFixed(2)} / ${totalDays} presence points`;


  card.appendChild(nameRow);
  card.appendChild(amountEl);
  card.appendChild(percEl);
  card.appendChild(subline);

  card.addEventListener("click", () => {
    openRoommateModal(i);
  });

  cardsGrid.appendChild(card);
});

/* ========= ROOMMATE MODAL ========= */

const rmOverlay = document.getElementById("rmOverlay");
const rmModalDot = document.getElementById("rmModalDot");
const rmModalTitle = document.getElementById("rmModalTitle");
const rmModalTotal = document.getElementById("rmModalTotal");
const rmModalSub = document.getElementById("rmModalSub");
const rmModalShare = document.getElementById("rmModalShare");

const rmModalFixed = document.getElementById("rmModalFixed");
const rmModalVariable = document.getElementById("rmModalVariable");
const rmModalPoints = document.getElementById("rmModalPoints");
const rmModalDays = document.getElementById("rmModalDays");
const rmModalExpenses = document.getElementById("rmModalExpenses");
const rmModalClose = document.getElementById("rmModalClose");

function openRoommateModal(index) {
  const name = roommates[index] || `Roommate ${index + 1}`;
  const total = totals[index];
  const varShare = variableShares[index];
  const fixedShare = fixedShares[index] || 0;
  

  const pts = points[index];
  const daysHome = daysPresent[index];

  rmModalDot.style.background = palette[index % palette.length];
  rmModalTitle.textContent = name;
  rmModalTotal.textContent = "€" + total.toFixed(2);
  rmModalSub.textContent =
    `This amount combines an equal share of the fixed part ` +
    `and a variable part based on the days ${name} was actually at home.`;

  const percOfBill = billAmount > 0 ? (total / billAmount) * 100 : 0;
rmModalShare.textContent = `${percOfBill.toFixed(1)}%`;

  rmModalFixed.textContent = "€" + fixedShare.toFixed(2);
  rmModalVariable.textContent = "€" + varShare.toFixed(2);
  rmModalPoints.textContent = `${pts.toFixed(2)} / ${totalDays}`;
  rmModalDays.textContent = `${daysHome} day${daysHome !== 1 ? "s" : ""}`;

  const list = perRoommateExpenses[index];
  rmModalExpenses.innerHTML = "";

  if (!list.length) {
    rmModalExpenses.textContent =
      "No expenses registered for this roommate.";
  } else {
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "rm-modal-exp-row";

      const main = document.createElement("div");
      main.className = "rm-modal-exp-main";

      const left = document.createElement("div");
      left.className = "rm-modal-exp-left";

      const iconSpan = document.createElement("span");
      iconSpan.className = "rm-modal-exp-icon";
      iconSpan.textContent = item.icon || "•";

      const nameSpan = document.createElement("span");
      nameSpan.className = "rm-modal-exp-name";
      nameSpan.textContent = item.name;

      left.appendChild(iconSpan);
      left.appendChild(nameSpan);

      const totalSpan = document.createElement("span");
      totalSpan.className = "rm-modal-exp-amount";
      totalSpan.textContent = "€" + item.totalShare.toFixed(2);

      main.appendChild(left);
      main.appendChild(totalSpan);

      const detail = document.createElement("div");
      detail.className = "rm-modal-exp-detail";

      const percOfTotal =
  total > 0 ? (item.totalShare / total) * 100 : 0;

detail.textContent =
  `Fixed €${item.fixedShare.toFixed(
    2
  )} · Variable €${item.variableShare.toFixed(
    2
  )} (${percOfTotal.toFixed(1)}% of ${name}'s total bill).`;



      row.appendChild(main);
      row.appendChild(detail);

      rmModalExpenses.appendChild(row);
    });
  }

  rmOverlay.style.display = "flex";
}

rmModalClose.addEventListener("click", () => {
  rmOverlay.style.display = "none";
});

rmOverlay.addEventListener("click", (e) => {
  if (e.target === rmOverlay) {
    rmOverlay.style.display = "none";
  }
});

function buildShortRoommateLabels(names) {
  const initials = names.map((name) => {
    if (!name) return "?";
    const rmMatch = name.match(/roommate\s*(\d+)/i);
    if (rmMatch) {
      // "Roommate 1" → "R.1"
      return `R.${rmMatch[1]}`;
    }
    return name.trim()[0].toUpperCase(); // first letter
  });

  const counts = {};
  initials.forEach((i) => {
    counts[i] = (counts[i] || 0) + 1;
  });

  const duplicates = {};
  return initials.map((initial) => {
    if (counts[initial] === 1) return initial;
    const num = (duplicates[initial] || 0) + 1;
    duplicates[initial] = num;
    // "F" (Filippo + Francesca) → "F.1" / "F.2"
    return `${initial}.${num}`;
  });
}


/* ========= STATS ========= */

const statsCard = document.getElementById("statsCard");
const toggleStatsBtn = document.getElementById("toggleStatsBtn");

function renderStats() {
  const overallPerDay = billAmount / totalDays;
  let html = "";

  html += `<div class="stats-title">Cost per day</div>`;
  html += `<div class="stats-line">Whole flat: <strong>€${overallPerDay.toFixed(
    2
  )}</strong> per day</div>`;

  roommates.forEach((name, i) => {
    const perDay =
      daysPresent[i] > 0 ? totals[i] / daysPresent[i] : 0;
    html += `<div class="stats-line">${name}: <strong>€${perDay.toFixed(
      2
    )}</strong> per day at home</div>`;
  });

  html += `<div class="stats-note">
    The <strong>fixed part</strong> of the bill (€${fixedTotal.toFixed(
      2
    )}) is split equally between everyone.
    The <strong>variable part</strong> (€${variableTotal.toFixed(
      2
    )}) is split using presence points based on who was actually at home.
  </div>`;

  statsCard.innerHTML = html;
}

// Start with stats hidden (for both modes)
if (statsCard) {
  statsCard.style.display = "none";
} 

// Render stats only for PRO
if (mode === "pro") {
  renderStats();
}

// Button is ALWAYS visible; behavior depends on mode
if (toggleStatsBtn) {
  if (mode !== "pro") {
    // Optional: dim the button a bit for Free
    toggleStatsBtn.classList.add("pro-locked");
  }

  toggleStatsBtn.addEventListener("click", () => {
    if (mode !== "pro") {
      // FREE → show upgrade message instead of stats
      if (typeof showUpgrade === "function") {
        showUpgrade();
      } else {
        alert("This is a Pro feature.");
      }
      return;
    }

    // PRO → normal toggle
    const visible = statsCard.style.display === "block";
    statsCard.style.display = visible ? "none" : "block";
    toggleStatsBtn.textContent = visible ? "Show stats" : "Hide stats";
  });
}

/* ========= REPORT OVERLAY (PRO) ========= */

const openReportBtn = document.getElementById("exportReportBtn");
const reportOverlay = document.getElementById("reportOverlay");
const reportCloseBtn = document.getElementById("reportCloseBtn");
const reportMetaEl = document.getElementById("reportMeta");
const reportOverviewEl = document.getElementById("reportOverview");
const reportCompositionSection = document.getElementById("reportCompositionSection");
const reportCompositionList = document.getElementById("reportCompositionList");
const reportSplitEl = document.getElementById("reportSplit");
const reportCostSection  = document.getElementById("reportCostSection");
const reportCostContent  = document.getElementById("reportCostContent");
const reportPdfBtn = document.getElementById("reportPdfBtn");
const reportKpiSection    = document.getElementById("reportKpiSection");
const reportKpiCard       = document.getElementById("reportKpiCard");
const reportKpiUtilityEl  = document.getElementById("reportKpiUtility");
const reportKpiHouseholdEl= document.getElementById("reportKpiHousehold");
const reportKpiScoreText  = document.getElementById("reportKpiScoreText");
const reportKpiMainLine   = document.getElementById("reportKpiMainLine");
const reportKpiSubLine    = document.getElementById("reportKpiSubLine");
const reportKpiFooterYear = document.getElementById("reportKpiDataYear");

// Highlight card elements
const reportHighlightMetaEl = document.getElementById("reportHighlightMeta");
const reportHighlightLine1El = document.getElementById("reportHighlightLine1");
const reportHighlightLine2El = document.getElementById("reportHighlightLine2");

// Open button behaviour
if (openReportBtn) {
  if (mode !== "pro") {
    openReportBtn.classList.add("pro-locked");
    openReportBtn.addEventListener("click", () => {
      if (typeof showUpgrade === "function") {
        showUpgrade();
      } else {
        alert("This is a Pro feature.");
      }
    });
   } else {
    openReportBtn.addEventListener("click", () => {
      buildReportView();


function updateKpiGauge(score) {
  const needle = document.getElementById("kpiGaugeNeedle");
  if (!needle) return;

  const angle = -90 + (score / 100) * 180;
  needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;

  // update colour of progress bar
  const scale = document.querySelector(".kpi-gauge-scale");
  if (scale) {
    scale.style.setProperty("--kpi-score", score);
    scale.style.setProperty(
      "--kpi-color",
      score < 33 ? "#ef4444" : score < 67 ? "#facc15" : "#22c55e"
    );
  }
}



      renderPortugalKpiCard();          // ← add this line
      reportOverlay.style.display = "flex";

      setTimeout(renderReportCharts, 30);
    });
  }
}


// Close overlay
if (reportCloseBtn) {
  reportCloseBtn.addEventListener("click", () => {
    reportOverlay.style.display = "none";
  });
}
if (reportOverlay) {
  reportOverlay.addEventListener("click", (e) => {
    if (e.target === reportOverlay) {
      reportOverlay.style.display = "none";
    }
  });
}

/* ========= PORTUGAL UTILITY BENCHMARKS (simple version) ========= */

const UTILITY_BENCHMARKS = {
  PT: {
    data_year: 2024,
    sources: "ERSE, ERSAR, INE (Portugal)",
    electricity: {
      1: { avgMonthlyConsumption: 150, avgMonthlyCost: 35 },
      2: { avgMonthlyConsumption: 250, avgMonthlyCost: 55 },
      3: { avgMonthlyConsumption: 350, avgMonthlyCost: 75 },
      4: { avgMonthlyConsumption: 450, avgMonthlyCost: 95 }
    },
    water: {
      1: { avgMonthlyConsumption: 4, avgMonthlyCost: 15 },
      2: { avgMonthlyConsumption: 6, avgMonthlyCost: 22 },
      3: { avgMonthlyConsumption: 8, avgMonthlyCost: 28 },
      4: { avgMonthlyConsumption: 10, avgMonthlyCost: 35 }
    },
    gas: {
      1: { avgMonthlyConsumption: 250, avgMonthlyCost: 30 },
      2: { avgMonthlyConsumption: 450, avgMonthlyCost: 50 },
      3: { avgMonthlyConsumption: 650, avgMonthlyCost: 70 },
      4: { avgMonthlyConsumption: 850, avgMonthlyCost: 90 }
    }
  }
};

function getBenchmark(countryCode, utilityType, householdSize) {
  const country = UTILITY_BENCHMARKS[countryCode];
  if (!country) return null;

  const util = country[utilityType];
  if (!util) return null;

  const size = householdSize >= 4 ? 4 : householdSize;
  return {
    ...util[size],
    data_year: country.data_year,
    sources: country.sources
  };
}

// --- classify an expense into a utility type based on icon/name ---
function classifyUtility(exp) {
  const name = (exp.name || "").toLowerCase();
  const icon = exp.icon || "";

  if (icon.includes("⚡") || name.includes("elec")) return "electricity";
  if (icon.includes("💧") || icon.includes("🚰") || name.includes("water")) return "water";
  if (icon.includes("🔥") || name.includes("gas")) return "gas";

  return null; // something else like "Internet", "Condo fees", etc.
}

// --- compute combined PT benchmarks for the utilities actually present ---
function computePortugalUtilitySummary() {
  const countryCode = "PT";
  const country = UTILITY_BENCHMARKS[countryCode];
  if (!country) return null;

  // 1) Aggregate bill by utility type
  const activeExpenses = Array.isArray(expenses)
    ? expenses.filter((exp) => (Number(exp.total) || 0) > 0)
    : [];

  const utilityTotals = { electricity: 0, water: 0, gas: 0 };

  activeExpenses.forEach((exp) => {
    const type = classifyUtility(exp);
    if (!type) return; // skip non-utility expenses
    const total = Number(exp.total) || 0;
    utilityTotals[type] += total;
  });

  const typesPresent = Object.keys(utilityTotals).filter(
    (t) => utilityTotals[t] > 0
  );
  if (!typesPresent.length) return null;

  // 2) Normalise your bill to a 30-day "month"
  const daysInPeriod = totalDays || 30;
  const toMonthlyFactor = 30 / daysInPeriod;

  const householdSize = Math.max(1, roommates.length || 1);

  let userMonthlyTotal = 0;
  let benchMonthlyTotal = 0;
  const breakdown = [];

  typesPresent.forEach((type) => {
    const userMonthly = utilityTotals[type] * toMonthlyFactor;
    const bench = getBenchmark(countryCode, type, householdSize);
    if (!bench) return;

    userMonthlyTotal += userMonthly;
    benchMonthlyTotal += bench.avgMonthlyCost;

    const diffPct =
      bench.avgMonthlyCost > 0
        ? ((userMonthly - bench.avgMonthlyCost) / bench.avgMonthlyCost) * 100
        : 0;

    breakdown.push({
      type,
      userMonthly,
      benchMonthly: bench.avgMonthlyCost,
      diffPct,
    });
  });

  if (!userMonthlyTotal || !benchMonthlyTotal) return null;

  return {
    countryCode,
    typesPresent,
    userMonthlyTotal,
    benchMonthlyTotal,
    breakdown,
    householdSize,
    data_year: country.data_year,
    sources: country.sources,
  };
}

// Nice label: ["electricity","water"] → "Electricity + Water"
function labelForUtilityTypes(types) {
  const pretty = types.map((t) => {
    if (t === "electricity") return "Electricity";
    if (t === "water") return "Water";
    if (t === "gas") return "Gas";
    return t;
  });
  return pretty.join(" + ");
}


// 50 = around national average
// >50 = better/cheaper than average
// <50 = worse/more expensive than average
function computeEfficiencyScore(userMonthly, benchMonthly) {
  const user = Number(userMonthly) || 0;
  const bench = Number(benchMonthly) || 0;

  if (!bench) return 50;

  const ratio = user / bench;
  let score;

  if (ratio >= 1) {
    // Worse than average → 0–50 range
    score = 50 - (ratio - 1) * 35;
  } else {
    // Better than average → 50–100 range
    const improvement = 1 - ratio;
    score = 50 + improvement * 80;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return score;
}



function buildReportView() {
  const periodStr =
    `${startDate.toLocaleDateString()} → ${endDate.toLocaleDateString()}`;

  // Top meta under title
  reportMetaEl.textContent =
    `${periodStr} · ${totalDays} day${totalDays !== 1 ? "s" : ""} · ` +
    `€${billAmount.toFixed(2)} total`;

      // ===== Highlight meta + copy (fixed vs variable) =====
  const fixedPerc =
    billAmount > 0 ? (fixedTotal / billAmount) * 100 : 0;
  const variablePerc =
    billAmount > 0 ? (variableTotal / billAmount) * 100 : 0;

  if (reportHighlightMetaEl) {
    reportHighlightMetaEl.textContent =
      `${totalDays} day${totalDays !== 1 ? "s" : ""} · ` +
      `€${billAmount.toFixed(2)} total`;
  }

  if (reportHighlightLine1El) {
    reportHighlightLine1El.innerHTML =
      `<strong>${variablePerc.toFixed(0)}%</strong> of your bill ` +
      `is <strong>variable</strong> (€${variableTotal.toFixed(2)}).`;
  }

  if (reportHighlightLine2El) {
    reportHighlightLine2El.innerHTML =
      `You would still pay <strong>€${fixedTotal.toFixed(
        2
      )}</strong> in <strong>fixed</strong> costs, even with zero usage.`;
  }

    // Overview section (only if the element exists)
  if (reportOverviewEl) {
    reportOverviewEl.innerHTML = `
      <div class="report-kv-row"><span><strong>Period</strong></span><span>${periodStr}</span></div>
      <div class="report-kv-row"><span><strong>Total bill</strong></span><span>€${billAmount.toFixed(2)}</span></div>
      <div class="report-kv-row"><span><strong>Total days</strong></span><span>${totalDays}</span></div>
      <div class="report-kv-row"><span><strong>Roommates</strong></span><span>${roommates.join(", ")}</span></div>
      <div class="report-kv-row"><span><strong>Variable part</strong></span><span>€${variableTotal.toFixed(2)}</span></div>
      <div class="report-kv-row"><span><strong>Fixed part</strong></span><span>€${fixedTotal.toFixed(2)}</span></div>
    `;
  }

    // ===== Cost per day section =====
  if (reportCostSection && reportCostContent) {
    const overallPerDay = totalDays > 0 ? billAmount / totalDays : 0;
    const perDayValues = roommates.map((_, i) =>
      daysPresent[i] > 0 ? totals[i] / daysPresent[i] : 0
    );
    const shortLabels = buildShortRoommateLabels(roommates);

    reportCostContent.innerHTML = `
      <div class="stats-flat-card">
        <div>
          <div class="stats-flat-label">Whole flat</div>
          <div class="stats-flat-value">
            €${overallPerDay.toFixed(2)}
            <span class="stats-flat-unit">/day</span>
          </div>
        </div>
      </div>

      <div class="stats-chart-wrapper">
        <canvas id="reportCostPerDayChart"></canvas>
      </div>

      <div class="stats-legend-title">Per roommate</div>
      <div class="stats-legend-grid">
        ${roommates
          .map((name, i) => {
            const value = perDayValues[i];
            return `
              <div class="stats-legend-item">
                <span class="stats-legend-label">${shortLabels[i]}</span>
                <span class="stats-legend-name">${name}</span>
                <span class="stats-legend-value">€${value.toFixed(2)}/day</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    // store for the chart function
    window.__reportCostPerDayValues = perDayValues;
    window.__reportShortLabels = shortLabels;
  }


    // ===== KPI vs Portugal (simple electricity example) =====
    // ===== KPI vs Portugal (combined utilities that are actually in the bill) =====
  if (reportKpiSection && reportKpiCard) {
    const summary = computePortugalUtilitySummary();

    if (!summary) {
      reportKpiSection.style.display = "none";
    } else {
      reportKpiSection.style.display = "block";

      const {
        typesPresent,
        userMonthlyTotal,
        benchMonthlyTotal,
        householdSize,
        data_year,
      } = summary;

      // Use cost-only efficiency: 50 = same as average
      const score = computeEfficiencyScore(
        userMonthlyTotal,
        benchMonthlyTotal,
        userMonthlyTotal,
        benchMonthlyTotal
      );

      window.__reportKpiScore = score;
      updateKpiGauge(score);

      const utilitiesLabel = labelForUtilityTypes(typesPresent);

      if (reportKpiUtilityEl) {
        reportKpiUtilityEl.textContent = `${utilitiesLabel} · Portugal`;
      }

      if (reportKpiHouseholdEl) {
        const hhLabel =
          householdSize >= 4
            ? "4+ person household"
            : `${householdSize}-person household`;
        reportKpiHouseholdEl.textContent = hhLabel;
      }

      if (reportKpiScoreText) {
        reportKpiScoreText.textContent = Math.round(score);
      }

      if (reportKpiMainLine) {
        reportKpiMainLine.textContent = `Your estimated monthly cost for these utilities is €${userMonthlyTotal.toFixed(
          2
        )} vs Portuguese average €${benchMonthlyTotal.toFixed(2)}.`;
      }

      const diffPct =
        benchMonthlyTotal > 0
          ? ((userMonthlyTotal - benchMonthlyTotal) / benchMonthlyTotal) * 100
          : 0;
      const aboveBelow =
        diffPct > 0 ? "above" : diffPct < 0 ? "below" : "in line with";

      // NEW #1 – appears only if there is more than one utility
      if (reportKpiSubLine) {
        const hhLabel =
          householdSize >= 4
            ? "4+ person household"
            : `${householdSize}-person household`;

        if (typesPresent.length > 1) {
          // multi-utility extra info
          const perPersonUser = userMonthlyTotal / householdSize;
          const perPersonBench = benchMonthlyTotal / householdSize;

          reportKpiSubLine.textContent =
            `You are ${Math.abs(diffPct).toFixed(
              1
            )}% ${aboveBelow} the average for a ${hhLabel}. ` +
            `Per person: you ~€${perPersonUser.toFixed(
              2
            )}/month vs PT ~€${perPersonBench.toFixed(2)}/month.`;
        } else {
          // single utility – keep it simple
          reportKpiSubLine.textContent =
            `You are ${Math.abs(diffPct).toFixed(
              1
            )}% ${aboveBelow} the average for a ${hhLabel}.`;
        }
      }

      if (reportKpiFooterYear && data_year) {
        reportKpiFooterYear.textContent = data_year;
      }
    }
  }




    // Bill composition section (only if we have detailed expenses > 0)
  const activeExpenses = Array.isArray(expenses)
    ? expenses.filter((exp) => (Number(exp.total) || 0) > 0)
    : [];

  if (!activeExpenses.length) {
    // Nothing real to show → hide section
    if (reportCompositionSection) {
      reportCompositionSection.style.display = "none";
    }
  } else {
    if (reportCompositionSection) {
      reportCompositionSection.style.display = "block";
    }
    reportCompositionList.innerHTML = "";

    activeExpenses.forEach((exp) => {
      const icon = exp.icon || "•";
      const total = Number(exp.total) || 0;
      const fixed = Math.min(total, Math.max(0, Number(exp.fixed) || 0));
      const variable = total - fixed;

      // Period for this specific expense (can be different from global period)
      let expStart = exp.from ? new Date(exp.from) : startDate;
      let expEnd   = exp.to   ? new Date(exp.to)   : endDate;

      // Clamp inside overall period, just to be safe
      if (expStart < startDate) expStart = new Date(startDate);
      if (expEnd   > endDate)   expEnd   = new Date(endDate);

      const periodLabel =
        expStart.toLocaleDateString() + " → " + expEnd.toLocaleDateString();

      const card = document.createElement("div");
      card.className = "report-comp-card";

      card.innerHTML = `
        <div class="report-comp-header">
          <div class="report-comp-icon">${icon}</div>
          <div class="report-comp-name">${exp.name}</div>
        </div>
        <div class="report-comp-total">€${total.toFixed(2)}</div>
        <div class="report-comp-meta">
          Fixed €${fixed.toFixed(2)} · Variable €${variable.toFixed(2)}
        </div>
        <div class="report-comp-period">${periodLabel}</div>
      `;

      reportCompositionList.appendChild(card);
    });
  }



  // Split by roommate section
  reportSplitEl.innerHTML = roommates
    .map((name, i) => {
      const perc = billAmount > 0 ? (totals[i] / billAmount) * 100 : 0;
      return `
      <div class="report-roommate-card">
        <div class="report-roommate-top">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="
              width:8px;height:8px;border-radius:999px;
              background:${palette[i % palette.length]};
              display:inline-block;"></span>
            <span>${name}</span>
          </div>
          <div><strong>€${totals[i].toFixed(2)}</strong></div>
        </div>
        <div class="report-roommate-meta">
          ${perc.toFixed(1)}% of bill ·
          ${points[i].toFixed(2)} / ${totalPoints.toFixed(2)} presence pts ·
          ${daysPresent[i]} days at home · ${daysAway[i]} away
        </div>
      </div>`;
    })
    .join("");

    
}
// ===== PORTUGAL KPI CARD (UTILITY KPI TILE + COST TILE) =====
// ===== PORTUGAL KPI CARD (UTILITY KPI TILE + COST TILE) =====
// ===== PORTUGAL KPI CARD (UTILITY KPI TILE + COST TILE) =====
function renderPortugalKpiCard() {
  const tile          = document.getElementById("kpiGaugeTile");
  const scoreValueEl  = document.getElementById("kpiScoreValue");
  const householdEl   = document.getElementById("kpiHouseholdLabel");
  const needleEl      = document.getElementById("kpiGaugeNeedle");
  const yourCostEl    = document.getElementById("kpiYourCost");
  const avgCostEl     = document.getElementById("kpiAvgCost");
  const diffSummaryEl = document.getElementById("kpiDiffSummary");
  const dataYearEl    = document.getElementById("kpiDataYear");

  if (!tile || !needleEl) return;

  const summary = computePortugalUtilitySummary();
  if (!summary) {
    const section = document.getElementById("portugalKpiSection");
    if (section) section.style.display = "none";
    return;
  }

  const {
    typesPresent,
    userMonthlyTotal,
    benchMonthlyTotal,
    householdSize,
    data_year,
  } = summary;

  const score = computeEfficiencyScore(
    userMonthlyTotal,
    benchMonthlyTotal,
    userMonthlyTotal,
    benchMonthlyTotal
  );
  const clamped = Math.max(0, Math.min(100, score));

  const label = labelForUtilityTypes(typesPresent);

  // score pill
  if (scoreValueEl) scoreValueEl.textContent = clamped.toFixed(0);

  // household label
  if (householdEl) {
    const hhLabel =
      householdSize >= 4
        ? "4+ person household"
        : `${householdSize}-person household`;
    householdEl.textContent = `${label} · ${hhLabel}`;
  }

  // needle position: -90° = 0, +90° = 100
  const angle = -90 + (clamped / 100) * 180;
  needleEl.style.transform = `translateX(-50%) rotate(${angle}deg)`;

  // colour state
  let level = "avg";
  if (clamped < 34) level = "bad";
  else if (clamped > 67) level = "good";
  tile.dataset.level = level;

  // NEW: cost comparison (combined utilities)
  if (yourCostEl)
    yourCostEl.textContent = `€${userMonthlyTotal.toFixed(2)}`;
  if (avgCostEl)
    avgCostEl.textContent = `€${benchMonthlyTotal.toFixed(2)}`;

  const diffPct =
    benchMonthlyTotal > 0
      ? ((userMonthlyTotal - benchMonthlyTotal) / benchMonthlyTotal) * 100
      : 0;

  if (diffSummaryEl) {
    const hhLabel =
      householdSize >= 4 ? "4+ person" : `${householdSize}-person`;
    const dir = diffPct > 0 ? "above" : diffPct < 0 ? "below" : "in line with";
    const absDiff = Math.abs(diffPct).toFixed(1);
    const perPersonUser = userMonthlyTotal / householdSize;
    const perPersonBench = benchMonthlyTotal / householdSize;

    if (typesPresent.length > 1) {
      // NEW #2 – extra detail only for multi-utility bills
      diffSummaryEl.textContent =
        `You pay €${userMonthlyTotal.toFixed(
          2
        )}/month for these utilities (~€${perPersonUser.toFixed(
          2
        )} per person). ` +
        `A typical ${hhLabel} Portuguese home would pay about €${benchMonthlyTotal.toFixed(
          2
        )}/month (~€${perPersonBench.toFixed(
          2
        )} per person), ` +
        `so you are ${absDiff}% ${dir} the average.`;
    } else {
      diffSummaryEl.textContent =
        `You are ${absDiff}% ${dir} the Portuguese average for a ${hhLabel} household.`;
    }
  }

  if (dataYearEl && data_year) {
    dataYearEl.textContent = data_year;
  }
}

// ========= REPORT CHARTS =========
let fvChartInstance = null;
let billChartInstance = null;
let pointsChartInstance = null;
let compositionChartInstance = null;
let reportCostChartInstance = null;
let kpiGaugeInstance = null;



function renderReportCharts() {
  if (typeof Chart === "undefined") return;

  const fixedVarCanvas   = document.getElementById("reportFixedVarChart");
  const compositionCanvas = document.getElementById("billCompositionChart");
  const billCanvas        = document.getElementById("reportBillChart");
  const ptsCanvas         = document.getElementById("reportPointsChart");
   const costCanvas        = document.getElementById("reportCostPerDayChart"); // NEW
   const kpiCanvas         = document.getElementById("reportKpiGauge");

  // Destroy old charts if overlay opened before
  if (fvChartInstance) fvChartInstance.destroy();
  if (compositionChartInstance) compositionChartInstance.destroy();
  if (billChartInstance) billChartInstance.destroy();
  if (pointsChartInstance) pointsChartInstance.destroy();
  if (reportCostChartInstance) reportCostChartInstance.destroy(); // NEW

  const baseOptions = {
    responsive: false,
    maintainAspectRatio: false,
    cutout: "70%",
    plugins: {
      legend: { display: false }
    }
  };

  // Plugin for center % text in the fixed/variable ring
  const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart) {
      if (!fixedVarCanvas || chart.canvas !== fixedVarCanvas) return;

      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data.length) return;

      const { x, y } = meta.data[0];
      const variablePct =
        billAmount > 0 ? Math.round((variableTotal / billAmount) * 100) : 0;

      ctx.save();
      ctx.font =
        "600 20px -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#111827";
      ctx.fillText(variablePct + "%", x, y);
      ctx.restore();
    }
  };

  // 1) Fixed vs variable ring (highlight card)
  if (fixedVarCanvas) {
    fixedVarCanvas.width = 180;
    fixedVarCanvas.height = 180;

    fvChartInstance = new Chart(fixedVarCanvas, {
      type: "doughnut",
      data: {
        labels: ["Variable", "Fixed"],
        datasets: [
          {
            data: [variableTotal, fixedTotal],
            backgroundColor: ["#6366f1", "#e5e7eb"],
            borderWidth: 0
          }
        ]
      },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          centerText: true
        }
      },
      plugins: [centerTextPlugin]
    });
  }

  // Active expenses = only those really used (total > 0)
  const activeExpenses = Array.isArray(expenses)
    ? expenses.filter((exp) => (Number(exp.total) || 0) > 0)
    : [];

  // 2) Composition donut (share of total bill)
  if (compositionCanvas && activeExpenses.length) {
    compositionCanvas.width = 180;
    compositionCanvas.height = 180;

    const compLabels = activeExpenses.map((exp) =>
      exp.icon ? `${exp.icon} ${exp.name}` : exp.name
    );
    const compValues = activeExpenses.map(
      (exp) => Number(exp.total) || 0
    );
    const compColors = activeExpenses.map(
      (_, i) => palette[i % palette.length]
    );

    compositionChartInstance = new Chart(compositionCanvas, {
      type: "doughnut",
      data: {
        labels: compLabels,
        datasets: [
          {
            data: compValues,
            backgroundColor: compColors,
            borderWidth: 0
          }
        ]
      },
      options: baseOptions
    });
  }

  // 3) Bill split by roommate
  if (billCanvas) {
    billCanvas.width = 180;
    billCanvas.height = 180;

    const labels = roommates.map((name, i) => name || `Roommate ${i + 1}`);
    const colors = roommates.map((_, i) => palette[i % palette.length]);

    billChartInstance = new Chart(billCanvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: totals,
            backgroundColor: colors,
            borderWidth: 0
          }
        ]
      },
      options: baseOptions
    });
  }

  // 4) Presence points share
  if (ptsCanvas) {
    ptsCanvas.width = 180;
    ptsCanvas.height = 180;

    const labels = roommates.map((name, i) => name || `Roommate ${i + 1}`);
    const colors = roommates.map((_, i) => palette[i % palette.length]);

    pointsChartInstance = new Chart(ptsCanvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: points,
            backgroundColor: colors,
            borderWidth: 0
          }
        ]
      },
      options: baseOptions
    });
  }
  // 5) Cost per day bar chart (inside report)
  if (costCanvas && window.__reportCostPerDayValues && window.__reportShortLabels) {
    costCanvas.width = 180;
    costCanvas.height = 160; // matches .stats-chart-wrapper height

    const ctx = costCanvas.getContext("2d");
    const perDayValues = window.__reportCostPerDayValues;
    const shortLabels  = window.__reportShortLabels;

    const gradient = ctx.createLinearGradient(0, costCanvas.height, 0, 0);
    gradient.addColorStop(0, "#f97373"); // bottom
    gradient.addColorStop(1, "#6366f1"); // top

    // one color per roommate, softer (80% opacity)
const barColors = roommates.map((_, i) => {
  const hex = palette[i % palette.length]; // e.g. "#ef4444"
  return hex + "CC"; // adds alpha channel → #RRGGBBCC (≈ 80% opacity)
});

reportCostChartInstance = new Chart(ctx, {
  type: "bar",
  data: {
    labels: shortLabels,
    datasets: [
      {
        data: perDayValues.map((v) => Number(v.toFixed(2))),
        backgroundColor: barColors,   // <— instead of single gradient
        borderRadius: 10,
        borderWidth: 0
      }
    ]
  },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const idx = context.dataIndex;
                const name = roommates[idx] || "";
                const value = perDayValues[idx];
                return `${name}: €${value.toFixed(2)}/day`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 10 }
            }
          },
          y: {
            grid: { color: "rgba(148, 163, 184, 0.20)" },
            ticks: {
              callback: (value) => "€" + value
            }
          }
        }
      }
    });
  }
    // 5) KPI gauge (0–100) vs Portugal  — with needle + 3 coloured zones
  if (kpiCanvas && typeof window.__reportKpiScore === "number") {
    const ctx = kpiCanvas.getContext("2d");
    const score = Math.max(0, Math.min(100, window.__reportKpiScore));

    kpiCanvas.width = 220;
    kpiCanvas.height = 120;

    // plugin to draw the needle
    const gaugeNeedlePlugin = {
      id: "gaugeNeedle",
      afterDraw(chart) {
        const { ctx } = chart;
        const dataset = chart.data.datasets[0];
        const value = dataset.score || 0;

        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || !meta.data[0]) return;

        const arc = meta.data[0];
        const { x, y, innerRadius, outerRadius } = arc;
        const radius = (innerRadius + outerRadius) / 2;

        // -Math.PI (0)  →  0 (100)
        const angle = -Math.PI + (value / 100) * Math.PI;

        const needleX = x + radius * Math.cos(angle);
        const needleY = y + radius * Math.sin(angle);

        ctx.save();
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#111827";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(needleX, needleY);
        ctx.stroke();

        // small center circle
        ctx.beginPath();
        ctx.fillStyle = "#111827";
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    kpiGaugeInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        // 3 fixed slices: red (low), yellow (mid), green (good)
        labels: ["Low", "Average", "Good"],
        datasets: [
          {
            data: [33, 34, 33],
            backgroundColor: ["#ef4444", "#facc15", "#22c55e"],
            borderWidth: 0,
            score: score   // <— used by the needle plugin
          }
        ]
      },
      options: {
        rotation: -Math.PI,         // start at 180°
        circumference: Math.PI,     // half-circle
        cutout: "80%",
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      },
      plugins: [gaugeNeedlePlugin]
    });
  }

}




// ========= PRETTY A4 PDF – OVERVIEW + ROOMMATES + COMPOSITION + CALC + COST/DAY + ABSENCES =========
async function exportReportPdf() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("PDF export is not available.");
    return;
  }

  // Make sure report data is ready
  buildReportView();
  renderPortugalKpiCard();   // still builds UI, even if KPI not in PDF
  renderReportCharts();

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageWidth  = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX    = 40;
  let   y          = 90;

  // --- handy values ---
  const rawStart = startDate.toLocaleDateString();
  const rawEnd   = endDate.toLocaleDateString();
  const safePeriodStr = `${rawStart} to ${rawEnd}`;

  const fixedPerc    = billAmount > 0 ? (fixedTotal / billAmount) * 100 : 0;
  const variablePerc = billAmount > 0 ? (variableTotal / billAmount) * 100 : 0;
  const avgPerRoommate = roommates.length ? billAmount / roommates.length : 0;
  const overallPerDay  = totalDays > 0 ? billAmount / totalDays : 0;
  const totalRoommates = roommates.length;

  const activeExpenses = Array.isArray(expenses)
    ? expenses.filter((exp) => (Number(exp.total) || 0) > 0)
    : [];


      // Presence timeline used by the calendar (one entry per day)
  let presenceTimeline = [];
  try {
    presenceTimeline = JSON.parse(
      localStorage.getItem("splitroomPresenceTimeline") || "[]"
    );
  } catch (e) {
    presenceTimeline = [];
  }


  // ---------- HELPERS ----------
  function ensureSpace(extraHeight) {
    if (y + extraHeight > pageHeight - 60) {
      pdf.addPage();
      y = 80;
    }
  }

  function addSectionTitle(title, subtitle) {
    ensureSpace(40);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.setTextColor(20, 24, 35);
    pdf.text(title, marginX, y);
    y += 18;

    if (subtitle) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(107, 114, 128);
      pdf.text(subtitle, marginX, y);
      y += 18;
    }

    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(1);
    pdf.line(marginX, y, pageWidth - marginX, y);
    y += 18;
  }

  function addParagraph(text, lineSpacing = 14) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(75, 85, 99);
    const maxWidth = pageWidth - marginX * 2;
    const lines = pdf.splitTextToSize(text, maxWidth);

    lines.forEach((line) => {
      ensureSpace(lineSpacing);
      pdf.text(line, marginX, y);
      y += lineSpacing;
    });
    y += 6;
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return { r: 239, g: 68, b: 68 };
    return {
      r: parseInt(m[1], 16),
      g: parseInt(m[2], 16),
      b: parseInt(m[3], 16),
    };
  }

  function getAbsenceMapByRoommate() {
    const map = new Map();
    if (!Array.isArray(absencesRaw)) return map;

    absencesRaw.forEach((a) => {
      const idx =
        typeof a.index === "number"
          ? a.index
          : typeof a.roommateIndex === "number"
          ? a.roommateIndex
          : null;
      const dStr = a.date || a.day || a.iso;
      if (idx == null || !dStr) return;
      const d = new Date(dStr);
      if (Number.isNaN(d.getTime())) return;
      if (!map.has(idx)) map.set(idx, []);
      map.get(idx).push(d);
    });

    // sort each roommate's dates
    map.forEach((arr, idx) => {
      arr.sort((a, b) => a - b);
    });

    return map;
  }

  function buildAbsenceRanges(dates) {
    if (!dates || !dates.length) return [];

    const ranges = [];
    let start = dates[0];
    let prev  = dates[0];

    for (let i = 1; i < dates.length; i++) {
      const d = dates[i];
      const diffDays = (d - prev) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        // still same range
        prev = d;
      } else {
        ranges.push({ start, end: prev });
        start = d;
        prev = d;
      }
    }
    ranges.push({ start, end: prev });
    return ranges;
  }

  function formatDate(d) {
    // keep same locale formatting as on screen
    return d.toLocaleDateString();
  }

  // ---------- HEADER STRIP ----------
  pdf.setFillColor(79, 70, 229);
  pdf.rect(0, 0, pageWidth, 80, "F");

  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text("Bill by Days", marginX, 32);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.text("Final bill split summary", marginX, 50);

  pdf.setFontSize(10);
  pdf.text(
    `${safePeriodStr} · ${totalDays} days · € ${billAmount.toFixed(
      2
    )} total · ${totalRoommates} roommates`,
    marginX,
    66
  );

  // pro pill
  const pillW = 80,
    pillH = 24;
  const pillX = pageWidth - marginX - pillW;
  const pillY = 24;
  pdf.setFillColor(31, 41, 55);
  pdf.roundedRect(pillX, pillY, pillW, pillH, 12, 12, "F");
  pdf.setTextColor(229, 231, 235);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("Pro mode", pillX + pillW / 2, pillY + 16, { align: "center" });

  // =====================================================================
  // SECTION 1: BILL OVERVIEW
  // =====================================================================
  y = 110;
  addSectionTitle("Bill overview");

  const overviewW = pageWidth - marginX * 2;
  const overviewH = 110;
  const overviewTop = y;

  pdf.setFillColor(15, 23, 42);
  pdf.roundedRect(marginX, overviewTop, overviewW, overviewH, 16, 16, "F");

  // left column
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("Total bill", marginX + 18, overviewTop + 26);
  pdf.setFontSize(20);
  pdf.text(`€ ${billAmount.toFixed(2)}`, marginX + 18, overviewTop + 52);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(156, 163, 175);
  pdf.text(`Total days: ${totalDays}`, marginX + 18, overviewTop + 70);
  pdf.text(`Roommates: ${totalRoommates}`, marginX + 18, overviewTop + 86);

  // right column
  const rightX = marginX + overviewW / 2 + 10;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(209, 213, 219);
  pdf.text("Period", rightX, overviewTop + 24);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(safePeriodStr, rightX, overviewTop + 38);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Bill composition", rightX, overviewTop + 58);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(
    `Fixed: € ${fixedTotal.toFixed(2)} (${fixedPerc.toFixed(0)}%)`,
    rightX,
    overviewTop + 72
  );
  pdf.text(
    `Variable: € ${variableTotal.toFixed(2)} (${variablePerc.toFixed(0)}%)`,
    rightX,
    overviewTop + 86
  );

  pdf.setFontSize(9);
  pdf.setTextColor(148, 163, 184);
  pdf.text(
    `Avg per roommate: € ${avgPerRoommate.toFixed(
      2
    )} · Whole flat: € ${overallPerDay.toFixed(2)}/day`,
    marginX + 18,
    overviewTop + overviewH + 16
  );

  y = overviewTop + overviewH + 34;

  // =====================================================================
  // SECTION 2: WHAT EACH ROOMMATE HAS TO PAY
  // =====================================================================
  addSectionTitle(
    "What each roommate has to pay",
    "Each card shows their share of the bill and how it was built."
  );

  const rmCardW = pageWidth - marginX * 2;
  const rmCardH = 96;

  roommates.forEach((name, i) => {
    ensureSpace(rmCardH + 20);

    const cardTop = y;
    pdf.setFillColor(247, 248, 252);
    pdf.roundedRect(marginX, cardTop, rmCardW, rmCardH, 14, 14, "F");

    const colorHex =
      typeof palette !== "undefined" && palette[i % palette.length]
        ? palette[i % palette.length]
        : "#ef4444";
    const rgb = hexToRgb(colorHex);
    pdf.setFillColor(rgb.r, rgb.g, rgb.b);
    pdf.circle(marginX + 18, cardTop + 24, 5, "F");

    const total = totals[i] || 0;
    const varShare = variableShares[i] || 0;
    const fixShare = fixedShares[i] || 0;
    const pts = points[i] || 0;
    const daysHome = daysPresent[i] || 0;
    const daysAwayVal = daysAway[i] || 0;
    const percOfBill = billAmount > 0 ? (total / billAmount) * 100 : 0;

    pdf.setTextColor(31, 41, 55);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(name, marginX + 32, cardTop + 22);

    pdf.setFontSize(16);
    pdf.text(
      `€ ${total.toFixed(2)}`,
      pageWidth - marginX - 12,
      cardTop + 28,
      { align: "right" }
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(107, 114, 128);
    pdf.text(
      `${percOfBill.toFixed(1)}% of bill`,
      pageWidth - marginX - 12,
      cardTop + 42,
      { align: "right" }
    );

    let innerY = cardTop + 52;
    pdf.setTextColor(100, 116, 139);
    pdf.text("Presence points", marginX + 32, innerY);
    pdf.text(
      `${pts.toFixed(2)} / ${totalPoints.toFixed(2)}`,
      pageWidth - marginX - 12,
      innerY,
      { align: "right" }
    );
    innerY += 14;

    pdf.text("Days at home · Days away", marginX + 32, innerY);
    pdf.text(
      `${daysHome} days · ${daysAwayVal} days`,
      pageWidth - marginX - 12,
      innerY,
      { align: "right" }
    );
    innerY += 14;

    pdf.text("Fixed part · Variable part", marginX + 32, innerY);
    pdf.text(
      `€ ${fixShare.toFixed(2)} · € ${varShare.toFixed(2)}`,
      pageWidth - marginX - 12,
      innerY,
      { align: "right" }
    );

    y = cardTop + rmCardH + 16;
  });

  // =====================================================================
  // SECTION 3: GLOBAL BILL COMPOSITION  (cards + horizontal bar + legend)
  // =====================================================================
  if (activeExpenses.length) {
    addSectionTitle(
      "Global bill composition",
      "How much each expense contributes to this bill."
    );

    const compCardW = pageWidth - marginX * 2;
    const compCardH = 60;

    activeExpenses.forEach((exp) => {
      const total = Number(exp.total) || 0;
      const fixed = Math.min(total, Math.max(0, Number(exp.fixed) || 0));
      const variable = total - fixed;

      let expStart = exp.from ? new Date(exp.from) : startDate;
      let expEnd = exp.to ? new Date(exp.to) : endDate;
      if (expStart < startDate) expStart = new Date(startDate);
      if (expEnd > endDate) expEnd = new Date(endDate);
      const periodLabel = `${expStart.toLocaleDateString()} to ${expEnd.toLocaleDateString()}`;

      ensureSpace(compCardH + 10);
      const cardTop = y;

      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(marginX, cardTop, compCardW, compCardH, 14, 14, "F");

      const label = exp.name || "Expense";

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(31, 41, 55);
      pdf.text(label, marginX + 18, cardTop + 20);

      pdf.setFontSize(11);
      pdf.text(
        `€ ${total.toFixed(2)}`,
        pageWidth - marginX - 12,
        cardTop + 20,
        { align: "right" }
      );

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `Fixed € ${fixed.toFixed(2)} · Variable € ${variable.toFixed(2)}`,
        marginX + 18,
        cardTop + 36
      );

      pdf.setFontSize(8.5);
      pdf.setTextColor(148, 163, 184);
      pdf.text(periodLabel, marginX + 18, cardTop + 50);

      y = cardTop + compCardH + 6;
    });

    // share bar
    ensureSpace(60);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128);
    pdf.text("Share of total bill", marginX, y);
    y += 10;

    const barW = pageWidth - marginX * 2;
    const barH = 12;
    const barTop = y;

    pdf.setFillColor(229, 231, 235);
    pdf.roundedRect(marginX, barTop, barW, barH, 6, 6, "F");

    let currentX = marginX;
    activeExpenses.forEach((exp, idx) => {
      const total = Number(exp.total) || 0;
      const share = billAmount > 0 ? total / billAmount : 0;
      const width = barW * share;

      const colorHex =
        typeof palette !== "undefined"
          ? palette[idx % palette.length]
          : "#3b82f6";
      const rgb = hexToRgb(colorHex);

      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      pdf.rect(currentX, barTop, width, barH, "F");
      currentX += width;
    });

    y = barTop + barH + 16;

    // legend
    activeExpenses.forEach((exp, idx) => {
      ensureSpace(14);
      const colorHex =
        typeof palette !== "undefined"
          ? palette[idx % palette.length]
          : "#3b82f6";
      const rgb = hexToRgb(colorHex);
      const total = Number(exp.total) || 0;
      const sharePct = billAmount > 0 ? (total / billAmount) * 100 : 0;

      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      pdf.circle(marginX + 5, y - 4, 3, "F");

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(55, 65, 81);
      const label = exp.name || "Expense";
      pdf.text(`${label} – ${sharePct.toFixed(1)}%`, marginX + 14, y);

      y += 12;
    });

    y += 10;
  }

  // =====================================================================
  // SECTION 4: HOW THIS BILL WAS CALCULATED
  // =====================================================================
  addSectionTitle(
    "How this bill was calculated",
    "The method behind the split and the exact formula for each roommate."
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 41, 55);
  pdf.text("1 · You marked who was away.", marginX, y);
  y += 18;
  addParagraph(
    "In Step 2 you marked the days when each roommate was not at home. From that, the app works out who was actually in the flat on every day of the bill period."
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 41, 55);
  pdf.text("2 · Each day gives 1 presence point.", marginX, y);
  y += 18;
  addParagraph(
    "Every day in the period gives the flat 1.00 presence point. If only one person is home, they get the whole point. If several are home, the point is shared equally. If nobody is home, the point is shared equally between everyone."
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 41, 55);
  pdf.text("3 · Presence points decide the variable part.", marginX, y);
  y += 18;
  addParagraph(
    "We add up these daily points for each roommate. More presence points means more days at home and therefore a bigger share of the variable part of the bill."
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 41, 55);
  pdf.text("4 · Fixed and variable parts.", marginX, y);
  y += 18;
  addParagraph(
    `The bill is split into a fixed part and a variable part. The variable total (€ ${variableTotal.toFixed(
      2
    )}) is shared using presence points. The fixed total (€ ${fixedTotal.toFixed(
      2
    )}) is shared equally between all roommates.`
  );

  ensureSpace(40);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Summary of this split:", marginX, y);
  y += 18;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(75, 85, 99);
  pdf.text(
    `Total presence points: ${totalPoints.toFixed(
      2
    )} across ${totalRoommates} roommates.`,
    marginX,
    y
  );
  y += 22;

  // per-roommate formulas
  roommates.forEach((name, i) => {
    const pp = points[i] || 0;
    const varShare = variableShares[i] || 0;
    const fixShare = fixedShares[i] || 0;
    const total = totals[i] || 0;

    const variableFormula = `(${pp.toFixed(2)} / ${totalPoints.toFixed(
      2
    )}) × € ${variableTotal.toFixed(2)}`;
    const fixedFormula =
      fixedTotal > 0 && totalRoommates > 0
        ? `(1 / ${totalRoommates}) × € ${fixedTotal.toFixed(2)}`
        : null;

    const cardH = fixedFormula ? 88 : 74;
    ensureSpace(cardH + 14);

    const cardTop = y;
    const cardW = pageWidth - marginX * 2;

    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(marginX, cardTop, cardW, cardH, 10, 10, "F");

    const colorHex =
      typeof palette !== "undefined" && palette[i % palette.length]
        ? palette[i % palette.length]
        : "#ef4444";
    const rgb = hexToRgb(colorHex);
    pdf.setFillColor(rgb.r, rgb.g, rgb.b);
    pdf.circle(marginX + 16, cardTop + 20, 4, "F");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(31, 41, 55);
    pdf.text(name, marginX + 28, cardTop + 22);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(
      `Total: € ${total.toFixed(2)}`,
      pageWidth - marginX - 12,
      cardTop + 22,
      { align: "right" }
    );

    let innerY = cardTop + 38;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(75, 85, 99);

    pdf.text(
      `Presence points: ${pp.toFixed(2)} / ${totalPoints.toFixed(2)}`,
      marginX + 20,
      innerY
    );
    innerY += 14;

    pdf.text(
      `Variable part: € ${varShare.toFixed(2)}`,
      marginX + 20,
      innerY
    );
    innerY += 12;
    pdf.text(`= ${variableFormula}`, marginX + 32, innerY);
    innerY += 16;

    if (fixedFormula) {
      pdf.text(
        `Fixed part: € ${fixShare.toFixed(2)}`,
        marginX + 20,
        innerY
      );
      innerY += 12;
      pdf.text(`= ${fixedFormula}`, marginX + 32, innerY);
    }

    y = cardTop + cardH + 12;
  });

  // =====================================================================
  // SECTION 5: COST PER DAY
  // =====================================================================
  addSectionTitle(
    "Cost per day",
    "How much the flat and each roommate pay for every day at home."
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 41, 55);
  pdf.text("Whole flat", marginX, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(75, 85, 99);
  pdf.text(`€ ${overallPerDay.toFixed(2)} / day`, marginX, y + 14);
  y += 28;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(107, 114, 128);
  pdf.text("Per roommate", marginX, y);
  y += 10;

  roommates.forEach((name, i) => {
    ensureSpace(18);
    const perDay = daysPresent[i] > 0 ? totals[i] / daysPresent[i] : 0;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(55, 65, 81);
    pdf.text(name, marginX, y + 12);
    pdf.text(
      `€ ${perDay.toFixed(2)} / day at home`,
      pageWidth - marginX - 12,
      y + 12,
      { align: "right" }
    );
    y += 16;
  });

  y += 10;

   // ---------- SECTION 5: HOW YOU COMPARE TO PORTUGAL ----------
  ensureSpace(120);

  const portugalSummary = computePortugalUtilitySummary();
  if (portugalSummary) {
    const {
      typesPresent,
      userMonthlyTotal,
      benchMonthlyTotal,
      householdSize,
      data_year,
    } = portugalSummary;

    const score = computeEfficiencyScore(
      userMonthlyTotal,
      benchMonthlyTotal,
      userMonthlyTotal,
      benchMonthlyTotal
    );
    const clamped = Math.max(0, Math.min(100, score));

    addSectionTitle(
      "How you compare to Portugal",
      "Efficiency score and monthly cost vs Portuguese averages."
    );

    const label = labelForUtilityTypes(typesPresent);
    const hhLabel =
      householdSize >= 4
        ? "4+ person household"
        : `${householdSize}-person household`;

    const kpiW = pageWidth - marginX * 2;
    const kpiH = 80;
    const kpiTop = y;

    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(marginX, kpiTop, kpiW, kpiH, 14, 14, "F");

    // Score line
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(31, 41, 55);
    pdf.text(`Efficiency score: ${clamped} / 100`, marginX + 16, kpiTop + 24);

    // Utility label + household size
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`Utilities: ${label}`, marginX + 16, kpiTop + 40);
    pdf.text(`Household: ${hhLabel}`, marginX + 16, kpiTop + 54);

    // Cost lines
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(31, 41, 55);
    pdf.text(
      `Your bill: € ${userMonthlyTotal.toFixed(2)}/month`,
      marginX + 16,
      kpiTop + 70
    );

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text(
      `Portugal average: € ${benchMonthlyTotal.toFixed(2)}/month`,
      pageWidth - marginX - 12,
      kpiTop + 70,
      { align: "right" }
    );

    y = kpiTop + kpiH + 18;

    // Narrative paragraph
    const diffPct =
      benchMonthlyTotal > 0
        ? ((userMonthlyTotal - benchMonthlyTotal) / benchMonthlyTotal) * 100
        : 0;
    const dir = diffPct > 0 ? "above" : diffPct < 0 ? "below" : "in line with";
    const absDiff = Math.abs(diffPct).toFixed(1);
    const perPersonUser = userMonthlyTotal / householdSize;
    const perPersonBench = benchMonthlyTotal / householdSize;

    addParagraph(
      `You pay about € ${userMonthlyTotal.toFixed(
        2
      )}/month for these utilities (~€ ${perPersonUser.toFixed(
        2
      )} per person). A typical ${hhLabel} Portuguese home would pay around € ${benchMonthlyTotal.toFixed(
        2
      )}/month (~€ ${perPersonBench.toFixed(
        2
      )} per person), so you are ${absDiff}% ${dir} the national average.`,
      14
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(148, 163, 184);
    pdf.text(
      `Data year: ${data_year} · Sources: ERSE / ERSAR / INE (Portugal)`,
      marginX,
      y
    );
    y += 20;
  }

  // ---------- SECTION 6: PRESENCE & ABSENCES ----------
ensureSpace(120);
addSectionTitle(
  "Presence & absences",
  "For each roommate, which days were marked as away in Step 2."
);

// Convert Step 2 data into Date arrays
const absencesByRoommate = roommates.map((_, idx) => {
  const raw = Array.isArray(absencesRaw[idx]) ? absencesRaw[idx] : [];
  return raw
    .map(iso => new Date(iso))
    .filter(d => !Number.isNaN(d.getTime()));
});

// Safe date formatter for jsPDF
function formatAbsDate(d) {
  const day   = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year  = d.getFullYear();
  return `${day}/${month}/${year}`;  // dd/mm/yyyy
}

// Convert list of dates → "dd/mm/yyyy to dd/mm/yyyy" ranges
function formatAbsenceRanges(dates) {
  if (!dates || dates.length === 0) {
    return "No absences recorded in this period.";
  }

  // sort + remove duplicates
  const sorted = Array.from(
    new Map(dates.map(d => [d.toDateString(), d])).values()
  ).sort((a, b) => a - b);

  const ranges = [];
  let start = sorted[0];
  let prev  = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const diff = (cur - prev) / (1000 * 60 * 60 * 24);

    if (diff === 1) {
      prev = cur;
      continue;
    }

    // close previous range
    if (start.toDateString() === prev.toDateString()) {
      ranges.push(formatAbsDate(start));
    } else {
      ranges.push(`${formatAbsDate(start)} to ${formatAbsDate(prev)}`);
    }

    start = cur;
    prev = cur;
  }

  // close last range
  if (start.toDateString() === prev.toDateString()) {
    ranges.push(formatAbsDate(start));
  } else {
    ranges.push(`${formatAbsDate(start)} to ${formatAbsDate(prev)}`);
  }

  // If only 1 range → return it
  if (ranges.length === 1) return ranges[0];

  // Otherwise → numbered list
  return ranges.map((r, i) => `${i + 1}) ${r}`).join("; ");
}

// Render into the PDF
roommates.forEach((name, i) => {
  ensureSpace(30);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text(name || `Roommate ${i + 1}`, marginX, y);
  y += 14;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(75, 85, 99);

  const summary = formatAbsenceRanges(absencesByRoommate[i]);
  const maxWidth = pageWidth - marginX * 2;
  const lines = pdf.splitTextToSize(summary, maxWidth);

  lines.forEach(line => {
    ensureSpace(12);
    pdf.text(line, marginX, y);
    y += 12;
  });

  y += 6;
});


  // FINAL SAVE
  pdf.save("bill-by-days-report.pdf");
}







/* ========= CALENDAR + DAY VIEW ========= */

const calendarOverlay = document.getElementById("calendarOverlay");
const presenceGrid = document.getElementById("presenceGrid");
const dayInfo = document.getElementById("dayInfo");
const dayInfoBackBtn = document.getElementById("dayInfoBackBtn");
const dayInfoTitle = document.getElementById("dayInfoTitle");
const dayInfoBars = document.getElementById("dayInfoBars");
const dayInfoList = document.getElementById("dayInfoList");
const dayInfoSplit = document.getElementById("dayInfoSplit");

const calMonthLabel = document.getElementById("calMonthLabel");
const calPrevBtn = document.getElementById("calPrevBtn");
const calNextBtn = document.getElementById("calNextBtn");

function showCalendarGrid() {
  presenceGrid.style.display = "grid";
  dayInfo.style.display = "none";
}

function showDayView() {
  presenceGrid.style.display = "none";
  dayInfo.style.display = "block";
}

function buildPresenceCalendar() {
  presenceGrid.innerHTML = "";
  showCalendarGrid();

  // Label for current month
  const monthDate = new Date(calYear, calMonth, 1);
  if (calMonthLabel) {
    calMonthLabel.textContent = monthDate.toLocaleString("default", {
      month: "long",
      year: "numeric"
    });
  }

  // Disable / enable nav buttons based on min/max month
  const atMin = calYear === minYear && calMonth === minMonth;
  const atMax = calYear === maxYear && calMonth === maxMonth;

  if (calPrevBtn) calPrevBtn.disabled = atMin;
  if (calNextBtn) calNextBtn.disabled = atMax;

  // First and last day of this calendar month
  const firstOfMonth = new Date(calYear, calMonth, 1);
  const lastOfMonth = new Date(calYear, calMonth + 1, 0);

  // Monday-based index for the first day (0 = Mon ... 6 = Sun)
  const jsDay = firstOfMonth.getDay(); // 0 Sun ... 6 Sat
  const startOffset = (jsDay + 6) % 7;

  // Empty cells before the 1st of the month
  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement("div");
    empty.className = "presence-card out-of-range";
    presenceGrid.appendChild(empty);
  }

  let d = new Date(firstOfMonth);
  while (d <= lastOfMonth) {
    const day = new Date(d);
    const inRange = day >= startDate && day <= endDate;
    const cell = document.createElement("div");
    cell.className = "presence-card";
    if (!inRange) {
      cell.classList.add("out-of-range");
    }

    const numEl = document.createElement("div");
    numEl.className = "cal-day-number";
    numEl.textContent = day.getDate();
    cell.appendChild(numEl);

    const bars = document.createElement("div");
    bars.className = "presence-bars";

    if (inRange) {
      const key = dayKey(day);
      const presentFlags = roommates.map((_, i) =>
        absences[i].has(key) ? 0 : 1
      );

      roommates.forEach((_, i) => {
        const bar = document.createElement("div");
        bar.className = "presence-bar";
        bar.style.background =
          presentFlags[i] === 1 ? palette[i % palette.length] : "#e5e7eb";
        bars.appendChild(bar);
      });

      // Tap = show detailed view
      cell.addEventListener("click", () => {
        dayInfoTitle.textContent = day.toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric"
        });

        dayInfoBars.innerHTML = "";
        dayInfoList.innerHTML = "";
        let dayShares = new Array(roommates.length).fill(0);

        const flags = roommates.map((_, i) =>
          absences[i].has(key) ? 0 : 1
        );
        const presentCount = flags.reduce((acc, v) => acc + v, 0);

        if (presentCount > 0) {
          const sharePerPresent = 1 / presentCount;
          roommates.forEach((_, i) => {
            const bar = document.createElement("div");
            bar.className = "presence-bar";
            const inner = document.createElement("div");
            inner.className = "presence-inner";

            if (flags[i] === 1) {
              inner.style.width = "100%";
              inner.style.background = palette[i % palette.length];
              dayShares[i] = sharePerPresent;
            } else {
              inner.style.width = "40%";
              inner.style.background = "#e5e7eb";
              dayShares[i] = 0;
            }

            bar.appendChild(inner);
            dayInfoBars.appendChild(bar);
          });
        } else {
          // Nobody home → share equally
          const shareAll = 1 / roommates.length;
          roommates.forEach((_, i) => {
            const bar = document.createElement("div");
            bar.className = "presence-bar";
            const inner = document.createElement("div");
            inner.className = "presence-inner";
            inner.style.width = "100%";
            inner.style.background = "#d1d5db";
            bar.appendChild(inner);
            dayInfoBars.appendChild(bar);
            dayShares[i] = shareAll;
          });
        }

        roommates.forEach((name, i) => {
          const row = document.createElement("div");
          row.className = "day-roommate-row";

          const dot = document.createElement("div");
          dot.className = "day-dot";
          dot.style.background = absences[i].has(key)
            ? "#d1d5db"
            : palette[i % palette.length];

          const nameSpan = document.createElement("span");
          nameSpan.className = "day-roommate-name";
          nameSpan.textContent = name;

          const statusSpan = document.createElement("span");
          statusSpan.className = "day-roommate-status";
          statusSpan.innerHTML =
            " — <strong>" +
            (absences[i].has(key) ? "away" : "present") +
            "</strong>";

          row.appendChild(dot);
          row.appendChild(nameSpan);
          row.appendChild(statusSpan);
          dayInfoList.appendChild(row);
        });

        const pieces = roommates
          .map(
            (name, i) =>
              `${name}: ${
                dayShares[i] ? dayShares[i].toFixed(2) : "0.00"
              } pt`
          )
          .join(" · ");

        dayInfoSplit.textContent =
          "Point split for this day (1.00 total): " + pieces;

        showDayView();
      });
    }

    cell.appendChild(bars);
    presenceGrid.appendChild(cell);
    d.setDate(d.getDate() + 1);
  }
}


const openCalendarBtn = document.getElementById("openCalendarBtn");

if (openCalendarBtn) {
  // Optional: make it look slightly dimmed for Free users
  if (mode !== "pro") {
    openCalendarBtn.classList.add("pro-locked"); // only if you added that CSS
  }

  openCalendarBtn.addEventListener("click", () => {
  if (mode !== "pro") {
    // FREE → show Pro popup instead of opening calendar
    if (typeof showUpgrade === "function") {
      showUpgrade();
    } else {
      alert("This is a Pro feature.");
    }
    return;
  }

  // PRO → open full calendar as usual
  buildPresenceCalendar();
  calendarOverlay.style.display = "flex";
});
}        


if (calPrevBtn) {
  calPrevBtn.addEventListener("click", () => {
    // Already at first month of period
    if (calYear === minYear && calMonth === minMonth) return;
    calMonth--;
    if (calMonth < 0) {
      calMonth = 11;
      calYear--;
    }
    buildPresenceCalendar();
  });
}

if (calNextBtn) {
  calNextBtn.addEventListener("click", () => {
    // Already at last month of period
    if (calYear === maxYear && calMonth === maxMonth) return;
    calMonth++;
    if (calMonth > 11) {
      calMonth = 0;
      calYear++;
    }
    buildPresenceCalendar();
  });
}


document.getElementById("calCloseBtn").addEventListener("click", () => {
  calendarOverlay.style.display = "none";
});

calendarOverlay.addEventListener("click", (e) => {
  if (e.target === calendarOverlay) {
    calendarOverlay.style.display = "none";
  }
});

dayInfoBackBtn.addEventListener("click", () => {
  showCalendarGrid();
});

/* ========= CALC EXPLANATION ========= */

const calcOverlay = document.getElementById("calcOverlay");
const calcContent = document.getElementById("calcContent");

function buildCalcExplanation() {
  let html = "";

  html += `<div class="step-block">
    <div class="step-label">1 · You marked who was away.</div>
    <p class="calc-step-text">
      In Step 2 you chose the days when each roommate was
      <strong>not</strong> at home. From that we work out who was
      actually in the flat on each day.
    </p>
  </div>`;

  html += `<div class="step-block">
    <div class="step-label">2 · Each day gives 1 point.</div>
    <p class="calc-step-text">
      For every day in the bill period the flat gets
      <strong>1 point</strong>. We split that point like this:
    </p>
    <ul class="calc-list">
      <li>If only one person was home, they get the full <strong>1.00 point</strong>.</li>
      <li>If several people were home, the point is shared equally between them.</li>
      <li>If nobody was home, the point is shared equally between everyone in the flat.</li>
    </ul>
  </div>`;

  html += `<div class="step-block">
    <div class="step-label">3 · Presence points.</div>
    <p class="calc-step-text">
      We add up the daily points for each roommate. These are their
      <strong>presence points</strong>.
    </p>
    <p class="calc-step-text">
      More points = more days at home = a larger share of the
      <strong>variable</strong> part of the bill.
    </p>
  </div>`;

  html += `<div class="step-block">
    <div class="step-label">4 · Fixed and variable parts.</div>
    <p class="calc-step-text">
      The bill is split into a <strong>fixed</strong> part and a
      <strong>variable</strong> part:
    </p>
    <ul class="calc-list">
      <li>
        The <strong>variable total</strong> is €${variableTotal.toFixed(2)}
        and is split using the Roomate's presence points / total points * total variable bill.
      </li>
      <li>
        The <strong>fixed total</strong> is €${fixedTotal.toFixed(2)}
        and is shared equally: €${fixedPerRoommate.toFixed(2)} per roommate.
      </li>
    </ul>
  </div>`;

    html += `<div class="calc-table">
    <div class="step-label">In this split:</div>
    ${roommates
  .map((name, i) => {
    const pp = points[i];
    const varShare = variableShares[i];
    const fixShare = fixedShares[i];
    
    const variableFormula = `(${pp.toFixed(2)} / ${totalPoints.toFixed(2)}) × €${variableTotal.toFixed(2)}`;
    const fixedFormula = roommates.length > 0 
      ? `(1 / ${roommates.length}) × €${fixedTotal.toFixed(2)}` 
      : `€0.00`;

    // If fixed part = 0, hide the fixed component in formula
    let formulaString = "";
    if (fixedTotal > 0) {
      formulaString = `${variableFormula}  +  ${fixedFormula}`;
    } else {
      formulaString = `${variableFormula}`;
    }

    return `
      <div class="person-split">
        <div class="person-header">
          <div class="calc-dot" style="background:${
            palette[i % palette.length]
          }"></div>
          <span class="person-name">${name}</span>
        </div>

        <div class="person-line">
          <span>Presence points</span>
          <span>${pp.toFixed(2)} pts</span>
        </div>

        <div class="person-line">
          <span>Variable part</span>
          <span>€${varShare.toFixed(2)}</span>
        </div>

        <div class="person-line">
          <span>Fixed part</span>
          <span>€${fixShare.toFixed(2)}</span>
        </div>

        <div class="person-line calc-formula">
          <span>Formula</span>
          <span>${formulaString}</span>
        </div>

        <div class="person-total">
          Total: <strong>€${totals[i].toFixed(2)}</strong>
        </div>
      </div>
    `;
  })
  .join("")}


    <div class="calc-row calc-row-total">
      <div><strong>Total points</strong></div>
      <div>${totalPoints.toFixed(2)}</div>
    </div>
  </div>`;


  calcContent.innerHTML = html;
}



document.getElementById("openCalcBtn").addEventListener("click", () => {
  buildCalcExplanation();
  calcOverlay.style.display = "flex";
});

document.getElementById("calcCloseBtn").addEventListener("click", () => {
  calcOverlay.style.display = "none";
});


calcOverlay.addEventListener("click", (e) => {
  if (e.target === calcOverlay) {
    calcOverlay.style.display = "none";
  }
});


/* ========= TIPS OVERLAY (FREE + PRO) ========= */

const tipsOverlay = document.getElementById("tipsOverlay");
const tipsCloseBtn = document.getElementById("tipsCloseBtn");
const openTipsBtn = document.getElementById("openTipsBtn");

if (openTipsBtn && tipsOverlay && tipsCloseBtn) {
  // Open for both Free and Pro
  openTipsBtn.addEventListener("click", () => {
    tipsOverlay.style.display = "flex";
  });

  tipsCloseBtn.addEventListener("click", () => {
    tipsOverlay.style.display = "none";
  });

  tipsOverlay.addEventListener("click", (e) => {
    if (e.target === tipsOverlay) {
      tipsOverlay.style.display = "none";
    }
  });
}

/* ========= FEEDBACK OVERLAY (FREE + PRO) ========= */

const feedbackOverlay = document.getElementById("feedbackOverlay");
const feedbackOpenBtn = document.getElementById("openFeedbackBtn");
const feedbackCloseBtn = document.getElementById("feedbackCloseBtn");
const feedbackStars = document.querySelectorAll("#feedbackStars span");
const feedbackMessage = document.getElementById("feedbackMessage");
const feedbackEmail = document.getElementById("feedbackEmail");
const feedbackStatus = document.getElementById("feedbackStatus");

let feedbackRating = 0;

if (feedbackOverlay && feedbackOpenBtn && feedbackCloseBtn) {
  // Open / close
  feedbackOpenBtn.addEventListener("click", () => {
    feedbackOverlay.style.display = "flex";
  });

  feedbackCloseBtn.addEventListener("click", () => {
    feedbackOverlay.style.display = "none";
  });

  feedbackOverlay.addEventListener("click", (e) => {
    if (e.target === feedbackOverlay) {
      feedbackOverlay.style.display = "none";
    }
  });

  // Star selection
  feedbackStars.forEach((star) => {
    star.addEventListener("click", () => {
      feedbackRating = Number(star.dataset.star);
      feedbackStars.forEach((s) => {
        const n = Number(s.dataset.star);
        s.textContent = n <= feedbackRating ? "⭐" : "☆";
      });
    });
  });
}

/* ========= SUPABASE FEEDBACK SAVE ========= */

const SUPABASE_URL = "https://vzxnkgpdzpupgvjifvdg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6eG5rZ3BkenB1cGd2amlmdmRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjg0MTMsImV4cCI6MjA3OTg0NDQxM30.u1GXj7vjk5_v3r8yWT1tX07YGyPuyiGP_v9YI0CQA0M";

let sbClient = null;
if (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const sendFeedbackBtn = document.getElementById("sendFeedbackBtn");

if (sendFeedbackBtn && sbClient) {
  sendFeedbackBtn.addEventListener("click", async () => {
    if (!feedbackMessage.value.trim() && feedbackRating === 0) {
      feedbackStatus.style.color = "#b91c1c";
      feedbackStatus.textContent =
        "Please leave at least a rating or a short message 🙏";
      return;
    }

    feedbackStatus.style.color = "#6b7280";
    feedbackStatus.textContent = "Sending...";

    try {
      const { error } = await sbClient.from("feedback").insert([
        {
          rating: feedbackRating || null,
          message: feedbackMessage.value.trim() || null,
          email: feedbackEmail.value.trim() || null,
          page: "step3",
        },
      ]);

      if (error) {
        console.error(error);
        feedbackStatus.style.color = "#b91c1c";
        feedbackStatus.textContent =
          "Something went wrong. Please try again 😔";
        return;
      }

      feedbackStatus.style.color = "#16a34a";
      feedbackStatus.textContent =
        "Thank you! Your feedback helps a lot 💛";

      feedbackMessage.value = "";
      feedbackEmail.value = "";
      feedbackRating = 0;
      feedbackStars.forEach((s) => (s.textContent = "☆"));
    } catch (err) {
      console.error(err);
      feedbackStatus.style.color = "#b91c1c";
      feedbackStatus.textContent =
        "Network error. Please try again later 😔";
    }
  });
}




/* ========= SHARE WITH FRIENDS (DOWNLOAD PDF) ========= */

const shareFriendsBtn = document.getElementById("shareFriendsBtn");

if (shareFriendsBtn) {
  if (mode !== "pro") {
    // visually you can add .pro-locked class in CSS if you want
    shareFriendsBtn.classList.add("pro-locked");
  }

  shareFriendsBtn.addEventListener("click", async () => {
    // Pro-only gate
    if (mode !== "pro") {
      if (typeof showUpgrade === "function") {
        showUpgrade();
      } else {
        alert("This is a Pro feature.");
      }
      return;
    }

    // Optionally open the report overlay so the user sees what's being exported
    const hadOverlayHidden = reportOverlay.style.display !== "flex";
    if (hadOverlayHidden) {
      buildReportView();
      renderPortugalKpiCard();
      reportOverlay.style.display = "flex";
      setTimeout(renderReportCharts, 30);
    }

    await exportReportPdf();

    // If we opened the overlay just for the PDF, close it again
    if (hadOverlayHidden) {
      reportOverlay.style.display = "none";
    }

    // Tiny nudge so users know what to do next
    alert("PDF downloaded ✅.\nYou can now send it in WhatsApp or by email.");
  });
}





/* ========= FOOTER BUTTONS ========= */

document.getElementById("backBtn").addEventListener("click", () => {
  window.location.href = "step2.html";
});

document.getElementById("restartBtn").addEventListener("click", () => {
  if (confirm("Clear everything and start again?")) {
    localStorage.removeItem("splitroomBill");
    localStorage.removeItem("splitroomStart");
    localStorage.removeItem("splitroomEnd");
    localStorage.removeItem("splitroomRoommates");
    localStorage.removeItem("splitroomAbsences");
    localStorage.removeItem("splitroomExpenses");
    localStorage.removeItem("splitroomMode");
    window.location.href = "index.html";
  }
});



