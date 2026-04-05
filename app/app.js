import {
  BUN_HASH_SELF_TESTS,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  SPECIES,
  STAT_NAMES,
  matchesFilters,
  verifyBunHashCompatibility,
} from "./shared/buddy-core.js";
import { ASCII_WIDTH, buildAsciiPortrait, getEyeLabel } from "./shared/buddy-art.js";
import { getEffectiveWorkerCount } from "./shared/search-plan.js";
import { MESSAGES } from "./messages.js";

const DEFAULT_WORKERS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
const LOCALE_KEY = "claude_buddy_locale";
const PORTABLE_API_TOKEN = window.__CLAUDE_BUDDY_API_TOKEN__ || "";

const state = {
  locale: chooseInitialLocale(),
  mode: "random",
  portableMode: false,
  configStatus: null,
  pingTimer: null,
  retryTimer: null,
  finishTimer: null,
  currentView: "setup",
  metricFrame: null,
  displayAttempts: 0,
  displayMatches: 0,
  limitLocked: false,
  searchStartedAt: 0,
  appliedUserId: null,
  results: [],
  seenIds: new Set(),
  selectedUserId: null,
  isApplying: false,
  workers: [],
  searchWorkerCount: 0,
  isSearching: false,
  completedWorkers: 0,
  attemptsByWorker: new Map(),
  lastStatus: "",
};

const speciesGrid = document.querySelector("#speciesGrid");
const rarityRow = document.querySelector("#rarityRow");
const eyeRow = document.querySelector("#eyeRow");
const hatRow = document.querySelector("#hatRow");
const shinyRow = document.querySelector("#shinyRow");
const modeRow = document.querySelector("#modeRow");
const resultsList = document.querySelector("#resultsList");
const progressCard = document.querySelector("#progressCard");
const selectedSummary = document.querySelector("#selectedSummary");
const configSummary = document.querySelector("#configSummary");
const configLog = document.querySelector("#configLog");
const rollingFeedback = document.querySelector("#rollingFeedback");
const returnAfterFailureButton = document.querySelector("#returnAfterFailureButton");
const copyPowerShellButton = document.querySelector("#copyPowerShellButton");
const copyNodeButton = document.querySelector("#copyNodeButton");
const runButton = document.querySelector("#runButton");
const stopButton = document.querySelector("#stopButton");
const backToSetupButton = document.querySelector("#backToSetupButton");
const statusBanner = document.querySelector("#statusBanner");
const setupFilterSummary = document.querySelector("#setupFilterSummary");
const rollingFilterSummary = document.querySelector("#rollingFilterSummary");
const bytesField = document.querySelector("#bytesField");
const prefixField = document.querySelector("#prefixField");
const startField = document.querySelector("#startField");
const resultTemplate = document.querySelector("#resultTemplate");
const langButtons = Array.from(document.querySelectorAll(".lang-button"));
const stepPills = Array.from(document.querySelectorAll(".step-pill"));
const estimateCards = Array.from(document.querySelectorAll("[data-slot='estimate']"));
const hashCards = Array.from(document.querySelectorAll("[data-slot='hash']"));
const views = {
  setup: document.querySelector("#setupView"),
  rolling: document.querySelector("#rollingView"),
  result: document.querySelector("#resultView"),
};

function chooseInitialLocale() {
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    if (stored && MESSAGES[stored]) {
      return stored;
    }
  } catch {}

  return "en";
}

function saveLocale(locale) {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {}
}

function t(key) {
  return key.split(".").reduce((value, part) => value?.[part], MESSAGES[state.locale]) ?? key;
}

function formatMessage(key, params = {}) {
  return Object.entries(params).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    t(key),
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildAsciiPortraitMarkup(bones) {
  return buildAsciiPortrait(bones)
    .split("\n")
    .map((line) => {
      const cells = Array.from(line.padEnd(ASCII_WIDTH, " "))
        .slice(0, ASCII_WIDTH)
        .map((char) => `<span class="ascii-cell">${char === " " ? "&nbsp;" : escapeHtml(char)}</span>`)
        .join("");

      return `<span class="ascii-line">${cells}</span>`;
    })
    .join("");
}

function formatNumber(value) {
  return new Intl.NumberFormat(state.locale).format(value);
}

function totalAttempts() {
  return Array.from(state.attemptsByWorker.values()).reduce((sum, value) => sum + value, 0);
}

function stepMetric(current, target) {
  if (current === target) {
    return target;
  }

  const delta = target - current;
  const step = Math.max(1, Math.ceil(Math.abs(delta) * 0.18));
  const next = current + Math.sign(delta) * step;
  return Math.sign(delta) > 0 ? Math.min(next, target) : Math.max(next, target);
}

function stopMetricAnimation() {
  if (state.metricFrame !== null) {
    window.cancelAnimationFrame(state.metricFrame);
    state.metricFrame = null;
  }
}

function syncMetricDisplays(immediate = false) {
  const targetAttempts = totalAttempts();
  const targetMatches = state.results.length;

  if (immediate) {
    stopMetricAnimation();
    state.displayAttempts = targetAttempts;
    state.displayMatches = targetMatches;
    renderProgress();
    return;
  }

  if (state.metricFrame !== null) {
    return;
  }

  const tick = () => {
    const liveAttempts = totalAttempts();
    const liveMatches = state.results.length;
    state.displayAttempts = stepMetric(state.displayAttempts, liveAttempts);
    state.displayMatches = stepMetric(state.displayMatches, liveMatches);
    renderProgress();

    if (state.displayAttempts !== totalAttempts() || state.displayMatches !== state.results.length) {
      state.metricFrame = window.requestAnimationFrame(tick);
      return;
    }

    state.metricFrame = null;
  };

  state.metricFrame = window.requestAnimationFrame(tick);
}

function titleCase(value) {
  return value.replace(/(^|[-\s])([a-z])/g, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);
}

function labelValue(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return MESSAGES[state.locale].labels?.[value] ?? MESSAGES.en.labels?.[value] ?? titleCase(String(value));
}

function labelGroup(group) {
  return labelValue(group);
}

function labelEye(value) {
  return getEyeLabel(value, state.locale);
}

function uiText(key) {
  return t(`ui.${key}`);
}

function primaryApplyButtonText() {
  return state.isApplying ? t("apply.applying") : t("apply.apply_selected");
}

function secondaryApplyButtonText() {
  return t("apply.copy_user_id");
}

function updateApplyButtons() {
  copyPowerShellButton.textContent = primaryApplyButtonText();
  copyNodeButton.textContent = secondaryApplyButtonText();
}

function portableApiHeaders({ json = false } = {}) {
  const headers = {};
  if (PORTABLE_API_TOKEN) {
    headers["X-ClaudeBuddy-Token"] = PORTABLE_API_TOKEN;
  }
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function showView(viewName) {
  state.currentView = viewName;
  for (const [name, node] of Object.entries(views)) {
    node.classList.toggle("is-active", name === viewName);
  }

  stepPills.forEach((pill) => {
    pill.classList.toggle("is-active", pill.dataset.step === viewName);
  });
}

function renderStatus(message, isError = false) {
  const html = `<span class="status-pill ${isError ? "warn" : "good"}">${escapeHtml(message)}</span>`;
  statusBanner.innerHTML = html;
  configLog.innerHTML = html;
}

function clearRetryTimer() {
  if (state.retryTimer !== null) {
    window.clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
}

function clearFinishTimer() {
  if (state.finishTimer !== null) {
    window.clearTimeout(state.finishTimer);
    state.finishTimer = null;
  }
}

function hideRollingFeedback() {
  clearRetryTimer();
  rollingFeedback.classList.add("hidden");
  rollingFeedback.innerHTML = "";
  returnAfterFailureButton.classList.add("hidden");
}

function scheduleFinish(reason, callback) {
  clearFinishTimer();
  const minDwell = reason === "stopped" ? 0 : 850;
  const elapsed = performance.now() - state.searchStartedAt;
  const delay = Math.max(0, minDwell - elapsed);

  if (delay === 0) {
    callback();
    return;
  }

  state.finishTimer = window.setTimeout(() => {
    state.finishTimer = null;
    callback();
  }, delay);
}

function showRollingFailure() {
  if (hasImpossibleSearch()) {
    rollingFeedback.innerHTML = `
      <p class="telemetry-label">${escapeHtml(t("status.impossible"))}</p>
      <div class="telemetry-value compact">${escapeHtml(t("telemetry.estimate_impossible"))}</div>
      <p class="telemetry-copy">${escapeHtml(t("status.impossible_detail"))}</p>
    `;
    rollingFeedback.classList.remove("hidden");
    returnAfterFailureButton.classList.remove("hidden");
    renderTargetPanels();
    return;
  }

  const limitInput = document.querySelector("#limitInput");
  const currentLimit = clampNumber(limitInput.value, 1, Number.MAX_SAFE_INTEGER, 500000);
  const nextLimit = Math.min(Number.MAX_SAFE_INTEGER, currentLimit * 5);
  limitInput.value = String(nextLimit);
  rollingFeedback.innerHTML = `
    <p class="telemetry-label">${escapeHtml(t("rolling.not_found_title"))}</p>
    <div class="telemetry-value compact">${escapeHtml(t("rolling.not_found_copy"))}</div>
    <p class="telemetry-copy">${escapeHtml(formatMessage("rolling.doubled_limit", { limit: formatNumber(nextLimit) }))}</p>
  `;
  rollingFeedback.classList.remove("hidden");
  returnAfterFailureButton.classList.add("hidden");
  renderTargetPanels();
  state.retryTimer = window.setTimeout(() => {
    hideRollingFeedback();
    startSearch();
  }, 1600);
}

function createChip(label, value, groupName, active = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `chip${active ? " is-active" : ""}`;
  button.dataset.group = groupName;
  button.dataset.value = value;
  button.textContent = label;
  return button;
}

function applyStaticTranslations() {
  document.documentElement.lang = state.locale;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  updateApplyButtons();
  langButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.locale === state.locale);
  });
}

function renderFilterRows() {
  const filterGroups = [
    { container: speciesGrid, name: "species", items: SPECIES, any: "" },
    { container: rarityRow, name: "rarity", items: RARITIES, any: "" },
    { container: eyeRow, name: "eye", items: EYES, any: "" },
    { container: hatRow, name: "hat", items: HATS, any: "" },
    { container: shinyRow, name: "shiny", items: ["true", "false"], any: "any" },
  ];

  for (const { container, name, items, any } of filterGroups) {
    const activeValue = container.querySelector(".chip.is-active")?.dataset.value ?? any;
    container.innerHTML = "";
    container.append(createChip(t("options.any"), any, name, activeValue === any));

    for (const item of items) {
      let label = item;
      if (name === "shiny") {
        label = item === "true" ? t("options.shiny_only") : t("options.shiny_off");
      } else if (name === "eye") {
        label = labelEye(item);
      } else {
        label = labelValue(item);
      }

      container.append(createChip(label, item, name, activeValue === item));
    }
  }
}

function installLocaleHandlers() {
  langButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.locale === state.locale) {
        return;
      }

      state.locale = button.dataset.locale;
      saveLocale(state.locale);
      rerenderForLocale();
    });
  });
}

function installChipHandlers() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".chip");
    if (!button) {
      return;
    }

    const { group, value } = button.dataset;
    const row = button.parentElement;
    row.querySelectorAll(".chip").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");

    state.lastStatus = value
      ? formatMessage("status.filter_set", {
          label: labelValue(group),
          value: group === "eye" ? labelEye(value) : labelValue(value),
        })
      : formatMessage("status.filter_any", { label: labelValue(group) });

    refreshSuggestedLimit();
    renderHashStatus();
    renderSearchEstimate();
    renderTargetPanels();
  });
}

function installModeHandlers() {
  modeRow.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      modeRow.querySelectorAll(".mode-card").forEach((item) => item.classList.remove("selected"));
      card.classList.add("selected");
      state.mode = card.dataset.mode;
      state.lastStatus = state.mode === "random" ? t("status.mode_random") : t("status.mode_sequential");
      renderHashStatus();
      syncModeFields();
      renderTargetPanels();
    });
  });
}

function rerenderForLocale() {
  applyStaticTranslations();
  renderFilterRows();
  renderHashStatus();
  renderSearchEstimate();
  renderProgress();
  renderResults();
  renderSelectedSummary();
  renderConfigSummary();
  renderTargetPanels();
  showView(state.currentView);
}

function syncModeFields() {
  const sequential = state.mode === "sequential";
  bytesField.classList.toggle("hidden", sequential);
  prefixField.classList.toggle("hidden", !sequential);
  startField.classList.toggle("hidden", !sequential);
}

function activeValue(container) {
  return container.querySelector(".chip.is-active")?.dataset.value ?? "";
}

function collectFilters() {
  return {
    species: activeValue(speciesGrid),
    rarity: activeValue(rarityRow),
    eye: activeValue(eyeRow),
    hat: activeValue(hatRow),
    shiny: activeValue(shinyRow) || "any",
  };
}

function clampNumber(input, min, max, fallback) {
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function collectSearchOptions() {
  return {
    mode: state.mode,
    algorithm: document.querySelector("#algorithmInput").value,
    count: clampNumber(document.querySelector("#countInput").value, 1, 25, 1),
    limit: clampNumber(document.querySelector("#limitInput").value, 1, Number.MAX_SAFE_INTEGER, 500000),
    workers: clampNumber(document.querySelector("#workersInput").value, 1, 16, DEFAULT_WORKERS),
    bytes: clampNumber(document.querySelector("#bytesInput").value, 4, 64, 32),
    prefix: document.querySelector("#prefixInput").value || "buddy-",
    start: clampNumber(document.querySelector("#startInput").value, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function formatFilterValue(name, value) {
  if (!value || value === "any") {
    return t("telemetry.none_selected");
  }

  if (name === "eye") {
    return labelEye(value);
  }

  if (name === "shiny") {
    return value === "true" ? t("options.shiny_only") : t("options.shiny_off");
  }

  return labelValue(value);
}

function renderTargetPanels() {
  const filters = collectFilters();
  const options = collectSearchOptions();
  const html = `
    <p class="telemetry-label">${escapeHtml(t("telemetry.target_label"))}</p>
    <div class="fact-grid">
      ${buildFactCard(labelValue("species"), formatFilterValue("species", filters.species))}
      ${buildFactCard(labelValue("rarity"), formatFilterValue("rarity", filters.rarity))}
      ${buildFactCard(labelValue("eye"), formatFilterValue("eye", filters.eye))}
      ${buildFactCard(labelValue("hat"), formatFilterValue("hat", filters.hat))}
      ${buildFactCard(labelValue("shiny"), formatFilterValue("shiny", filters.shiny))}
      ${buildFactCard(
        t("setup.search_label"),
        formatMessage("setup.search_value", {
          count: formatNumber(options.count),
          limit: formatNumber(options.limit),
        }),
      )}
    </div>
  `;

  setupFilterSummary.innerHTML = html;
  rollingFilterSummary.innerHTML = html;
}

async function detectPortableMode() {
  if (!(window.location.protocol.startsWith("http") && window.location.hostname === "127.0.0.1")) {
    return false;
  }

  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.portable === true;
  } catch {
    return false;
  }
}

function startPortablePing() {
  if (!state.portableMode || state.pingTimer !== null) {
    return;
  }

  state.pingTimer = window.setInterval(() => {
    fetch("/api/ping", { cache: "no-store", headers: portableApiHeaders() }).catch(() => {});
  }, 15000);
}

async function refreshConfigStatus() {
  if (!state.portableMode) {
    state.configStatus = null;
    renderConfigSummary();
    return;
  }

  try {
    const response = await fetch("/api/config/status", { cache: "no-store", headers: portableApiHeaders() });
    if (!response.ok) {
      throw new Error("status unavailable");
    }

    state.configStatus = await response.json();
  } catch {
    state.configStatus = null;
  }

  renderConfigSummary();
}

function calculateHatProbability(hat, rarity) {
  if (!hat) {
    return 1;
  }

  if (rarity) {
    if (rarity === "common") {
      return hat === "none" ? 1 : 0;
    }
    return 1 / HATS.length;
  }

  if (hat === "none") {
    return (RARITY_WEIGHTS.common / 100) + ((100 - RARITY_WEIGHTS.common) / 100) * (1 / HATS.length);
  }

  return ((100 - RARITY_WEIGHTS.common) / 100) * (1 / HATS.length);
}

function calculateMatchProbability(filters = collectFilters()) {
  let probability = 1;

  if (filters.species) probability *= 1 / SPECIES.length;
  if (filters.rarity) probability *= RARITY_WEIGHTS[filters.rarity] / 100;
  if (filters.eye) probability *= 1 / EYES.length;
  probability *= calculateHatProbability(filters.hat, filters.rarity);
  if (filters.shiny === "true") probability *= 0.01;
  if (filters.shiny === "false") probability *= 0.99;

  return probability;
}

function hasImpossibleSearch(filters = collectFilters()) {
  return calculateMatchProbability(filters) <= 0;
}

function expectedAttemptCount(filters = collectFilters(), count = collectSearchOptions().count) {
  const probability = calculateMatchProbability(filters);
  if (probability <= 0) {
    return 500000;
  }

  const expected = Math.max(1, Math.round((1 / probability) * Math.max(1, count)));
  return Math.min(Number.MAX_SAFE_INTEGER, expected);
}

function refreshSuggestedLimit(force = false) {
  if (state.limitLocked && !force) {
    return;
  }

  const limitInput = document.querySelector("#limitInput");
  limitInput.value = String(expectedAttemptCount());
}

function formatHitRate(probability) {
  if (probability === 0) {
    return t("telemetry.estimate_impossible");
  }

  if (probability >= 0.01) {
    return `${(probability * 100).toFixed(2)}%`;
  }

  if (probability >= 0.0001) {
    return `${(probability * 100).toFixed(3)}%`;
  }

  return `1 / ${formatNumber(Math.round(1 / probability))}`;
}

function renderHashStatus() {
  const hashHealthy = verifyBunHashCompatibility();
  const headline = hashHealthy ? t("telemetry.hash_ready") : t("telemetry.hash_warning");
  const detail = state.lastStatus || formatMessage("status.hash_loaded", { count: BUN_HASH_SELF_TESTS.length });

  const html = `
    <p class="telemetry-label">${escapeHtml(t("telemetry.hash_label"))}</p>
    <div class="telemetry-value compact">${escapeHtml(headline)}</div>
    <p class="telemetry-copy">${escapeHtml(detail)}</p>
  `;

  hashCards.forEach((card) => {
    card.innerHTML = html;
  });
}

function renderSearchEstimate() {
  const filters = collectFilters();
  const probability = calculateMatchProbability(filters);

  if (probability === 0) {
    const html = `
      <p class="telemetry-label">${escapeHtml(t("telemetry.estimate_label"))}</p>
      <div class="telemetry-value">${escapeHtml(t("telemetry.estimate_impossible"))}</div>
      <p class="telemetry-copy">${escapeHtml(t("status.impossible_detail"))}</p>
    `;
    estimateCards.forEach((card) => {
      card.innerHTML = html;
    });
    updateSearchControls(filters);
    return;
  }

  const html = `
    <p class="telemetry-label">${escapeHtml(t("telemetry.estimate_label"))}</p>
    <div class="telemetry-value">${escapeHtml(formatHitRate(probability))}</div>
    <p class="telemetry-copy">${escapeHtml(formatMessage("telemetry.estimate_detail", { tries: formatNumber(Math.round(1 / probability)) }))}</p>
  `;
  estimateCards.forEach((card) => {
    card.innerHTML = html;
  });
  updateSearchControls(filters);
}

function renderProgress() {
  const attempts = state.displayAttempts;
  const matches = state.displayMatches;
  const selected = state.results.find((item) => item.userId === state.selectedUserId);

  progressCard.innerHTML = `
    <p class="telemetry-label">${escapeHtml(t("telemetry.progress_label"))}</p>
    <p class="telemetry-copy">${escapeHtml(state.isSearching ? t("status.search_started") : t("status.progress_idle"))}</p>
    <div class="metric-grid">
      <div class="metric-box">
        <p class="telemetry-label">${escapeHtml(t("status.progress_attempts"))}</p>
        <div class="metric-value metric-roll">${escapeHtml(formatNumber(attempts))}</div>
      </div>
      <div class="metric-box">
        <p class="telemetry-label">${escapeHtml(t("status.progress_matches"))}</p>
        <div class="metric-value metric-roll">${escapeHtml(formatNumber(matches))}</div>
      </div>
      <div class="metric-box">
        <p class="telemetry-label">${escapeHtml(t("status.progress_selected"))}</p>
        <div class="metric-value">${escapeHtml(selected ? labelValue(selected.bones.species) : t("status.progress_none"))}</div>
      </div>
    </div>
  `;
}

function buildFactCard(label, value, raw = false) {
  return `
    <div class="fact-card">
      <p class="fact-label">${escapeHtml(label)}</p>
      <span class="fact-value">${raw ? value : escapeHtml(value)}</span>
    </div>
  `;
}

function statCard(name, value) {
  return `
    <div class="stat-card">
      <p class="stat-name">${escapeHtml(labelValue(name))}</p>
      <span class="stat-value">${escapeHtml(value)}</span>
      <div class="stat-track"><span class="stat-fill" style="width:${value}%"></span></div>
    </div>
  `;
}

function renderConfigSummary() {
  const status = state.configStatus;
  const statusText = !state.portableMode
    ? t("apply.status_unavailable")
    : !status
      ? t("apply.status_loading")
      : status.parseError
        ? t("apply.status_error")
        : status.exists
          ? t("apply.status_ready")
          : t("apply.status_missing");
  const configPathValue = state.portableMode
    ? `<span class="mono">${escapeHtml(status?.configPath ?? "~/.claude.json")}</span>`
    : escapeHtml(t("apply.launch_portable"));
  const userIdValue = state.portableMode && status?.currentUserId
    ? `<span class="mono">${escapeHtml(status.currentUserId)}</span>`
    : escapeHtml(state.portableMode ? t("status.progress_none") : t("apply.host_missing"));
  configSummary.innerHTML = `
    <div class="fact-grid">
      ${buildFactCard(uiText("runtime_mode"), state.portableMode ? uiText("runtime_mode_portable") : uiText("runtime_mode_missing"))}
      ${buildFactCard(uiText("config_status"), statusText)}
      ${buildFactCard(uiText("script_config"), configPathValue, true)}
      ${buildFactCard(uiText("current_user_id"), userIdValue, true)}
      ${buildFactCard(uiText("script_backup"), document.querySelector("#backupInput").checked ? t("apply.shiny_yes") : t("apply.shiny_no"))}
      ${buildFactCard(uiText("script_remove_companion"), document.querySelector("#removeCompanionInput").checked ? t("apply.shiny_yes") : t("apply.shiny_no"))}
      ${buildFactCard(uiText("script_remove_account_uuid"), document.querySelector("#removeAccountUuidInput").checked ? t("apply.shiny_yes") : t("apply.shiny_no"))}
    </div>
  `;
}

function renderSelectedSummary() {
  const selected = state.results.find((item) => item.userId === state.selectedUserId);
  if (!selected) {
    selectedSummary.innerHTML = `<div class="empty-state">${escapeHtml(t("apply.selected_empty"))}</div>`;
    copyPowerShellButton.disabled = true;
    copyNodeButton.disabled = true;
    return;
  }

  selectedSummary.innerHTML = `
    <div class="selected-stage">
      ${
        state.appliedUserId === selected.userId
          ? `<div class="apply-success-banner">
              <p class="telemetry-label">${escapeHtml(t("apply.applied_banner_title"))}</p>
              <div class="telemetry-value compact">${escapeHtml(t("apply.applied_banner_copy"))}</div>
            </div>`
          : ""
      }
      <div class="selection-topline">
        <div>
          <p class="section-kicker">${escapeHtml(t("apply.stage_ready"))}</p>
          <h3 class="selection-id">${escapeHtml(selected.userId)}</h3>
          <p class="selection-subtitle">${escapeHtml(`${labelValue(selected.bones.species)} / ${labelValue(selected.bones.rarity)}`)}</p>
        </div>
        <span class="status-pill ${selected.bones.shiny ? "good" : ""}">${escapeHtml(selected.bones.shiny ? t("results.shiny") : t("results.standard"))}</span>
      </div>
      <div class="ascii-stage">
        <div>
          <p class="portrait-label">${escapeHtml(t("apply.selected_ascii"))}</p>
          <div class="ascii-portrait">${buildAsciiPortraitMarkup(selected.bones)}</div>
        </div>
      </div>
      <div class="fact-grid">
        ${buildFactCard(t("apply.selected_species"), labelValue(selected.bones.species))}
        ${buildFactCard(t("apply.selected_rarity"), labelValue(selected.bones.rarity))}
        ${buildFactCard(t("apply.selected_eye"), labelEye(selected.bones.eye))}
        ${buildFactCard(t("apply.selected_hat"), labelValue(selected.bones.hat))}
        ${buildFactCard(t("apply.selected_shiny"), selected.bones.shiny ? t("apply.shiny_yes") : t("apply.shiny_no"))}
        ${buildFactCard(t("apply.selected_user_id"), `<span class="mono">${escapeHtml(selected.userId)}</span>`, true)}
      </div>
      <div class="stats-grid">
        ${STAT_NAMES.map((name) => statCard(name, selected.bones.stats[name])).join("")}
      </div>
    </div>
  `;

  copyPowerShellButton.disabled = state.isApplying;
  copyNodeButton.disabled = false;
  updateApplyButtons();
}

function renderConfigLog(message, isError = false) {
  renderStatus(message, isError);
}

function renderResults() {
  if (state.results.length === 0) {
    resultsList.innerHTML = `<div class="empty-state">${escapeHtml(state.isSearching ? t("results.empty_searching") : t("results.empty_idle"))}</div>`;
    return;
  }

  resultsList.innerHTML = "";

  for (const item of state.results) {
    const node = resultTemplate.content.firstElementChild.cloneNode(true);
    node.classList.toggle("is-selected", item.userId === state.selectedUserId);
    node.querySelector(".result-species").textContent = `${labelValue(item.bones.species)} / ${labelValue(item.bones.rarity)}`;
    const selectionBadge = node.querySelector(".selection-badge");
    selectionBadge.textContent = item.userId === state.selectedUserId ? t("results.selected") : t("results.candidate");
    selectionBadge.classList.toggle("good", item.userId === state.selectedUserId);
    const rarityBadge = node.querySelector(".rarity-badge");
    rarityBadge.textContent = labelValue(item.bones.rarity);
    rarityBadge.dataset.rarity = item.bones.rarity;
    const shinyBadge = node.querySelector(".shiny-badge");
    shinyBadge.textContent = item.bones.shiny ? t("results.shiny") : t("results.standard");
    shinyBadge.classList.toggle("good", item.bones.shiny);
    node.querySelector(".result-id").textContent = item.userId;
    node.querySelector(".result-traits").textContent = formatMessage("results.traits", {
      eye: labelEye(item.bones.eye),
      hat: labelValue(item.bones.hat),
      algorithm: item.algorithm.toUpperCase(),
    });
    node.querySelector(".copy-button").textContent = t("results.copy_button");
    node.querySelector(".select-button").textContent = t("results.select_button");
    node.querySelector(".copy-button").addEventListener("click", async () => {
      await copyTextWithFallback(item.userId, {
        successMessage: formatMessage("status.copied", { userId: item.userId }),
        promptText: uiText("prompt_copy_user_id"),
      });
    });
    node.querySelector(".select-button").addEventListener("click", () => selectBuddy(item.userId));
    node.addEventListener("click", (event) => {
      if (!event.target.closest("button")) {
        selectBuddy(item.userId);
      }
    });
    resultsList.append(node);
  }
}

function resetSearchState() {
  stopMetricAnimation();
  clearFinishTimer();
  state.results = [];
  state.seenIds = new Set();
  state.selectedUserId = null;
  state.workers.forEach((worker) => worker.terminate());
  state.workers = [];
  state.searchWorkerCount = 0;
  state.completedWorkers = 0;
  state.attemptsByWorker = new Map();
  state.displayAttempts = 0;
  state.displayMatches = 0;
  renderResults();
  renderSelectedSummary();
  renderProgress();
}

function createSearchWorker() {
  if (window.__CLAUDE_BUDDY_WORKER_SOURCE__) {
    const blob = new Blob([window.__CLAUDE_BUDDY_WORKER_SOURCE__], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  }

  return new Worker("./search-worker.js", { type: "module" });
}

function updateSearchControls(filters = collectFilters()) {
  runButton.disabled = state.isSearching || hasImpossibleSearch(filters);
  stopButton.disabled = !state.isSearching;
}

function setSearching(searching) {
  state.isSearching = searching;
  updateSearchControls();
}

function haltWorkers() {
  state.workers.forEach((worker) => worker.postMessage({ type: "stop" }));
  state.workers.forEach((worker) => worker.terminate());
  state.workers = [];
  state.completedWorkers = state.searchWorkerCount;
  setSearching(false);
}

function finishSearch(reason) {
  syncMetricDisplays(true);
  renderProgress();
  renderResults();
  renderSelectedSummary();
  hideRollingFeedback();
  scheduleFinish(reason, () => {
    if (state.results.length > 0) {
      showView("result");
      if (reason === "stopped") {
        renderStatus(t("status.search_stopped"));
      } else if (reason === "done") {
        renderStatus(t("status.search_done"));
      } else {
        renderStatus(formatMessage("status.found_matches", { count: formatNumber(state.results.length) }));
      }
      return;
    }

    if (reason === "none") {
      showView("rolling");
      showRollingFailure();
      renderStatus(t("status.search_none"), true);
      return;
    }

    showView("setup");
    renderStatus(t("status.search_stopped"));
  });
}

function stopSearch(reason = "stopped") {
  haltWorkers();
  finishSearch(reason);
}

function maybeFinishSearch() {
  if (state.completedWorkers < state.searchWorkerCount) {
    return;
  }

  setSearching(false);
  finishSearch(state.results.length > 0 ? "done" : "none");
}

function startSearch() {
  const filters = collectFilters();
  if (hasImpossibleSearch(filters)) {
    hideRollingFeedback();
    showView("setup");
    renderStatus(t("status.impossible"), true);
    updateSearchControls(filters);
    return;
  }

  resetSearchState();
  hideRollingFeedback();
  state.searchStartedAt = performance.now();
  const options = collectSearchOptions();
  const workerCount = getEffectiveWorkerCount(options.workers, options.limit);
  setSearching(true);
  state.searchWorkerCount = workerCount;
  syncMetricDisplays(true);
  renderResults();
  showView("rolling");

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const worker = createSearchWorker();
    worker.onmessage = (event) => {
      const { data } = event;

      if (data.type === "progress") {
        state.attemptsByWorker.set(data.workerIndex, data.attempts);
        syncMetricDisplays();
        return;
      }

      if (data.type === "match") {
        state.attemptsByWorker.set(data.workerIndex, data.attempts);
        if (!state.seenIds.has(data.result.userId) && matchesFilters(data.result.bones, filters)) {
          state.seenIds.add(data.result.userId);
          state.results.push({ ...data.result, algorithm: options.algorithm });
          if (!state.selectedUserId) {
            state.selectedUserId = data.result.userId;
          }
          renderResults();
          renderSelectedSummary();
        }

        if (state.results.length >= options.count) {
          stopSearch("matches");
          return;
        }
        syncMetricDisplays();
        return;
      }

      if (data.type === "done") {
        state.attemptsByWorker.set(data.workerIndex, data.attempts);
        state.completedWorkers += 1;
        syncMetricDisplays();
        maybeFinishSearch();
        return;
      }

      if (data.type === "error") {
        renderStatus(data.error, true);
        stopSearch("stopped");
      }
    };

    worker.postMessage({ type: "start", payload: { filters, options: { ...options, workerIndex, workerCount } } });
    state.workers.push(worker);
    state.attemptsByWorker.set(workerIndex, 0);
  }

  renderStatus(t("status.search_started"));
}

function selectBuddy(userId) {
  state.selectedUserId = userId;
  renderResults();
  renderSelectedSummary();
  renderProgress();
  renderConfigLog(formatMessage("status.selected", { userId }));
}

function selectedBuddy() {
  return state.results.find((item) => item.userId === state.selectedUserId) ?? null;
}

async function applySelectedBuddy() {
  const selected = selectedBuddy();
  if (!selected) {
    return;
  }

  if (!state.portableMode) {
    renderConfigLog(t("status.runtime_missing"), true);
    return;
  }

  if (state.isApplying) {
    return;
  }

  state.isApplying = true;
  updateApplyButtons();
  copyPowerShellButton.disabled = true;

  try {
    const response = await fetch("/api/apply", {
      method: "POST",
      headers: portableApiHeaders({ json: true }),
      body: JSON.stringify({
        userId: selected.userId,
        backup: document.querySelector("#backupInput").checked,
        removeCompanion: document.querySelector("#removeCompanionInput").checked,
        removeAccountUuid: document.querySelector("#removeAccountUuidInput").checked,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || t("status.apply_failed"));
    }

    await refreshConfigStatus();
    state.appliedUserId = selected.userId;
    renderSelectedSummary();
    renderConfigLog(formatMessage("status.applied", { userId: selected.userId }));
  } catch (error) {
    renderConfigLog(error instanceof Error ? error.message : t("status.apply_failed"), true);
  } finally {
    state.isApplying = false;
    renderSelectedSummary();
  }
}

async function copyTextWithFallback(value, { successMessage, promptText }) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      renderConfigLog(successMessage);
      return;
    } catch {}
  }

  const promptResult = window.prompt(promptText, value);
  if (promptResult === null) {
    renderConfigLog(uiText("copy_cancelled"), true);
    return;
  }

  renderConfigLog(uiText("copy_manual"), true);
}

function installInputRerenderHandlers() {
  const rerender = () => {
    renderTargetPanels();
    renderSearchEstimate();
    renderConfigSummary();
  };
  const onLimitInput = () => {
    state.limitLocked = true;
    rerender();
  };
  const onCountInput = () => {
    refreshSuggestedLimit();
    rerender();
  };

  document.querySelector("#algorithmInput").addEventListener("change", rerender);
  document.querySelector("#countInput").addEventListener("input", onCountInput);
  document.querySelector("#countInput").addEventListener("change", onCountInput);
  document.querySelector("#limitInput").addEventListener("input", onLimitInput);
  document.querySelector("#limitInput").addEventListener("change", onLimitInput);
  document.querySelector("#workersInput").addEventListener("input", rerender);
  document.querySelector("#workersInput").addEventListener("change", rerender);
  document.querySelector("#bytesInput").addEventListener("input", rerender);
  document.querySelector("#bytesInput").addEventListener("change", rerender);
  document.querySelector("#prefixInput").addEventListener("input", rerender);
  document.querySelector("#prefixInput").addEventListener("change", rerender);
  document.querySelector("#startInput").addEventListener("input", rerender);
  document.querySelector("#startInput").addEventListener("change", rerender);
  document.querySelector("#backupInput").addEventListener("change", rerender);
  document.querySelector("#removeCompanionInput").addEventListener("change", rerender);
  document.querySelector("#removeAccountUuidInput").addEventListener("change", rerender);
}

async function initializeRuntimeMode() {
  state.portableMode = await detectPortableMode();
  updateApplyButtons();
  renderSelectedSummary();
  renderConfigSummary();

  if (state.portableMode) {
    startPortablePing();
    await refreshConfigStatus();
    return;
  }

  renderStatus(t("status.runtime_missing"), true);
}

function boot() {
  applyStaticTranslations();
  renderFilterRows();
  installLocaleHandlers();
  installChipHandlers();
  installModeHandlers();
  installInputRerenderHandlers();
  syncModeFields();
  renderHashStatus();
  renderSearchEstimate();
  renderTargetPanels();
  renderProgress();
  renderResults();
  renderSelectedSummary();
  renderConfigSummary();
  renderStatus(t("status.ready"));
  showView("setup");
  hideRollingFeedback();

  document.querySelector("#workersInput").value = String(DEFAULT_WORKERS);
  refreshSuggestedLimit(true);
  renderSearchEstimate();
  renderTargetPanels();
  runButton.addEventListener("click", startSearch);
  stopButton.addEventListener("click", () => stopSearch("stopped"));
  backToSetupButton.addEventListener("click", () => {
    hideRollingFeedback();
    showView("setup");
    renderStatus(t("status.ready"));
  });
  returnAfterFailureButton.addEventListener("click", () => {
    hideRollingFeedback();
    showView("setup");
    renderStatus(t("status.ready"));
  });

  copyPowerShellButton.addEventListener("click", () => {
    if (!state.selectedUserId) {
      return;
    }

    void applySelectedBuddy();
  });

  copyNodeButton.addEventListener("click", () => {
    if (!state.selectedUserId) {
      return;
    }

    void copyTextWithFallback(state.selectedUserId, {
      successMessage: formatMessage("status.copied", { userId: state.selectedUserId }),
      promptText: uiText("prompt_copy_user_id"),
    });
  });

  void initializeRuntimeMode();
}

boot();
