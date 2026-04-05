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
import { getEffectiveWorkerCount } from "./shared/search-plan.js";
import { MESSAGES } from "./messages.js";

const DEFAULT_WORKERS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
const LOCALE_KEY = "claude_buddy_locale";

const state = {
  locale: chooseInitialLocale(),
  mode: "random",
  results: [],
  seenIds: new Set(),
  selectedUserId: null,
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
const hashStatus = document.querySelector("#hashStatus");
const searchEstimate = document.querySelector("#searchEstimate");
const selectedSummary = document.querySelector("#selectedSummary");
const configSummary = document.querySelector("#configSummary");
const configLog = document.querySelector("#configLog");
const copyPowerShellButton = document.querySelector("#copyPowerShellButton");
const copyNodeButton = document.querySelector("#copyNodeButton");
const runButton = document.querySelector("#runButton");
const stopButton = document.querySelector("#stopButton");
const bytesField = document.querySelector("#bytesField");
const prefixField = document.querySelector("#prefixField");
const startField = document.querySelector("#startField");
const resultTemplate = document.querySelector("#resultTemplate");
const langButtons = Array.from(document.querySelectorAll(".lang-button"));

function chooseInitialLocale() {
  const stored = window.localStorage.getItem(LOCALE_KEY);
  if (stored && MESSAGES[stored]) {
    return stored;
  }

  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
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

function formatNumber(value) {
  return new Intl.NumberFormat(state.locale).format(value);
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

/*
function uiText(key) {
  const copy = {
    "copy_node_button": {
      "zh-CN": "复制 Node 命令",
      en: "Copy Node Command",
    },
    "copy_powershell_button": {
      "zh-CN": "复制 PowerShell 命令",
      en: "Copy PowerShell Command",
    },
    "script_name": {
      "zh-CN": "应用脚本",
      en: "Apply Script",
    },
    "script_mode": {
      "zh-CN": "推荐方式",
      en: "Recommended Mode",
    },
    "script_mode_value": {
      "zh-CN": "复制命令后在 PowerShell 执行",
      en: "Copy the command and run it in PowerShell",
    },
    "script_config": {
      "zh-CN": "目标配置",
      en: "Target Config",
    },
    "script_backup": {
      "zh-CN": "写入前备份",
      en: "Backup Before Write",
    },
    "script_remove_companion": {
      "zh-CN": "清理 companion",
      en: "Remove companion",
    },
    "script_remove_account_uuid": {
      "zh-CN": "清理 accountUuid",
      en: "Remove accountUuid",
    },
    "copied_powershell": {
      "zh-CN": "已复制 PowerShell 命令",
      en: "Copied the PowerShell command",
    },
    "copied_node": {
      "zh-CN": "已复制 Node 命令",
      en: "Copied the Node command",
    },
  };

  return copy[key]?.[state.locale] ?? copy[key]?.en ?? key;
}

*/
function uiText(key) {
  return t(`ui.${key}`);
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
  copyPowerShellButton.textContent = uiText("copy_powershell_button");
  copyNodeButton.textContent = uiText("copy_node_button");

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
      } else if (name !== "eye") {
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
      window.localStorage.setItem(LOCALE_KEY, state.locale);
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
      ? formatMessage("status.filter_set", { label: labelGroup(group), value: group === "eye" ? value : labelValue(value) })
      : formatMessage("status.filter_any", { label: labelGroup(group) });

    renderHashStatus();
    renderSearchEstimate();
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

function renderHashStatus() {
  const headline = verifyBunHashCompatibility() ? t("status.hash_ok") : t("status.hash_fail");
  const detail = state.lastStatus || formatMessage("status.hash_loaded", { count: BUN_HASH_SELF_TESTS.length });

  hashStatus.innerHTML = `<strong>${escapeHtml(headline)}</strong><div>${escapeHtml(detail)}</div>`;
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

function formatProbability(probability) {
  return probability >= 0.01 ? `${(probability * 100).toFixed(2)}%` : probability.toExponential(2);
}

function renderSearchEstimate() {
  const filters = collectFilters();
  let probability = 1;

  if (filters.species) probability *= 1 / SPECIES.length;
  if (filters.rarity) probability *= RARITY_WEIGHTS[filters.rarity] / 100;
  if (filters.eye) probability *= 1 / EYES.length;
  probability *= calculateHatProbability(filters.hat, filters.rarity);
  if (filters.shiny === "true") probability *= 0.01;
  if (filters.shiny === "false") probability *= 0.99;

  if (probability === 0) {
    searchEstimate.innerHTML = `<strong>${escapeHtml(t("status.impossible"))}</strong><div>${escapeHtml(t("status.impossible_detail"))}</div>`;
    return;
  }

  searchEstimate.innerHTML = `
    <strong>${escapeHtml(formatMessage("status.estimate", { rate: formatProbability(probability) }))}</strong>
    <div>${escapeHtml(formatMessage("status.estimate_detail", { tries: formatNumber(Math.round(1 / probability)) }))}</div>
  `;
}

function renderProgress() {
  const attempts = Array.from(state.attemptsByWorker.values()).reduce((sum, value) => sum + value, 0);
  const selected = state.results.find((item) => item.userId === state.selectedUserId);

  if (!state.isSearching && attempts === 0) {
    progressCard.innerHTML = `<div class="empty-state">${escapeHtml(t("status.progress_idle"))}</div>`;
    return;
  }

  progressCard.innerHTML = `
    <div class="progress-grid">
      <div class="metric">
        <div class="metric-label">${escapeHtml(t("status.progress_attempts"))}</div>
        <div class="metric-value">${escapeHtml(formatNumber(attempts))}</div>
      </div>
      <div class="metric">
        <div class="metric-label">${escapeHtml(t("status.progress_matches"))}</div>
        <div class="metric-value">${escapeHtml(formatNumber(state.results.length))}</div>
      </div>
      <div class="metric">
        <div class="metric-label">${escapeHtml(t("status.progress_selected"))}</div>
        <div class="metric-value">${escapeHtml(selected ? labelValue(selected.bones.species) : t("status.progress_none"))}</div>
      </div>
    </div>
  `;
}

function buildSummaryRow(key, value, raw = false) {
  return `<div class="summary-row"><span class="summary-key">${escapeHtml(key)}</span><span class="summary-value">${raw ? value : escapeHtml(value)}</span></div>`;
}

function renderConfigSummary() {
  configSummary.innerHTML = [
    buildSummaryRow(uiText("script_name"), `<span class="mono">apply-userid.ps1</span>`, true),
    buildSummaryRow(uiText("script_mode"), uiText("script_mode_value")),
    buildSummaryRow(uiText("script_config"), `<span class="mono">~/.claude.json</span>`, true),
    buildSummaryRow(uiText("script_backup"), document.querySelector("#backupInput").checked ? t("apply.shiny_yes") : t("apply.shiny_no")),
    buildSummaryRow(uiText("script_remove_companion"), document.querySelector("#removeCompanionInput").checked ? t("apply.shiny_yes") : t("apply.shiny_no")),
    buildSummaryRow(uiText("script_remove_account_uuid"), document.querySelector("#removeAccountUuidInput").checked ? t("apply.shiny_yes") : t("apply.shiny_no")),
  ].join("");
}

function renderSelectedSummary() {
  const selected = state.results.find((item) => item.userId === state.selectedUserId);
  if (!selected) {
    selectedSummary.innerHTML = `<div class="empty-state">${escapeHtml(t("apply.selected_empty"))}</div>`;
    copyPowerShellButton.disabled = true;
    copyNodeButton.disabled = true;
    return;
  }

  selectedSummary.innerHTML = [
    buildSummaryRow(t("apply.selected_user_id"), `<span class="mono">${escapeHtml(selected.userId)}</span>`, true),
    buildSummaryRow(t("apply.selected_species"), labelValue(selected.bones.species)),
    buildSummaryRow(t("apply.selected_rarity"), labelValue(selected.bones.rarity)),
    buildSummaryRow(t("apply.selected_eye"), selected.bones.eye),
    buildSummaryRow(t("apply.selected_hat"), labelValue(selected.bones.hat)),
    buildSummaryRow(
      t("apply.selected_shiny"),
      selected.bones.shiny ? `<span class="pill good">${escapeHtml(t("apply.shiny_yes"))}</span>` : `<span class="pill">${escapeHtml(t("apply.shiny_no"))}</span>`,
      true,
    ),
  ].join("");

  copyPowerShellButton.disabled = false;
  copyNodeButton.disabled = false;
  copyNodeButton.textContent = uiText("copy_node_button");
}

function renderConfigLog(message, isError = false) {
  configLog.innerHTML = `<span class="pill ${isError ? "warn" : "good"}">${escapeHtml(message)}</span>`;
}

function statRow(name, value) {
  const statLabel = labelValue(name);
  return `
    <div class="stat-row">
      <div class="stat-topline"><span>${escapeHtml(statLabel)}</span><span>${escapeHtml(value)}</span></div>
      <div class="stat-bar"><div class="stat-bar-fill" style="width: ${value}%"></div></div>
    </div>
  `;
}

function renderResults() {
  if (state.results.length === 0) {
    resultsList.innerHTML = `<div class="info-card empty-state">${escapeHtml(state.isSearching ? t("results.empty_searching") : t("results.empty_idle"))}</div>`;
    return;
  }

  resultsList.innerHTML = "";

  for (const item of state.results) {
    const node = resultTemplate.content.firstElementChild.cloneNode(true);
    node.classList.toggle("is-selected", item.userId === state.selectedUserId);
    node.querySelector(".species-badge").textContent = labelValue(item.bones.species);
    node.querySelector(".rarity-badge").textContent = labelValue(item.bones.rarity);
    node.querySelector(".rarity-badge").dataset.rarity = item.bones.rarity;
    node.querySelector(".shiny-badge").textContent = item.bones.shiny ? t("results.shiny") : t("results.standard");
    node.querySelector(".result-id").textContent = item.userId;
    node.querySelector(".result-traits").textContent = formatMessage("results.traits", {
      eye: item.bones.eye,
      hat: labelValue(item.bones.hat),
      algorithm: item.algorithm,
    });
    node.querySelector(".stats-grid").innerHTML = STAT_NAMES.map((name) => statRow(name, item.bones.stats[name])).join("");
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
  state.results = [];
  state.seenIds = new Set();
  state.selectedUserId = null;
  state.workers.forEach((worker) => worker.terminate());
  state.workers = [];
  state.searchWorkerCount = 0;
  state.completedWorkers = 0;
  state.attemptsByWorker = new Map();
  renderResults();
  renderSelectedSummary();
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

function setSearching(searching) {
  state.isSearching = searching;
  runButton.disabled = searching;
  stopButton.disabled = !searching;
}

function stopSearch() {
  state.workers.forEach((worker) => worker.postMessage({ type: "stop" }));
  state.workers.forEach((worker) => worker.terminate());
  state.workers = [];
  state.completedWorkers = state.searchWorkerCount;
  setSearching(false);
  renderProgress();
  renderResults();
  renderConfigLog(t("status.search_stopped"));
}

function maybeFinishSearch() {
  if (state.completedWorkers < state.searchWorkerCount) {
    return;
  }

  setSearching(false);
  renderProgress();
  renderResults();
  renderConfigLog(state.results.length > 0 ? t("status.search_done") : t("status.search_none"));
}

function startSearch() {
  resetSearchState();
  const filters = collectFilters();
  const options = collectSearchOptions();
  const workerCount = getEffectiveWorkerCount(options.workers, options.limit);
  setSearching(true);
  state.searchWorkerCount = workerCount;
  renderProgress();
  renderResults();

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const worker = createSearchWorker();
    worker.onmessage = (event) => {
      const { data } = event;
      if (data.type === "progress") {
        state.attemptsByWorker.set(data.workerIndex, data.attempts);
        renderProgress();
        return;
      }
      if (data.type === "match") {
        state.attemptsByWorker.set(data.workerIndex, data.attempts);
        if (!state.seenIds.has(data.result.userId) && matchesFilters(data.result.bones, filters)) {
          state.seenIds.add(data.result.userId);
          state.results.push({ ...data.result, algorithm: options.algorithm });
          if (!state.selectedUserId) state.selectedUserId = data.result.userId;
          renderResults();
          renderSelectedSummary();
        }
        if (state.results.length >= options.count) {
          stopSearch();
          renderConfigLog(formatMessage("status.found_matches", { count: formatNumber(state.results.length) }));
        } else {
          renderProgress();
        }
        return;
      }
      if (data.type === "done") {
        state.attemptsByWorker.set(data.workerIndex, data.attempts);
        state.completedWorkers += 1;
        renderProgress();
        maybeFinishSearch();
        return;
      }
      if (data.type === "error") {
        renderConfigLog(data.error, true);
        stopSearch();
      }
    };

    worker.postMessage({ type: "start", payload: { filters, options: { ...options, workerIndex, workerCount } } });
    state.workers.push(worker);
    state.attemptsByWorker.set(workerIndex, 0);
  }

  renderConfigLog(t("status.search_started"));
}

function selectBuddy(userId) {
  state.selectedUserId = userId;
  renderResults();
  renderSelectedSummary();
  renderProgress();
  renderConfigLog(formatMessage("status.selected", { userId }));
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildPowerShellCommand(userId) {
  const flags = [];
  if (!document.querySelector("#backupInput").checked) flags.push("-NoBackup");
  if (!document.querySelector("#removeCompanionInput").checked) flags.push("-KeepCompanion");
  if (!document.querySelector("#removeAccountUuidInput").checked) flags.push("-KeepAccountUuid");
  return [
    "powershell.exe",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ".\\apply-userid.ps1",
    "-UserId",
    quotePowerShellLiteral(userId),
    ...flags,
  ].join(" ");
}

function buildNodeCommand(userId) {
  const flags = [];
  if (!document.querySelector("#backupInput").checked) flags.push("--no-backup");
  if (!document.querySelector("#removeCompanionInput").checked) flags.push("--keep-companion");
  if (!document.querySelector("#removeAccountUuidInput").checked) flags.push("--keep-account-uuid");
  return ["node", ".\\apply-userid.mjs", quotePowerShellLiteral(userId), ...flags].join(" ");
}

/*async function copyCommand(command, messageKey) {
  try {
    await navigator.clipboard.writeText(command);
    renderConfigLog(uiText(messageKey));
  } catch (error) {
    window.prompt(state.locale === "zh-CN" ? "复制下面这条命令" : "Copy this command", command);
    renderConfigLog(uiText(messageKey));
  }
}

*/
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

async function copyCommand(command, messageKey) {
  await copyTextWithFallback(command, {
    successMessage: uiText(messageKey),
    promptText: uiText("prompt_copy_command"),
  });
}

function boot() {
  applyStaticTranslations();
  renderFilterRows();
  installLocaleHandlers();
  installChipHandlers();
  installModeHandlers();
  syncModeFields();
  renderHashStatus();
  renderSearchEstimate();
  renderProgress();
  renderResults();
  renderSelectedSummary();
  renderConfigSummary();
  renderConfigLog(t("status.ready"));
  document.querySelector("#workersInput").value = String(DEFAULT_WORKERS);
  document.querySelector("#backupInput").addEventListener("change", renderConfigSummary);
  document.querySelector("#removeCompanionInput").addEventListener("change", renderConfigSummary);
  document.querySelector("#removeAccountUuidInput").addEventListener("change", renderConfigSummary);
  runButton.addEventListener("click", startSearch);
  stopButton.addEventListener("click", stopSearch);
  copyPowerShellButton.addEventListener("click", () => state.selectedUserId && copyCommand(buildPowerShellCommand(state.selectedUserId), "copied_powershell"));
  copyNodeButton.addEventListener("click", () => state.selectedUserId && copyCommand(buildNodeCommand(state.selectedUserId), "copied_node"));
}

boot();
