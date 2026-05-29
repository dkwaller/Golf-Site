const STORE_KEY = "golfScoreJournal.v1";
const SVG_NS = "http://www.w3.org/2000/svg";

const appConfig = window.GOLF_SCORE_CONFIG || {};
const viewerMode = appConfig.viewerMode === true || new URLSearchParams(window.location.search).get("view") === "1";
const dataStore = createDataStore(appConfig);

const form = document.querySelector("#round-form");
const roundIdInput = document.querySelector("#round-id");
const courseInput = document.querySelector("#course");
const scoreInput = document.querySelector("#score");
const dateInput = document.querySelector("#date");
const notesInput = document.querySelector("#notes");
const saveButton = document.querySelector("#save-button");
const statusEl = document.querySelector("#form-status");
const courseOptions = document.querySelector("#course-options");
const averageScoreEl = document.querySelector("#average-score");
const bestScoreEl = document.querySelector("#best-score");
const roundCountEl = document.querySelector("#round-count");
const lastRoundEl = document.querySelector("#last-round");
const courseCountEl = document.querySelector("#course-count");
const syncStatusEl = document.querySelector("#sync-status");
const scoreChart = document.querySelector("#score-chart");
const chartEmpty = document.querySelector("#chart-empty");
const roundsBody = document.querySelector("#rounds-body");
const roundsTable = document.querySelector("#rounds-table");
const roundsEmpty = document.querySelector("#rounds-empty");

let state = { rounds: [], courses: [] };

init();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (viewerMode) return;

  const course = courseInput.value.trim();
  const score = Number(scoreInput.value);
  const date = dateInput.value;
  const notes = notesInput.value.trim();

  if (!course || !date || !Number.isFinite(score) || score < 1 || score > 250) {
    setStatus("Check the course, score, and date.", true);
    return;
  }

  const editingId = roundIdInput.value;
  const existingRound = state.rounds.find((round) => round.id === editingId);
  const savedRound = {
    id: editingId || createId(),
    course,
    score,
    date,
    notes,
    createdAt: existingRound?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  setLoading(true);
  try {
    await dataStore.saveRound(savedRound, Boolean(editingId));
    await refreshRounds({ quiet: true });
    resetForm();
    setStatus(editingId ? "Round updated." : "Round saved.");
  } catch {
    setStatus(dataStore.mode === "cloud" ? "Cloud save failed." : "This browser blocked saving.", true);
  } finally {
    setLoading(false);
  }
});

form.addEventListener("reset", () => {
  window.setTimeout(() => {
    resetForm();
    setStatus("");
  }, 0);
});

roundsBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || viewerMode) return;

  const id = button.dataset.id;
  const round = state.rounds.find((item) => item.id === id);
  if (!round) return;

  if (button.dataset.action === "edit") {
    roundIdInput.value = round.id;
    courseInput.value = round.course;
    scoreInput.value = String(round.score);
    dateInput.value = round.date;
    notesInput.value = round.notes || "";
    saveButton.textContent = "Update round";
    setStatus("Editing saved round.");
    courseInput.focus();
  }

  if (button.dataset.action === "delete") {
    const shouldDelete = window.confirm(`Delete the ${formatDate(round.date)} round at ${round.course}?`);
    if (!shouldDelete) return;

    setLoading(true);
    try {
      await dataStore.deleteRound(id);
      await refreshRounds({ quiet: true });
      if (roundIdInput.value === id) resetForm();
      setStatus("Round deleted.");
    } catch {
      setStatus(dataStore.mode === "cloud" ? "Cloud delete failed." : "This browser blocked saving.", true);
    } finally {
      setLoading(false);
    }
  }
});

async function init() {
  dateInput.value = todayForInput();
  document.body.classList.toggle("viewer-mode", viewerMode);
  setSyncStatus();
  if (viewerMode) setStatus("");
  await refreshRounds();
}

async function refreshRounds(options = {}) {
  setLoading(true);

  try {
    const rounds = await dataStore.loadRounds();
    state = stateFromRounds(rounds);
    cacheLocalState(state);
    render();
    setSyncStatus();
    if (!options.quiet && dataStore.mode === "cloud") setStatus("Cloud synced.");
  } catch {
    state = loadLocalState();
    render();
    setSyncStatus("Offline copy", "viewer");
    setStatus("Cloud sync failed; showing this browser's saved copy.", true);
  } finally {
    setLoading(false);
  }
}

function createDataStore(config) {
  if (hasCloudConfig(config)) return createSupabaseStore(config);
  return createLocalStore();
}

function hasCloudConfig(config) {
  return Boolean(
    config.supabaseUrl
      && config.supabaseAnonKey
      && !config.supabaseUrl.includes("YOUR_")
      && !config.supabaseAnonKey.includes("YOUR_")
  );
}

function createLocalStore() {
  return {
    mode: "local",
    label: "Browser only",
    async loadRounds() {
      return loadLocalState().rounds;
    },
    async saveRound(round, isEdit) {
      const localState = loadLocalState();
      localState.rounds = isEdit
        ? localState.rounds.map((item) => (item.id === round.id ? round : item))
        : [...localState.rounds, round];
      localState.courses = uniqueSorted([...localState.courses, round.course]);
      saveLocalState(localState);
      return round;
    },
    async deleteRound(id) {
      const localState = loadLocalState();
      localState.rounds = localState.rounds.filter((round) => round.id !== id);
      saveLocalState(localState);
    }
  };
}

function createSupabaseStore(config) {
  const supabaseUrl = config.supabaseUrl.replace(/\/$/, "");
  const tableName = config.tableName || "rounds";
  const endpoint = `${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}`;
  const headers = {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`,
    "Content-Type": "application/json"
  };

  return {
    mode: "cloud",
    label: "Cloud sync",
    async loadRounds() {
      const data = await request(`${endpoint}?select=id,course,score,played_on,notes,created_at,updated_at&order=played_on.asc,created_at.asc`);
      return data.map(roundFromDatabase);
    },
    async saveRound(round, isEdit) {
      const payload = roundToDatabase(round);
      const url = isEdit ? `${endpoint}?id=eq.${encodeURIComponent(round.id)}` : endpoint;
      const method = isEdit ? "PATCH" : "POST";
      const data = await request(url, {
        method,
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload)
      });
      return roundFromDatabase(data[0]);
    },
    async deleteRound(id) {
      await request(`${endpoint}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
    }
  };

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    if (response.status === 204) return null;

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

function roundFromDatabase(row) {
  return {
    id: row.id,
    course: row.course,
    score: Number(row.score),
    date: row.played_on,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function roundToDatabase(round) {
  return {
    id: round.id,
    course: round.course,
    score: round.score,
    played_on: round.date,
    notes: round.notes || "",
    updated_at: round.updatedAt || new Date().toISOString()
  };
}

function loadLocalState() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { rounds: [], courses: [] };

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return stateFromRounds(parsed);
    }

    const rounds = Array.isArray(parsed.rounds) ? parsed.rounds : [];
    const courses = Array.isArray(parsed.courses) ? parsed.courses : [];
    return { rounds, courses: uniqueSorted([...courses, ...rounds.map((round) => round.course)]) };
  } catch {
    return { rounds: [], courses: [] };
  }
}

function saveLocalState(nextState) {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(nextState));
}

function cacheLocalState(nextState) {
  try {
    saveLocalState(nextState);
  } catch {
    // The cloud copy is still the source of truth when browser storage is blocked.
  }
}

function stateFromRounds(rounds) {
  const cleanRounds = rounds.map((round) => ({
    id: round.id,
    course: round.course,
    score: Number(round.score),
    date: round.date,
    notes: round.notes || "",
    createdAt: round.createdAt || round.created_at || "",
    updatedAt: round.updatedAt || round.updated_at || ""
  }));

  return {
    rounds: cleanRounds,
    courses: uniqueSorted(cleanRounds.map((round) => round.course))
  };
}

function render() {
  renderCourses();
  renderStats();
  renderChart();
  renderRounds();
}

function renderCourses() {
  courseOptions.replaceChildren();
  uniqueSorted([...state.courses, ...state.rounds.map((round) => round.course)]).forEach((course) => {
    const option = document.createElement("option");
    option.value = course;
    courseOptions.append(option);
  });
}

function renderStats() {
  const rounds = state.rounds;
  const scores = rounds.map((round) => round.score);
  const average = scores.length
    ? scores.reduce((total, score) => total + score, 0) / scores.length
    : null;
  const best = scores.length ? Math.min(...scores) : null;
  const latest = sortedRoundsDescending(rounds)[0];
  const courseCount = uniqueSorted([...state.courses, ...rounds.map((round) => round.course)]).length;

  averageScoreEl.textContent = average === null ? "--" : average.toFixed(1);
  bestScoreEl.textContent = best === null ? "--" : String(best);
  roundCountEl.textContent = String(rounds.length);
  lastRoundEl.textContent = latest ? String(latest.score) : "--";
  courseCountEl.textContent = `${courseCount} ${courseCount === 1 ? "course" : "courses"}`;
}

function renderRounds() {
  const rounds = sortedRoundsDescending(state.rounds);
  roundsBody.replaceChildren();
  roundsEmpty.hidden = rounds.length > 0;
  roundsTable.hidden = rounds.length === 0;

  rounds.forEach((round) => {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    dateTd.textContent = formatDate(round.date);

    const courseTd = document.createElement("td");
    courseTd.textContent = round.course;

    const scoreTd = document.createElement("td");
    scoreTd.className = "score-cell";
    scoreTd.textContent = String(round.score);

    const notesTd = document.createElement("td");
    notesTd.className = "notes-cell";
    notesTd.textContent = round.notes || "";

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";
    if (!viewerMode) {
      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.append(createActionButton("Edit", "edit", round.id));
      actions.append(createActionButton("Delete", "delete", round.id, "delete-button"));
      actionsTd.append(actions);
    }

    tr.append(dateTd, courseTd, scoreTd, notesTd, actionsTd);
    roundsBody.append(tr);
  });
}

function renderChart() {
  const rounds = sortedRoundsAscending(state.rounds);
  scoreChart.replaceChildren();
  scoreChart.setAttribute("viewBox", "0 0 760 310");
  chartEmpty.hidden = rounds.length > 0;

  if (!rounds.length) return;

  const width = 760;
  const height = 310;
  const pad = { top: 24, right: 34, bottom: 44, left: 48 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const scores = rounds.map((round) => round.score);
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const minScore = Math.max(0, rawMin - 2);
  const maxScore = rawMax + 2;
  const yRange = Math.max(1, maxScore - minScore);
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const xFor = (index) => {
    if (rounds.length === 1) return pad.left + plotWidth / 2;
    return pad.left + (index / (rounds.length - 1)) * plotWidth;
  };
  const yFor = (score) => pad.top + ((score - minScore) / yRange) * plotHeight;
  const points = rounds.map((round, index) => ({
    x: xFor(index),
    y: yFor(round.score),
    round
  }));

  appendGrid(scoreChart, pad, width, plotWidth, minScore, maxScore, yFor);

  if (points.length > 1) {
    const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const lastPoint = points[points.length - 1];
    const areaPath = `${linePath} L ${lastPoint.x} ${pad.top + plotHeight} L ${points[0].x} ${pad.top + plotHeight} Z`;
    scoreChart.append(svgEl("path", { class: "score-area", d: areaPath }));
    scoreChart.append(svgEl("path", { class: "score-line", d: linePath }));
  }

  const averageY = yFor(avg);
  scoreChart.append(svgEl("line", {
    class: "average-line",
    x1: pad.left,
    x2: width - pad.right,
    y1: averageY,
    y2: averageY
  }));
  scoreChart.append(svgText(width - pad.right - 88, averageY - 8, `Avg ${avg.toFixed(1)}`, "chart-label"));

  points.forEach((point) => {
    const circle = svgEl("circle", {
      class: "score-point",
      cx: point.x,
      cy: point.y,
      r: 6
    });
    const title = svgEl("title");
    title.textContent = `${formatDate(point.round.date)} - ${point.round.course}: ${point.round.score}`;
    circle.append(title);
    scoreChart.append(circle);
  });

  const first = points[0].round;
  const last = points[points.length - 1].round;
  scoreChart.append(svgText(pad.left, height - 14, formatShortDate(first.date), "chart-label"));
  scoreChart.append(svgText(width - pad.right - 66, height - 14, formatShortDate(last.date), "chart-label"));
}

function appendGrid(svg, pad, width, plotWidth, minScore, maxScore, yFor) {
  const values = uniqueSortedNumbers([minScore, Math.round((minScore + maxScore) / 2), maxScore]);

  values.forEach((value) => {
    const y = yFor(value);
    svg.append(svgEl("line", {
      class: "grid-line",
      x1: pad.left,
      x2: pad.left + plotWidth,
      y1: y,
      y2: y
    }));
    svg.append(svgText(14, y + 4, String(value), "chart-label"));
  });

  svg.append(svgEl("line", {
    class: "axis-line",
    x1: pad.left,
    x2: width - pad.right,
    y1: pad.top + (yFor(maxScore) - pad.top),
    y2: pad.top + (yFor(maxScore) - pad.top)
  }));
  svg.append(svgEl("line", {
    class: "axis-line",
    x1: pad.left,
    x2: pad.left,
    y1: pad.top,
    y2: yFor(maxScore)
  }));
}

function createActionButton(label, action, id, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `text-button ${extraClass}`.trim();
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  return button;
}

function svgEl(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function svgText(x, y, text, className) {
  const element = svgEl("text", { x, y, class: className });
  element.textContent = text;
  return element;
}

function resetForm() {
  roundIdInput.value = "";
  courseInput.value = "";
  scoreInput.value = "";
  dateInput.value = todayForInput();
  notesInput.value = "";
  saveButton.textContent = "Save round";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#8a3324" : "";
}

function setSyncStatus(label = dataStore.label, mode = dataStore.mode) {
  syncStatusEl.textContent = viewerMode ? `${label} viewer` : label;
  syncStatusEl.dataset.mode = viewerMode ? "viewer" : mode;
}

function setLoading(isLoading) {
  saveButton.disabled = isLoading || viewerMode;
}

function sortedRoundsAscending(rounds) {
  return [...rounds].sort((a, b) => {
    const dateSort = a.date.localeCompare(b.date);
    if (dateSort !== 0) return dateSort;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

function sortedRoundsDescending(rounds) {
  return sortedRoundsAscending(rounds).reverse();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function uniqueSortedNumbers(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function todayForInput() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatShortDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `round-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
