"use strict";

const VOG_WEB_VERSION = "8.38";
document.documentElement.dataset.vogWebVersion = VOG_WEB_VERSION;

const API_BASE = "https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net";
const SESSION_KEY = "trt_web_session";
const TRT_MAP_VIEW_KEY = "trt_web_map_view_v3";
const TRT_MAP_FILTER_KEY = "trt_web_map_filters_v1";
const TRT_MAP_MODE_KEY = "trt_web_map_mode_v1";
const DEFAULT_MAP_VIEW = Object.freeze({ center: [58.3, 47.0], zoom: 5 });
const PAGES = new Set(["employees", "sales-import", "trt-directory", "activity", "tasks", "visits", "trt", "region-analytics", "logistics", "trt-master-audit"]);

const state = {
  token: localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "",
  user: null,
  employees: [],
  activity: [],
  activityLoaded: false,
  tasks: [],
  tasksLoaded: false,
  taskSelectedId: "",
  visits: [],
  visitsLoaded: false,
  visitSelectedId: "",
  media: [],
  mediaLoaded: false,
  mediaPreviewUrls: new Map(),
  mediaPreviewRequests: new Map(),
  mediaPreviewItems: [],
  mediaPreviewIndex: -1,
  trtPoints: [],
  trtLoaded: false,
  trtSelectedId: "",
  trtFitRequested: true,
  logistics: { loaded: false, trips: [], summary: {}, dictionaries: null, aliasCatalog: null, aliasMap: new Map(), suggestionMap: new Map(), preview: null, sourceTrips: [], fileName: "", observedWarehouses: [], observedVehicles: [], matchResults: new Map(), uniqueMatchItems: [] },
  marketAnalysis: { loaded: false, catalog: null, plans: [], diy: [], staticPlanSources: [], staticPlanRows: null, staticPlanStats: null, staticPlanCacheKey: "" },
  trtMasterAudit: { loaded: false, loading: false, rows: [], summary: {}, error: "", currentWebMatched: 0, currentWebTotal: 0 },
  currentPage: PAGES.has(location.hash.slice(1)) ? location.hash.slice(1) : "trt",
};

let trtMap = null;
let trtMarkerLayer = null;
let trtRegionLayer = null;
let trtCityLabelLayer = null;
let trtRegionsLoading = false;
let trtInspectorMode = "";
let trtInspectorRegion = null;
let trtSmartFilters = [];
let trtSmartSuggestions = [];
let trtSmartSuggestionIndex = -1;
let trtSalesChart = null;
let trtCardSalesChart = null;
let trtCardFdiyShareChart = null;
let trtCardFdiySalesMode = "vog";
let trtAnalyticsChart = null;
let trtStructureChart = null;
let trtMainView = "map";
let trtAnalyticsTab = "dynamics";
let trtAnalyticsSelectedFormats = new Set();
let trtAnalyticsFormatAnchorIndex = null;
let mediaPreviewLoadSequence = 0;
let mediaPreviewTouchStartX = null;
let logisticsActiveTab = "overview";
let warehouseMap = null;
let warehouseMarker = null;
let trtManualMap = null;
let trtManualMarker = null;
let trtManualCityLabelLayer = null;
let trtManualReverseSequence = 0;
let trtManualAddressSuggestTimer = null;
let trtManualAddressSuggestAbort = null;
let trtManualAddressSuggestions = [];
let trtManualAddressSuggestionIndex = -1;
let marketAnalysisDirection = "обои";
let marketAnalysisYear = 2026;
let marketAnalysisMonth = 7;

const STATIC_MARKET_PLAN_SOURCES = Object.freeze([
  { url: "trt_plan_wallpaper_2026.json?v=20260811-v8-16", direction: "обои", optional: false },
  { url: "trt_plan_tile_2026.json?v=20260811-v8-16", direction: "плитка", optional: true },
]);

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortPersonName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

function userRoleLabel(user) {
  const role = String(user?.role || "").trim().toUpperCase();
  const labels = {
    GD: "Генеральный директор",
    KD: "Коммерческий директор",
    RRO: "Руководитель регионального отдела",
    MANAGER: "Менеджер",
  };
  return labels[role] || String(user?.roleLabel || user?.role_label || user?.position || "Сотрудник").trim();
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function resetProtectedState() {
  state.employees = [];
  state.activity = [];
  state.activityLoaded = false;
  state.tasks = [];
  state.tasksLoaded = false;
  state.taskSelectedId = "";
  state.visits = [];
  state.visitsLoaded = false;
  state.visitSelectedId = "";
  state.media = [];
  state.mediaLoaded = false;
  state.mediaPreviewUrls.clear();
  state.mediaPreviewRequests.clear();
  state.mediaPreviewItems = [];
  state.mediaPreviewIndex = -1;
  state.trtPoints = [];
  state.trtLoaded = false;
  state.trtSelectedId = "";
  state.trtFitRequested = true;
  state.logistics = { loaded: false, trips: [], summary: {}, dictionaries: null, aliasCatalog: null, aliasMap: new Map(), suggestionMap: new Map(), preview: null, sourceTrips: [], fileName: "", observedWarehouses: [], matchResults: new Map(), uniqueMatchItems: [] };
  state.marketAnalysis = { loaded: false, catalog: null, plans: [], diy: [], staticPlanSources: [], staticPlanRows: null, staticPlanStats: null, staticPlanCacheKey: "" };
  state.trtMasterAudit = { loaded: false, loading: false, rows: [], summary: {}, error: "", currentWebMatched: 0, currentWebTotal: 0 };
  fdiyDirectoryState = { loaded: false, loading: false, clients: [], networks: [], summary: {} };
  fdiyImportState = { rows: [], preview: null, fileName: "", mode: "", sourceSheet: "", historical: false, detectedPeriodCount: 0 };
}

function isGeneralDirector() {
  return String(state.user?.role || "").toUpperCase() === "GD";
}

function isSystemAdmin() {
  return state.user?.is_admin === true || state.user?.isAdmin === true;
}


function setNavGroupExpanded(groupName, expanded) {
  const button = document.querySelector(`[data-nav-group="${groupName}"]`);
  const submenu = document.querySelector(`[data-nav-submenu="${groupName}"]`);
  if (!button || !submenu) return;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  submenu.hidden = !expanded;
}

function syncSidebarNavigation(page) {
  const isSettings = page === "employees" || page === "sales-import" || page === "trt-directory" || page === "activity" || page === "trt-master-audit";
  const isAnalytics = page === "logistics" || page === "region-analytics";
  if (isSettings) setNavGroupExpanded("settings", true);
  if (isAnalytics) setNavGroupExpanded("analytics", true);

  document.querySelectorAll(".main-nav > .nav-item, .main-nav .nav-parent").forEach((button) => {
    let active = false;
    if (button.dataset.page) active = button.dataset.page === page;
    if (button.dataset.navGroup === "settings") active = isSettings;
    if (button.dataset.navGroup === "analytics") active = isAnalytics;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  document.querySelectorAll(".nav-subitem").forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout || 30000);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Сервер не ответил вовремя. Проверьте интернет и повторите попытку.");
    }
    throw new Error("Нет связи с сервером. Проверьте интернет и повторите попытку.");
  } finally {
    window.clearTimeout(timeout);
  }

  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; }
  catch { data = { error: responseText || "Некорректный ответ сервера." }; }

  if (response.status === 401 && path !== "/auth/login") {
    clearSession();
    showLogin();
  }
  if (!response.ok) throw new Error(data.error || `Ошибка сервера: ${response.status}`);
  return data;
}

function clearSession() {
  state.token = "";
  state.user = null;
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(TRT_MAP_VIEW_KEY);
  resetProtectedState();

  if (trtMap) {
    trtMap.off();
    trtMap.remove();
    trtMap = null;
    trtMarkerLayer = null;
    trtRegionLayer = null;
    trtCityLabelLayer = null;
    trtRegionsLoading = false;
    trtInspectorMode = "";
    trtInspectorRegion = null;
  }
}

let loginWasEntered = false;
let passwordWasEntered = false;
let autofillGuardTimer = null;

function getLoginInput() {
  return document.querySelector("[data-login-field]");
}

function getPasswordInput() {
  return document.querySelector("[data-password-field]");
}

function updateLoginButton() {
  const loginInput = getLoginInput();
  const passwordInput = getPasswordInput();
  const button = $("login-button");
  if (!button) return;
  button.disabled = !(
    loginInput
    && passwordInput
    && loginWasEntered
    && passwordWasEntered
    && loginInput.value.trim()
    && passwordInput.value
  );
}

function stopAutofillGuard() {
  if (autofillGuardTimer) {
    window.clearInterval(autofillGuardTimer);
    autofillGuardTimer = null;
  }
}

function protectFieldFromAutofill(input, kind) {
  const markManual = () => {
    if (kind === "login") loginWasEntered = true;
    else passwordWasEntered = true;
    input.readOnly = false;
    window.setTimeout(updateLoginButton, 0);
  };

  input.addEventListener("pointerdown", () => {
    input.readOnly = false;
    if (input.value && !(kind === "login" ? loginWasEntered : passwordWasEntered)) {
      input.value = "";
    }
  });
  input.addEventListener("focus", () => {
    input.readOnly = false;
    if (input.value && !(kind === "login" ? loginWasEntered : passwordWasEntered)) {
      input.value = "";
    }
  });
  input.addEventListener("keydown", markManual);
  input.addEventListener("paste", markManual);
  input.addEventListener("input", () => {
    const manual = kind === "login" ? loginWasEntered : passwordWasEntered;
    if (!manual) input.value = "";
    updateLoginButton();
  });
}

function openLoginForm() {
  const form = $("login-form");
  const fields = $("login-fields");
  const template = $("login-fields-template");
  const openButton = $("open-login-form-button");

  fields.replaceChildren(template.content.cloneNode(true));
  const loginInput = getLoginInput();
  const passwordInput = getPasswordInput();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  loginInput.id = `user_${suffix}`;
  loginInput.name = `user_${suffix}`;
  passwordInput.id = `secret_${suffix}`;
  passwordInput.name = `secret_${suffix}`;
  loginInput.value = "";
  passwordInput.value = "";
  loginInput.readOnly = true;
  passwordInput.readOnly = true;
  loginWasEntered = false;
  passwordWasEntered = false;

  protectFieldFromAutofill(loginInput, "login");
  protectFieldFromAutofill(passwordInput, "password");

  form.hidden = false;
  openButton.hidden = true;
  updateLoginButton();

  stopAutofillGuard();
  let checks = 0;
  autofillGuardTimer = window.setInterval(() => {
    checks += 1;
    if (!loginWasEntered && loginInput.value) loginInput.value = "";
    if (!passwordWasEntered && passwordInput.value) passwordInput.value = "";
    updateLoginButton();
    if (checks >= 40 || (loginWasEntered && passwordWasEntered)) stopAutofillGuard();
  }, 100);
}

function resetLoginForm() {
  stopAutofillGuard();
  $("login-fields").replaceChildren();
  $("login-form").hidden = true;
  $("open-login-form-button").hidden = false;
  $("login-button").disabled = true;
  loginWasEntered = false;
  passwordWasEntered = false;
  $("login-error").hidden = true;
}

function showLogin() {
  $("session-bootstrap").hidden = true;
  $("app-shell").hidden = true;
  $("login-screen").hidden = false;
  resetLoginForm();
}


function mountTrtToolsInMainSidebar() {
  const mainSidebar = document.querySelector(".sidebar");
  const trtTools = document.querySelector(".legacy-trt-sidebar");
  if (!mainSidebar || !trtTools || trtTools.dataset.mountedInMainSidebar === "true") return;
  trtTools.dataset.mountedInMainSidebar = "true";
  trtTools.classList.add("main-sidebar-trt-tools");
  mainSidebar.append(trtTools);
  trtTools.hidden = state.currentPage !== "trt";
}


function mountTrtCardInInspector() {
  const card = $("trt-map-card");
  const host = $("trt-inspector-card-host");
  if (!card || !host || card.parentElement === host) return;
  host.append(card);
}

function setMapInspectorView(mode) {
  trtInspectorMode = mode || "";
  const shell = $("app-shell");
  const inspector = $("map-inspector");
  if (!shell || !inspector) return;

  const validMode = ["trt", "region"].includes(trtInspectorMode);
  inspector.hidden = !validMode;
  shell.classList.toggle("map-inspector-active", validMode);
  shell.classList.toggle("map-inspector-trt", trtInspectorMode === "trt");
  shell.classList.toggle("map-inspector-region", trtInspectorMode === "region");

  $("trt-inspector-view").hidden = trtInspectorMode !== "trt";
  $("region-inspector-view").hidden = trtInspectorMode !== "region";

  const kicker = $("map-inspector-kicker");
  const status = $("map-inspector-status");
  if (kicker) kicker.textContent = trtInspectorMode === "region" ? "Карточка региона" : "Карточка ТРТ";
  if (status) status.textContent = trtInspectorMode === "region" ? "Регионы присутствия ВОГ" : "";

  const trtTools = document.querySelector(".main-sidebar-trt-tools");
  if (trtTools) trtTools.hidden = validMode || state.currentPage !== "trt";

  window.setTimeout(() => trtMap?.invalidateSize(), 320);
}

function closeMapInspector() {
  if (trtCardSalesChart) {
    trtCardSalesChart.destroy();
    trtCardSalesChart = null;
  }
  if ($("trt-sales-modal") && !$("trt-sales-modal").hidden) closeTrtSales();
  trtInspectorRegion = null;
  state.trtSelectedId = "";
  if ($("trt-map-empty")) $("trt-map-empty").hidden = false;
  setMapInspectorView("");
}

function openTrtInspector() {
  mountTrtCardInInspector();
  setMapInspectorView("trt");
}

function showPage(page, updateHash = true) {
  let nextPage = PAGES.has(page) ? page : "trt";
  if (["employees", "sales-import", "trt-directory", "activity", "trt-master-audit"].includes(nextPage) && !isSystemAdmin()) nextPage = "trt";
  state.currentPage = nextPage;
  if (nextPage !== "trt" && trtInspectorMode) closeMapInspector();
  mountTrtToolsInMainSidebar();
  const trtTools = document.querySelector(".main-sidebar-trt-tools");
  if (trtTools) trtTools.hidden = nextPage !== "trt";

  document.querySelectorAll(".page-view").forEach((section) => {
    section.hidden = section.id !== `page-${nextPage}`;
  });

  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === nextPage && !button.dataset.trtView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  syncSidebarNavigation(nextPage);

  if (updateHash && location.hash !== `#${nextPage}`) {
    history.replaceState(null, "", `#${nextPage}`);
  }

  if (nextPage === "employees" && state.token && state.employees.length === 0) {
    loadEmployees();
  }
  if (nextPage === "sales-import") { initializeSalesImportPeriod(); initializeTrtBulkImport(); initializeFdiyPeriods(); loadFdiyDirectory(); }
  if (nextPage === "trt-directory" && state.token) { loadFdiyDirectory(); }
  if (nextPage === "logistics") { initializeLogisticsPeriod(); loadLogistics(); }
  if (nextPage === "region-analytics") { loadRegionAnalyticsDirectory(); }
  if (nextPage === "trt-master-audit" && state.token) { loadTrtMasterAudit(); }

  if (nextPage === "activity" && state.token) {
    loadActivity();
  }

  if (nextPage === "tasks" && state.token) {
    loadTasks();
  }

  if (nextPage === "visits" && state.token) {
    loadVisits(true);
  }

  if (nextPage === "trt") {
    if (trtMainView !== "map") setTrtMainView("map");
    loadTrtMap();
    window.setTimeout(() => trtMap?.invalidateSize(), 80);
  }
}

function showApp() {
  $("session-bootstrap").hidden = true;
  $("login-screen").hidden = true;
  $("app-shell").hidden = false;
  const sidebarUserRole = $("sidebar-user-role");
  const sidebarUserName = $("sidebar-user-display-name");
  if (sidebarUserRole) sidebarUserRole.textContent = userRoleLabel(state.user);
  if (sidebarUserName) {
    sidebarUserName.textContent = shortPersonName(state.user?.full_name || state.user?.fullName) || "—";
  }

  const settingsNavGroup = $("settings-nav-group");
  const analyticsNavGroup = $("analytics-nav-group");
  const employeesPage = $("page-employees");
  const salesImportPage = $("page-sales-import");
  const trtDirectoryPage = $("page-trt-directory");
  const activityPage = $("page-activity");
  const trtMasterAuditPage = $("page-trt-master-audit");
  const gdAdmin = isSystemAdmin();
  if (settingsNavGroup) settingsNavGroup.hidden = !gdAdmin;
  if (analyticsNavGroup) analyticsNavGroup.hidden = !["GD","KD","RRO"].includes(String(state.user?.role || "").toUpperCase()) && !gdAdmin;
  if (employeesPage && !gdAdmin) employeesPage.hidden = true;
  if (salesImportPage && !gdAdmin) salesImportPage.hidden = true;
  if (trtDirectoryPage && !gdAdmin) trtDirectoryPage.hidden = true;
  if (activityPage && !gdAdmin) activityPage.hidden = true;
  if (trtMasterAuditPage && !gdAdmin) trtMasterAuditPage.hidden = true;

  const trtAddPointControl = $("trt-add-point-control");
  if (trtAddPointControl) trtAddPointControl.hidden = !gdAdmin || trtMainView !== "map";

  $("add-employee-button").hidden = !gdAdmin;
  $("add-employee-button").title = gdAdmin
    ? "Добавить сотрудника и создать ему учётную запись"
    : "Раздел доступен только администратору";

  if (!gdAdmin && ["employees", "sales-import", "trt-directory", "activity", "trt-master-audit"].includes(state.currentPage)) state.currentPage = "trt";
  showPage(state.currentPage, true);
}

async function login(event) {
  event.preventDefault();
  const button = $("login-button");
  const error = $("login-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Вход…";

  if (!loginWasEntered || !passwordWasEntered) {
    error.textContent = "Введите логин и пароль вручную.";
    error.hidden = false;
    button.disabled = true;
    return;
  }

  try {
    const loginInput = getLoginInput();
    const passwordInput = getPasswordInput();
    if (!loginInput || !passwordInput) throw new Error("Поля входа не открыты.");

    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: loginInput.value.trim(),
        password: passwordInput.value,
        device_name: "ТК ВОГ Офис · веб-кабинет",
      }),
    });
    resetProtectedState();
    state.token = result.session_token;
    state.user = result.user;

    const rememberOnDevice = Boolean($("remember-device")?.checked);
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    if (rememberOnDevice) {
      localStorage.setItem(SESSION_KEY, state.token);
    } else {
      sessionStorage.setItem(SESSION_KEY, state.token);
    }

    showApp();
    if (state.currentPage === "employees") await loadEmployees();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Войти";
  }
}

async function restoreSession() {
  if (!state.token) {
    showLogin();
    return;
  }

  try {
    const result = await api("/auth/me");
    state.user = result.user;
    showApp();
    if (state.currentPage === "employees") await loadEmployees();
  } catch {
    clearSession();
    showLogin();
  }
}

function activityDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function activityLocalDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function activitySourceLabel(value) {
  return value === "web" ? "Веб-кабинет" : "МП";
}

function fillActivityEmployeeFilter() {
  const select = $("activity-employee-filter");
  if (!select) return;
  const current = select.value;
  const people = [...new Map(
    state.activity
      .filter((item) => item.employeeId || item.employeeName)
      .map((item) => [String(item.employeeId || item.employeeName), {
        id: String(item.employeeId || item.employeeName),
        name: shortPersonName(item.employeeName) || "—",
      }])
  ).values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  select.innerHTML = `<option value="">Все сотрудники</option>${people.map((person) => (
    `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`
  )).join("")}`;
  if (people.some((person) => person.id === current)) select.value = current;
}

function filteredActivity() {
  const query = $("activity-search").value.trim().toLowerCase();
  const employeeId = $("activity-employee-filter").value;
  const actionType = $("activity-action-filter").value;
  const source = $("activity-source-filter").value;
  const dateFrom = $("activity-date-from").value;
  const dateTo = $("activity-date-to").value;

  return state.activity.filter((item) => {
    if (employeeId && String(item.employeeId || item.employeeName) !== employeeId) return false;
    if (actionType && item.actionType !== actionType) return false;
    if (source && item.source !== source) return false;
    const dateKey = activityLocalDateKey(item.occurredAt);
    if (dateFrom && dateKey && dateKey < dateFrom) return false;
    if (dateTo && dateKey && dateKey > dateTo) return false;
    if (!query) return true;
    return [
      item.employeeName,
      item.action,
      item.section,
      item.pointName,
      item.address,
      item.details,
      item.deviceName,
    ].join(" ").toLowerCase().includes(query);
  });
}

function renderActivity() {
  const rows = filteredActivity();
  const today = activityLocalDateKey(new Date().toISOString());
  const todayRows = state.activity.filter((item) => activityLocalDateKey(item.occurredAt) === today);
  $("activity-today").textContent = todayRows.length;
  $("activity-users-today").textContent = new Set(todayRows.map((item) => item.employeeId || item.employeeName).filter(Boolean)).size;
  $("activity-visits").textContent = state.activity.filter((item) => item.actionType === "visit").length;
  $("activity-tasks").textContent = state.activity.filter((item) => item.actionType === "task").length;
  $("activity-media").textContent = state.activity.filter((item) => item.actionType === "media").length;

  $("activity-loading").hidden = true;
  $("activity-empty").hidden = rows.length > 0;
  $("activity-table-body").innerHTML = rows.map((item) => {
    const where = item.pointName || item.section || "—";
    const address = item.address ? `<span class="activity-address">${escapeHtml(item.address)}</span>` : "";
    const device = item.deviceName ? `<span class="activity-device">${escapeHtml(item.deviceName)}</span>` : "";
    return `
      <tr>
        <td class="activity-time">${escapeHtml(activityDateTime(item.occurredAt))}</td>
        <td><strong>${escapeHtml(shortPersonName(item.employeeName) || "—")}</strong></td>
        <td><span class="badge ${item.source === "web" ? "account" : "success"}">${escapeHtml(activitySourceLabel(item.source))}</span>${device}</td>
        <td><strong>${escapeHtml(item.action || "—")}</strong><span class="activity-section">${escapeHtml(item.section || "")}</span></td>
        <td><strong>${escapeHtml(where)}</strong>${address}</td>
        <td class="activity-details">${escapeHtml(item.details || "—")}</td>
      </tr>`;
  }).join("");
}

async function loadActivity(force = false) {
  if (!isSystemAdmin()) return;
  if (state.activityLoaded && !force) {
    renderActivity();
    return;
  }
  $("activity-loading").hidden = false;
  $("activity-loading").textContent = "Загрузка активности…";
  $("activity-empty").hidden = true;
  try {
    const result = await api("/employees?view=activity", { timeout: 60000 });
    state.activity = Array.isArray(result.events) ? result.events : [];
    state.activityLoaded = true;
    fillActivityEmployeeFilter();
    renderActivity();
  } catch (error) {
    $("activity-loading").hidden = false;
    $("activity-loading").textContent = error.message;
  }
}


async function loadEmployees() {
  if (!isSystemAdmin()) {
    state.employees = [];
    if (state.currentPage === "employees") showPage("trt", true);
    return;
  }

  $("employees-loading").hidden = false;
  $("employees-loading").textContent = "Загрузка сотрудников…";
  $("employees-empty").hidden = true;
  $("employees-table-body").innerHTML = "";

  try {
    const result = await api("/employees");
    state.employees = Array.isArray(result.employees) ? result.employees : [];
    renderEmployees();
  } catch (err) {
    $("employees-loading").textContent = err.message;
  }
}

function filteredEmployees() {
  const query = $("employee-search").value.trim().toLowerCase();
  const status = $("employee-status-filter").value;

  return state.employees.filter((item) => {
    if (status === "active" && !item.isActive) return false;
    if (status === "inactive" && item.isActive) return false;
    if (!query) return true;
    return [
      item.fullName,
      item.displayName,
      item.position,
      item.role,
      item.roleLabel,
      item.direction,
      item.managerName,
      item.login,
      item.email,
    ].join(" ").toLowerCase().includes(query);
  });
}

function renderEmployees() {
  const items = filteredEmployees();

  $("employees-total").textContent = state.employees.length;
  $("employees-active").textContent = state.employees.filter((x) => x.isActive).length;
  $("employees-accounts").textContent = state.employees.filter((x) => x.hasAccount).length;
  $("employees-loading").hidden = true;
  $("employees-empty").hidden = items.length > 0;

  $("employees-table-body").innerHTML = items.map((item) => {
    const displayName = shortPersonName(item.displayName || item.fullName) || "—";
    const managerName = shortPersonName(item.managerName) || "—";
    const roleLabel = item.roleLabel || item.position || item.role || "—";
    const position = item.position && item.position !== roleLabel ? item.position : "";
    return `
      <tr>
        <td><span class="employee-name">${escapeHtml(displayName)}</span></td>
        <td class="employee-role-cell">
          <strong>${escapeHtml(roleLabel)}</strong>
          ${position ? `<span>${escapeHtml(position)}</span>` : ""}
        </td>
        <td>${escapeHtml(item.direction || "—")}</td>
        <td>${escapeHtml(managerName)}</td>
        <td>${item.hasAccount
          ? `<span class="badge account">${escapeHtml(item.login || "Есть доступ")}</span>`
          : `<span class="badge">Без учётной записи</span>`}
        </td>
        <td>${item.isActive
          ? `<span class="badge success">Активен</span>`
          : `<span class="badge inactive">Отключён</span>`}
        </td>
        <td class="employee-action-cell">
          <button
            class="secondary-button compact-button employee-invite-button"
            type="button"
            data-invite-employee-id="${escapeHtml(item.employeeId)}"
            ${!item.isActive ? "disabled" : ""}
            title="${!item.isActive
              ? "Сотрудник отключён"
              : (item.hasAccount ? "Отправить приглашение и новый временный пароль" : "Создать учётную запись и отправить приглашение")}">
            Пригласить
          </button>
        </td>
      </tr>`;
  }).join("");
}



async function inviteEmployee(employeeId, button) {
  const employee = state.employees.find(
    (item) => String(item.employeeId) === String(employeeId)
  );

  if (!employee) {
    showToast("Сотрудник не найден.");
    return;
  }

  const name = shortPersonName(employee.displayName || employee.fullName) || "сотрудника";
  const confirmed = window.confirm(
    `Отправить приглашение для «${name}»?\n\n` +
    "Будет создан новый временный пароль. Старый пароль перестанет работать."
  );

  if (!confirmed) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Отправка…";

  try {
    const result = await api("/employees", {
      method: "POST",
      body: JSON.stringify({
        operation: "invite",
        employeeId,
      }),
    });

    const prefix = result.testMode
      ? "Тестовое приглашение"
      : "Приглашение";

    const accountText = result.accountCreated
      ? " Учётная запись создана автоматически."
      : (result.accountReactivated ? " Учётная запись активирована." : "");
    showToast(
      `${prefix} отправлено на ${result.recipient}.${accountText}`
    );
    await loadEmployees();
  } catch (error) {
    showToast(error.message || "Не удалось отправить приглашение.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}


function employeeRoleCode(item) {
  return String(item?.role || "").toUpperCase();
}

function eligibleEmployeeManagers() {
  const role = $("employee-role").value;
  const direction = $("employee-direction").value;

  if (role === "GD") return [];

  return state.employees.filter((item) => {
    if (!item.isActive) return false;
    const managerRole = employeeRoleCode(item);
    const managerDirection = String(item.direction || "");

    if (role === "KD") return managerRole === "GD";
    if (role === "RRO") {
      if (!["GD", "KD"].includes(managerRole)) return false;
    } else if (role === "MANAGER") {
      if (!["GD", "KD", "RRO"].includes(managerRole)) return false;
    }

    if (managerRole === "GD") return true;
    return !direction || managerDirection === direction;
  });
}

function applyEmployeeRoleRules() {
  const role = $("employee-role").value;
  const isGd = role === "GD";
  const direction = $("employee-direction");
  const manager = $("employee-manager");
  const note = $("employee-admin-note");

  direction.required = !isGd;
  direction.disabled = isGd;
  manager.required = !isGd;
  manager.disabled = isGd;

  if (isGd) {
    direction.value = "";
    manager.value = "";
  }

  if (note) {
    note.hidden = !isGd;
  }
}

function fillManagerOptions(selectedManagerId = "") {
  applyEmployeeRoleRules();
  const options = eligibleEmployeeManagers()
    .map((item) => {
      const name = shortPersonName(item.displayName || item.fullName);
      const role = item.roleLabel || item.position || item.role;
      const direction = item.direction ? ` · ${item.direction}` : "";
      return `<option value="${escapeHtml(item.employeeId)}">${escapeHtml(name)} — ${escapeHtml(role)}${escapeHtml(direction)}</option>`;
    })
    .join("");

  const role = $("employee-role").value;
  $("employee-manager").innerHTML = role === "GD"
    ? `<option value="">Руководитель не требуется</option>`
    : `<option value="">Выберите руководителя</option>${options}`;
  if ([...$("employee-manager").options].some((option) => option.value === selectedManagerId)) {
    $("employee-manager").value = selectedManagerId;
  }
}

function generateTemporaryPassword(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function setGeneratedEmployeePassword() {
  const password = generateTemporaryPassword();
  $("employee-password").value = password;
  $("employee-password-confirm").value = password;
  $("employee-password").focus();
  $("employee-password").select();
}

function openEmployeeDialog() {
  $("employee-form").reset();
  $("employee-form-error").hidden = true;
  $("employee-dialog-title").textContent = "Новый сотрудник";
  $("employee-role").value = "MANAGER";
  $("employee-direction").value = "";
  $("employee-active").checked = true;
  fillManagerOptions();
  setGeneratedEmployeePassword();
  $("employee-dialog").showModal();
  $("employee-full-name").focus();
}

function closeEmployeeDialog() {
  $("employee-dialog").close();
}

async function saveEmployee(event) {
  event.preventDefault();
  const error = $("employee-form-error");
  const button = $("employee-save-button");
  const password = $("employee-password").value;
  const passwordConfirm = $("employee-password-confirm").value;

  error.hidden = true;

  if (password !== passwordConfirm) {
    error.textContent = "Пароли не совпадают.";
    error.hidden = false;
    return;
  }

  button.disabled = true;
  button.textContent = "Добавление…";

  try {
    const result = await api("/employees", {
      method: "POST",
      body: JSON.stringify({
        fullName: $("employee-full-name").value.trim(),
        role: $("employee-role").value,
        direction: $("employee-direction").value,
        managerId: $("employee-manager").value,
        email: $("employee-email").value.trim(),
        password,
        isActive: $("employee-active").checked,
      }),
    });
    const createdEmployee = result.employee;
    closeEmployeeDialog();
    if (createdEmployee) {
      state.employees.push(createdEmployee);
      renderEmployees();
    }
    showToast(`Сотрудник добавлен. Логин: ${createdEmployee?.login || $("employee-email").value.trim()}`);
    window.setTimeout(() => loadEmployees(), 1300);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Добавить сотрудника";
  }
}



function taskCurrentEmployeeId() {
  return String(state.user?.employee_id || state.user?.employeeId || "");
}

function taskIsDone(task) {
  return String(task?.status || "").toLowerCase() === "done";
}

function taskIsOverdue(task) {
  if (taskIsDone(task) || !task?.dueDate) return false;
  const deadline = new Date(`${task.dueDate}T23:59:59`);
  return Number.isFinite(deadline.getTime()) && deadline.getTime() < Date.now();
}

function taskStatusInfo(task) {
  if (taskIsDone(task)) return { label: "Выполнено", className: "success" };
  if (taskIsOverdue(task)) return { label: "Просрочено", className: "danger" };
  return { label: "Активна", className: "account" };
}

function taskPriorityInfo(priority) {
  const value = String(priority || "medium").toLowerCase();
  if (value === "high") return { label: "Высокий", className: "danger" };
  if (value === "low") return { label: "Низкий", className: "" };
  return { label: "Средний", className: "inactive" };
}

function formatTaskDate(value) {
  if (!value) return "Без срока";
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function taskTrtPoint(task) {
  return state.trtPoints.find((point) => String(point.id) === String(task?.trtId));
}

function taskTrtTitle(task) {
  const point = taskTrtPoint(task);
  return point?.client || point?.holding || task?.trtId || "—";
}

function taskTrtAddress(task) {
  return taskTrtPoint(task)?.address || "";
}

function fillTaskAssigneeFilter() {
  const select = $("task-assignee-filter");
  const current = select.value;
  const names = [...new Set(
    state.tasks
      .map((task) => shortPersonName(task.assignee))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ru"));

  select.innerHTML = `<option value="">Все исполнители</option>${names.map((name) => (
    `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
  )).join("")}`;
  if (names.includes(current)) select.value = current;
}

async function ensureTrtData() {
  if (state.trtLoaded) return;
  const payload = await api("/trt-map-data");
  const points = Array.isArray(payload.points) ? payload.points : [];
  state.trtPoints = points.filter((point) => point && point.id != null);
  state.trtLoaded = true;
  state.trtFitRequested = false;
  fillTrtFilters();
  populateAnalyticsFilters(true);
}

async function loadTasks(force = false) {
  if (state.tasksLoaded && !force) {
    renderTasks();
    return;
  }

  $("tasks-loading").hidden = false;
  $("tasks-loading").textContent = "Загрузка задач…";
  $("tasks-empty").hidden = true;
  $("tasks-table-body").innerHTML = "";
  $("tasks-data-status").textContent = "Загрузка…";

  try {
    const [taskPayload] = await Promise.all([
      api("/tasks"),
      ensureTrtData(),
    ]);
    state.tasks = Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [];
    state.tasksLoaded = true;
    fillTaskAssigneeFilter();
    renderTasks();
    $("tasks-data-status").textContent = `Задач: ${state.tasks.length}`;
  } catch (error) {
    $("tasks-loading").textContent = error.message;
    $("tasks-data-status").textContent = "Данные недоступны";
  }
}

function filteredTasks() {
  const query = normalizeText($("task-search").value);
  const scope = $("task-scope-filter").value;
  const status = $("task-status-filter").value;
  const assignee = $("task-assignee-filter").value;
  const employeeId = taskCurrentEmployeeId();

  return state.tasks.filter((task) => {
    if (scope === "assigned" && String(task.assigneeId) !== employeeId) return false;
    if (scope === "created" && String(task.createdById) !== employeeId) return false;

    if (status === "active" && (taskIsDone(task) || taskIsOverdue(task))) return false;
    if (status === "overdue" && !taskIsOverdue(task)) return false;
    if (status === "done" && !taskIsDone(task)) return false;

    if (assignee && shortPersonName(task.assignee) !== assignee) return false;

    if (!query) return true;
    const point = taskTrtPoint(task);
    return normalizeText([
      task.title,
      task.description,
      task.assignee,
      task.createdBy,
      point?.client,
      point?.holding,
      point?.address,
      task.direction,
    ].join(" ")).includes(query);
  });
}

function renderTasks() {
  const items = filteredTasks();
  const total = state.tasks.length;
  const done = state.tasks.filter(taskIsDone).length;
  const overdue = state.tasks.filter(taskIsOverdue).length;
  const active = total - done;

  $("tasks-total").textContent = total;
  $("tasks-active").textContent = active;
  $("tasks-overdue").textContent = overdue;
  $("tasks-done").textContent = done;
  $("tasks-loading").hidden = true;
  $("tasks-empty").hidden = items.length > 0;

  $("tasks-table-body").innerHTML = items.map((task) => {
    const status = taskStatusInfo(task);
    const priority = taskPriorityInfo(task.priority);
    const point = taskTrtPoint(task);
    const trtName = point?.client || point?.holding || task.trtId || "—";
    const address = point?.address || "";
    return `
      <tr class="interactive-table-row" data-task-view="${escapeHtml(task.id)}" tabindex="0" role="button" aria-label="Открыть задачу ${escapeHtml(task.title || "Задача")}">
        <td>
          <span class="task-title">${escapeHtml(task.title || "Задача")}</span>
          ${task.description ? `<span class="task-secondary">${escapeHtml(task.description)}</span>` : ""}
        </td>
        <td>
          <span class="task-trt-name">${escapeHtml(trtName)}</span>
          ${address ? `<span class="task-secondary">${escapeHtml(address)}</span>` : ""}
        </td>
        <td>${escapeHtml(shortPersonName(task.assignee) || "—")}</td>
        <td>${escapeHtml(shortPersonName(task.createdBy) || "—")}</td>
        <td class="${taskIsOverdue(task) ? "overdue-date" : ""}">${escapeHtml(formatTaskDate(task.dueDate))}</td>
        <td><span class="badge ${priority.className}">${escapeHtml(priority.label)}</span></td>
        <td><span class="badge ${status.className}">${escapeHtml(status.label)}</span></td>
      </tr>`;
  }).join("");
}


function visitPoint(visit) {
  return state.trtPoints.find((point) => String(point.id) === String(visit?.trtId));
}

function visitPointTitle(visit) {
  const point = visitPoint(visit);
  return point?.client || point?.holding || visit?.trtId || "—";
}

function visitEmployeeName(visit) {
  return shortPersonName(visit?.employee || visit?.employeeName || visit?.employeeId) || "—";
}

function visitMediaItems(visitId) {
  return state.media.filter((item) => String(item.visitId || "") === String(visitId || ""));
}

function visitDate(visit) {
  const raw = visit?.completedAt || visit?.createdAt || visit?.startedAt;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function visitLocalDateKey(visit) {
  const date = visitDate(visit);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatVisitDateTime(visit) {
  const date = visitDate(visit);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatVisitDistance(visit) {
  const meters = Number(visit?.distanceMeters);
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} км`;
}


function fourPAssessment(visit) {
  const value = visit?.fourP;
  if (!value || typeof value !== "object" || !value.complete) return null;
  const product = value.product || {};
  const promotion = value.promotion || {};
  return {
    ...value,
    product: {
      ...product,
      vogSkuCount: product.vogSkuCount ?? null,
    },
    promotion: {
      ...promotion,
      commercialTermsScore: promotion.commercialTermsScore ?? promotion.ownerIncentiveScore ?? null,
      commercialTermsStatus: promotion.commercialTermsStatus || (
        promotion.commercialTermsScore != null || promotion.ownerIncentiveScore != null
          ? "Получено из системы"
          : "Ожидает данных КУ"
      ),
      sellerCount: promotion.sellerCount ?? null,
      vogClubParticipants: promotion.vogClubParticipants ?? null,
      sellerParticipationPercent: promotion.sellerParticipationPercent ?? null,
    },
  };
}

function fourPScoreText(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toFixed(1).replace(".", ",")
    : "—";
}

function latestFourPVisit(pointId) {
  return state.visits
    .filter((visit) => (
      String(visit.trtId) === String(pointId)
      && fourPAssessment(visit)
    ))
    .sort((a, b) => (
      String(b.completedAt || b.createdAt || "")
        .localeCompare(String(a.completedAt || a.createdAt || ""))
    ))[0] || null;
}

function renderVisitFourP(visit) {
  const assessment = fourPAssessment(visit);
  const section = $("visit-fourp-section");
  const empty = $("visit-fourp-empty");
  const content = $("visit-fourp-content");

  section.hidden = false;
  empty.hidden = Boolean(assessment);
  content.hidden = !assessment;
  $("visit-fourp-total").textContent = fourPScoreText(assessment?.totalScore);
  if (!assessment) return;

  const product = assessment.product || {};
  const promotion = assessment.promotion || {};
  $("visit-fourp-location").textContent = fourPScoreText(assessment.place?.locationScore);
  $("visit-fourp-placement").textContent = fourPScoreText(assessment.place?.vogPlacementScore);
  $("visit-fourp-sku").textContent = `${Number(product.skuCount || 0).toLocaleString("ru-RU")} SKU · оценка ${fourPScoreText(product.assortmentScore)}`;
  $("visit-fourp-share").textContent = `${product.vogSkuCount == null ? "—" : Number(product.vogSkuCount).toLocaleString("ru-RU")} SKU · ${String(product.vogSharePercent ?? 0).replace(".", ",")}% · оценка ${fourPScoreText(product.vogShareScore)}`;
  $("visit-fourp-commercial").textContent = promotion.commercialTermsScore == null
    ? (promotion.commercialTermsStatus || "Ожидает данных КУ")
    : fourPScoreText(promotion.commercialTermsScore);
  $("visit-fourp-motivation").textContent = `${promotion.sellerCount == null ? "оценка " + fourPScoreText(promotion.sellerMotivationScore) : `${promotion.vogClubParticipants ?? 0}/${promotion.sellerCount} продавцов · ${String(promotion.sellerParticipationPercent ?? 0).replace(".", ",")}% · оценка ${fourPScoreText(promotion.sellerMotivationScore)}`}`;
  $("visit-fourp-display").textContent = fourPScoreText(promotion.consumerPromoScore);
}

function trtDisplayName(point) {
  const raw = String(point?.client || point?.holding || "ТРТ").trim();
  const format = String(point?.format || "").trim();
  if (!format) return raw;
  const escaped = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw.replace(new RegExp(`\\s*[—–-]\\s*${escaped}\\s*$`, "i"), "").trim() || raw;
}

function trtStatusLabel(point) {
  const raw = String(
    point?.trtStatus || point?.clientStatus || point?.customerStatus || point?.status || "АКБ"
  ).trim();
  const normalized = normalizeText(raw).replace(/[^a-zа-я0-9]/g, "");
  const aliases = { akb: "АКБ", tsakb: "ЦАКБ", nakb: "НАКБ", tsnakb: "ЦНАКБ" };
  return aliases[normalized] || raw || "АКБ";
}


function trtOriginKey(point) {
  const explicit = String(point?.origin || "").trim();
  if (explicit) return explicit;
  const id = String(point?.id || "");
  if (id.startsWith("trt-new-")) return "new_bulk";
  if (id.startsWith("trt-mobile-")) return "mobile_created";
  return "base";
}

function trtOriginLabel(pointOrOrigin) {
  const origin = typeof pointOrOrigin === "string" ? pointOrOrigin : trtOriginKey(pointOrOrigin);
  return {
    new_bulk: "Новые ТРТ",
    mobile_created: "Добавлено в МП",
    base: "Основная БД",
  }[origin] || String(origin || "Основная БД");
}

function renderTrtFourP(point) {
  const visit = latestFourPVisit(point?.id);
  const assessment = fourPAssessment(visit);
  const rating = $("trt-card-rating");
  if (rating) rating.textContent = fourPScoreText(assessment?.totalScore);
}

async function ensureVisitsData(force = false) {
  if (state.visitsLoaded && !force) return state.visits;
  const payload = await api("/visits");
  state.visits = Array.isArray(payload.visits) ? payload.visits : [];
  state.visitsLoaded = true;
  return state.visits;
}

function fillVisitFilters() {
  const employeeSelect = $("visit-employee-filter");
  const directionSelect = $("visit-direction-filter");
  const employeeCurrent = employeeSelect.value;
  const directionCurrent = directionSelect.value;

  const employees = [...new Set(state.visits.map(visitEmployeeName).filter((value) => value && value !== "—"))]
    .sort((a, b) => a.localeCompare(b, "ru"));
  const directions = [...new Set(state.visits.map((visit) => String(visitPoint(visit)?.direction || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru"));

  employeeSelect.innerHTML = `<option value="">Все сотрудники</option>${employees.map((value) => (
    `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
  )).join("")}`;
  directionSelect.innerHTML = `<option value="">Все направления</option>${directions.map((value) => (
    `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
  )).join("")}`;

  if (employees.includes(employeeCurrent)) employeeSelect.value = employeeCurrent;
  if (directions.includes(directionCurrent)) directionSelect.value = directionCurrent;
}

async function loadVisits(force = false) {
  if (state.visitsLoaded && !force) {
    renderVisits();
    return;
  }

  $("visits-loading").hidden = false;
  $("visits-loading").textContent = "Загрузка визитов…";
  $("visits-empty").hidden = true;
  $("visits-table-body").innerHTML = "";
  $("visits-data-status").textContent = "Загрузка…";

  try {
    await Promise.all([
      ensureVisitsData(force),
      ensureTrtData(),
      ensureMediaLoaded(true),
    ]);
    fillVisitFilters();
    renderVisits();
    $("visits-data-status").textContent = `Визитов: ${state.visits.length}`;
  } catch (error) {
    $("visits-loading").textContent = error.message;
    $("visits-data-status").textContent = "Данные недоступны";
  }
}

function visitResultText(visit) {
  const values = [];
  const source = Array.isArray(visit?.results)
    ? visit.results
    : String(visit?.result || '').split(/\s*[•;]\s*/);

  source.forEach(item => {
    const value = String(item || '').trim();
    if (value && !values.includes(value)) values.push(value);
  });

  const other = String(visit?.otherResult || '').trim();
  if (other && !values.includes(other)) values.push(other);

  return values.join(' • ') || String(visit?.result || '').trim() || '—';
}

function filteredVisits() {
  const query = normalizeText($("visit-search").value);
  const employee = $("visit-employee-filter").value;
  const direction = $("visit-direction-filter").value;
  const dateFrom = $("visit-date-from").value;
  const dateTo = $("visit-date-to").value;

  return state.visits.filter((visit) => {
    const point = visitPoint(visit);
    const employeeName = visitEmployeeName(visit);
    const visitDirection = String(point?.direction || "");
    const dateKey = visitLocalDateKey(visit);

    if (employee && employeeName !== employee) return false;
    if (direction && visitDirection !== direction) return false;
    if (dateFrom && (!dateKey || dateKey < dateFrom)) return false;
    if (dateTo && (!dateKey || dateKey > dateTo)) return false;

    if (!query) return true;
    return normalizeText([
      employeeName,
      point?.client,
      point?.holding,
      point?.address,
      point?.direction,
      visitResultText(visit),
      visit.comment,
      visit.nextStep,
    ].join(" ")).includes(query);
  });
}

function renderVisits() {
  const items = filteredVisits();
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  $("visits-total").textContent = state.visits.length;
  $("visits-last-30").textContent = state.visits.filter((visit) => {
    const date = visitDate(visit);
    return date && date.getTime() >= thirtyDaysAgo;
  }).length;
  $("visits-with-media").textContent = state.visits.filter((visit) => visitMediaItems(visit.id).length > 0).length;
  $("visits-with-next-step").textContent = state.visits.filter((visit) => String(visit.nextStep || "").trim()).length;

  $("visits-loading").hidden = true;
  $("visits-empty").hidden = items.length > 0;

  $("visits-table-body").innerHTML = items.map((visit) => {
    const point = visitPoint(visit);
    const mediaCount = visitMediaItems(visit.id).length;
    const result = visitResultText(visit) || String(visit.comment || "—").trim();
    return `
      <tr class="interactive-table-row" data-visit-view="${escapeHtml(visit.id)}" tabindex="0" role="button" aria-label="Открыть визит ${escapeHtml(formatVisitDateTime(visit))}">
        <td class="visit-date-cell">${escapeHtml(formatVisitDateTime(visit))}</td>
        <td>
          <span class="task-trt-name">${escapeHtml(visitPointTitle(visit))}</span>
          ${point?.address ? `<span class="task-secondary">${escapeHtml(point.address)}</span>` : ""}
        </td>
        <td>${escapeHtml(visitEmployeeName(visit))}</td>
        <td>${escapeHtml(point?.direction || "—")}</td>
        <td><span class="visit-result-preview">${escapeHtml(result)}</span></td>
        <td>${mediaCount ? `<span class="badge badge-neutral">${mediaCount}</span>` : "—"}</td>
      </tr>`;
  }).join("");

}

async function openVisitDetail(visitId) {
  const visit = state.visits.find((item) => String(item.id) === String(visitId));
  if (!visit) return;

  state.visitSelectedId = String(visit.id);
  const point = visitPoint(visit);
  const mediaItems = visitMediaItems(visit.id).map((item) => ({
    ...item,
    contextEmployeeName: visitEmployeeName(visit),
  }));
  const modal = $("visit-detail-modal");

  // Открываем окно до построения внутренних блоков: даже ошибка превью
  // или старой оценки 4P не должна блокировать просмотр визита.
  modal.hidden = false;
  modal.classList.add("open");
  document.body.style.overflow = "hidden";

  $("visit-detail-title").textContent = `Визит · ${formatVisitDateTime(visit)}`;
  $("visit-detail-trt").textContent = [visitPointTitle(visit), point?.address].filter(Boolean).join(" · ");
  $("visit-detail-employee").textContent = visitEmployeeName(visit);
  $("visit-detail-date").textContent = formatVisitDateTime(visit);
  $("visit-detail-direction").textContent = point?.direction || "—";
  const gpsBox = $("visit-gps-box");
  const visitGrid = document.querySelector(".visit-detail-grid");
  const showGpsControl = isSystemAdmin();
  gpsBox.hidden = !showGpsControl;
  visitGrid?.classList.toggle("admin-gps", showGpsControl);
  if (showGpsControl) {
    const distanceMeters = Number(visit?.distanceMeters);
    const gpsConfirmed = Number.isFinite(distanceMeters) && distanceMeters <= 150;
    gpsBox.classList.toggle("gps-confirmed", gpsConfirmed);
    gpsBox.classList.toggle("gps-unconfirmed", !gpsConfirmed);
    $("visit-detail-distance").textContent = gpsConfirmed
      ? "Визит подтвержден по GPS"
      : "Нет подтверждения GPS";
    gpsBox.title = Number.isFinite(distanceMeters)
      ? `Расстояние до координат ТРТ: ${formatVisitDistance(visit)}`
      : "Координаты визита не были получены";
  }
  $("visit-detail-result").textContent = visitResultText(visit);
  $("visit-detail-comment").textContent = visit.comment || "—";
  $("visit-detail-next-step").textContent = visit.nextStep || "—";
  $("visit-open-trt-button").disabled = !point;

  try {
    renderVisitFourP(visit);
  } catch (error) {
    console.error("Не удалось показать рейтинг визита", error);
    $("visit-fourp-section").hidden = true;
  }

  try {
    renderTaskMedia("visit-media", "visit-media-empty", mediaItems);
  } catch (error) {
    console.error("Не удалось показать материалы визита", error);
    $("visit-media").innerHTML = "";
    $("visit-media-empty").hidden = false;
    $("visit-media-empty").textContent = "Материалы временно недоступны.";
  }
}

function closeVisitDetail() {
  const modal = $("visit-detail-modal");
  modal.hidden = true;
  modal.classList.remove("open");
  document.body.style.overflow = "";
  state.visitSelectedId = "";
}

async function openSelectedVisitTrt() {
  const visit = state.visits.find((item) => String(item.id) === String(state.visitSelectedId));
  const point = visitPoint(visit);
  if (!point) return;

  closeVisitDetail();
  showPage("trt", true);
  await ensureTrtData();
  initTrtMap();
  setTrtMainView("map");
  openTrtCard(point.id, true);
}

async function ensureMediaLoaded(force = false) {
  if (state.mediaLoaded && !force) return;
  const payload = await api("/media");
  state.media = Array.isArray(payload.media) ? payload.media : [];
  state.mediaLoaded = true;
}

async function ensureMediaPreview(item) {
  const cacheKey = `${item.id}:${item.etag || ""}`;
  if (state.mediaPreviewUrls.has(cacheKey)) {
    return state.mediaPreviewUrls.get(cacheKey);
  }
  if (state.mediaPreviewRequests.has(cacheKey)) {
    return state.mediaPreviewRequests.get(cacheKey);
  }

  const request = api("/media/thumbnail-url", {
    method: "POST",
    body: JSON.stringify({ mediaId: item.id }),
  }).then((result) => {
    const value = {
      thumbnailUrl: result.thumbnailUrl || item.downloadUrl || "",
      downloadUrl: result.downloadUrl || item.downloadUrl || "",
      fallbackOriginal: Boolean(result.fallbackOriginal),
    };
    state.mediaPreviewUrls.set(cacheKey, value);
    state.mediaPreviewRequests.delete(cacheKey);
    return value;
  }).catch((error) => {
    state.mediaPreviewRequests.delete(cacheKey);
    throw error;
  });

  state.mediaPreviewRequests.set(cacheKey, request);
  return request;
}

async function hydrateTaskMediaImage(button, item) {
  const img = button.querySelector("img");
  const status = button.querySelector(".task-media-loading");
  try {
    const preview = await ensureMediaPreview(item);
    if (!preview.thumbnailUrl) throw new Error("Превью недоступно.");
    img.src = preview.thumbnailUrl;
    img.hidden = false;
    status.hidden = true;
    button.dataset.ready = "1";
  } catch (error) {
    status.textContent = "Открыть фото";
    status.classList.add("task-media-load-error");
    button.dataset.ready = "0";
  }
}

function mediaIsImage(item) {
  return String(item?.type || "").startsWith("image/")
    || String(item?.mediaKind || "") === "photo";
}

function formatMediaFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

function formatMediaDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function mediaSourceLabel(value) {
  const labels = {
    camera: "Снято камерой из МП",
    library: "Загружено с телефона",
    unknown: "Источник не определён",
  };
  return labels[String(value || "").toLowerCase()] || String(value || "—");
}

function mediaPurposeLabel(value) {
  const labels = {
    visit: "Визит",
    task_material: "Материалы задачи",
    task_result: "Результат задачи",
    point: "Карточка ТРТ",
  };
  return labels[String(value || "")] || "—";
}

function mediaUploaderName(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const employee = state.employees.find((row) => String(row.employeeId || row.id || "") === String(item?.employeeId || ""));
  return shortPersonName(
    metadata.uploadedByName
    || item?.contextEmployeeName
    || employee?.displayName
    || employee?.fullName
    || item?.employeeId
  ) || "—";
}

function mediaCoordinates(metadata) {
  const exifLat = Number(metadata.gpsLatitude);
  const exifLon = Number(metadata.gpsLongitude);
  if (Number.isFinite(exifLat) && Number.isFinite(exifLon)) {
    return {lat: exifLat, lon: exifLon, label: "GPS фотографии (EXIF)"};
  }
  const uploadLat = Number(metadata.uploadLatitude);
  const uploadLon = Number(metadata.uploadLongitude);
  if (Number.isFinite(uploadLat) && Number.isFinite(uploadLon)) {
    return {lat: uploadLat, lon: uploadLon, label: "Геопозиция при добавлении"};
  }
  return null;
}

function renderMediaMetadata(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const coordinates = mediaCoordinates(metadata);
  const device = [metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(" ")
    || metadata.platform
    || "—";
  const dimensions = Number(metadata.width) > 0 && Number(metadata.height) > 0
    ? `${metadata.width} × ${metadata.height} px`
    : "—";
  const capturedAt = metadata.capturedAt || metadata.fileLastModifiedAt || "";
  const capturedLabel = metadata.capturedAt ? "Снято" : "Дата файла";
  const accuracy = Number(metadata.uploadAccuracy);
  const coordinateText = coordinates
    ? `${coordinates.lat.toFixed(6)}, ${coordinates.lon.toFixed(6)}${Number.isFinite(accuracy) && coordinates.label !== "GPS фотографии (EXIF)" ? ` · точность ±${Math.round(accuracy)} м` : ""}`
    : "GPS-метка отсутствует";
  const rows = [
    ["Файл", item?.name || metadata.originalName || "—"],
    [capturedLabel, formatMediaDateTime(capturedAt)],
    ["Добавлено в систему", formatMediaDateTime(item?.createdAt || metadata.receivedAt)],
    ["Добавил", mediaUploaderName(item)],
    ["Источник", mediaSourceLabel(metadata.source)],
    ["Устройство / камера", device],
    ["Размер изображения", dimensions],
    ["Размер файла", formatMediaFileSize(item?.size || metadata.originalSize)],
    ["Тип файла", item?.type || metadata.originalType || "—"],
    ["Раздел", mediaPurposeLabel(item?.purpose)],
    [coordinates?.label || "Геопозиция", coordinateText],
    ["ID файла", item?.id || "—"],
  ];
  $("media-preview-metadata").innerHTML = rows.map(([label, value]) => `
    <div class="media-preview-meta-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");

  const mapLink = $("media-preview-map");
  if (coordinates) {
    mapLink.href = `https://yandex.ru/maps/?pt=${encodeURIComponent(coordinates.lon)},${encodeURIComponent(coordinates.lat)}&z=17&l=map`;
    mapLink.hidden = false;
  } else {
    mapLink.hidden = true;
    mapLink.href = "#";
  }
}

function renderTaskMedia(containerId, emptyId, items, galleryItems = items) {
  const container = $(containerId);
  const empty = $(emptyId);
  container.innerHTML = "";

  if (!items.length) {
    empty.hidden = false;
    return;
  }

  const galleryImages = (galleryItems || []).filter(mediaIsImage);
  empty.hidden = true;
  container.innerHTML = items.map((item) => {
    const href = escapeHtml(item.downloadUrl || "#");
    const mediaId = escapeHtml(item.id || "");
    const name = escapeHtml(item.name || (item.mediaKind === "video" ? "Видео" : "Фото"));
    if (mediaIsImage(item)) {
      return `<button class="task-media-item task-image-item" type="button" data-media-preview="${mediaId}" aria-label="Открыть ${name}">
        <span class="task-media-image-box">
          <img alt="${name}" loading="lazy" decoding="async" hidden>
          <span class="task-media-loading">Загрузка превью…</span>
        </span>
        <span>${name}</span>
      </button>`;
    }
    return `<a class="task-media-item task-video-item" href="${href}" target="_blank" rel="noopener">
      <span class="task-video-icon">▶</span>
      <span>${name}</span>
    </a>`;
  }).join("");

  container.querySelectorAll("[data-media-preview]").forEach((button) => {
    const item = items.find((media) => String(media.id) === String(button.dataset.mediaPreview));
    if (!item) return;
    hydrateTaskMediaImage(button, item);
    button.addEventListener("click", () => openMediaPreview(item, galleryImages));
  });
}

async function showCurrentMediaPreview() {
  const item = state.mediaPreviewItems[state.mediaPreviewIndex];
  if (!item) return;
  const sequence = ++mediaPreviewLoadSequence;
  const image = $("media-preview-image");
  const loading = $("media-preview-loading");
  const original = $("media-preview-original");
  const total = state.mediaPreviewItems.length;

  $("media-preview-title").textContent = item.name || "Фото";
  $("media-preview-counter").textContent = total > 1 ? `${state.mediaPreviewIndex + 1} из ${total}` : "";
  $("media-preview-prev").hidden = total <= 1;
  $("media-preview-next").hidden = total <= 1;
  $("media-preview-prev").disabled = state.mediaPreviewIndex <= 0;
  $("media-preview-next").disabled = state.mediaPreviewIndex >= total - 1;
  image.hidden = true;
  image.removeAttribute("src");
  loading.hidden = false;
  loading.textContent = "Загрузка превью…";
  original.hidden = true;
  renderMediaMetadata(item);

  try {
    const preview = await ensureMediaPreview(item);
    if (sequence !== mediaPreviewLoadSequence) return;
    image.src = preview.thumbnailUrl;
    image.hidden = false;
    loading.hidden = true;
    original.href = preview.downloadUrl || item.downloadUrl || "#";
    original.hidden = !original.href || original.href.endsWith("#");
  } catch (error) {
    if (sequence !== mediaPreviewLoadSequence) return;
    loading.textContent = `Не удалось открыть фото: ${error.message}`;
    original.href = item.downloadUrl || "#";
    original.hidden = !item.downloadUrl;
  }
}

async function openMediaPreview(item, galleryItems = null) {
  const images = (galleryItems || [item]).filter(mediaIsImage);
  state.mediaPreviewItems = images.length ? images : [item];
  state.mediaPreviewIndex = Math.max(0, state.mediaPreviewItems.findIndex((row) => String(row.id) === String(item.id)));
  $("media-preview-modal").hidden = false;
  document.body.style.overflow = "hidden";
  await showCurrentMediaPreview();
}

function moveMediaPreview(step) {
  const next = state.mediaPreviewIndex + step;
  if (next < 0 || next >= state.mediaPreviewItems.length) return;
  state.mediaPreviewIndex = next;
  showCurrentMediaPreview();
}

function closeMediaPreview() {
  mediaPreviewLoadSequence += 1;
  $("media-preview-modal").hidden = true;
  $("media-preview-image").removeAttribute("src");
  state.mediaPreviewItems = [];
  state.mediaPreviewIndex = -1;
  document.body.style.overflow = "";
}

async function openTaskDetail(taskId) {
  const task = state.tasks.find((item) => String(item.id) === String(taskId));
  if (!task) return;

  state.taskSelectedId = String(task.id);
  const status = taskStatusInfo(task);
  const priority = taskPriorityInfo(task.priority);
  const point = taskTrtPoint(task);

  $("task-detail-title").textContent = task.title || "Задача";
  $("task-detail-trt").textContent = [point?.client || point?.holding || task.trtId, point?.address]
    .filter(Boolean).join(" · ");
  $("task-detail-status").textContent = status.label;
  $("task-detail-status").className = `badge ${status.className}`;
  $("task-detail-priority").textContent = priority.label;
  $("task-detail-priority").className = `badge ${priority.className}`;
  $("task-detail-assignee").textContent = shortPersonName(task.assignee) || "—";
  $("task-detail-created-by").textContent = shortPersonName(task.createdBy) || "—";
  $("task-detail-due").textContent = formatTaskDate(task.dueDate);
  $("task-detail-direction").textContent = task.direction || "—";
  $("task-detail-description").textContent = task.description || "Описание не указано.";
  $("task-detail-result").textContent = task.completionComment || (taskIsDone(task) ? "Комментарий не указан." : "Задача ещё не выполнена.");
  $("task-result-section").hidden = !taskIsDone(task) && !task.completionComment;
  $("task-open-trt-button").disabled = !point;

  renderTaskMedia("task-materials", "task-materials-empty", []);
  renderTaskMedia("task-result-media", "task-result-media-empty", []);
  $("task-detail-modal").hidden = false;

  try {
    await ensureMediaLoaded();
    const taskMedia = state.media
      .filter((item) => String(item.taskId || "") === String(task.id))
      .map((item) => ({
        ...item,
        contextEmployeeName: shortPersonName(task.createdBy),
      }));
    renderTaskMedia(
      "task-materials",
      "task-materials-empty",
      taskMedia.filter((item) => item.purpose === "task_material"),
      taskMedia,
    );
    renderTaskMedia(
      "task-result-media",
      "task-result-media-empty",
      taskMedia.filter((item) => item.purpose === "task_result"),
      taskMedia,
    );
  } catch (error) {
    $("task-materials-empty").textContent = `Материалы недоступны: ${error.message}`;
    $("task-materials-empty").hidden = false;
  }
}

function closeTaskDetail() {
  $("task-detail-modal").hidden = true;
}

async function openSelectedTaskTrt() {
  const task = state.tasks.find((item) => String(item.id) === state.taskSelectedId);
  const point = taskTrtPoint(task);
  if (!point) return;
  showPage("trt", true);
  setTrtMainView("map");
  await loadTrtMap();
  window.setTimeout(() => openTrtCard(point.id, true), 120);
}


function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}


function cleanTrtCityName(value) {
  return String(value || "")
    .trim()
    .replace(/^[\s\d-]+/, "")
    .replace(/^(?:г(?:ород)?\.?|г\.\s*о\.|городской округ|пгт\.?|пос\.?|поселок|посёлок)\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/, "")
    .trim();
}

const TRT_CITY_RU_ALIASES = new Map([
  ["minsk", "Минск"], ["мінск", "Минск"],
  ["brest", "Брест"], ["брэст", "Брест"],
  ["vitebsk", "Витебск"], ["viciebsk", "Витебск"], ["віцебск", "Витебск"],
  ["gomel", "Гомель"], ["homiel", "Гомель"],
  ["grodno", "Гродно"], ["hrodna", "Гродно"], ["гродна", "Гродно"],
  ["mogilev", "Могилёв"], ["mahilyow", "Могилёв"], ["mahilioŭ", "Могилёв"], ["магілёў", "Могилёв"],
]);

function trtRussianCityName(value) {
  const city = cleanTrtCityName(value);
  if (!city) return "";
  return TRT_CITY_RU_ALIASES.get(normalizeText(city)) || city;
}

function trtPointCity(point) {
  const explicit = point?.city || point?.town || point?.locality || point?.settlement;
  if (explicit) return trtRussianCityName(explicit);

  const address = String(point?.address || "").trim();
  if (!address) return "";

  const prefixed = address.match(/(?:^|[,;]\s*|\s)(?:г(?:ород)?\.?|г\.\s*о\.)\s*([А-ЯЁA-Z][^,;]{1,50})/i);
  if (prefixed?.[1]) {
    const candidate = trtRussianCityName(prefixed[1].split(/\b(?:ул\.?|улица|пр-т|проспект|ш\.?|шоссе|д\.?|дом|мкр\.?|микрорайон)\b/i)[0]);
    if (candidate) return candidate;
  }

  const parts = address.split(/[,;]/).map((part) => trtRussianCityName(part)).filter(Boolean);
  const regionNorm = normalizeText(point?.region);
  const blocked = /\b(?:обл(?:асть)?|край|республика|район|р-н|улица|ул\.?|проспект|пр-т|шоссе|ш\.?|дом|д\.?|корпус|корп\.?|строение|стр\.?|мкр\.?|микрорайон)\b/i;
  for (const part of parts) {
    const normalized = normalizeText(part);
    if (!normalized || /^\d{5,6}$/.test(normalized)) continue;
    if (["россия", "рф", "российская федерация", "russia", "беларусь", "белоруссия", "республика беларусь", "belarus"].includes(normalized)) continue;
    if (["москва", "санкт-петербург", "санкт петербург"].includes(normalized)) return part;
    if (regionNorm && (normalized === regionNorm || regionNorm.includes(normalized) || normalized.includes(regionNorm))) continue;
    if (blocked.test(part)) continue;
    if (part.length > 2 && part.length < 55) return part;
  }
  return "";
}

function trtPointCityKey(point) {
  const city = trtPointCity(point);
  if (!city) return "";
  return `${normalizeRegionName(trtCanonicalRegionName(point))}|||${normalizeText(city)}`;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trtColor(size) {
  if (size === null || size === undefined || Number.isNaN(Number(size))) return "#7f8c8d";
  const value = Number(size);
  if (value < 50) return "#e74c3c";
  if (value <= 100) return "#f1c40f";
  return "#2ecc71";
}

function trtUnit(point) {
  if (point?.unit) return point.unit;
  const direction = normalizeText(point?.direction);
  if (direction.includes("обои")) return "рулонов";
  if (direction.includes("плитка") || direction.includes("наполь")) return "м²";
  return "ед.";
}

function formatTrtSize(point) {
  if (point?.size === null || point?.size === undefined || Number.isNaN(Number(point.size))) return "—";
  return `${Math.round(Number(point.size)).toLocaleString("ru-RU")} ${trtUnit(point)}`;
}

function selectedTrtPoint() {
  return state.trtPoints.find((point) => String(point.id) === String(state.trtSelectedId));
}

function sumSales(values, count = 12) {
  return (Array.isArray(values) ? values : [])
    .slice(0, count)
    .reduce((sum, value) => sum + numberOrZero(value), 0);
}

function formatSales(value, unit = "") {
  const formatted = Math.round(numberOrZero(value)).toLocaleString("ru-RU");
  return unit ? `${formatted} ${unit}` : formatted;
}

function populateSelect(id, values, allLabel, labelFormatter = (value) => value) {
  const select = $(id);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>${values.map((value) => (
    `<option value="${escapeHtml(value)}">${escapeHtml(labelFormatter(value))}</option>`
  )).join("")}`;
  if (values.includes(current)) select.value = current;
}

function fillTrtFilters() {
  const directions = [...new Set(
    state.trtPoints.map((point) => String(point.direction || "").trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ru"));

  const managers = [...new Set(
    state.trtPoints.map((point) => String(point.manager || "").trim()).filter(Boolean)
  )].sort((a, b) => shortPersonName(a).localeCompare(shortPersonName(b), "ru"));

  populateSelect("trt-direction-filter", directions, "Все направления");
  populateSelect("trt-manager-filter", managers, "Все менеджеры", shortPersonName);
  pruneTrtSmartFilters();
  populateAnalyticsFilters(true);
}

function trtSmartFilterTypeLabel(type) {
  return {
    direction: "Направление",
    manager: "Менеджер",
    city: "Город",
    region: "Регион",
    source: "Источник",
    network: "Сеть",
    point: "ТРТ",
  }[type] || "Фильтр";
}

function trtSmartFilterTokenKey(token) {
  return `${token?.type || ""}:${String(token?.value ?? "")}`;
}

function sanitizeTrtSmartFilterToken(token) {
  if (!token || !["direction", "manager", "city", "region", "source", "network", "point"].includes(token.type)) return null;
  const value = String(token.value ?? "").trim();
  const label = String(token.label ?? "").trim();
  if (!value || !label) return null;
  return { type: token.type, value, label };
}

function restoreTrtSmartFilters() {
  try {
    const raw = sessionStorage.getItem(TRT_MAP_FILTER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    trtSmartFilters = Array.isArray(parsed)
      ? parsed.map(sanitizeTrtSmartFilterToken).filter(Boolean)
      : [];
  } catch {
    trtSmartFilters = [];
  }
  renderTrtSmartFilterChips();
}

function persistTrtSmartFilters() {
  sessionStorage.setItem(TRT_MAP_FILTER_KEY, JSON.stringify(trtSmartFilters));
}

function pruneTrtSmartFilters() {
  if (!state.trtLoaded || !trtSmartFilters.length) {
    renderTrtSmartFilterChips();
    return;
  }
  const validDirections = new Set(state.trtPoints.map((point) => String(point.direction || "")).filter(Boolean));
  const validManagers = new Set(state.trtPoints.map((point) => String(point.manager || "")).filter(Boolean));
  const validCities = new Set(state.trtPoints.map(trtPointCityKey).filter(Boolean));
  const validRegions = new Set(state.trtPoints.map(trtCanonicalRegionName).filter(Boolean));
  const validSources = new Set(state.trtPoints.map(trtOriginKey).filter(Boolean));
  const validNetworks = new Set(state.trtPoints.map(trtFdiyNetworkKey).filter(Boolean));
  const validPoints = new Set(state.trtPoints.map((point) => String(point.id)));
  const before = trtSmartFilters.length;
  trtSmartFilters = trtSmartFilters.filter((token) => {
    if (token.type === "direction") return validDirections.has(token.value);
    if (token.type === "manager") return validManagers.has(token.value);
    if (token.type === "city") return validCities.has(token.value);
    if (token.type === "region") return validRegions.has(token.value);
    if (token.type === "source") return validSources.has(token.value);
    if (token.type === "network") return validNetworks.has(token.value);
    if (token.type === "point") return validPoints.has(token.value);
    return false;
  });
  if (trtSmartFilters.length !== before) persistTrtSmartFilters();
  renderTrtSmartFilterChips();
}

function trtSmartFilterValues(type) {
  return new Set(
    trtSmartFilters
      .filter((token) => token.type === type)
      .map((token) => String(token.value))
  );
}

function trtSmartMatchScore(value, query) {
  const haystack = normalizeText(value).replace(/[^a-zа-я0-9]+/gi, " ").trim();
  const needle = normalizeText(query).replace(/[^a-zа-я0-9]+/gi, " ").trim();
  if (!haystack || !needle) return Number.POSITIVE_INFINITY;
  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.every((word) => haystack.includes(word))) return Number.POSITIVE_INFINITY;
  if (haystack === needle) return 0;
  if (haystack.startsWith(needle)) return 1;
  if (haystack.split(/\s+/).some((word) => word.startsWith(needle))) return 2;
  if (words.every((word) => haystack.split(/\s+/).some((candidate) => candidate.startsWith(word)))) return 3;
  return 4;
}

function trtSmartPointTitle(point) {
  return String(point?.client || point?.holding || point?.address || "ТРТ").trim() || "ТРТ";
}

function trtFdiyNetworkKey(point) {
  return String(point?.fdiyNetworkId || point?.fdiyNetwork || "").trim();
}

function trtFdiyNetworkLabel(point) {
  return String(point?.fdiyNetwork || point?.fdiyNetworkId || "").trim();
}

function buildTrtSmartSuggestions(query) {
  const q = String(query || "").trim();
  if (!q || !state.trtLoaded) return [];

  const suggestions = [];
  const selectedKeys = new Set(trtSmartFilters.map(trtSmartFilterTokenKey));
  const add = (item) => {
    if (!item || !Number.isFinite(item.score)) return;
    if (selectedKeys.has(`${item.type}:${String(item.value)}`)) return;
    suggestions.push(item);
  };

  const directions = [...new Set(state.trtPoints.map((point) => String(point.direction || "").trim()).filter(Boolean))];
  directions.forEach((value) => {
    const score = trtSmartMatchScore(value, q);
    add({ type: "direction", value, label: value, meta: "Направление", score });
  });

  const managers = [...new Set(state.trtPoints.map((point) => String(point.manager || "").trim()).filter(Boolean))];
  managers.forEach((value) => {
    const score = trtSmartMatchScore(`${shortPersonName(value)} ${value}`, q);
    add({ type: "manager", value, label: shortPersonName(value), meta: "Менеджер", score });
  });

  const cityMap = new Map();
  state.trtPoints.forEach((point) => {
    const city = trtPointCity(point);
    const key = trtPointCityKey(point);
    if (!city || !key || cityMap.has(key)) return;
    cityMap.set(key, { city, region: trtCanonicalRegionName(point) });
  });
  cityMap.forEach(({ city, region }, value) => {
    const score = trtSmartMatchScore(`${city} ${region}`, q);
    add({ type: "city", value, label: city, meta: ["Город", region].filter(Boolean).join(" · "), score });
  });

  const regions = [...new Set(state.trtPoints.map(trtCanonicalRegionName).filter(Boolean))];
  regions.forEach((value) => {
    const score = trtSmartMatchScore(value, q);
    add({ type: "region", value, label: value, meta: "Регион", score });
  });

  const sourceMap = new Map();
  state.trtPoints.forEach((point) => {
    const value = trtOriginKey(point);
    if (!sourceMap.has(value)) sourceMap.set(value, trtOriginLabel(value));
  });
  sourceMap.forEach((label, value) => {
    const score = trtSmartMatchScore(`${label} ${value}`, q);
    add({ type: "source", value, label, meta: "Источник", score });
  });

  const networkMap = new Map();
  state.trtPoints.forEach((point) => {
    const value = trtFdiyNetworkKey(point);
    const label = trtFdiyNetworkLabel(point);
    if (!value || !label || networkMap.has(value)) return;
    networkMap.set(value, label);
  });
  networkMap.forEach((label, value) => {
    const score = trtSmartMatchScore(`${label} ${value}`, q);
    add({ type: "network", value, label, meta: "FDIY сеть", score });
  });

  state.trtPoints.forEach((point) => {
    const fields = [
      ["ТРТ", point.client],
      ["Клиент", point.holding],
      ["Адрес", point.address],
      ["Город", trtPointCity(point)],
      ["Менеджер", shortPersonName(point.manager)],
      ["Направление", point.direction],
      ["Регион", trtCanonicalRegionName(point)],
      ["Источник", trtOriginLabel(point)],
      ["Сеть", trtFdiyNetworkLabel(point)],
    ].filter(([, value]) => String(value || "").trim());

    let best = null;
    fields.forEach(([field, value]) => {
      const score = trtSmartMatchScore(value, q);
      if (!Number.isFinite(score)) return;
      if (!best || score < best.score) best = { field, value: String(value), score };
    });
    if (!best) return;

    const pointId = String(point.id);
    const title = trtSmartPointTitle(point);
    const address = String(point.address || "").trim();
    const secondary = best.field === "Адрес"
      ? address
      : [best.field !== "ТРТ" ? `${best.field}: ${best.value}` : "", address].filter(Boolean).join(" · ");
    add({
      type: "point",
      value: pointId,
      label: title,
      meta: secondary || "ТРТ",
      score: best.score + 0.35,
    });
  });

  const typePriority = { network: 0, direction: 1, manager: 2, city: 3, region: 4, source: 5, point: 6 };
  const deduped = [];
  const seen = new Set();
  suggestions
    .sort((a, b) => a.score - b.score || typePriority[a.type] - typePriority[b.type] || a.label.localeCompare(b.label, "ru"))
    .forEach((item) => {
      const key = `${item.type}:${String(item.value)}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(item);
    });
  return deduped.slice(0, 14);
}

function closeTrtSmartSuggestions() {
  const list = $("trt-smart-search-suggestions");
  const input = $("trt-smart-search-input");
  if (!list || !input) return;
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  trtSmartSuggestions = [];
  trtSmartSuggestionIndex = -1;
}

function renderTrtSmartSuggestions(query = $("trt-smart-search-input")?.value || "") {
  const list = $("trt-smart-search-suggestions");
  const input = $("trt-smart-search-input");
  if (!list || !input) return;
  const q = String(query || "").trim();
  if (!q) {
    closeTrtSmartSuggestions();
    return;
  }

  trtSmartSuggestions = buildTrtSmartSuggestions(q);
  if (!trtSmartSuggestions.length) {
    list.innerHTML = `<div class="trt-smart-search-empty">Ничего не найдено. Попробуйте сеть, город, регион, название ТРТ, адрес, направление или фамилию менеджера.</div>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    trtSmartSuggestionIndex = -1;
    return;
  }

  if (trtSmartSuggestionIndex >= trtSmartSuggestions.length) trtSmartSuggestionIndex = trtSmartSuggestions.length - 1;
  list.innerHTML = trtSmartSuggestions.map((item, index) => `
    <button class="trt-smart-suggestion${index === trtSmartSuggestionIndex ? " active" : ""}" type="button" role="option"
      aria-selected="${index === trtSmartSuggestionIndex ? "true" : "false"}" data-trt-suggestion-index="${index}">
      <span class="trt-smart-suggestion-type">${escapeHtml(trtSmartFilterTypeLabel(item.type))}</span>
      <span class="trt-smart-suggestion-copy">
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.meta || "")}</small>
      </span>
    </button>
  `).join("");
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function renderTrtSmartFilterChips() {
  const host = $("trt-smart-filter-chips");
  const input = $("trt-smart-search-input");
  const clear = $("trt-smart-filter-clear");
  if (!host || !input || !clear) return;

  host.innerHTML = trtSmartFilters.map((token) => `
    <span class="trt-smart-filter-chip" title="${escapeHtml(trtSmartFilterTypeLabel(token.type))}">
      <span>${escapeHtml(token.label)}</span>
      <button type="button" aria-label="Убрать фильтр ${escapeHtml(token.label)}" data-trt-filter-remove="${escapeHtml(trtSmartFilterTokenKey(token))}">×</button>
    </span>
  `).join("");
  clear.hidden = trtSmartFilters.length === 0;
  input.placeholder = trtSmartFilters.length
    ? "Добавить фильтр…"
    : "Сеть, ТРТ, город, регион, направление, менеджер или адрес";
}

function hasActiveTrtFilters() {
  return trtSmartFilters.length > 0
    || Boolean($("trt-direction-filter")?.value)
    || Boolean($("trt-manager-filter")?.value);
}

function resetTrtMapToDefaultView(animate = true) {
  state.trtFitRequested = false;
  if (!trtMap) return;
  const options = animate ? { animate: true, duration: 0.55 } : { animate: false };
  if (animate && typeof trtMap.flyTo === "function") {
    trtMap.flyTo(DEFAULT_MAP_VIEW.center, DEFAULT_MAP_VIEW.zoom, options);
  } else {
    trtMap.setView(DEFAULT_MAP_VIEW.center, DEFAULT_MAP_VIEW.zoom, options);
  }
}

function applyTrtSmartFilters() {
  // fitBounds нужен только для реального фильтра. После очистки возвращаем
  // согласованный стартовый вид ЦФО + основной части СЗФО + регионов присутствия ВОГ в ПФО.
  state.trtFitRequested = hasActiveTrtFilters();
  persistTrtSmartFilters();
  renderTrtSmartFilterChips();
  renderTrtMap();
  if (!hasActiveTrtFilters()) resetTrtMapToDefaultView(true);
}

function addTrtSmartFilter(suggestion) {
  if (!suggestion) return;
  const token = sanitizeTrtSmartFilterToken({
    type: suggestion.type,
    value: suggestion.value,
    label: suggestion.label,
  });
  if (!token) return;
  const key = trtSmartFilterTokenKey(token);
  if (!trtSmartFilters.some((item) => trtSmartFilterTokenKey(item) === key)) {
    trtSmartFilters.push(token);
  }

  const input = $("trt-smart-search-input");
  if (input) input.value = "";

  // Поисковый фильтр всегда должен быть виден на карте. Если пользователь
  // находился в режиме «только регионы», включаем совместный слой.
  if ($("trt-map-mode")?.value === "regions") setTrtMapMode("both");

  applyTrtSmartFilters();
  closeTrtSmartSuggestions();

  if (token.type === "point") {
    const point = state.trtPoints.find((item) => String(item.id) === token.value);
    if (point) window.setTimeout(() => openTrtCard(point.id, true), 30);
  }
}

function removeTrtSmartFilter(key) {
  const next = trtSmartFilters.filter((token) => trtSmartFilterTokenKey(token) !== key);
  if (next.length === trtSmartFilters.length) return;
  trtSmartFilters = next;
  applyTrtSmartFilters();
}

function clearTrtSmartFilters() {
  if (!trtSmartFilters.length) return;
  trtSmartFilters = [];
  applyTrtSmartFilters();
  $("trt-smart-search-input")?.focus();
}

function restoreTrtMapMode() {
  const select = $("trt-map-mode");
  if (!select) return;
  const saved = sessionStorage.getItem(TRT_MAP_MODE_KEY);
  if (["points", "regions", "both"].includes(saved)) select.value = saved;
  syncTrtDisplayControl();
}

function syncTrtDisplayControl() {
  const mode = $("trt-map-mode")?.value || "both";
  document.querySelectorAll("[data-trt-map-mode-value]").forEach((button) => {
    const active = button.dataset.trtMapModeValue === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setTrtMapMode(mode) {
  if (!["points", "regions", "both"].includes(mode)) return;
  const select = $("trt-map-mode");
  if (!select) return;
  select.value = mode;
  sessionStorage.setItem(TRT_MAP_MODE_KEY, mode);
  syncTrtDisplayControl();
  preserveTrtMapView(updateTrtMapMode);
}

function setTrtDisplayPanel(open) {
  const control = document.querySelector(".trt-display-control");
  const toggle = $("trt-display-toggle");
  const panel = $("trt-display-panel");
  if (!control || !toggle || !panel) return;
  control.classList.toggle("open", Boolean(open));
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  panel.setAttribute("aria-hidden", open ? "false" : "true");
}

function readTrtMapView() {
  try {
    const raw = sessionStorage.getItem(TRT_MAP_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed.lat);
    const lng = Number(parsed.lng);
    const zoom = Number(parsed.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
    return { center: [lat, lng], zoom };
  } catch {
    return null;
  }
}

function saveTrtMapView() {
  if (!trtMap) return;
  const center = trtMap.getCenter();
  const zoom = trtMap.getZoom();
  if (!center || !Number.isFinite(zoom)) return;
  sessionStorage.setItem(TRT_MAP_VIEW_KEY, JSON.stringify({
    lat: center.lat,
    lng: center.lng,
    zoom,
  }));
}


const TRT_MAJOR_CITY_LABELS = new Set([
  "москва", "санкт-петербург", "санкт петербург", "воронеж", "минск"
]);

const TRT_REGIONAL_CENTER_LABELS = new Set([
  "белгород", "брянск", "владимир", "воронеж", "иваново", "калуга", "кострома", "курск",
  "липецк", "орел", "орёл", "рязань", "смоленск", "тамбов", "тверь", "тула", "ярославль",
  "москва", "санкт-петербург", "санкт петербург", "петрозаводск", "сыктывкар", "архангельск",
  "вологда", "калининград", "мурманск", "нарьян-мар", "нарьян мар", "великий новгород", "псков",
  "нижний новгород", "киров", "чебоксары", "саранск", "йошкар-ола", "йошкар ола",
  "минск", "брест", "витебск", "гомель", "гродно", "могилев"
]);

const TRT_FIXED_RU_CITY_LABELS = [
  { key: "by|minsk", city: "Минск", region: "Беларусь", lat: 53.9023, lon: 27.5619, count: 100, minZoom: 4, tier: "major", priority: 0 },
  { key: "by|brest", city: "Брест", region: "Беларусь", lat: 52.0976, lon: 23.7341, count: 30, minZoom: 6, tier: "regional", priority: 1 },
  { key: "by|vitebsk", city: "Витебск", region: "Беларусь", lat: 55.1848, lon: 30.2016, count: 30, minZoom: 6, tier: "regional", priority: 1 },
  { key: "by|gomel", city: "Гомель", region: "Беларусь", lat: 52.4345, lon: 30.9754, count: 30, minZoom: 6, tier: "regional", priority: 1 },
  { key: "by|grodno", city: "Гродно", region: "Беларусь", lat: 53.6694, lon: 23.8131, count: 30, minZoom: 6, tier: "regional", priority: 1 },
  { key: "by|mogilev", city: "Могилёв", region: "Беларусь", lat: 53.9007, lon: 30.3314, count: 30, minZoom: 6, tier: "regional", priority: 1 },
];

function trtIsAdministrativeLabel(value) {
  const city = cleanTrtCityName(value);
  if (!city) return true;
  const normalized = normalizeText(city);
  if (!normalized) return true;
  return /(?:^|\s)(?:область|обл\.?|республика|край|автономный\s+округ|автономная\s+область|ао)(?:$|\s)/i.test(city)
    || /^(?:республика\s+|область\s+)/i.test(city);
}

function trtCityLabelProfile(row) {
  const city = normalizeText(row?.city);
  if (TRT_MAJOR_CITY_LABELS.has(city)) return { minZoom: 4, tier: "major", priority: 0 };
  if (TRT_REGIONAL_CENTER_LABELS.has(city)) return { minZoom: 5, tier: "regional", priority: 1 };
  if (row.count >= 18) return { minZoom: 6, tier: "large", priority: 2 };
  if (row.count >= 7) return { minZoom: 7, tier: "medium", priority: 3 };
  if (row.count >= 3) return { minZoom: 8, tier: "small", priority: 4 };
  return { minZoom: 9, tier: "local", priority: 5 };
}

function buildTrtCityLabelData() {
  const groups = new Map();
  state.trtPoints.forEach((point) => {
    const city = trtPointCity(point);
    const key = trtPointCityKey(point);
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!city || !key || trtIsAdministrativeLabel(city) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!groups.has(key)) groups.set(key, { key, city, region: String(point.region || ""), latSum: 0, lonSum: 0, count: 0 });
    const row = groups.get(key);
    row.latSum += lat;
    row.lonSum += lon;
    row.count += 1;
  });
  const derived = [...groups.values()]
    .map((row) => {
      const result = { ...row, lat: row.latSum / row.count, lon: row.lonSum / row.count };
      return { ...result, ...trtCityLabelProfile(result) };
    });
  const seenCities = new Set(derived.map((row) => normalizeText(row.city)));
  TRT_FIXED_RU_CITY_LABELS.forEach((row) => {
    if (!seenCities.has(normalizeText(row.city))) derived.push({ ...row });
  });
  return derived.sort((a, b) => a.priority - b.priority || b.count - a.count || a.city.localeCompare(b.city, "ru"));
}

function trtCityLabelBox(row, point) {
  const widthFactor = row.tier === "major" ? 7.8 : row.tier === "regional" ? 7.0 : 6.2;
  const width = Math.max(36, Math.min(170, row.city.length * widthFactor + 18));
  const height = row.tier === "major" ? 23 : row.tier === "regional" ? 20 : 18;
  return {
    left: point.x - width / 2 - 5,
    right: point.x + width / 2 + 5,
    top: point.y - height / 2 - 4,
    bottom: point.y + height / 2 + 4,
  };
}

function trtCityLabelBoxesOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function refreshTrtCityLabels() {
  if (!trtMap || !trtCityLabelLayer || !state.trtLoaded) return;
  trtCityLabelLayer.clearLayers();
  const zoom = trtMap.getZoom();
  const mapSize = trtMap.getSize();
  const occupied = [];
  const rows = buildTrtCityLabelData().filter((row) => zoom >= row.minZoom);

  rows.forEach((row) => {
    const point = trtMap.latLngToContainerPoint([row.lat, row.lon]);
    if (point.x < -80 || point.y < -40 || point.x > mapSize.x + 80 || point.y > mapSize.y + 40) return;
    const box = trtCityLabelBox(row, point);
    if (occupied.some((existing) => trtCityLabelBoxesOverlap(existing, box))) return;
    occupied.push(box);

    const marker = L.marker([row.lat, row.lon], {
      interactive: false,
      keyboard: false,
      zIndexOffset: -250,
      icon: L.divIcon({
        className: "trt-city-label-icon",
        html: `<span class="trt-city-label trt-city-label-${row.tier}">${escapeHtml(row.city)}</span>`,
        iconSize: null,
      }),
    });
    trtCityLabelLayer.addLayer(marker);
  });
}

function initTrtMap() {
  if (trtMap || typeof window.L === "undefined") return;

  const savedView = readTrtMapView();
  trtMap = L.map("trt-map").setView(
    savedView?.center || DEFAULT_MAP_VIEW.center,
    savedView?.zoom ?? DEFAULT_MAP_VIEW.zoom
  );
  trtMap.on("moveend", () => { saveTrtMapView(); refreshTrtCityLabels(); });
  trtMap.on("zoomend", saveTrtMapView);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    attribution: "© OpenStreetMap contributors · © CARTO",
  }).addTo(trtMap);
  trtMap.attributionControl.setPrefix("");

  trtMarkerLayer = typeof L.markerClusterGroup === "function"
    ? L.markerClusterGroup({
        zoomToBoundsOnClick: true,
        spiderfyOnMaxZoom: true,
        iconCreateFunction(cluster) {
          const markers = cluster.getAllChildMarkers();
          const sizes = markers
            .map((marker) => Number(marker.options.sizeValue))
            .filter(Number.isFinite);
          const average = sizes.length
            ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length
            : null;
          const origins = markers.map((marker) => String(marker.options.originKey || ""));
          const allNewBulk = origins.length > 0 && origins.every((origin) => origin === "new_bulk");
          const color = allNewBulk ? "#4b5563" : trtColor(average);
          return L.divIcon({
            html: `<div class="legacy-cluster${allNewBulk ? " trt-new-bulk-cluster" : ""}" style="background:${color}"><span>${markers.length}</span></div>`,
            className: "",
            iconSize: [40, 40],
          });
        },
      })
    : L.layerGroup();

  trtMarkerLayer.addTo(trtMap);
  trtCityLabelLayer = L.layerGroup().addTo(trtMap);
  refreshTrtCityLabels();
}

function filteredTrtPoints() {
  const direction = $("trt-direction-filter").value;
  const manager = $("trt-manager-filter").value;
  const smartDirections = trtSmartFilterValues("direction");
  const smartManagers = trtSmartFilterValues("manager");
  const smartCities = trtSmartFilterValues("city");
  const smartRegions = trtSmartFilterValues("region");
  const smartSources = trtSmartFilterValues("source");
  const smartNetworks = trtSmartFilterValues("network");
  const smartPoints = trtSmartFilterValues("point");

  return state.trtPoints.filter((point) => {
    if (direction && point.direction !== direction) return false;
    if (manager && point.manager !== manager) return false;
    if (smartDirections.size && !smartDirections.has(String(point.direction || ""))) return false;
    if (smartManagers.size && !smartManagers.has(String(point.manager || ""))) return false;
    if (smartCities.size && !smartCities.has(trtPointCityKey(point))) return false;
    if (smartRegions.size && !smartRegions.has(trtCanonicalRegionName(point))) return false;
    if (smartSources.size && !smartSources.has(trtOriginKey(point))) return false;
    if (smartNetworks.size && !smartNetworks.has(trtFdiyNetworkKey(point))) return false;
    if (smartPoints.size && !smartPoints.has(String(point.id))) return false;
    return true;
  });
}

function trtMarkerIcon(point) {
  const isNewBulk = trtOriginKey(point) === "new_bulk";
  const color = isNewBulk ? "#4b5563" : trtColor(point.size);
  const title = isNewBulk ? "Новая ТРТ" : "";
  return L.divIcon({
    className: "",
    html: `<div class="legacy-size-marker${isNewBulk ? " trt-new-bulk-marker" : ""}" style="background:${color}"${title ? ` title="${title}"` : ""}></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function isFdiyTrtPoint(point) {
  return String(point?.salesSource || "").toUpperCase() === "FDIY"
    || Boolean(point?.fdiySales)
    || Boolean(point?.fdiyNetworkId);
}

async function loadFdiyCardSeries(point, force = false) {
  if (!point || !isFdiyTrtPoint(point)) return null;
  if (point._fdiyCardLoading) return point._fdiyCardLoading;
  if (point._fdiyCardLoaded && !force) return point.fdiySales || null;

  const selectedId = String(point.id || "");
  const empty = $("trt-card-sales-empty");
  if (empty && state.trtSelectedId === selectedId) {
    empty.hidden = false;
    empty.textContent = "Загрузка продаж FDIY…";
  }

  point._fdiyCardLoading = (async () => {
    try {
      const payload = await api(`/trt-map-data?view=fdiy_card&point_id=${encodeURIComponent(selectedId)}`, { timeout: 90000 });
      point._fdiyCardLoaded = true;
      point.fdiySales = payload?.fdiySales || { vog: {}, total: {} };
      if (payload?.network) point.fdiyNetwork = payload.network;
      if (payload?.networkId) point.fdiyNetworkId = payload.networkId;
      if (payload?.storeCode) point.fdiyStoreCode = payload.storeCode;
      if (payload?.masterId) point.fdiyMasterId = payload.masterId;
      point.fdiyCardMatchedRows = Number(payload?.matchedRows || 0);
      point.fdiyCardActivePeriods = Number(payload?.activePeriods || 0);
      if (state.trtSelectedId === selectedId) {
        renderTrtFdiyShare(point);
        updateTrtFdiySalesControl(point);
        renderTrtCardSalesChart(point);
      }
      return point.fdiySales;
    } catch (error) {
      point._fdiyCardLoaded = false;
      if (state.trtSelectedId === selectedId) {
        const target = $("trt-card-sales-empty");
        if (target) {
          target.hidden = false;
          target.textContent = `Не удалось загрузить продажи FDIY: ${error?.message || error}`;
        }
      }
      return null;
    } finally {
      point._fdiyCardLoading = null;
    }
  })();
  return point._fdiyCardLoading;
}

function trtFdiySeries(point, mode, year) {
  const source = point?.fdiySales?.[mode] || {};
  return (Array.isArray(source?.[year]) ? source[year] : [])
    .concat(Array(12).fill(null)).slice(0, 12);
}

function trtSalesData(point, mode = null) {
  const isFdiy = isFdiyTrtPoint(point);
  const salesMode = isFdiy ? (mode === "total" ? "total" : "vog") : "vog";
  const sales2025 = isFdiy
    ? trtFdiySeries(point, salesMode, "2025")
    : (Array.isArray(point?.sales?.["2025"]) ? point.sales["2025"] : []).concat(Array(12).fill(null)).slice(0, 12);
  const sales2026 = isFdiy
    ? trtFdiySeries(point, salesMode, "2026")
    : (Array.isArray(point?.sales?.["2026"]) ? point.sales["2026"] : []).concat(Array(12).fill(null)).slice(0, 12);
  const unit = trtUnit(point);
  const ytd2025 = sumSales(sales2025, 6);
  const ytd2026 = sumSales(sales2026, 6);
  const yoy = ytd2025 ? ((ytd2026 - ytd2025) / ytd2025) * 100 : null;
  const hasSales = [...sales2025, ...sales2026].some((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
  return {
    sales2025, sales2026, unit, ytd2025, ytd2026, yoy, hasSales, isFdiy, salesMode,
    salesModeLabel: isFdiy ? (salesMode === "total" ? "Общие продажи" : "Продажи ВОГ") : "Продажи",
  };
}

function trtFdiyLatestShare(point) {
  if (!isFdiyTrtPoint(point)) return null;
  const totalByYear = point?.fdiySales?.total || {};
  const vogByYear = point?.fdiySales?.vog || {};
  const years = [...new Set([...Object.keys(totalByYear), ...Object.keys(vogByYear)])]
    .map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  let latest = null;
  years.forEach((year) => {
    const total = (Array.isArray(totalByYear[String(year)]) ? totalByYear[String(year)] : []).concat(Array(12).fill(null)).slice(0, 12);
    const vog = (Array.isArray(vogByYear[String(year)]) ? vogByYear[String(year)] : []).concat(Array(12).fill(null)).slice(0, 12);
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const totalRaw = total[monthIndex], vogRaw = vog[monthIndex];
      if (totalRaw === null || totalRaw === undefined || totalRaw === "" || vogRaw === null || vogRaw === undefined || vogRaw === "") continue;
      const totalValue = Number(totalRaw), vogValue = Number(vogRaw);
      // A pie chart is meaningful only for a normal positive sales month. Negative
      // corrections remain visible in the bar chart but are not converted to a share.
      if (!Number.isFinite(totalValue) || !Number.isFinite(vogValue) || totalValue <= 0 || vogValue < 0 || vogValue > totalValue) continue;
      latest = { year, month: monthIndex + 1, total: totalValue, vog: vogValue, other: totalValue - vogValue, share: totalValue ? (vogValue / totalValue) * 100 : null };
    }
  });
  return latest;
}

function renderTrtFdiyShare(point) {
  if (trtCardFdiyShareChart) {
    trtCardFdiyShareChart.destroy();
    trtCardFdiyShareChart = null;
  }
  const block = $("trt-card-fdiy-share");
  const canvas = $("trt-card-fdiy-share-chart");
  const value = $("trt-card-fdiy-share-value");
  const period = $("trt-card-fdiy-share-period");
  const detail = $("trt-card-fdiy-share-detail");
  if (!block || !canvas || !value || !period || !detail) return;

  const isFdiy = isFdiyTrtPoint(point);
  block.hidden = !isFdiy;
  if (!isFdiy) return;

  const share = trtFdiyLatestShare(point);
  if (!share) {
    value.textContent = "—";
    period.textContent = "Нет периода для корректного расчёта доли";
    detail.textContent = "Доля рассчитывается для последнего месяца, где есть и общие продажи, и продажи ВОГ.";
    return;
  }

  const labels = analyticsMonthLabels();
  const unit = trtUnit(point);
  value.textContent = `${share.share.toFixed(1).replace(".", ",")}%`;
  period.textContent = `${labels[share.month - 1]} ${share.year}`;
  detail.textContent = `ВОГ ${Math.round(share.vog).toLocaleString("ru-RU")} из ${Math.round(share.total).toLocaleString("ru-RU")} ${unit}`;

  trtCardFdiyShareChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["ВОГ", "Остальные продажи"],
      datasets: [{ data: [share.vog, share.other], backgroundColor: ["#384E86", "#dce2eb"], borderWidth: 0, hoverOffset: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      animation: { duration: 220, easing: "easeOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label(context) { return `${context.label}: ${Math.round(numberOrZero(context.raw)).toLocaleString("ru-RU")} ${unit}`; } } },
      },
    },
  });
}

function updateTrtFdiySalesControl(point) {
  const control = $("trt-card-fdiy-sales-control");
  const shown = $("trt-card-fdiy-sales-shown");
  const button = $("trt-card-fdiy-sales-toggle");
  if (!control || !shown || !button) return;
  const isFdiy = isFdiyTrtPoint(point);
  control.hidden = !isFdiy;
  if (!isFdiy) return;
  const showingTotal = trtCardFdiySalesMode === "total";
  shown.textContent = showingTotal ? "Показано: общие продажи" : "Показано: продажи ВОГ";
  button.textContent = showingTotal ? "Продажи ВОГ" : "Общие продажи";
  button.setAttribute("aria-pressed", showingTotal ? "true" : "false");
}

function renderTrtCardSalesChart(point) {
  if (trtCardSalesChart) {
    trtCardSalesChart.destroy();
    trtCardSalesChart = null;
  }
  const preview = $("trt-card-sales-preview");
  const empty = $("trt-card-sales-empty");
  const canvas = $("trt-card-sales-chart");
  if (!preview || !empty || !canvas) return;

  const data = trtSalesData(point, trtCardFdiySalesMode);
  preview.hidden = !data.hasSales;
  empty.hidden = data.hasSales;
  empty.textContent = data.isFdiy
    ? `${data.salesModeLabel} по этой ТРТ пока не загружены.`
    : "Продажи по этой ТРТ пока не загружены.";
  preview.setAttribute("aria-disabled", data.hasSales ? "false" : "true");
  preview.setAttribute("aria-label", data.isFdiy ? `Увеличить график: ${data.salesModeLabel}` : "Увеличить график продаж");
  updateTrtFdiySalesControl(point);
  if (!data.hasSales) return;

  trtCardSalesChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: analyticsMonthLabels(),
      datasets: [
        { label: "2025", data: data.sales2025, backgroundColor: "#c9deef", borderColor: "#a9c7df", borderWidth: 1, borderRadius: 5, maxBarThickness: 18 },
        { label: "2026", data: data.sales2026, backgroundColor: "#384E86", borderColor: "#2b3f71", borderWidth: 1, borderRadius: 5, maxBarThickness: 18 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 18, boxHeight: 8, useBorderRadius: true, borderRadius: 3 } },
        tooltip: { callbacks: { label(context) { return `${context.dataset.label}: ${Math.round(numberOrZero(context.parsed.y)).toLocaleString("ru-RU")} ${data.unit}`; } } },
      },
      scales: {
        y: { beginAtZero: true, grace: "8%", ticks: { font: { size: 10 }, maxTicksLimit: 5, callback(value) { return Math.round(Number(value)).toLocaleString("ru-RU"); } }, grid: { color: "rgba(56,78,134,.08)" } },
        x: { ticks: { font: { size: 10 }, maxRotation: 0 }, grid: { display: false } },
      },
    },
  });
}

function openTrtCard(pointId, focusMap = true) {
  const point = state.trtPoints.find((item) => String(item.id) === String(pointId));
  if (!point) return;

  const inspector = $("map-inspector");
  const previousScrollTop = trtInspectorMode === "trt" && inspector ? inspector.scrollTop : 0;

  state.trtSelectedId = String(point.id);
  trtInspectorRegion = null;
  $("trt-map-empty").hidden = true;
  $("trt-map-card").hidden = false;
  mountTrtCardInInspector();
  setMapInspectorView("trt");

  $("trt-card-name").textContent = trtDisplayName(point);
  $("trt-card-direction").textContent = point.direction || "—";
  $("trt-card-manager").textContent = shortPersonName(point.manager) || "—";
  $("trt-card-holding").textContent = point.holding || point.client || "—";
  $("trt-card-format").textContent = point.format || "—";
  const origin = trtOriginKey(point);
  $("trt-card-status").textContent = origin === "base"
    ? trtStatusLabel(point)
    : `${trtStatusLabel(point)} · ${trtOriginLabel(origin)}`;
  $("trt-card-address").textContent = point.address || "—";
  renderTrtFourP(point);

  trtCardFdiySalesMode = "vog";
  renderTrtFdiyShare(point);
  updateTrtFdiySalesControl(point);

  const badge = $("trt-card-size-badge");
  badge.textContent = formatTrtSize(point);
  badge.style.background = trtColor(point.size);

  window.requestAnimationFrame(() => renderTrtCardSalesChart(point));
  if (isFdiyTrtPoint(point)) {
    loadFdiyCardSeries(point, true);
  }

  if (focusMap && trtMap && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))) {
    setTrtMainView("map");
    trtMap.setView([Number(point.lat), Number(point.lon)], Math.max(trtMap.getZoom(), 14));
  }

  if (inspector) {
    window.requestAnimationFrame(() => { inspector.scrollTop = previousScrollTop; });
  }
}

function recalculateTrtRegionStats() {
  const stats = {};
  state.trtPoints.forEach((point) => {
    if (!point.sales) return;
    const region = point.region || "Без региона";
    if (!stats[region]) stats[region] = { count: 0, sales2025: 0, sales2026: 0 };
    stats[region].count += 1;
    stats[region].sales2025 += sumSales(point.sales["2025"], 6);
    stats[region].sales2026 += sumSales(point.sales["2026"], 6);
  });
  Object.values(stats).forEach((item) => {
    item.yoy = item.sales2025
      ? ((item.sales2026 - item.sales2025) / item.sales2025) * 100
      : null;
  });
  return stats;
}

function regionResultColor(yoy) {
  if (yoy === null || !Number.isFinite(yoy)) return "#94a3b8";
  if (yoy < -10) return "#dc2626";
  if (yoy <= 10) return "#facc15";
  return "#16a34a";
}

function trtRegionFeatureName(feature) {
  const properties = feature?.properties || {};
  return String(properties.name || properties.NAME || properties.name_en || properties.NAME_1 || "").trim();
}

const TRT_REGION_DEFINITIONS = Object.freeze({
  // Центральный федеральный округ — 18 субъектов.
  "Белгородская область": { key: "Белгородская область", district: "ЦФО" },
  "Брянская область": { key: "Брянская область", district: "ЦФО" },
  "Владимирская область": { key: "Владимирская область", district: "ЦФО" },
  "Воронежская область": { key: "Воронежская область", district: "ЦФО" },
  "Ивановская область": { key: "Ивановская область", district: "ЦФО" },
  "Калужская область": { key: "Калужская область", district: "ЦФО" },
  "Костромская область": { key: "Костромская область", district: "ЦФО" },
  "Курская область": { key: "Курская область", district: "ЦФО" },
  "Липецкая область": { key: "Липецкая область", district: "ЦФО" },
  "Москва": {
    key: "Москва и Московская область",
    label: "Москва",
    district: "ЦФО",
    pointAliases: ["Москва", "Москва и Московская область"],
  },
  "Московская область": {
    key: "Москва и Московская область",
    district: "ЦФО",
    pointAliases: ["Московская область", "Москва и Московская область"],
  },
  "Орловская область": { key: "Орловская область", district: "ЦФО" },
  "Рязанская область": { key: "Рязанская область", district: "ЦФО" },
  "Смоленская область": { key: "Смоленская область", district: "ЦФО" },
  "Тамбовская область": { key: "Тамбовская область", district: "ЦФО" },
  "Тверская область": { key: "Тверская область", district: "ЦФО" },
  "Тульская область": { key: "Тульская область", district: "ЦФО" },
  "Ярославская область": { key: "Ярославская область", district: "ЦФО" },

  // Северо-Западный федеральный округ — 11 субъектов.
  "Республика Карелия": {
    key: "Республика Карелия",
    district: "СЗФО",
    pointAliases: ["Карелия", "Республика Карелия"],
  },
  "Республика Коми": {
    key: "Республика Коми",
    district: "СЗФО",
    pointAliases: ["Коми", "Республика Коми"],
  },
  "Архангельская область": { key: "Архангельская область", district: "СЗФО" },
  "Вологодская область": { key: "Вологодская область", district: "СЗФО" },
  "Калининградская область": { key: "Калининградская область", district: "СЗФО" },
  "Ленинградская область": { key: "Ленинградская область", district: "СЗФО" },
  "Мурманская область": { key: "Мурманская область", district: "СЗФО" },
  "Ненецкий автономный округ": {
    key: "Ненецкий автономный округ",
    district: "СЗФО",
    pointAliases: ["Ненецкий АО", "Ненецкий автономный округ"],
  },
  "Новгородская область": { key: "Новгородская область", district: "СЗФО" },
  "Псковская область": { key: "Псковская область", district: "СЗФО" },
  "Санкт-Петербург": {
    key: "Санкт-Петербург",
    district: "СЗФО",
    pointAliases: ["Санкт-Петербург", "Санкт Петербург", "СПб"],
  },

  // Дополнительные регионы присутствия ВОГ — Приволжский федеральный округ.
  "Нижегородская область": {
    key: "Нижегородская область",
    district: "ПФО",
    pointAliases: ["Нижегородская область", "Нижегородская обл", "Нижегородская обл."],
  },
  "Кировская область": {
    key: "Кировская область",
    district: "ПФО",
    pointAliases: ["Кировская область", "Кировская обл", "Кировская обл."],
  },
  "Чувашия": {
    key: "Чувашия",
    district: "ПФО",
    pointAliases: ["Чувашия", "Чувашская Республика", "Чувашская Республика - Чувашия", "Чувашская Республика — Чувашия"],
  },
  "Республика Мордовия": {
    key: "Республика Мордовия",
    label: "Мордовия",
    district: "ПФО",
    pointAliases: ["Мордовия", "Республика Мордовия"],
  },
  "Марий Эл": {
    key: "Марий Эл",
    district: "ПФО",
    pointAliases: ["Марий Эл", "Республика Марий Эл"],
  },
});

const TRT_REGION_FILL_COLOR = "#4293C4";
const TRT_REGION_BORDER_COLOR = "#384E86";

function trtRegionConfig(feature) {
  return TRT_REGION_DEFINITIONS[trtRegionFeatureName(feature)] || null;
}

function trtRegionKey(feature) {
  return trtRegionConfig(feature)?.key || null;
}

function trtRegionStyle(feature) {
  const config = trtRegionConfig(feature);
  return {
    color: TRT_REGION_BORDER_COLOR,
    weight: 1.8,
    fillColor: config ? TRT_REGION_FILL_COLOR : "transparent",
    fillOpacity: config ? 0.30 : 0,
  };
}

function normalizeRegionName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ");
}


const TRT_REGION_CENTER_TO_KEY = Object.freeze({
  "белгород":"Белгородская область","брянск":"Брянская область","владимир":"Владимирская область",
  "воронеж":"Воронежская область","иваново":"Ивановская область","калуга":"Калужская область",
  "кострома":"Костромская область","курск":"Курская область","липецк":"Липецкая область",
  "москва":"Москва и Московская область","орел":"Орловская область","орёл":"Орловская область",
  "рязань":"Рязанская область","смоленск":"Смоленская область","тамбов":"Тамбовская область",
  "тверь":"Тверская область","тула":"Тульская область","ярославль":"Ярославская область",
  "петрозаводск":"Республика Карелия","сыктывкар":"Республика Коми","архангельск":"Архангельская область",
  "вологда":"Вологодская область","калининград":"Калининградская область","санкт-петербург":"Санкт-Петербург",
  "санкт петербург":"Санкт-Петербург","мурманск":"Мурманская область","нарьян-мар":"Ненецкий автономный округ",
  "нарьян мар":"Ненецкий автономный округ","великий новгород":"Новгородская область","псков":"Псковская область",
  "нижний новгород":"Нижегородская область","киров":"Кировская область","чебоксары":"Чувашия",
  "саранск":"Республика Мордовия","йошкар-ола":"Марий Эл","йошкар ола":"Марий Эл"
});

let trtRegionAliasCache = null;
let trtCityRegionCache = null;
let trtCityRegionCacheSize = -1;

function normalizeRegionLookupText(value) {
  return normalizeRegionName(value)
    .replace(/\bобл\.?\b/g, "область")
    .replace(/\bао\b/g, "автономный округ")
    .replace(/\s+/g, " ")
    .trim();
}

function trtRegionAliasEntries() {
  if (trtRegionAliasCache) return trtRegionAliasCache;
  const entries = [];
  Object.entries(TRT_REGION_DEFINITIONS).forEach(([featureName, config]) => {
    const aliases = new Set([featureName, config.key, config.label, ...(config.pointAliases || [])].filter(Boolean));
    [...aliases].forEach((alias) => {
      const normalized = normalizeRegionLookupText(alias);
      if (!normalized) return;
      entries.push({ alias: normalized, key: config.key });
      if (normalized.includes(" область")) {
        entries.push({ alias: normalized.replace(" область", " обл"), key: config.key });
      }
    });
  });
  trtRegionAliasCache = entries.sort((a, b) => b.alias.length - a.alias.length);
  return trtRegionAliasCache;
}

function inferTrtExplicitRegion(point) {
  const candidates = [point?.region, point?.address].map(normalizeRegionLookupText).filter(Boolean);
  for (const candidate of candidates) {
    for (const entry of trtRegionAliasEntries()) {
      if (candidate === entry.alias || candidate.includes(entry.alias)) return entry.key;
    }
  }
  const city = normalizeText(trtPointCity(point)).replace(/ё/g, "е");
  if (city && TRT_REGION_CENTER_TO_KEY[city]) return TRT_REGION_CENTER_TO_KEY[city];
  return "";
}

function rebuildTrtCityRegionCache() {
  const map = new Map();
  state.trtPoints.forEach((point) => {
    const city = normalizeText(trtPointCity(point));
    const region = inferTrtExplicitRegion(point);
    if (!city || !region) return;
    if (!map.has(city)) map.set(city, new Set());
    map.get(city).add(region);
  });
  const unique = new Map();
  map.forEach((regions, city) => {
    if (regions.size === 1) unique.set(city, [...regions][0]);
  });
  trtCityRegionCache = unique;
  trtCityRegionCacheSize = state.trtPoints.length;
}

function trtCanonicalRegionName(point) {
  const explicit = inferTrtExplicitRegion(point);
  if (explicit) return explicit;
  if (!trtCityRegionCache || trtCityRegionCacheSize !== state.trtPoints.length) rebuildTrtCityRegionCache();
  const city = normalizeText(trtPointCity(point));
  return (city && trtCityRegionCache.get(city)) || String(point?.region || "").trim();
}

function marketDirectionKey(value) {
  const normalized = normalizeText(value);
  return normalized.includes("обо") ? "обои" : normalized.includes("плит") || normalized.includes("керам") ? "плитка" : normalized;
}

function marketDirectionLabel(value) {
  return marketDirectionKey(value) === "обои" ? "Обои" : "Плитка";
}

function marketUnit(value) {
  return marketDirectionKey(value) === "обои" ? "рул." : "м²";
}

function marketPotential(population, direction = marketAnalysisDirection) {
  const people = Math.max(0, Number(population || 0));
  return marketDirectionKey(direction) === "обои" ? people * 0.8 / 1.92 / 12 : people / 12;
}

function marketTargetShare(direction = marketAnalysisDirection) {
  return marketDirectionKey(direction) === "обои" ? 0.15 : 0.10;
}

function marketPercent(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits).replace(".", ",")}%` : "—";
}

function marketNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function marketQuantity(value, direction = marketAnalysisDirection, digits = 0) {
  return `${marketNumber(value, digits)} ${marketUnit(direction)}`;
}

function marketPointMonthFact(point, year = marketAnalysisYear, month = marketAnalysisMonth) {
  const values = point?.sales?.[String(year)];
  if (!Array.isArray(values)) return 0;
  const value = Number(values[Number(month) - 1]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function marketPointMatchesDirection(point, direction = marketAnalysisDirection) {
  return marketDirectionKey(point?.direction) === marketDirectionKey(direction);
}

function marketCatalogRegions() {
  return Array.isArray(state.marketAnalysis?.catalog?.regions) ? state.marketAnalysis.catalog.regions : [];
}

function marketRegionEntry(regionKey) {
  const normalized = normalizeRegionName(regionKey);
  return marketCatalogRegions().find((item) => normalizeRegionName(item.key) === normalized) || null;
}

async function marketFetchOptionalJson(source) {
  try {
    const response = await fetch(source.url, { cache: "no-store" });
    if (response.status === 404 && source.optional) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.periods)) throw new Error("Некорректный формат статического файла");
    return { ...payload, _sourceUrl: source.url, _direction: source.direction || payload.direction || "" };
  } catch (error) {
    if (source.optional) {
      console.info(`[VOG] optional static market source skipped: ${source.url}`, error?.message || error);
      return null;
    }
    throw new Error(`Не удалось загрузить статический файл планов: ${source.url}`);
  }
}

function marketMatchNormalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketPointClientValues(point) {
  return [...new Set([point?.client, point?.holding, point?.customer, point?.clientName, point?.customerName]
    .map(marketMatchNormalize).filter(Boolean))];
}

function marketPointLocationValues(point, clients = marketPointClientValues(point)) {
  const base = [point?.address, point?.location, point?.name, point?.pointName, point?.title, point?.trtName, trtDisplayName(point)]
    .map(marketMatchNormalize).filter(Boolean);
  const combined = [];
  clients.forEach((client) => base.forEach((location) => combined.push(marketMatchNormalize(`${client} ${location}`))));
  return [...new Set([...clients, ...base, ...combined].filter(Boolean))];
}

function marketTokenSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  let common = 0; a.forEach((token) => { if (b.has(token)) common += 1; });
  const union = Math.max(1, new Set([...a, ...b]).size);
  const tokenScore = common / union;
  const bigrams = (text) => {
    const compact = text.replace(/\s+/g, " ");
    if (compact.length < 2) return new Set([compact]);
    const set = new Set(); for (let i = 0; i < compact.length - 1; i += 1) set.add(compact.slice(i, i + 2));
    return set;
  };
  const ab = bigrams(left); const bb = bigrams(right);
  let biCommon = 0; ab.forEach((item) => { if (bb.has(item)) biCommon += 1; });
  const dice = (2 * biCommon) / Math.max(1, ab.size + bb.size);
  const containsBonus = left.includes(right) || right.includes(left) ? 0.04 : 0;
  return Math.min(1, Math.max(tokenScore, dice) + containsBonus);
}

function marketBuildStaticPointIndex() {
  const byDirection = new Map();
  const byAddress = new Map();
  (state.trtPoints || []).forEach((point) => {
    const pointId = String(point?.id || "");
    if (!pointId) return;
    const direction = marketDirectionKey(point?.direction);
    const clients = marketPointClientValues(point);
    const locations = marketPointLocationValues(point, clients);
    const item = { point, pointId, direction, clients, locations };
    if (!byDirection.has(direction)) byDirection.set(direction, []);
    byDirection.get(direction).push(item);
    const address = marketMatchNormalize(point?.address);
    if (address) {
      const key = `${direction}|${address}`;
      if (!byAddress.has(key)) byAddress.set(key, []);
      byAddress.get(key).push(item);
    }
  });
  return { byDirection, byAddress };
}

function marketMatchStaticPlanRow(direction, row, index) {
  const directionKey = marketDirectionKey(direction || row?.direction);
  const candidates = index.byDirection.get(directionKey) || [];
  if (!candidates.length) return { status: "unmatched", pointId: "", message: "Нет ТРТ этого направления" };
  const client = marketMatchNormalize(row?.client);
  const name = marketMatchNormalize(row?.trt || row?.trtName);
  const address = marketMatchNormalize(row?.address);

  if (address) {
    const exactAddress = index.byAddress.get(`${directionKey}|${address}`) || [];
    if (exactAddress.length === 1) return { status: "matched", pointId: exactAddress[0].pointId, message: "Точный адрес" };
    if (exactAddress.length > 1) {
      const narrowed = exactAddress.filter((item) => (client && item.clients.includes(client)) || (name && item.locations.includes(name)));
      if (narrowed.length === 1) return { status: "matched", pointId: narrowed[0].pointId, message: "Адрес + клиент/ТРТ" };
    }
    const scored = candidates.map((item) => {
      const pointAddress = marketMatchNormalize(item.point?.address);
      const addressScore = pointAddress ? marketTokenSimilarity(address, pointAddress) : 0;
      if (addressScore < 0.84) return null;
      const clientScore = client ? Math.max(0, ...item.clients.map((value) => marketTokenSimilarity(client, value))) : 0;
      const nameScore = name ? Math.max(0, ...item.locations.map((value) => marketTokenSimilarity(name, value))) : 0;
      const score = 0.72 * addressScore + 0.18 * Math.max(clientScore, nameScore) + 0.10 * Math.min(clientScore, nameScore);
      return { item, score, addressScore };
    }).filter(Boolean).sort((a,b) => b.score - a.score);
    if (scored.length === 1 && scored[0].score >= 0.86) return { status: "matched", pointId: scored[0].item.pointId, message: `Адрес ${Math.round(scored[0].addressScore * 100)}%` };
    if (scored.length > 1 && scored[0].score >= 0.90 && scored[0].score - scored[1].score >= 0.045) return { status: "matched", pointId: scored[0].item.pointId, message: `Адрес ${Math.round(scored[0].addressScore * 100)}%` };
  }

  const exact = candidates.filter((item) => client && name && item.clients.includes(client) && item.locations.includes(name));
  if (exact.length === 1) return { status: "matched", pointId: exact[0].pointId, message: "Клиент + ТРТ" };
  const similar = candidates.map((item) => {
    const clientScore = client ? Math.max(0, ...item.clients.map((value) => marketTokenSimilarity(client, value))) : 0;
    const nameScore = name ? Math.max(0, ...item.locations.map((value) => marketTokenSimilarity(name, value))) : 0;
    const score = 0.35 * clientScore + 0.65 * nameScore;
    return { item, clientScore, nameScore, score };
  }).filter((item) => item.clientScore >= 0.78 && item.nameScore >= 0.88).sort((a,b) => b.score - a.score);
  if (similar.length === 1 && similar[0].score >= 0.91) return { status: "matched", pointId: similar[0].item.pointId, message: "Клиент + название" };
  if (similar.length > 1 && similar[0].score >= 0.93 && similar[0].score - similar[1].score >= 0.07) return { status: "matched", pointId: similar[0].item.pointId, message: "Клиент + название" };
  return { status: "unmatched", pointId: "", message: address ? "Адрес не сопоставлен" : "Нет надёжного адреса/названия" };
}

function marketResolveStaticPlanRows() {
  const sources = Array.isArray(state.marketAnalysis?.staticPlanSources) ? state.marketAnalysis.staticPlanSources : [];
  const cacheKey = `${state.trtPoints.length}|${sources.map((source) => `${source._sourceUrl}:${source.rowCount || source.rows?.length || 0}`).join("|")}`;
  if (state.marketAnalysis.staticPlanRows && state.marketAnalysis.staticPlanCacheKey === cacheKey) return state.marketAnalysis.staticPlanRows;
  const pointIndex = marketBuildStaticPointIndex();
  const result = [];
  const stats = { sourceRows: 0, matchedRows: 0, unmatchedRows: 0, monthlyValues: 0, matchedMonthlyValues: 0, byDirection: {}, unmatched: [] };
  sources.forEach((source) => {
    const direction = marketDirectionKey(source._direction || source.direction);
    const periods = Array.isArray(source.periods) ? source.periods : [];
    if (!stats.byDirection[direction]) stats.byDirection[direction] = { sourceRows: 0, matchedRows: 0, unmatchedRows: 0, monthlyValues: 0, matchedMonthlyValues: 0 };
    (source.rows || []).forEach((row) => {
      stats.sourceRows += 1; stats.byDirection[direction].sourceRows += 1;
      const match = marketMatchStaticPlanRow(direction, row, pointIndex);
      const quantities = Array.isArray(row.q) ? row.q : [];
      const valueCount = quantities.filter((value) => value !== null && value !== undefined && value !== "").length;
      stats.monthlyValues += valueCount; stats.byDirection[direction].monthlyValues += valueCount;
      if (match.status !== "matched") {
        stats.unmatchedRows += 1; stats.byDirection[direction].unmatchedRows += 1;
        if (stats.unmatched.length < 50) stats.unmatched.push({ row: row.row, client: row.client, trt: row.trt, address: row.address, message: match.message });
        return;
      }
      stats.matchedRows += 1; stats.byDirection[direction].matchedRows += 1;
      periods.forEach((period, index) => {
        const raw = quantities[index];
        if (raw === null || raw === undefined || raw === "") return;
        const planQuantity = Math.max(0, Number(raw) || 0);
        result.push({
          year: Number(period.year), month: Number(period.month), direction, manager: row.manager || "", client: row.client || "",
          trtName: row.trt || "", sourceAddress: row.address || "", planQuantity, pointId: match.pointId,
          source: "static-site", sourceRow: row.row || 0, matchMessage: match.message,
        });
        stats.matchedMonthlyValues += 1; stats.byDirection[direction].matchedMonthlyValues += 1;
      });
    });
  });
  state.marketAnalysis.staticPlanRows = result;
  state.marketAnalysis.staticPlanStats = stats;
  state.marketAnalysis.staticPlanCacheKey = cacheKey;
  console.info("[VOG] static TRT plans", stats);
  return result;
}

function marketStaticPlanPeriodKeys() {
  const keys = new Set();
  (state.marketAnalysis?.staticPlanSources || []).forEach((source) => {
    const direction = marketDirectionKey(source._direction || source.direction);
    (source.periods || []).forEach((period) => {
      const year = Number(period.year); const month = Number(period.month);
      if (year && month) keys.add(`${year}-${month}-${direction}`);
    });
  });
  return keys;
}

function marketAllPlanRows() {
  const staticRows = marketResolveStaticPlanRows();
  const staticPeriods = marketStaticPlanPeriodKeys();
  const apiRows = (state.marketAnalysis?.plans || []).filter((row) => !staticPeriods.has(`${Number(row.year)}-${Number(row.month)}-${marketDirectionKey(row.direction)}`));
  return [...apiRows, ...staticRows];
}

async function loadRegionalMarketData(force = false) {
  if (state.marketAnalysis.loaded && !force) return state.marketAnalysis;
  const [payload, sourceResults] = await Promise.all([
    api("/trt-map-data?view=market_analysis"),
    Promise.all(STATIC_MARKET_PLAN_SOURCES.map((source) => marketFetchOptionalJson(source))),
  ]);
  state.marketAnalysis = {
    loaded: true,
    catalog: payload.catalog || { regions: [], targetShares: {} },
    plans: Array.isArray(payload.plans) ? payload.plans : [],
    diy: Array.isArray(payload.diy) ? payload.diy : [],
    staticPlanSources: sourceResults.filter(Boolean),
    staticPlanRows: null, staticPlanStats: null, staticPlanCacheKey: "",
  };
  return state.marketAnalysis;
}

function marketAvailablePeriods(direction = marketAnalysisDirection) {
  const key = marketDirectionKey(direction);
  const periods = new Map();
  [...marketAllPlanRows(), ...(state.marketAnalysis.diy || [])].forEach((row) => {
    if (marketDirectionKey(row.direction) !== key) return;
    const year = Number(row.year); const month = Number(row.month);
    if (!year || !month) return;
    periods.set(`${year}-${month}`, { year, month });
  });
  return [...periods.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

function syncMarketPeriodControls() {
  const periods = marketAvailablePeriods(marketAnalysisDirection);
  const years = [...new Set(periods.map((item) => item.year))];
  if (!years.length) years.push(2025, 2026);
  if (!years.includes(marketAnalysisYear)) marketAnalysisYear = years[years.length - 1];
  const yearHtml = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  [$("region-analysis-year"), $("region-directory-year")].filter(Boolean).forEach((select) => { select.innerHTML = yearHtml; select.value = String(marketAnalysisYear); });
  [$("region-analysis-direction"), $("region-directory-direction")].filter(Boolean).forEach((select) => { select.value = marketAnalysisDirection; });
  [$("region-analysis-month"), $("region-directory-month")].filter(Boolean).forEach((select) => { select.value = String(marketAnalysisMonth); });
}

function regionCityLookup(regionEntry) {
  const map = new Map();
  (regionEntry?.cities || []).forEach((city) => {
    map.set(normalizeText(city.name), city.name);
    (city.satellites || []).forEach((satellite) => map.set(normalizeText(satellite.name), city.name));
  });
  return map;
}

function regionBucketForPoint(point, regionEntry, lookup = regionCityLookup(regionEntry)) {
  const city = normalizeText(trtPointCity(point));
  return lookup.get(city) || "Прочие";
}

function buildAdjustedTrtFacts(direction = marketAnalysisDirection, year = marketAnalysisYear, month = marketAnalysisMonth) {
  const directionKey = marketDirectionKey(direction);
  const pointById = new Map(state.trtPoints.map((point) => [String(point.id), point]));
  const diyPointIds = new Set((state.marketAnalysis.diy || [])
    .filter((row) => Number(row.year) === Number(year) && Number(row.month) === Number(month) && marketDirectionKey(row.direction) === directionKey)
    .map((row) => String(row.pointId || "")).filter(Boolean));
  const isDiyPoint = (pointId) => {
    const id = String(pointId || "");
    const point = pointById.get(id);
    const format = normalizeText(point?.format).replace(/[^a-zа-я0-9]/g, "");
    return diyPointIds.has(id) || format.includes("diy");
  };
  const plans = marketAllPlanRows().filter((row) => Number(row.year) === Number(year) && Number(row.month) === Number(month) && marketDirectionKey(row.direction) === directionKey && !isDiyPoint(row.pointId));
  const clientGroups = new Map();
  plans.forEach((row) => {
    const clientKey = normalizeText(row.client) || `point:${row.pointId}`;
    if (!clientGroups.has(clientKey)) clientGroups.set(clientKey, []);
    clientGroups.get(clientKey).push(row);
  });
  const adjusted = [];
  clientGroups.forEach((rows, clientKey) => {
    const uniquePointIds = [...new Set(rows.map((row) => String(row.pointId || "")).filter(Boolean))];
    const planTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.planQuantity || 0)), 0);
    const factTotal = uniquePointIds.reduce((sum, pointId) => {
      if (diyPointIds.has(pointId)) return sum;
      const point = pointById.get(pointId);
      return sum + (point && marketPointMatchesDirection(point, direction) ? marketPointMonthFact(point, year, month) : 0);
    }, 0);
    rows.forEach((row) => {
      const point = pointById.get(String(row.pointId || ""));
      const plan = Math.max(0, Number(row.planQuantity || 0));
      const rawFact = diyPointIds.has(String(row.pointId || "")) ? 0 : marketPointMonthFact(point, year, month);
      const adjustedFact = planTotal > 0 ? factTotal * plan / planTotal : 0;
      adjusted.push({ ...row, point, clientKey, plan, rawFact, adjustedFact, clientPlanTotal: planTotal, clientFactTotal: factTotal, needsManualAllocation: planTotal <= 0 && factTotal > 0 });
    });
  });
  return adjusted;
}

function regionDiagnosis(model) {
  if (!model.planRows.length) {
    return { code: "no-plan", title: "Планы ТРТ пока не загружены", text: `Потенциал и DIY уже можно анализировать. Для полного вывода загрузите планы ТРТ по направлению «${marketDirectionLabel(model.direction)}».` };
  }
  if (model.totalVog >= model.targetSales && model.targetSales > 0) {
    return { code: "good", title: "Целевая доля достигнута", text: `Факт ВОГ составляет ${marketPercent(model.totalShare)} при цели ${marketPercent(model.targetShare * 100, 0)}. Можно переходить к удержанию результата и точечному развитию.` };
  }
  const plannedTotal = model.diyVog + model.trtPlan;
  const execution = model.trtPlan > 0 ? model.trtFact / model.trtPlan : 0;
  if (plannedTotal < model.targetSales && execution >= 0.95) {
    return { code: "coverage", title: "Не хватает покрытия ТРТ", text: "Существующие ТРТ в целом выполняют план, но даже полного выполнения текущих планов недостаточно для целевой доли. Нужны новые ТРТ или увеличение потенциала текущих." };
  }
  if (plannedTotal < model.targetSales) {
    return { code: "plan", title: "План ниже требуемой доли рынка", text: "Сумма факта DIY и планов ТРТ не дотягивает до целевой доли. Сначала нужно увеличить плановое покрытие: развить текущие ТРТ и/или найти новые." };
  }
  return { code: "execution", title: "План достаточен, но факт не выполнен", text: "Плановая модель позволяет достичь цели, однако текущий факт ниже. Нужно разложить недобор по клиентам и ТРТ и работать с выполнением плана." };
}

function buildRegionAnalysisModel(regionKey, direction = marketAnalysisDirection, year = marketAnalysisYear, month = marketAnalysisMonth) {
  const region = marketRegionEntry(regionKey);
  if (!region) return null;
  const directionKey = marketDirectionKey(direction);
  const pointById = new Map(state.trtPoints.map((point) => [String(point.id), point]));
  const lookup = regionCityLookup(region);
  const population = Number(region.population || 0);
  const potential = marketPotential(population, directionKey);
  const targetShare = marketTargetShare(directionKey);
  const targetSales = potential * targetShare;

  const diyRows = (state.marketAnalysis.diy || []).filter((row) => {
    if (Number(row.year) !== Number(year) || Number(row.month) !== Number(month) || marketDirectionKey(row.direction) !== directionKey) return false;
    const point = pointById.get(String(row.pointId || ""));
    return point && normalizeRegionName(trtCanonicalRegionName(point)) === normalizeRegionName(region.key);
  }).map((row) => ({ ...row, point: pointById.get(String(row.pointId || "")) }));

  const allAdjusted = buildAdjustedTrtFacts(directionKey, year, month);
  const planRows = allAdjusted.filter((row) => row.point && normalizeRegionName(trtCanonicalRegionName(row.point)) === normalizeRegionName(region.key));

  const diyTotal = diyRows.reduce((sum, row) => sum + Math.max(0, Number(row.totalQuantity || 0)), 0);
  const diyVog = diyRows.reduce((sum, row) => sum + Math.max(0, Number(row.vogQuantity || 0)), 0);
  const trtPlan = planRows.reduce((sum, row) => sum + row.plan, 0);
  const trtFact = planRows.reduce((sum, row) => sum + row.adjustedFact, 0);
  const totalVog = diyVog + trtFact;
  const totalShare = potential > 0 ? totalVog / potential * 100 : 0;
  const deficit = Math.max(0, targetSales - totalVog);
  const requiredTrt = Math.max(0, targetSales - diyVog);

  const cityMap = new Map();
  (region.cities || []).forEach((city) => cityMap.set(city.name, {
    name: city.name, type: city.type || "city", population: Number(city.marketPopulation || city.population || 0), corePopulation: Number(city.population || 0), satellites: city.satellites || [], diyRows: [], planRows: [],
  }));
  cityMap.set("Прочие", { name: "Прочие", type: "other", population: Number(region.otherPopulation || 0), corePopulation: Number(region.otherPopulation || 0), satellites: [], diyRows: [], planRows: [] });
  diyRows.forEach((row) => { const bucket = regionBucketForPoint(row.point, region, lookup); (cityMap.get(bucket) || cityMap.get("Прочие")).diyRows.push(row); });
  planRows.forEach((row) => { const bucket = regionBucketForPoint(row.point, region, lookup); (cityMap.get(bucket) || cityMap.get("Прочие")).planRows.push(row); });

  const cities = [...cityMap.values()].map((city) => {
    const cityPotential = marketPotential(city.population, directionKey);
    const cityTarget = cityPotential * targetShare;
    const cityDiyTotal = city.diyRows.reduce((sum, row) => sum + Number(row.totalQuantity || 0), 0);
    const cityDiyVog = city.diyRows.reduce((sum, row) => sum + Number(row.vogQuantity || 0), 0);
    const cityPlan = city.planRows.reduce((sum, row) => sum + row.plan, 0);
    const cityFact = city.planRows.reduce((sum, row) => sum + row.adjustedFact, 0);
    const cityTotal = cityDiyVog + cityFact;
    return {
      ...city, potential: cityPotential, target: cityTarget, diyTotal: cityDiyTotal, diyVog: cityDiyVog,
      trtPlan: cityPlan, trtFact: cityFact, totalVog: cityTotal,
      share: cityPotential > 0 ? cityTotal / cityPotential * 100 : 0,
      deficit: Math.max(0, cityTarget - cityTotal),
    };
  }).filter((city) => city.population > 0).sort((a, b) => b.population - a.population);

  const model = {
    region, direction: directionKey, year: Number(year), month: Number(month), population, potential, targetShare, targetSales,
    diyRows, diyTotal, diyVog, diyMarketShare: potential > 0 ? diyTotal / potential * 100 : 0,
    diyVogShareInside: diyTotal > 0 ? diyVog / diyTotal * 100 : 0,
    diyVogShareRegion: potential > 0 ? diyVog / potential * 100 : 0,
    planRows, trtPlan, trtFact, trtCompletion: trtPlan > 0 ? trtFact / trtPlan * 100 : 0,
    requiredTrt, totalVog, totalShare, deficit, cities,
    networkCount: new Set(diyRows.map((row) => normalizeText(row.network)).filter(Boolean)).size,
    manualAllocationCount: planRows.filter((row) => row.needsManualAllocation).length,
  };
  model.diagnosis = regionDiagnosis(model);
  return model;
}

function renderRegionDetailRows(city, direction) {
  const trtRows = city.planRows.map((row) => {
    const point = row.point || {};
    const completion = row.plan > 0 ? row.adjustedFact / row.plan * 100 : 0;
    const cls = completion >= 100 ? "is-good" : completion >= 85 ? "is-mid" : "is-low";
    return `<tr><td><strong>${escapeHtml(trtDisplayName(point))}</strong><small>${escapeHtml(row.client || point.holding || "—")} · ${escapeHtml(point.address || row.sourceAddress || "—")}</small></td><td>${marketQuantity(row.plan, direction)}</td><td>${marketQuantity(row.rawFact, direction)}</td><td>${marketQuantity(row.adjustedFact, direction)}</td><td><span class="region-plan-pill ${cls}">${marketPercent(completion,0)}</span></td></tr>`;
  }).join("");
  const diyRows = city.diyRows.map((row) => `<tr><td><strong>${escapeHtml(row.network || "DIY")}</strong><small>${escapeHtml(row.address || row.point?.address || "—")}</small></td><td>${marketQuantity(row.totalQuantity, direction)}</td><td>${marketQuantity(row.vogQuantity, direction)}</td><td>${marketPercent(Number(row.totalQuantity) > 0 ? Number(row.vogQuantity) / Number(row.totalQuantity) * 100 : 0)}</td></tr>`).join("");
  return `<div class="region-detail-grid">
    <section><h4>ТРТ · план и распределённый факт</h4><div class="region-trt-subtable-wrap"><table class="region-trt-subtable"><thead><tr><th>ТРТ / клиент</th><th>План</th><th>Исходный факт</th><th>Распределённый факт</th><th>Выполнение</th></tr></thead><tbody>${trtRows || '<tr><td colspan="5">Планов ТРТ нет.</td></tr>'}</tbody></table></div></section>
    <section><h4>DIY · sell-out</h4><div class="region-trt-subtable-wrap"><table class="region-trt-subtable"><thead><tr><th>Сеть / магазин</th><th>Общие продажи</th><th>ВОГ</th><th>Доля ВОГ</th></tr></thead><tbody>${diyRows || '<tr><td colspan="4">DIY sell-out нет.</td></tr>'}</tbody></table></div></section>
  </div>`;
}

function renderRegionAnalysisModel(model) {
  trtInspectorRegion = { config: { key: model.region.key }, label: model.region.key, model };
  $("region-inspector-name").textContent = model.region.key;
  $("region-inspector-population").textContent = `${marketNumber(model.population)} чел.`;
  $("region-kpi-potential").textContent = marketQuantity(model.potential, model.direction);
  $("region-kpi-potential-unit").textContent = model.direction === "обои" ? "0,8 рул./чел./год ÷ 1,92 ÷ 12" : "1 м²/чел./год ÷ 12";
  $("region-kpi-target").textContent = marketQuantity(model.targetSales, model.direction);
  $("region-kpi-target-share").textContent = `целевая доля ${marketPercent(model.targetShare * 100,0)}`;
  $("region-kpi-fact").textContent = marketQuantity(model.totalVog, model.direction);
  $("region-kpi-share").textContent = marketPercent(model.totalShare);
  $("region-kpi-share-gap").textContent = `цель ${marketPercent(model.targetShare * 100,0)}`;
  $("region-kpi-deficit").textContent = marketQuantity(model.deficit, model.direction);
  $("region-kpi-deficit-note").textContent = model.deficit > 0 ? "нужно добрать продажами" : "цель закрыта";

  const donut = $("region-market-donut"); if (donut) donut.style.setProperty("--share", `${Math.max(0, Math.min(100, model.diyMarketShare))}%`);
  $("region-market-diy-share").textContent = marketPercent(model.diyMarketShare);
  $("region-market-diy-total").textContent = marketQuantity(model.diyTotal, model.direction);
  $("region-market-other-total").textContent = marketQuantity(Math.max(0, model.potential - model.diyTotal), model.direction);
  $("region-diy-network-count").textContent = `${model.networkCount} сет.`;
  $("region-diy-market").textContent = marketQuantity(model.diyTotal, model.direction);
  $("region-diy-vog").textContent = marketQuantity(model.diyVog, model.direction);
  $("region-diy-share-inside").textContent = marketPercent(model.diyVogShareInside);
  $("region-diy-share-region").textContent = marketPercent(model.diyVogShareRegion);
  $("region-trt-count").textContent = `${model.planRows.length} ТРТ`;
  $("region-trt-required").textContent = marketQuantity(model.requiredTrt, model.direction);
  $("region-trt-plan").textContent = marketQuantity(model.trtPlan, model.direction);
  $("region-trt-fact").textContent = marketQuantity(model.trtFact, model.direction);
  $("region-trt-completion").textContent = model.trtPlan > 0 ? marketPercent(model.trtCompletion) : "—";

  const diagnosis = $("region-diagnosis"); diagnosis.className = `region-diagnosis is-${model.diagnosis.code}`;
  $("region-diagnosis-title").textContent = model.diagnosis.title;
  $("region-diagnosis-text").textContent = model.diagnosis.text;
  const notes = [`Период: ${analysisPeriodLabel(model.year, model.month)} · ${marketDirectionLabel(model.direction)}.`, `Население региона — справочная тестовая база; города ≥75 тыс., малые города в радиусе 45 км агрегируются к ближайшему крупному центру.`];
  const staticStats = state.marketAnalysis?.staticPlanStats?.byDirection?.[marketDirectionKey(model.direction)];
  if (staticStats?.sourceRows) notes.push(`Планы ТРТ: статический файл сайта, сопоставлено ${staticStats.matchedRows} из ${staticStats.sourceRows} ТРТ.`);
  if (!model.diyRows.length) notes.push("DIY sell-out за выбранный период пока не загружен.");
  if (!model.planRows.length) notes.push(`Планы ТРТ по направлению «${marketDirectionLabel(model.direction)}» за этот период пока не загружены.`);
  if (model.manualAllocationCount) notes.push(`Есть ${model.manualAllocationCount} ТРТ с фактом при нулевом плане — требуется ручное распределение.`);
  $("region-data-note").textContent = notes.join(" ");

  $("region-inspector-city-body").innerHTML = model.cities.map((city, index) => {
    const detailId = `region-city-detail-${index}`;
    const subtitle = city.type === "agglomeration" && city.satellites.length ? `Агломерация: + ${city.satellites.map((item) => item.name).join(", ")}` : city.type === "other" ? "Малые и удалённые населённые пункты" : `${city.planRows.length} ТРТ · ${city.diyRows.length} DIY`;
    return `<tr class="region-city-row"><td><button class="region-city-expand" type="button" data-region-city-toggle="${detailId}" aria-expanded="false">+</button><strong>${escapeHtml(city.name)}</strong><small>${escapeHtml(subtitle)}</small></td><td>${marketNumber(city.population)}</td><td>${marketQuantity(city.potential, model.direction)}</td><td>${marketQuantity(city.target, model.direction)}</td><td>${marketQuantity(city.diyVog, model.direction)}</td><td>${marketQuantity(city.trtPlan, model.direction)}</td><td>${marketQuantity(city.trtFact, model.direction)}</td><td><strong>${marketPercent(city.share)}</strong></td><td class="${city.deficit > 0 ? 'region-deficit-cell' : 'region-ok-cell'}">${marketQuantity(city.deficit, model.direction)}</td></tr><tr id="${detailId}" class="region-city-detail" hidden><td colspan="9">${renderRegionDetailRows(city, model.direction)}</td></tr>`;
  }).join("");
}

async function renderRegionInspector(config, label) {
  const regionKey = config?.key || label;
  trtInspectorRegion = { config: { ...(config || {}), key: regionKey }, label: regionKey, model: null };
  setMapInspectorView("region");
  $("region-inspector-name").textContent = regionKey;
  $("region-analysis-error").hidden = true;
  $("region-analysis-loading").hidden = false;
  $("region-analysis-content").hidden = true;
  try {
    await Promise.all([ensureTrtData(), loadRegionalMarketData(false)]);
    const periods = marketAvailablePeriods(marketAnalysisDirection);
    if (periods.length && !periods.some((item) => item.year === marketAnalysisYear && item.month === marketAnalysisMonth)) {
      const latest = periods[periods.length - 1]; marketAnalysisYear = latest.year; marketAnalysisMonth = latest.month;
    }
    syncMarketPeriodControls();
    const model = buildRegionAnalysisModel(regionKey);
    if (!model) throw new Error(`Регион «${regionKey}» отсутствует в справочнике населения.`);
    renderRegionAnalysisModel(model);
    $("region-analysis-content").hidden = false;
  } catch (error) {
    $("region-analysis-error").textContent = error.message;
    $("region-analysis-error").hidden = false;
  } finally {
    $("region-analysis-loading").hidden = true;
  }
}

function openRegionInspector(feature) {
  const config = trtRegionConfig(feature);
  if (!config) return;
  state.trtSelectedId = "";
  // Масштаб и центр карты не меняем: карточка — оверлей, закрытие возвращает ровно к исходному виду.
  renderRegionInspector(config, config.key);
}

function openRegionInspectorByKey(regionKey) {
  state.trtSelectedId = "";
  renderRegionInspector({ key: regionKey }, regionKey);
}


function regionDirectoryCard(model) {
  const diagnosis = model.diagnosis || regionDiagnosis(model);
  return `<button class="region-directory-item is-${escapeHtml(diagnosis.code)}" type="button" data-region-open="${escapeHtml(model.region.key)}">
    <span class="region-directory-name">${escapeHtml(model.region.key)}</span>
    <span class="region-directory-meta">${marketNumber(model.population)} чел. · потенциал ${marketQuantity(model.potential, model.direction)}</span>
    <span class="region-directory-metrics"><b>${marketPercent(model.totalShare)}</b><small>доля ВОГ</small><b>${marketQuantity(model.deficit, model.direction)}</b><small>дефицит</small></span>
    <span class="region-directory-status">${escapeHtml(diagnosis.title)}</span>
  </button>`;
}

function renderRegionAnalyticsDirectory() {
  const host = $("region-directory-list");
  if (!host) return;
  const query = normalizeText($("region-directory-search")?.value || "");
  const models = marketCatalogRegions().map((region) => buildRegionAnalysisModel(region.key)).filter(Boolean)
    .filter((model) => !query || normalizeText(model.region.key).includes(query));
  host.innerHTML = models.map(regionDirectoryCard).join("");
  if (!models.length) host.innerHTML = '<div class="empty-state">Регионы не найдены.</div>';
}

async function loadRegionAnalyticsDirectory(force = false) {
  const loading = $("region-directory-loading");
  const error = $("region-directory-error");
  if (!loading || !error) return;
  loading.hidden = false; error.hidden = true;
  try {
    await Promise.all([ensureTrtData(), loadRegionalMarketData(force)]);
    const periods = marketAvailablePeriods(marketAnalysisDirection);
    if (periods.length && !periods.some((item) => item.year === marketAnalysisYear && item.month === marketAnalysisMonth)) {
      const latest = periods[periods.length - 1]; marketAnalysisYear = latest.year; marketAnalysisMonth = latest.month;
    }
    syncMarketPeriodControls();
    renderRegionAnalyticsDirectory();
  } catch (err) {
    error.textContent = err.message; error.hidden = false;
  } finally { loading.hidden = true; }
}

function refreshOpenRegionAnalysis() {
  syncMarketPeriodControls();
  if (trtInspectorMode === "region" && trtInspectorRegion?.config?.key) {
    const model = buildRegionAnalysisModel(trtInspectorRegion.config.key);
    if (model) renderRegionAnalysisModel(model);
  }
  if (state.currentPage === "region-analytics") renderRegionAnalyticsDirectory();
}

function bindTrtRegion(feature, layer) {
  const config = trtRegionConfig(feature);
  if (!config) return;

  const label = config.label || trtRegionFeatureName(feature) || config.key;
  layer.bindTooltip(`${label} · ${config.district}`);
  layer.on({
    mouseover(event) {
      event.target.setStyle({ weight: 3, fillOpacity: 0.52 });
      event.target.bringToFront();
    },
    mouseout(event) {
      trtRegionLayer?.resetStyle(event.target);
    },
    click() {
      openRegionInspector(feature, layer);
    },
  });
}

async function loadTrtRegions() {
  if (trtRegionLayer || trtRegionsLoading || !trtMap) return;
  trtRegionsLoading = true;
  $("trt-region-load-status").textContent = "Загрузка точных границ регионов…";

  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/russia.geojson"
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const geojson = await response.json();
    trtRegionLayer = L.geoJSON(geojson, {
      filter: (feature) => trtRegionKey(feature) !== null,
      style: trtRegionStyle,
      onEachFeature: bindTrtRegion,
    });
    $("trt-region-load-status").textContent = "Точные границы регионов загружены";
    updateTrtMapMode();
  } catch (error) {
    console.error(error);
    $("trt-region-load-status").textContent = "Не удалось загрузить точные границы";
  } finally {
    trtRegionsLoading = false;
  }
}

function updateTrtMapMode() {
  if (!trtMap || !trtMarkerLayer) return;
  const mode = $("trt-map-mode").value;

  if (trtMap.hasLayer(trtMarkerLayer)) trtMap.removeLayer(trtMarkerLayer);
  if (trtRegionLayer && trtMap.hasLayer(trtRegionLayer)) trtMap.removeLayer(trtRegionLayer);

  if ((mode === "regions" || mode === "both") && trtRegionLayer) trtRegionLayer.addTo(trtMap);
  if (mode === "points" || mode === "both") trtMarkerLayer.addTo(trtMap);
}

function renderTrtMap() {
  if (!state.trtLoaded || !trtMap || !trtMarkerLayer) return;
  const visible = filteredTrtPoints().filter((point) => (
    Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))
  ));

  trtMarkerLayer.clearLayers();
  const coordinates = [];

  visible.forEach((point) => {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    coordinates.push([lat, lon]);
    const marker = L.marker([lat, lon], {
      icon: trtMarkerIcon(point),
      sizeValue: point.size,
      originKey: trtOriginKey(point),
      title: point.client || point.holding || "ТРТ",
    });
    marker.bindTooltip(point.client || point.holding || "ТРТ");
    marker.on("click", () => openTrtCard(point.id, false));
    trtMarkerLayer.addLayer(marker);
  });

  updateTrtMapMode();
  refreshTrtCityLabels();
  $("trt-visible-count").textContent = `Показано ТРТ: ${visible.length}`;
  $("trt-data-status").textContent = `Всего в базе: ${state.trtPoints.length}`;
  const searchCount = $("trt-search-result-count");
  if (searchCount) searchCount.textContent = `${visible.length} ТРТ`;

  if (state.trtFitRequested && hasActiveTrtFilters() && visible.length) {
    trtMap.flyToBounds(L.latLngBounds(coordinates).pad(0.08), { maxZoom: 13, duration: 0.48 });
    state.trtFitRequested = false;
  } else if (state.trtFitRequested && !hasActiveTrtFilters()) {
    state.trtFitRequested = false;
  }

  window.setTimeout(() => trtMap.invalidateSize(), 30);
}

async function loadTrtMap() {
  if (state.trtLoaded) {
    if (!state.visitsLoaded) {
      try {
        await ensureVisitsData(false);
      } catch (visitError) {
        console.warn("Не удалось загрузить оценки 4P для карточек ТРТ", visitError);
      }
    }
    initTrtMap();
    renderTrtMap();
    loadTrtRegions();
    if (state.trtSelectedId) {
      const selected = selectedTrtPoint();
      if (selected) renderTrtFourP(selected);
    }
    return;
  }

  $("trt-data-status").textContent = "Загрузка карты…";
  $("trt-map-error").hidden = true;

  try {
    await ensureTrtData();
    try {
      await ensureVisitsData(false);
    } catch (visitError) {
      console.warn("Не удалось загрузить оценки 4P для карточек ТРТ", visitError);
    }
    initTrtMap();
    if (!trtMap) throw new Error("Библиотека карты не загрузилась. Обновите страницу и проверьте интернет.");
    renderTrtMap();
    loadTrtRegions();
  } catch (error) {
    $("trt-data-status").textContent = "Карта недоступна";
    $("trt-map-error").textContent = error.message;
    $("trt-map-error").hidden = false;
  }
}

function setTrtMainView(view) {
  trtMainView = view === "analytics" ? "analytics" : "map";
  const mapView = trtMainView === "map";
  const trtAddPointControl = $("trt-add-point-control");
  if (trtAddPointControl) trtAddPointControl.hidden = !mapView || !isSystemAdmin();

  $("view-map-button").classList.toggle("active", mapView);
  $("view-analytics-button").classList.toggle("active", !mapView);
  syncSidebarNavigation("trt");

  document.querySelectorAll(".legacy-map-only").forEach((element) => {
    element.hidden = !mapView;
  });
  $("trt-analytics-sidebar").hidden = mapView;
  $("trt-map").hidden = !mapView;
  $("trt-analytics-view").hidden = mapView;
  $("trt-analytics-view").setAttribute("aria-hidden", mapView ? "true" : "false");
  if ($("trt-smart-search-control")) $("trt-smart-search-control").hidden = !mapView;
  const displayControl = document.querySelector(".trt-display-control");
  if (displayControl) displayControl.hidden = !mapView;
  if (!mapView) {
    closeTrtSmartSuggestions();
    setTrtDisplayPanel(false);
    if (trtInspectorMode) closeMapInspector();
  }

  closeAnalyticsFormatMenu();

  if (mapView) {
    window.setTimeout(() => {
      trtMap?.invalidateSize();
      renderTrtMap();
    }, 40);
  } else {
    populateAnalyticsFilters(true);
    setTrtAnalyticsTab(trtAnalyticsTab);
  }
}

function analyticsAvailableYears() {
  const years = new Set();
  state.trtPoints.forEach((point) => {
    Object.keys(point.sales || {}).forEach((year) => {
      if (/^\d{4}$/.test(year)) years.add(Number(year));
    });
  });
  return [...years].sort((a, b) => a - b);
}

function analyticsCurrentYear() {
  const years = analyticsAvailableYears();
  return years.length ? years[years.length - 1] : new Date().getFullYear();
}

function analyticsLastCompleteMonthIndex() {
  const year = analyticsCurrentYear();
  let last = -1;
  state.trtPoints.forEach((point) => {
    const values = point.sales?.[String(year)];
    if (!Array.isArray(values)) return;
    values.forEach((value, index) => {
      if (value !== null && value !== undefined && value !== "") last = Math.max(last, index);
    });
  });
  return last >= 0 ? last : 11;
}

function analyticsMonthLabels() {
  return ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
}

function selectedAnalyticsFormats() {
  return [...trtAnalyticsSelectedFormats];
}

function analyticsFormatLabel() {
  const total = document.querySelectorAll(".legacy-multiselect-option").length;
  const selected = selectedAnalyticsFormats();
  if (!total) return "Нет доступных форматов";
  if (!selected.length) return "Форматы не выбраны";
  if (selected.length === total) return `Все форматы (${total})`;
  if (selected.length <= 2) return selected.join(", ");
  return `Выбрано форматов: ${selected.length}`;
}

function updateAnalyticsFormatControl() {
  const control = $("analytics-format-control");
  control.textContent = analyticsFormatLabel();
  document.querySelectorAll(".legacy-multiselect-option").forEach((option) => {
    const selected = trtAnalyticsSelectedFormats.has(option.dataset.value);
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function closeAnalyticsFormatMenu() {
  $("analytics-format-menu")?.classList.remove("open");
}

function toggleAnalyticsFormatMenu() {
  const control = $("analytics-format-control");
  if (!control || control.disabled) return;
  $("analytics-format-menu").classList.toggle("open");
}

function handleAnalyticsFormatClick(index, event) {
  const options = [...document.querySelectorAll(".legacy-multiselect-option")];
  const value = options[index]?.dataset.value;
  if (!value) return;

  if (event.shiftKey && trtAnalyticsFormatAnchorIndex !== null) {
    const start = Math.min(trtAnalyticsFormatAnchorIndex, index);
    const end = Math.max(trtAnalyticsFormatAnchorIndex, index);
    trtAnalyticsSelectedFormats.clear();
    for (let cursor = start; cursor <= end; cursor += 1) {
      trtAnalyticsSelectedFormats.add(options[cursor].dataset.value);
    }
  } else if (event.metaKey || event.ctrlKey) {
    if (trtAnalyticsSelectedFormats.has(value)) trtAnalyticsSelectedFormats.delete(value);
    else trtAnalyticsSelectedFormats.add(value);
    trtAnalyticsFormatAnchorIndex = index;
  } else {
    trtAnalyticsSelectedFormats.clear();
    trtAnalyticsSelectedFormats.add(value);
    trtAnalyticsFormatAnchorIndex = index;
  }

  updateAnalyticsFormatControl();
  renderActiveAnalyticsTab();
}

function populateAnalyticsFilters(preserveSelection = false) {
  const directionSelect = $("analytics-direction");
  if (!directionSelect) return;

  const previousDirection = directionSelect.value;
  const previousFormats = preserveSelection
    ? new Set(trtAnalyticsSelectedFormats)
    : new Set();
  const previousCategory = preserveSelection ? $("analytics-category").value : "__all__";
  const previousYear = $("analytics-structure-year").value;

  const directions = [...new Set(
    state.trtPoints.map((point) => String(point.direction || "").trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ru"));

  directionSelect.innerHTML = `<option value="">Выберите направление</option>${directions.map((direction) => (
    `<option value="${escapeHtml(direction)}">${escapeHtml(direction)}</option>`
  )).join("")}`;
  if (directions.includes(previousDirection)) directionSelect.value = previousDirection;

  const direction = directionSelect.value;
  const directionPoints = direction
    ? state.trtPoints.filter((point) => point.direction === direction)
    : [];

  const formats = [...new Set(
    directionPoints.map((point) => String(point.format || "").trim() || "Без формата")
  )].sort((a, b) => a.localeCompare(b, "ru"));

  trtAnalyticsSelectedFormats = new Set();
  formats.forEach((format) => {
    if (!preserveSelection || !previousFormats.size || previousFormats.has(format)) {
      trtAnalyticsSelectedFormats.add(format);
    }
  });
  if (!trtAnalyticsSelectedFormats.size && formats.length) {
    formats.forEach((format) => trtAnalyticsSelectedFormats.add(format));
  }

  trtAnalyticsFormatAnchorIndex = null;
  $("analytics-format-options").innerHTML = formats.map((format, index) => (
    `<button class="legacy-multiselect-option" type="button" role="option" data-index="${index}" data-value="${escapeHtml(format)}">${escapeHtml(format)}</button>`
  )).join("");

  document.querySelectorAll(".legacy-multiselect-option").forEach((option) => {
    option.addEventListener("click", (event) => {
      handleAnalyticsFormatClick(Number(option.dataset.index), event);
    });
  });

  const categories = [...new Set(
    directionPoints.map((point) => String(point.abcCategory || "").trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ru"));

  $("analytics-category").innerHTML = [
    `<option value="__all__">Все категории</option>`,
    `<option value="__none__">Без категории</option>`,
    ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`),
  ].join("");
  if (previousCategory === "__all__" || previousCategory === "__none__" || categories.includes(previousCategory)) {
    $("analytics-category").value = previousCategory;
  }

  const years = analyticsAvailableYears().sort((a, b) => b - a);
  $("analytics-structure-year").innerHTML = years.map((year) => (
    `<option value="${year}">${year}</option>`
  )).join("");
  if (years.map(String).includes(previousYear)) $("analytics-structure-year").value = previousYear;

  const disabled = !direction;
  $("analytics-format-control").disabled = disabled;
  $("analytics-category").disabled = disabled;
  $("analytics-structure-year").disabled = disabled;
  if (disabled) closeAnalyticsFormatMenu();

  if (!$("analytics-period-end").dataset.initialized) {
    $("analytics-period-start").value = "0";
    $("analytics-period-end").value = String(analyticsLastCompleteMonthIndex());
    $("analytics-period-end").dataset.initialized = "1";
  }

  updateAnalyticsFormatControl();
}

function analyticsPeriod() {
  let start = Number($("analytics-period-start").value);
  let end = Number($("analytics-period-end").value);
  if (!Number.isInteger(start)) start = 0;
  if (!Number.isInteger(end)) end = analyticsLastCompleteMonthIndex();
  if (start > end) [start, end] = [end, start];
  $("analytics-period-start").value = String(start);
  $("analytics-period-end").value = String(end);
  return { start, end };
}

function selectedAnalyticsPoints() {
  const direction = $("analytics-direction").value;
  const category = $("analytics-category").value;
  const formats = selectedAnalyticsFormats();
  if (!direction || !formats.length) return [];

  return state.trtPoints.filter((point) => {
    if (point.direction !== direction) return false;
    const format = String(point.format || "").trim() || "Без формата";
    if (!formats.includes(format)) return false;
    if (category === "__none__" && point.abcCategory) return false;
    if (category !== "__all__" && category !== "__none__" && point.abcCategory !== category) return false;
    return true;
  });
}

function aggregateSalesForYear(points, year) {
  const sums = Array(12).fill(0);
  const present = Array(12).fill(false);
  points.forEach((point) => {
    const values = point.sales?.[String(year)];
    if (!Array.isArray(values)) return;
    values.slice(0, 12).forEach((value, index) => {
      if (value === null || value === undefined || value === "") return;
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      sums[index] += number;
      present[index] = true;
    });
  });
  return sums.map((value, index) => (present[index] ? value : null));
}

function analyticsPeriodLabel(year, start, end) {
  const names = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];
  return `${start === end ? names[start] : `${names[start]}–${names[end]}`} ${year}`;
}

function destroyAnalyticsCharts() {
  if (trtAnalyticsChart) {
    trtAnalyticsChart.destroy();
    trtAnalyticsChart = null;
  }
  if (trtStructureChart) {
    trtStructureChart.destroy();
    trtStructureChart = null;
  }
}

function renderAnalyticsDynamics() {
  const content = $("analytics-report-content");
  const direction = $("analytics-direction").value;
  if (!direction) {
    destroyAnalyticsCharts();
    $("analytics-filter-status").textContent = "Выберите направление для построения отчёта.";
    content.innerHTML = `<div class="legacy-analytics-empty">Выберите направление, чтобы построить динамику продаж.</div>`;
    return;
  }

  const points = selectedAnalyticsPoints();
  const salesPoints = points.filter((point) => point.sales);
  const period = analyticsPeriod();
  $("analytics-filter-status").textContent =
    `ТРТ: ${points.length} · с продажами: ${salesPoints.length} · форматов: ${selectedAnalyticsFormats().length}`;

  if (!salesPoints.length) {
    destroyAnalyticsCharts();
    content.innerHTML = `<div class="legacy-analytics-empty">По выбранным фильтрам нет ТРТ с продажами.</div>`;
    return;
  }

  const currentYear = analyticsCurrentYear();
  const previousYear = currentYear - 1;
  const currentAll = aggregateSalesForYear(salesPoints, currentYear);
  const previousAll = aggregateSalesForYear(salesPoints, previousYear);
  const currentValues = currentAll.map((value, index) => (
    index >= period.start && index <= period.end ? value : null
  ));
  const previousValues = previousAll.map((value, index) => (
    index >= period.start && index <= period.end ? value : null
  ));
  const unit = trtUnit(salesPoints[0]);

  content.innerHTML = `
    <div class="legacy-main-chart-card">
      <div class="legacy-main-chart-header">
        <div>
          <h3>Динамика общих продаж</h3>
          <p>${escapeHtml(direction)} · ${escapeHtml(analyticsPeriodLabel(currentYear, period.start, period.end))} к ${escapeHtml(analyticsPeriodLabel(previousYear, period.start, period.end))}</p>
        </div>
        <div class="legacy-chart-meta">Единица: ${escapeHtml(unit)}</div>
      </div>
      <div class="legacy-main-chart-wrap"><canvas id="analytics-sales-chart"></canvas></div>
    </div>`;

  if (trtAnalyticsChart) trtAnalyticsChart.destroy();
  trtAnalyticsChart = new Chart($("analytics-sales-chart"), {
    type: "bar",
    data: {
      labels: analyticsMonthLabels(),
      datasets: [
        {
          label: String(previousYear),
          data: previousValues,
          backgroundColor: "#b9dcff",
          borderColor: "#7bb6ef",
          borderWidth: 1,
          borderRadius: 5,
        },
        {
          label: String(currentYear),
          data: currentValues,
          backgroundColor: "#1677ff",
          borderColor: "#0b5ed7",
          borderWidth: 1,
          borderRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180, easing: "linear" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${Math.round(context.parsed.y).toLocaleString("ru-RU")} ${unit}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback(value) {
              return Math.round(value).toLocaleString("ru-RU");
            },
          },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function structureGroups(points, groupBy, year, start, end) {
  const groups = {};
  points.forEach((point) => {
    const values = point.sales?.[String(year)];
    if (!Array.isArray(values)) return;
    let total = 0;
    for (let index = start; index <= end; index += 1) total += numberOrZero(values[index]);
    if (total <= 0) return;
    const key = groupBy === "category"
      ? (String(point.abcCategory || "").trim() || "Без категории")
      : (String(point.format || "").trim() || "Без формата");
    groups[key] = (groups[key] || 0) + total;
  });
  return Object.entries(groups)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function analyticsPalette(count) {
  const colors = [
    "#1677ff", "#12b76a", "#f79009", "#7a5af8", "#ee46bc", "#06aed4",
    "#f04438", "#6172f3", "#36bffa", "#84adff", "#fdb022", "#32d583",
  ];
  return Array.from({ length: count }, (_, index) => colors[index % colors.length]);
}

function renderAnalyticsStructure() {
  const content = $("analytics-structure-content");
  const direction = $("analytics-direction").value;
  if (!direction) {
    destroyAnalyticsCharts();
    content.innerHTML = `<div class="legacy-analytics-empty">Выберите направление, чтобы построить структуру продаж.</div>`;
    return;
  }

  const points = selectedAnalyticsPoints();
  const salesPoints = points.filter((point) => point.sales);
  const period = analyticsPeriod();
  const year = Number($("analytics-structure-year").value) || analyticsCurrentYear();
  const groupBy = $("analytics-structure-group").value;
  const groups = structureGroups(salesPoints, groupBy, year, period.start, period.end);
  const unit = salesPoints.length ? trtUnit(salesPoints[0]) : "ед.";
  const total = groups.reduce((sum, item) => sum + item.value, 0);

  $("analytics-filter-status").textContent =
    `ТРТ: ${points.length} · с продажами: ${salesPoints.length} · форматов: ${selectedAnalyticsFormats().length}`;

  if (!groups.length) {
    destroyAnalyticsCharts();
    content.innerHTML = `<div class="legacy-analytics-empty">В выбранном периоде продажи отсутствуют.</div>`;
    return;
  }

  const groupTitle = groupBy === "category" ? "категории ABC" : "формату ТРТ";
  content.innerHTML = `
    <div class="legacy-main-chart-card">
      <div class="legacy-main-chart-header">
        <div>
          <h3>Структура продаж по ${groupTitle}</h3>
          <p>${escapeHtml(direction)} · ${escapeHtml(analyticsPeriodLabel(year, period.start, period.end))}</p>
        </div>
        <div class="legacy-chart-meta">${Math.round(total).toLocaleString("ru-RU")} ${escapeHtml(unit)}</div>
      </div>
      <div class="legacy-main-chart-wrap"><canvas id="analytics-structure-chart"></canvas></div>
    </div>`;

  if (trtStructureChart) trtStructureChart.destroy();
  trtStructureChart = new Chart($("analytics-structure-chart"), {
    type: "doughnut",
    data: {
      labels: groups.map((item) => item.label),
      datasets: [{
        data: groups.map((item) => item.value),
        backgroundColor: analyticsPalette(groups.length),
        borderColor: "#ffffff",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180, easing: "linear" },
      cutout: "55%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 14, padding: 14 } },
        tooltip: {
          callbacks: {
            label(context) {
              const value = numberOrZero(context.raw);
              const share = total ? (value / total) * 100 : 0;
              return `${context.label}: ${Math.round(value).toLocaleString("ru-RU")} ${unit} (${share.toFixed(1).replace(".", ",")}%)`;
            },
          },
        },
      },
    },
  });
}

function renderActiveAnalyticsTab() {
  if (trtAnalyticsTab === "structure") renderAnalyticsStructure();
  else renderAnalyticsDynamics();
}

function setTrtAnalyticsTab(tab) {
  trtAnalyticsTab = tab === "structure" ? "structure" : "dynamics";
  document.querySelectorAll(".legacy-analytics-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.analyticsTab === trtAnalyticsTab);
  });
  document.querySelectorAll(".legacy-structure-only").forEach((element) => {
    element.hidden = trtAnalyticsTab !== "structure";
  });
  $("analytics-report-content").hidden = trtAnalyticsTab !== "dynamics";
  $("analytics-structure-content").hidden = trtAnalyticsTab !== "structure";
  closeAnalyticsFormatMenu();
  renderActiveAnalyticsTab();
}

function openTrtSales(sourceElement = $("trt-card-sales-preview")) {
  const point = selectedTrtPoint();
  if (!point) return;
  const data = trtSalesData(point, trtCardFdiySalesMode);
  if (!data.hasSales) return;

  const modal = $("trt-sales-modal");
  const dialog = modal?.querySelector(".sales-modal");
  if (!modal || !dialog) return;
  const sourceRect = sourceElement?.getBoundingClientRect?.();

  $("trt-sales-modal-title").textContent = trtDisplayName(point);
  $("trt-sales-modal-subtitle").textContent = `${data.isFdiy ? `${data.salesModeLabel} · ` : ""}Сравнение 2025 и 2026 годов · ${data.unit}`;
  $("trt-sales-ytd-2025").textContent = formatSales(data.ytd2025, data.unit);
  $("trt-sales-ytd-2026").textContent = formatSales(data.ytd2026, data.unit);
  $("trt-sales-yoy").textContent = data.yoy === null ? "—" : `${data.yoy >= 0 ? "+" : ""}${data.yoy.toFixed(1).replace(".", ",")}%`;

  const yoyBox = $("trt-sales-yoy-box");
  yoyBox.classList.remove("sales-yoy-positive", "sales-yoy-negative", "sales-yoy-neutral");
  if (data.yoy === null || data.yoy === 0) yoyBox.classList.add("sales-yoy-neutral");
  else if (data.yoy > 0) yoyBox.classList.add("sales-yoy-positive");
  else yoyBox.classList.add("sales-yoy-negative");

  modal.classList.remove("chart-expand-run");
  modal.hidden = false;

  window.requestAnimationFrame(() => {
    const targetRect = dialog.getBoundingClientRect();
    if (sourceRect && sourceRect.width > 0 && sourceRect.height > 0 && targetRect.width > 0 && targetRect.height > 0) {
      const sourceCx = sourceRect.left + sourceRect.width / 2;
      const sourceCy = sourceRect.top + sourceRect.height / 2;
      const targetCx = targetRect.left + targetRect.width / 2;
      const targetCy = targetRect.top + targetRect.height / 2;
      const scale = Math.max(.28, Math.min(.92, Math.min(sourceRect.width / targetRect.width, sourceRect.height / targetRect.height)));
      dialog.style.setProperty("--chart-expand-x", `${sourceCx - targetCx}px`);
      dialog.style.setProperty("--chart-expand-y", `${sourceCy - targetCy}px`);
      dialog.style.setProperty("--chart-expand-scale", String(scale));
    } else {
      dialog.style.setProperty("--chart-expand-x", "0px");
      dialog.style.setProperty("--chart-expand-y", "10px");
      dialog.style.setProperty("--chart-expand-scale", ".96");
    }
    void dialog.offsetWidth;
    modal.classList.add("chart-expand-run");

    if (trtSalesChart) trtSalesChart.destroy();
    trtSalesChart = new Chart($("trt-sales-chart"), {
      type: "bar",
      data: {
        labels: analyticsMonthLabels(),
        datasets: [
          { label: "2025", data: data.sales2025, backgroundColor: "#c9deef", borderColor: "#a9c7df", borderWidth: 1, borderRadius: 6, maxBarThickness: 30 },
          { label: "2026", data: data.sales2026, backgroundColor: "#384E86", borderColor: "#2b3f71", borderWidth: 1, borderRadius: 6, maxBarThickness: 30 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 260, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.86 } },
        plugins: {
          legend: { position: "top", align: "end" },
          tooltip: { callbacks: { label(context) { return `${context.dataset.label}: ${Math.round(numberOrZero(context.parsed.y)).toLocaleString("ru-RU")} ${data.unit}`; } } },
        },
        scales: {
          y: { beginAtZero: true, grace: "10%", ticks: { callback(value) { return Math.round(Number(value)).toLocaleString("ru-RU"); } }, title: { display: true, text: data.unit } },
          x: { title: { display: true, text: "Месяц" } },
        },
      },
    });
  });
}

function closeTrtSales() {
  const modal = $("trt-sales-modal");
  if (trtSalesChart) {
    trtSalesChart.destroy();
    trtSalesChart = null;
  }
  if (modal) {
    modal.classList.remove("chart-expand-run");
    modal.hidden = true;
  }
}


const SALES_IMPORT_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const SALES_IMPORT_REQUIRED_HEADERS = {
  direction: "направление деятельности",
  manager: "менеджер",
  client: "клиент",
  location: "торговая точка.месторасположение",
  quantity: "количество",
};
const SALES_IMPORT_HEADER_LABELS = {
  direction: "Направление деятельности",
  manager: "Менеджер",
  client: "Клиент",
  location: "Торговая точка.Месторасположение",
  quantity: "Количество",
};
let salesImportSourceRows = [];
let salesImportPreview = null;
let salesImportFileName = "";
let trtBulkImportRows = [];
let trtBulkImportPreview = [];
let trtBulkImportFileName = "";

function normalizeSalesHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s*\.\s*/g, ".")
    .replace(/местоположение/g, "месторасположение")
    .replace(/\s+/g, " ");
}



function normalizeTrtBulkHeader(value) {
  return String(value ?? "")
    .trim().toLowerCase().replace(/ё/g, "е")
    .replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

function trtBulkColumnIndex(headers, aliases) {
  const normalized = headers.map(normalizeTrtBulkHeader);
  for (const alias of aliases) {
    const target = normalizeTrtBulkHeader(alias);
    const exact = normalized.findIndex((value) => value === target);
    if (exact >= 0) return exact;
  }
  return -1;
}

function trtBulkText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function trtBulkNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

async function readTrtBulkImportFile(file) {
  if (!window.XLSX) throw new Error("Библиотека Excel не загрузилась. Обновите страницу.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("В Excel-файле нет листов.");
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
  if (!matrix.length) throw new Error("Excel-файл пуст.");

  let headerRow = -1;
  let indexes = null;
  for (let i = 0; i < Math.min(matrix.length, 12); i += 1) {
    const headers = matrix[i] || [];
    const candidate = {
      name: trtBulkColumnIndex(headers, ["Наименование ТРТ", "ТРТ", "Торговая точка", "Клиент"]),
      city: trtBulkColumnIndex(headers, ["Город", "Населенный пункт", "Населённый пункт"]),
      address: trtBulkColumnIndex(headers, ["Адрес", "Исходный адрес"]),
      fullAddress: trtBulkColumnIndex(headers, ["Адрес ТРТ", "Полный адрес", "Адрес для геокодера"]),
      lat: trtBulkColumnIndex(headers, ["Широта", "Latitude", "Lat"]),
      lon: trtBulkColumnIndex(headers, ["Долгота", "Longitude", "Lon", "Lng"]),
      geocodeStatus: trtBulkColumnIndex(headers, ["Статус геокодирования", "Статус геокодера"]),
      foundAddress: trtBulkColumnIndex(headers, ["Адрес, найденный Яндексом", "Найденный адрес", "Адрес найденный Яндексом"]),
      precision: trtBulkColumnIndex(headers, ["Точность", "Precision"]),
      direction: trtBulkColumnIndex(headers, ["Направление деятельности", "Направление"]),
      format: trtBulkColumnIndex(headers, ["Формат", "Формат ТРТ"]),
      businessStatus: trtBulkColumnIndex(headers, ["Статус ТРТ", "Статус"]),
      manager: trtBulkColumnIndex(headers, ["Менеджер"]),
    };
    if (candidate.name >= 0 && candidate.lat >= 0 && candidate.lon >= 0) {
      headerRow = i; indexes = candidate; break;
    }
  }
  if (headerRow < 0 || !indexes) {
    throw new Error("Не найдены обязательные столбцы: Наименование ТРТ, Широта, Долгота.");
  }

  const rows = [];
  for (let i = headerRow + 1; i < matrix.length; i += 1) {
    const source = matrix[i] || [];
    if (!source.some((value) => trtBulkText(value))) continue;
    const name = trtBulkText(source[indexes.name]);
    const city = indexes.city >= 0 ? trtBulkText(source[indexes.city]) : "";
    const shortAddress = indexes.address >= 0 ? trtBulkText(source[indexes.address]) : "";
    const fullAddress = indexes.fullAddress >= 0 ? trtBulkText(source[indexes.fullAddress]) : "";
    const foundAddress = indexes.foundAddress >= 0 ? trtBulkText(source[indexes.foundAddress]) : "";
    const address = fullAddress || [city, shortAddress].filter(Boolean).join(", ") || foundAddress;
    rows.push({
      rowNumber: i + 1,
      client: name,
      city,
      sourceAddress: shortAddress,
      address,
      foundAddress,
      lat: trtBulkNumber(source[indexes.lat]),
      lon: trtBulkNumber(source[indexes.lon]),
      geocodeStatus: indexes.geocodeStatus >= 0 ? trtBulkText(source[indexes.geocodeStatus]) : "",
      precision: indexes.precision >= 0 ? trtBulkText(source[indexes.precision]).toLowerCase() : "",
      direction: indexes.direction >= 0 ? trtBulkText(source[indexes.direction]) : "",
      format: indexes.format >= 0 ? trtBulkText(source[indexes.format]) : "",
      status: indexes.businessStatus >= 0 ? trtBulkText(source[indexes.businessStatus]).toUpperCase() : "",
      manager: indexes.manager >= 0 ? trtBulkText(source[indexes.manager]) : "",
    });
  }
  return rows;
}

function trtBulkNormalizeMatch(value) {
  return normalizeText(value).replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

function trtBulkDistanceMeters(a, b) {
  const lat1 = Number(a?.lat), lon1 = Number(a?.lon), lat2 = Number(b?.lat), lon2 = Number(b?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const r = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function buildTrtBulkPreview(rows) {
  const existing = (state.trtPoints || []).map((point) => ({
    id: String(point.id || ""),
    name: trtBulkNormalizeMatch(point.client || point.holding || ""),
    address: trtBulkNormalizeMatch(point.address || ""),
    lat: Number(point.lat), lon: Number(point.lon),
  }));
  return rows.map((row) => {
    let level = "ready";
    let message = "Готово к загрузке";
    if (!row.client) { level = "invalid"; message = "Нет наименования ТРТ"; }
    else if (!row.address) { level = "invalid"; message = "Нет адреса"; }
    else if (!Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon))) { level = "invalid"; message = "Нет корректных координат"; }
    else if (row.geocodeStatus && normalizeText(row.geocodeStatus) !== "ok") { level = "invalid"; message = `Геокодер: ${row.geocodeStatus}`; }
    else {
      const name = trtBulkNormalizeMatch(row.client);
      const address = trtBulkNormalizeMatch(row.address);
      const duplicate = existing.find((point) => (
        point.name === name && ((address && point.address === address) || trtBulkDistanceMeters(row, point) <= 35)
      ));
      if (duplicate) { level = "duplicate"; message = `Уже есть на карте · ${duplicate.id}`; }
      else if (row.precision && row.precision !== "exact") { level = "warning"; message = `Точность геокодера: ${row.precision}`; }
    }
    return { ...row, level, message };
  });
}

async function initializeTrtBulkImport() {
  const direction = $("trt-import-direction");
  const format = $("trt-import-format");
  if (!direction || !format) return;
  try { await ensureTrtData(); } catch (error) { console.warn("TRT bulk import directory unavailable", error); }
  const currentDirection = direction.value;
  const currentFormat = format.value;
  const directions = [...new Set(state.trtPoints.map((point) => trtBulkText(point.direction)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
  const formats = [...new Set(state.trtPoints.map((point) => trtBulkText(point.format)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
  direction.innerHTML = '<option value="">Выберите направление</option>' + directions.map((value)=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  format.innerHTML = '<option value="">Выберите формат</option>' + formats.map((value)=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (directions.includes(currentDirection)) direction.value = currentDirection;
  if (formats.includes(currentFormat)) format.value = currentFormat;
}

function resetTrtBulkImport(clearFile = true) {
  trtBulkImportRows = [];
  trtBulkImportPreview = [];
  trtBulkImportFileName = "";
  if ($("trt-import-result")) $("trt-import-result").hidden = true;
  if ($("trt-import-error")) $("trt-import-error").hidden = true;
  if ($("trt-import-progress")) $("trt-import-progress").hidden = true;
  if ($("trt-import-commit-button")) $("trt-import-commit-button").disabled = true;
  if ($("trt-import-map-button")) $("trt-import-map-button").hidden = true;
  if (clearFile && $("trt-import-file")) $("trt-import-file").value = "";
  updateTrtBulkPreviewButton();
}

function updateTrtBulkPreviewButton() {
  const button = $("trt-import-preview-button");
  if (!button) return;
  button.disabled = !$("trt-import-file")?.files?.[0] || !isSystemAdmin();
}

function trtBulkRowsForCommit() {
  const includeWarnings = Boolean($("trt-import-include-warning")?.checked);
  return trtBulkImportPreview.filter((row) => row.level === "ready" || (includeWarnings && row.level === "warning"));
}

function renderTrtBulkPreview() {
  const rows = trtBulkImportPreview;
  const count = (level) => rows.filter((row) => row.level === level).length;
  $("trt-import-total-rows").textContent = rows.length.toLocaleString("ru-RU");
  $("trt-import-ready-rows").textContent = count("ready").toLocaleString("ru-RU");
  $("trt-import-warning-rows").textContent = count("warning").toLocaleString("ru-RU");
  $("trt-import-duplicate-rows").textContent = count("duplicate").toLocaleString("ru-RU");
  $("trt-import-invalid-rows").textContent = count("invalid").toLocaleString("ru-RU");
  $("trt-import-table-body").innerHTML = rows.map((row) => {
    const badgeClass = row.level === "ready" ? "success" : row.level === "warning" ? "account" : row.level === "duplicate" ? "muted" : "danger";
    return `<tr class="sales-import-row-${escapeHtml(row.level)}"><td>${row.rowNumber}</td><td><strong>${escapeHtml(row.client || "—")}</strong><small>${escapeHtml(row.city || "")}</small></td><td>${escapeHtml(row.address || "—")}</td><td>${Number.isFinite(Number(row.lat)) ? Number(row.lat).toFixed(6) : "—"}<br>${Number.isFinite(Number(row.lon)) ? Number(row.lon).toFixed(6) : "—"}</td><td>${escapeHtml(row.precision || "—")}</td><td><span class="badge ${badgeClass}">${escapeHtml(row.message)}</span></td></tr>`;
  }).join("");
  $("trt-import-result").hidden = false;
  updateTrtBulkCommitButton();
}

function updateTrtBulkCommitButton() {
  const button = $("trt-import-commit-button");
  if (!button) return;
  const metadataReady = Boolean($("trt-import-direction")?.value && $("trt-import-format")?.value && $("trt-import-status")?.value);
  button.disabled = !isSystemAdmin() || !metadataReady || trtBulkRowsForCommit().length === 0;
}

async function previewTrtBulkImport() {
  const file = $("trt-import-file")?.files?.[0];
  if (!file) return;
  const error = $("trt-import-error"), progress = $("trt-import-progress"), button = $("trt-import-preview-button");
  error.hidden = true; progress.hidden = false; progress.textContent = "Проверка файла новых ТРТ…"; button.disabled = true;
  try {
    await initializeTrtBulkImport();
    trtBulkImportRows = await readTrtBulkImportFile(file);
    trtBulkImportFileName = file.name;
    trtBulkImportPreview = buildTrtBulkPreview(trtBulkImportRows);
    renderTrtBulkPreview();
  } catch (exc) {
    error.textContent = exc?.message || String(exc); error.hidden = false;
  } finally {
    progress.hidden = true; updateTrtBulkPreviewButton();
  }
}

function trtBulkChunk(items, size = 50) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function commitTrtBulkImport() {
  const rows = trtBulkRowsForCommit();
  if (!rows.length || !isSystemAdmin()) return;
  const direction = $("trt-import-direction").value;
  const format = $("trt-import-format").value;
  const status = $("trt-import-status").value;
  const manager = $("trt-import-manager").value.trim();
  if (!direction || !format || !status) { updateTrtBulkCommitButton(); return; }
  const button = $("trt-import-commit-button"), error = $("trt-import-error"), progress = $("trt-import-progress");
  button.disabled = true; error.hidden = true; progress.hidden = false;
  try {
    const chunks = trtBulkChunk(rows, 50);
    let created = 0, duplicates = 0, invalid = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      progress.textContent = `Загрузка новых ТРТ… ${i + 1} / ${chunks.length}`;
      const payloadRows = chunks[i].map((row) => ({
        rowNumber: row.rowNumber, client: row.client, address: row.address,
        lat: row.lat, lon: row.lon,
        direction: row.direction || direction, format: row.format || format,
        status: row.status || status, manager: row.manager || manager,
      }));
      const result = await api("/admin/sales-import", {
        method: "POST", timeout: 90000,
        body: JSON.stringify({ scope: "trt_bulk_import", operation: "commit", direction, format, status, manager, fileName: trtBulkImportFileName, rows: payloadRows }),
      });
      created += Number(result.summary?.createdRows || 0);
      duplicates += Number(result.summary?.duplicateRows || 0);
      invalid += Number(result.summary?.invalidRows || 0);
    }
    state.trtLoaded = false;
    state.trtPoints = [];
    await ensureTrtData();
    showToast(`Новые ТРТ: добавлено ${created}${duplicates ? ` · дублей ${duplicates}` : ""}${invalid ? ` · ошибок ${invalid}` : ""}`);
    progress.textContent = `Готово. Добавлено новых ТРТ: ${created}.`;
    $("trt-import-map-button").hidden = (created + duplicates) === 0;
  } catch (exc) {
    error.textContent = exc?.message || String(exc); error.hidden = false; progress.hidden = true;
  } finally {
    updateTrtBulkCommitButton();
  }
}

function openBulkNewTrtOnMap() {
  const directionFilter = $("trt-direction-filter");
  const managerFilter = $("trt-manager-filter");
  if (directionFilter) directionFilter.value = "";
  if (managerFilter) managerFilter.value = "";
  trtSmartFilters = [{ type: "source", value: "new_bulk", label: "Новые ТРТ" }];
  persistTrtSmartFilters();
  renderTrtSmartFilterChips();
  state.trtFitRequested = true;
  showPage("trt");
  window.setTimeout(() => renderTrtMap(), 50);
}

function trtMasterAuditLayerLabel(layer) {
  const labels = {
    alias: "Alias",
    master: "TRT Master",
    fallback: "Legacy fallback",
    unresolved: "Не сопоставлено",
    inactive: "Не участвует",
  };
  return labels[String(layer || "unresolved")] || String(layer || "—");
}

function trtMasterAuditSourceRows() {
  const rows = [];
  (state.marketAnalysis?.staticPlanSources || []).forEach((source) => {
    const direction = marketDirectionKey(source._direction || source.direction);
    const periods = Array.isArray(source.periods) ? source.periods : [];
    const periodIndex = periods.findIndex((period) => (
      Number(period?.year) === Number(marketAnalysisYear)
      && Number(period?.month) === Number(marketAnalysisMonth)
    ));
    (source.rows || []).forEach((row, index) => {
      const rowNumber = row.row || index + 2;
      const quantities = Array.isArray(row.q) ? row.q : [];
      const rawPlan = periodIndex >= 0 ? quantities[periodIndex] : 0;
      const planQuantity = Number.isFinite(Number(rawPlan)) ? Math.max(0, Number(rawPlan)) : 0;
      rows.push({
        sourceKey: `${source._sourceUrl || "static"}|${direction}|${rowNumber}`,
        rowNumber,
        direction,
        manager: row.manager || "",
        client: row.client || "",
        trtName: row.trt || row.trtName || "",
        address: row.address || "",
        city: row.city || "",
        region: row.region || "",
        format: row.format || "",
        planQuantity,
      });
    });
  });
  return rows;
}

function applyTrtMasterAuditPeriodRules(rows, sourceRows) {
  const sourceByKey = new Map(sourceRows.map((row) => [String(row.sourceKey || ""), row]));
  const pointById = new Map((state.trtPoints || []).map((point) => [String(point.id || ""), point]));
  const summary = {
    totalRows: 0,
    activeRows: 0,
    inactiveRows: 0,
    aliasRows: 0,
    masterRows: 0,
    fallbackRows: 0,
    unresolvedRows: 0,
    masterConflictRows: 0,
    masterOnlyRows: 0,
    masterAmbiguousRows: 0,
    matchedRows: 0,
  };

  const result = (rows || []).map((row) => {
    const source = sourceByKey.get(String(row.sourceKey || "")) || {};
    const point = row.pointId ? pointById.get(String(row.pointId)) : null;
    const planQuantity = Number(source.planQuantity || 0);
    const factQuantity = point ? marketPointMonthFact(point, marketAnalysisYear, marketAnalysisMonth) : 0;
    const hasAddress = Boolean(String(source.address || row.address || "").trim());
    const inactive = !hasAddress && planQuantity <= 0 && factQuantity <= 0;
    const next = {
      ...row,
      planQuantity,
      factQuantity,
      auditYear: Number(marketAnalysisYear),
      auditMonth: Number(marketAnalysisMonth),
    };

    summary.totalRows += 1;
    if (inactive) {
      next.originalLayer = row.layer || "unresolved";
      next.layer = "inactive";
      next.status = "inactive_period";
      next.message = "Не участвует в анализе периода: нет адреса, план = 0 и факт = 0.";
      summary.inactiveRows += 1;
      return next;
    }

    summary.activeRows += 1;
    if (next.layer === "alias") summary.aliasRows += 1;
    else if (next.layer === "master") summary.masterRows += 1;
    else if (next.layer === "fallback") summary.fallbackRows += 1;
    else summary.unresolvedRows += 1;

    if (next.masterStatus === "point_conflict") summary.masterConflictRows += 1;
    else if (next.masterStatus === "master_only") summary.masterOnlyRows += 1;
    else if (next.masterStatus === "ambiguous") summary.masterAmbiguousRows += 1;
    return next;
  });

  summary.matchedRows = summary.aliasRows + summary.masterRows + summary.fallbackRows;
  return { rows: result, summary };
}

function filteredTrtMasterAuditRows() {
  const query = normalizeText($("trt-master-audit-search")?.value || "");
  const layer = $("trt-master-audit-filter")?.value || "unresolved";
  return (state.trtMasterAudit.rows || []).filter((row) => {
    if (layer !== "all" && String(row.layer || "unresolved") !== layer) return false;
    if (!query) return true;
    return normalizeText([
      row.rowNumber, row.direction, row.manager, row.client, row.trtName, row.address,
      row.masterId, row.pointId, row.matchMethod, row.message, row.matchedName, row.matchedAddress,
    ].join(" ")).includes(query);
  });
}

function renderTrtMasterAudit() {
  const s = state.trtMasterAudit.summary || {};
  $("trt-master-audit-total").textContent = Number(s.totalRows || 0).toLocaleString("ru-RU");
  $("trt-master-audit-alias").textContent = Number(s.aliasRows || 0).toLocaleString("ru-RU");
  $("trt-master-audit-master").textContent = Number(s.masterRows || 0).toLocaleString("ru-RU");
  $("trt-master-audit-fallback").textContent = Number(s.fallbackRows || 0).toLocaleString("ru-RU");
  $("trt-master-audit-unresolved").textContent = Number(s.unresolvedRows || 0).toLocaleString("ru-RU");
  $("trt-master-audit-inactive").textContent = Number(s.inactiveRows || 0).toLocaleString("ru-RU");
  $("trt-master-audit-web").textContent = `${Number(state.trtMasterAudit.currentWebMatched || 0).toLocaleString("ru-RU")} / ${Number(state.trtMasterAudit.currentWebTotal || 0).toLocaleString("ru-RU")}`;

  const details = [];
  if (s.masterConflictRows) details.push(`конфликтов point_id: ${s.masterConflictRows}`);
  if (s.masterOnlyRows) details.push(`master без point_id: ${s.masterOnlyRows}`);
  if (s.masterAmbiguousRows) details.push(`неоднозначных master: ${s.masterAmbiguousRows}`);
  const note = $("trt-master-audit-note");
  const activeRows = Number(s.activeRows ?? (Number(s.totalRows || 0) - Number(s.inactiveRows || 0)));
  note.textContent = `Период контроля: ${String(marketAnalysisMonth).padStart(2, "0")}.${marketAnalysisYear}. Серверная цепочка: сохранённый alias → TRT Master → legacy fallback. Сопоставлено ${Number(s.matchedRows || 0)} из ${activeRows} активных строк. Не участвует в анализе периода: ${Number(s.inactiveRows || 0)}.${details.length ? ` Дополнительно: ${details.join(", ")}.` : ""}`;

  const rows = filteredTrtMasterAuditRows();
  $("trt-master-audit-visible").textContent = `Показано: ${rows.length.toLocaleString("ru-RU")}`;
  $("trt-master-audit-empty").hidden = rows.length > 0;
  $("trt-master-audit-table-body").innerHTML = rows.map((row) => {
    const badgeClass = row.layer === "unresolved" ? "danger" : row.layer === "inactive" ? "inactive" : row.layer === "fallback" ? "inactive" : row.layer === "alias" ? "success" : "account";
    return `<tr>
      <td>${escapeHtml(row.rowNumber ?? "—")}</td>
      <td>${escapeHtml(row.direction || "—")}</td>
      <td><strong>${escapeHtml(row.client || "—")}</strong><small>${escapeHtml(row.manager || "")}</small></td>
      <td><strong>${escapeHtml(row.trtName || "—")}</strong><small>${escapeHtml(row.address || "Адрес не указан")}</small></td>
      <td>${Number(row.planQuantity || 0).toLocaleString("ru-RU")}</td>
      <td>${Number(row.factQuantity || 0).toLocaleString("ru-RU")}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(trtMasterAuditLayerLabel(row.layer))}</span></td>
      <td><code>${escapeHtml(row.masterId || "—")}</code></td>
      <td><code>${escapeHtml(row.pointId || "—")}</code></td>
      <td><strong>${escapeHtml(row.matchMethod || "—")}</strong><small>${escapeHtml(row.message || "")}</small></td>
    </tr>`;
  }).join("");
}

async function loadTrtMasterAudit(force = false) {
  if (!isSystemAdmin()) return;
  if (state.trtMasterAudit.loading) return;
  if (state.trtMasterAudit.loaded && !force) {
    renderTrtMasterAudit();
    return;
  }
  state.trtMasterAudit.loading = true;
  $("trt-master-audit-loading").hidden = false;
  $("trt-master-audit-loading").textContent = "Проверка TRT Master…";
  $("trt-master-audit-error").hidden = true;
  try {
    await Promise.all([ensureTrtData(), loadRegionalMarketData(false)]);
    marketResolveStaticPlanRows();
    const sourceRows = trtMasterAuditSourceRows();
    if (!sourceRows.length) throw new Error("Статический файл планов ТРТ не найден.");
    const chunks = [];
    const batchSize = 25;
    for (let start = 0; start < sourceRows.length; start += batchSize) {
      chunks.push(sourceRows.slice(start, start + batchSize));
    }

    const mergedRows = [];
    const mergedSummary = {
      totalRows: 0, aliasRows: 0, masterRows: 0, fallbackRows: 0, unresolvedRows: 0,
      masterConflictRows: 0, masterOnlyRows: 0, masterAmbiguousRows: 0, matchedRows: 0,
    };

    for (let index = 0; index < chunks.length; index += 1) {
      $("trt-master-audit-loading").textContent = `Проверка TRT Master… ${index + 1} / ${chunks.length}`;
      const payload = await api("/admin/sales-import", {
        method: "POST",
        timeout: 90000,
        body: JSON.stringify({
          scope: "trt_master_audit",
          sourceType: "trt_plan",
          rows: chunks[index],
        }),
      });
      if (Array.isArray(payload.rows)) mergedRows.push(...payload.rows);
      const summary = payload.summary || {};
      Object.keys(mergedSummary).forEach((key) => {
        mergedSummary[key] += Number(summary[key] || 0);
      });
    }

    const result = applyTrtMasterAuditPeriodRules(mergedRows, sourceRows);
    const localStats = state.marketAnalysis?.staticPlanStats || {};
    state.trtMasterAudit = {
      loaded: true,
      loading: false,
      rows: Array.isArray(result.rows) ? result.rows : [],
      summary: result.summary || {},
      error: "",
      currentWebMatched: Number(localStats.matchedRows || 0),
      currentWebTotal: Number(localStats.sourceRows || 0),
    };
    renderTrtMasterAudit();
  } catch (error) {
    state.trtMasterAudit.loading = false;
    state.trtMasterAudit.error = error.message || String(error);
    $("trt-master-audit-error").textContent = state.trtMasterAudit.error;
    $("trt-master-audit-error").hidden = false;
  } finally {
    $("trt-master-audit-loading").hidden = true;
  }
}


function initializeSalesImportPeriod() {
  const yearSelect = $("sales-import-year");
  if (!yearSelect || yearSelect.options.length) return;
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const firstYear = Math.min(2025, previous.getFullYear());
  const lastYear = Math.max(previous.getFullYear() + 1, now.getFullYear());
  for (let year = lastYear; year >= firstYear; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.append(option);
  }
  yearSelect.value = String(previous.getFullYear());
  $("sales-import-month").value = String(previous.getMonth() + 1);
}

function resetSalesImport(clearFile = true) {
  salesImportSourceRows = [];
  salesImportPreview = null;
  salesImportFileName = "";
  $("sales-import-result").hidden = true;
  $("sales-import-error").hidden = true;
  $("sales-import-progress").hidden = true;
  $("sales-import-commit-button").disabled = true;
  if (clearFile) $("sales-import-file").value = "";
  updateSalesImportPreviewButton();
}

function updateSalesImportPreviewButton() {
  const button = $("sales-import-preview-button");
  const file = $("sales-import-file")?.files?.[0];
  button.disabled = !file || !isSystemAdmin();
}

function parseSalesQuantity(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

async function readSalesImportFile(file) {
  if (!window.XLSX) throw new Error("Модуль чтения Excel не загрузился. Обновите страницу и повторите попытку.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("В Excel-файле нет листов.");
  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "",
    raw: true,
  });
  if (!rawRows.length) throw new Error("На первом листе нет строк с данными.");

  const originalHeaders = Object.keys(rawRows[0]);
  const normalizedToOriginal = new Map(
    originalHeaders.map((header) => [normalizeSalesHeader(header), header])
  );
  const missingKeys = Object.entries(SALES_IMPORT_REQUIRED_HEADERS)
    .filter(([, required]) => !normalizedToOriginal.has(required))
    .map(([key]) => SALES_IMPORT_HEADER_LABELS[key]);
  if (missingKeys.length) {
    throw new Error(`Не найдены обязательные столбцы: ${missingKeys.join(", ")}.`);
  }

  return rawRows.map((row, index) => ({
    rowNumber: index + 2,
    direction: String(row[normalizedToOriginal.get(SALES_IMPORT_REQUIRED_HEADERS.direction)] ?? "").trim(),
    manager: String(row[normalizedToOriginal.get(SALES_IMPORT_REQUIRED_HEADERS.manager)] ?? "").trim(),
    client: String(row[normalizedToOriginal.get(SALES_IMPORT_REQUIRED_HEADERS.client)] ?? "").trim(),
    location: String(row[normalizedToOriginal.get(SALES_IMPORT_REQUIRED_HEADERS.location)] ?? "").trim(),
    quantity: parseSalesQuantity(row[normalizedToOriginal.get(SALES_IMPORT_REQUIRED_HEADERS.quantity)]),
  }));
}

function salesImportStatusBadge(row) {
  const status = String(row.status || "").toLowerCase();
  if (status === "matched") return `<span class="badge success">Найдено</span>`;
  if (status === "ambiguous") return `<span class="badge warning">Несколько ТРТ</span>`;
  if (status === "invalid") return `<span class="badge danger">Ошибка</span>`;
  if (status === "skipped") return `<span class="badge warning">FDIY · отдельно</span>`;
  return `<span class="badge inactive">ТРТ не найдена</span>`;
}

function renderSalesImportPreview(payload) {
  salesImportPreview = payload;
  const summary = payload.summary || {};
  $("sales-import-total-rows").textContent = Number(summary.totalRows || 0).toLocaleString("ru-RU");
  $("sales-import-matched-rows").textContent = Number(summary.matchedRows || 0).toLocaleString("ru-RU");
  $("sales-import-unmatched-rows").textContent = Number(summary.unmatchedRows || 0).toLocaleString("ru-RU");
  $("sales-import-invalid-rows").textContent = Number(summary.invalidRows || 0).toLocaleString("ru-RU");
  $("sales-import-total-quantity").textContent = Number(summary.totalQuantity || 0).toLocaleString("ru-RU");

  const warning = $("sales-import-period-warning");
  warning.hidden = !payload.periodExists;
  warning.textContent = payload.periodExists
    ? `Продажи за ${payload.periodLabel || "выбранный период"} уже загружены. При подтверждении старые данные за месяц будут полностью заменены.`
    : "";

  const totals = Array.isArray(payload.totalsByDirection) ? payload.totalsByDirection : [];
  $("sales-import-direction-totals").innerHTML = totals.map((item) => (
    `<article><span>${escapeHtml(item.direction || "Без направления")}</span><strong>${Number(item.quantity || 0).toLocaleString("ru-RU")}</strong></article>`
  )).join("");

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  $("sales-import-table-body").innerHTML = rows.map((row) => `
    <tr class="sales-import-row-${escapeHtml(row.status || "unmatched")}">
      <td>${escapeHtml(row.rowNumber)}</td>
      <td>${escapeHtml(row.direction || "—")}</td>
      <td>${escapeHtml(shortPersonName(row.manager) || "—")}</td>
      <td>${escapeHtml(row.client || "—")}</td>
      <td><strong>${escapeHtml(row.location || "—")}</strong>${row.message ? `<small>${escapeHtml(row.message)}</small>` : ""}${(row.masterId || row.pointId) ? `<small class="sales-master-meta">master: ${escapeHtml(row.masterId || "—")} · point: ${escapeHtml(row.pointId || "—")} · ${escapeHtml(row.matchMethod || "")}</small>` : ""}</td>
      <td>${row.quantity === null || row.quantity === undefined ? "—" : escapeHtml(Number(row.quantity).toLocaleString("ru-RU"))}</td>
      <td>${salesImportStatusBadge(row)}</td>
    </tr>`).join("");

  $("sales-import-result").hidden = false;
  $("sales-import-commit-button").disabled = Number(summary.matchedRows || 0) === 0;
}

async function previewSalesImport() {
  if (!isSystemAdmin()) return;
  const file = $("sales-import-file").files?.[0];
  if (!file) return;
  const error = $("sales-import-error");
  const progress = $("sales-import-progress");
  error.hidden = true;
  $("sales-import-result").hidden = true;
  progress.hidden = false;
  $("sales-import-preview-button").disabled = true;
  try {
    salesImportSourceRows = await readSalesImportFile(file);
    salesImportFileName = file.name;
    const payload = await api("/admin/sales-import", {
      method: "POST",
      body: JSON.stringify({
        operation: "preview",
        year: Number($("sales-import-year").value),
        month: Number($("sales-import-month").value),
        fileName: file.name,
        rows: salesImportSourceRows,
      }),
    });
    renderSalesImportPreview(payload);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    progress.hidden = true;
    updateSalesImportPreviewButton();
  }
}

async function commitSalesImport() {
  if (!isSystemAdmin() || !salesImportPreview || !salesImportSourceRows.length) return;
  const year = Number($("sales-import-year").value);
  const month = Number($("sales-import-month").value);
  const period = `${SALES_IMPORT_MONTHS[month - 1]} ${year}`;
  const replace = Boolean(salesImportPreview.periodExists);
  const question = replace
    ? `Заменить все ранее загруженные продажи за ${period}?`
    : `Загрузить проверенные продажи за ${period}?`;
  if (!window.confirm(question)) return;

  const button = $("sales-import-commit-button");
  const error = $("sales-import-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = replace ? "Замена данных…" : "Загрузка…";
  try {
    const result = await api("/admin/sales-import", {
      method: "POST",
      body: JSON.stringify({
        operation: "commit",
        year,
        month,
        fileName: salesImportFileName,
        replace,
        rows: salesImportSourceRows,
      }),
    });
    state.trtLoaded = false;
    state.trtPoints = [];
    showToast(result.message || `Продажи за ${period} загружены.`);
    resetSalesImport(true);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
  } finally {
    button.textContent = "Загрузить продажи";
  }
}


const ANALYSIS_IMPORT_STATE = {
  trt_plan: { rows: [], preview: null, fileName: "" },
  diy_sellout: { rows: [], preview: null, fileName: "" },
};

const ANALYSIS_MONTHS = {
  январь: 1, янв: 1,
  февраль: 2, фев: 2,
  март: 3, мар: 3,
  апрель: 4, апр: 4,
  май: 5,
  июнь: 6, июн: 6,
  июль: 7, июл: 7,
  август: 8, авг: 8,
  сентябрь: 9, сен: 9, сент: 9,
  октябрь: 10, окт: 10,
  ноябрь: 11, ноя: 11,
  декабрь: 12, дек: 12,
};

function normalizeAnalysisHeader(value) {
  return String(value ?? "")
    .trim().toLowerCase().replace(/ё/g, "е").replace(/²/g, "2")
    .replace(/[—–-]+/g, " ").replace(/[^0-9a-zа-я]+/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function parseAnalysisMonthHeader(header) {
  const normalized = normalizeAnalysisHeader(header);
  const monthName = Object.keys(ANALYSIS_MONTHS).find((name) => new RegExp(`(^|\\s)${name}(\\s|$)`).test(normalized));
  if (!monthName) return null;
  const yearMatch = normalized.match(/(?:^|\s)(20\d{2}|\d{2})(?:\s|$)/);
  if (!yearMatch) return null;
  let year = Number(yearMatch[1]);
  if (year < 100) year += 2000;
  return { year, month: ANALYSIS_MONTHS[monthName], normalized };
}

function analysisFindColumn(headers, aliases) {
  const normalized = headers.map((header) => [normalizeAnalysisHeader(header), header]);
  for (const alias of aliases) {
    const target = normalizeAnalysisHeader(alias);
    const exact = normalized.find(([key]) => key === target);
    if (exact) return exact[1];
  }
  return "";
}


// ---------------------------------------------------------------------------
// Плитка · сценарка v1 — структурный импорт и контроль TRT Master
// ---------------------------------------------------------------------------
let tileScenarioState = {
  fileName: "",
  sourceYear: 2026,
  trtRows: [],
  groupRows: [],
  summary: null,
  previewReady: false,
};

function tileScenarioText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function tileScenarioChunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function tileScenarioSharedStrings(xmlText) {
  const documentXml = new DOMParser().parseFromString(xmlText, "application/xml");
  if (documentXml.querySelector("parsererror")) throw new Error("Не удалось прочитать sharedStrings.xml из Excel.");
  return Array.from(documentXml.getElementsByTagName("si")).map((item) => (
    Array.from(item.getElementsByTagName("t")).map((node) => node.textContent || "").join("")
  ));
}

function tileScenarioCellValue(attrs, body, sharedStrings) {
  const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
  if (type === "inlineStr") {
    const matches = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    if (!matches.length) return "";
    const text = matches.map((match) => match[1]).join("");
    const box = document.createElement("textarea"); box.innerHTML = text; return box.value;
  }
  const value = (body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/) || [])[1];
  if (value == null) return "";
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  const box = document.createElement("textarea"); box.innerHTML = value; return box.value;
}

function tileScenarioParseRows(sheetXml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetXml))) {
    const rowAttrs = rowMatch[1];
    const rowBody = rowMatch[2];
    const rowNumber = Number((rowAttrs.match(/\br="(\d+)"/) || [])[1] || 0);
    if (!rowNumber) continue;
    const result = { rowNumber, A: "", B: "", C: "", D: "", E: "", styleA: "" };
    const cellRegex = /<c\b([^>]*\br="([A-E])(\d+)"[^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*\br="([A-E])(\d+)"[^>]*)\/>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowBody))) {
      const attrs = cellMatch[1] || cellMatch[5] || "";
      const column = cellMatch[2] || cellMatch[6];
      const body = cellMatch[4] || "";
      result[column] = tileScenarioCellValue(attrs, body, sharedStrings);
      if (column === "A") result.styleA = (attrs.match(/\bs="(\d+)"/) || [])[1] || "";
    }
    if (rowNumber <= 10 || result.A || result.B || result.C || result.D || result.E) rows.push(result);
  }
  return rows;
}

async function readTileScenarioFile(file) {
  if (!window.JSZip) throw new Error("Модуль чтения большой сценарки не загрузился. Обновите страницу.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sharedEntry = zip.file("xl/sharedStrings.xml");
  const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new Error("Не найден первый лист Excel.");
  const sharedStrings = sharedEntry ? tileScenarioSharedStrings(await sharedEntry.async("string")) : [];
  const rows = tileScenarioParseRows(await sheetEntry.async("string"), sharedStrings);
  const byRow = new Map(rows.map((row) => [row.rowNumber, row]));
  const expected = [[1,"Регион"],[2,"Город"],[3,"Клиент"],[4,"Торговая точка"],[5,"Бренд"]];
  for (const [rowNumber, label] of expected) {
    if (normalizeText(byRow.get(rowNumber)?.A || "") !== normalizeText(label)) {
      throw new Error(`Структура файла отличается от сценарки плитки: в A${rowNumber} ожидается «${label}».`);
    }
  }
  const styleMap = {
    region: String(byRow.get(6)?.styleA || ""),
    city: String(byRow.get(7)?.styleA || ""),
    client: String(byRow.get(8)?.styleA || ""),
    trt: String(byRow.get(9)?.styleA || ""),
    group: String(byRow.get(10)?.styleA || ""),
  };
  if (Object.values(styleMap).some((value) => !value) || new Set(Object.values(styleMap)).size < 5) {
    throw new Error("Не удалось определить уровни Регион → Город → Клиент → ТРТ → Бренд. Проверь шаблон файла.");
  }

  const trtRows = [];
  const groupRows = [];
  const regionNames = new Set();
  const clientNames = new Set();
  const groupNames = new Set();
  let cityCount = 0;
  const context = { region: "", cityGroup: "", client: "", trtRowNumber: 0 };

  rows.forEach((row) => {
    if (row.rowNumber <= 5) return;
    const value = tileScenarioText(row.A);
    if (!value && row.styleA !== styleMap.trt) return;
    if (row.styleA === styleMap.region) {
      if (!value) return;
      context.region = value; context.cityGroup = ""; context.client = ""; context.trtRowNumber = 0;
      regionNames.add(normalizeText(value));
      return;
    }
    if (row.styleA === styleMap.city) {
      if (!value) return;
      context.cityGroup = value; context.client = ""; context.trtRowNumber = 0; cityCount += 1; return;
    }
    if (row.styleA === styleMap.client) {
      if (!value) return;
      context.client = value; context.trtRowNumber = 0; clientNames.add(normalizeText(value)); return;
    }
    if (row.styleA === styleMap.trt) {
      if (!value) return;
      context.trtRowNumber = row.rowNumber;
      trtRows.push({
        rowNumber: row.rowNumber,
        region: context.region,
        cityGroup: context.cityGroup,
        client: context.client,
        trtName: value,
        city: tileScenarioText(row.B),
        entityKind: tileScenarioText(row.C),
        trtFormat: tileScenarioText(row.D),
        trtStatus: tileScenarioText(row.E),
      });
      return;
    }
    if (row.styleA === styleMap.group && value) {
      groupNames.add(normalizeText(value));
      groupRows.push({ rowNumber: row.rowNumber, trtRowNumber: context.trtRowNumber, groupName: value });
    }
  });

  if (!trtRows.length) throw new Error("В сценарке не найдены строки ТРТ.");
  return {
    trtRows,
    groupRows,
    summary: {
      regionCount: regionNames.size,
      cityCount,
      clientCount: clientNames.size,
      trtCount: trtRows.length,
      groupCount: groupRows.length,
      uniqueGroupCount: groupNames.size,
    },
  };
}

function resetTileScenario(clearFile = true) {
  tileScenarioState = { fileName: "", sourceYear: Number($("tile-scenario-year")?.value || 2026), trtRows: [], groupRows: [], summary: null, previewReady: false };
  if ($("tile-scenario-result")) $("tile-scenario-result").hidden = true;
  if ($("tile-scenario-error")) $("tile-scenario-error").hidden = true;
  if ($("tile-scenario-progress")) $("tile-scenario-progress").hidden = true;
  if ($("tile-scenario-commit")) $("tile-scenario-commit").disabled = true;
  if (clearFile && $("tile-scenario-file")) $("tile-scenario-file").value = "";
  updateTileScenarioPreviewButton();
}

function updateTileScenarioPreviewButton() {
  const button = $("tile-scenario-preview");
  if (button) button.disabled = !isSystemAdmin() || !$("tile-scenario-file")?.files?.[0];
}

function tileScenarioResultIsProblem(row) {
  return !row.clientExists || ["missing", "direction_mismatch", "ambiguous", "point_conflict"].includes(row.masterStatus);
}

function renderTileScenario() {
  const rows = tileScenarioState.trtRows;
  const summary = tileScenarioState.summary || {};
  const set = (id, value) => { if ($(id)) $(id).textContent = Number(value || 0).toLocaleString("ru-RU"); };
  set("tile-scenario-regions", summary.regionCount);
  set("tile-scenario-vog", summary.vogTrtCount);
  set("tile-scenario-other", summary.otherTrtCount);
  set("tile-scenario-clients", summary.clientCount);
  set("tile-scenario-trt", summary.trtCount);
  set("tile-scenario-groups", summary.groupCount);
  set("tile-scenario-master", summary.tileMasterCount);
  set("tile-scenario-direction-issues", summary.directionMismatchCount);
  set("tile-scenario-missing", summary.missingMasterCount);
  set("tile-scenario-point", summary.pointLinkedCount);

  const filter = $("tile-scenario-filter")?.value || "problems";
  let visible = rows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "problems") return tileScenarioResultIsProblem(row);
    if (filter === "other") return row.territoryScope === "other";
    if (filter === "vog") return row.territoryScope === "vog";
    if (filter === "no-point") return !row.pointId;
    if (filter === "missing") return row.masterStatus === "missing";
    return true;
  });
  const totalVisible = visible.length;
  visible = visible.slice(0, 500);
  if ($("tile-scenario-visible")) $("tile-scenario-visible").textContent = `Показано: ${visible.length.toLocaleString("ru-RU")}${totalVisible > visible.length ? ` из ${totalVisible.toLocaleString("ru-RU")}` : ""}`;
  if ($("tile-scenario-table-body")) $("tile-scenario-table-body").innerHTML = visible.map((row) => {
    const scope = row.territoryScope === "vog" ? "ВОГ" : "Другие";
    const statusLabels = {
      matched: "Master + point_id", master_only: "Master без point_id", point_conflict: "Несколько point_id",
      ambiguous: "Несколько Master", direction_mismatch: "Не Плитка в Master", missing: "Нет в Master",
    };
    const statusClass = ["matched"].includes(row.masterStatus) ? "success" : ["master_only"].includes(row.masterStatus) ? "muted" : "danger";
    const clientNote = row.clientExists ? "" : '<small class="danger-text">Клиент не найден в Master</small>';
    return `<tr>
      <td>${row.rowNumber}</td><td><span class="badge ${row.territoryScope === "vog" ? "success" : "muted"}">${scope}</span></td>
      <td>${escapeHtml(row.region || "—")}<small>${escapeHtml(row.cityGroup || "")}</small></td>
      <td><strong>${escapeHtml(row.client || "—")}</strong>${clientNote}</td>
      <td><strong>${escapeHtml(row.trtName || "—")}</strong><small>${escapeHtml(row.city || "")}</small></td>
      <td>${escapeHtml(row.entityKind || "—")}</td><td>${escapeHtml(row.trtFormat || "—")}</td><td>${escapeHtml(row.trtStatus || "—")}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(statusLabels[row.masterStatus] || row.masterStatus || "—")}</span><small>${escapeHtml(row.matchMethod || "")}</small></td>
      <td>${escapeHtml(row.masterId || "—")}</td><td>${escapeHtml(row.pointId || "—")}</td>
    </tr>`;
  }).join("");
  if ($("tile-scenario-result")) $("tile-scenario-result").hidden = false;
  if ($("tile-scenario-commit")) $("tile-scenario-commit").disabled = !isSystemAdmin() || !tileScenarioState.previewReady;
}

async function previewTileScenario() {
  const file = $("tile-scenario-file")?.files?.[0];
  if (!file || !isSystemAdmin()) return;
  const error = $("tile-scenario-error"), progress = $("tile-scenario-progress"), button = $("tile-scenario-preview");
  error.hidden = true; progress.hidden = false; button.disabled = true;
  try {
    progress.textContent = "Читаю структуру сценарки…";
    const parsed = await readTileScenarioFile(file);
    tileScenarioState = {
      fileName: file.name,
      sourceYear: Number($("tile-scenario-year")?.value || 2026),
      trtRows: parsed.trtRows,
      groupRows: parsed.groupRows,
      summary: parsed.summary,
      previewReady: false,
    };
    const chunks = tileScenarioChunk(tileScenarioState.trtRows, 200);
    const matches = new Map();
    for (let index = 0; index < chunks.length; index += 1) {
      progress.textContent = `Проверяю TRT Master… ${index + 1} / ${chunks.length}`;
      const payload = await api("/admin/sales-import", {
        method: "POST", timeout: 90000,
        body: JSON.stringify({
          scope: "tile_scenario", operation: "preview",
          rows: chunks[index].map((row) => ({
            rowNumber: row.rowNumber, region: row.region, city: row.city,
            client: row.client, trt: row.trtName, format: row.trtFormat,
          })),
        }),
      });
      (payload.rows || []).forEach((item) => matches.set(Number(item.rowNumber), item));
    }
    tileScenarioState.trtRows = tileScenarioState.trtRows.map((row) => ({ ...row, ...(matches.get(row.rowNumber) || {}) }));
    const summary = tileScenarioState.summary;
    summary.vogTrtCount = tileScenarioState.trtRows.filter((row) => row.territoryScope === "vog").length;
    summary.otherTrtCount = tileScenarioState.trtRows.filter((row) => row.territoryScope === "other").length;
    summary.tileMasterCount = tileScenarioState.trtRows.filter((row) => !["missing", "direction_mismatch"].includes(row.masterStatus)).length;
    summary.directionMismatchCount = tileScenarioState.trtRows.filter((row) => row.masterStatus === "direction_mismatch").length;
    summary.missingMasterCount = tileScenarioState.trtRows.filter((row) => row.masterStatus === "missing").length;
    summary.pointLinkedCount = tileScenarioState.trtRows.filter((row) => Boolean(row.pointId)).length;
    summary.missingClientCount = new Set(tileScenarioState.trtRows.filter((row) => !row.clientExists && row.client).map((row) => normalizeText(row.client))).size;
    tileScenarioState.previewReady = true;
    renderTileScenario();
    progress.textContent = `Проверка завершена: ${summary.trtCount.toLocaleString("ru-RU")} ТРТ.`;
    window.setTimeout(() => { if (progress) progress.hidden = true; }, 900);
  } catch (exc) {
    error.textContent = exc?.message || String(exc); error.hidden = false; progress.hidden = true;
  } finally {
    updateTileScenarioPreviewButton();
  }
}

async function commitTileScenario() {
  if (!tileScenarioState.previewReady || !isSystemAdmin()) return;
  const button = $("tile-scenario-commit"), error = $("tile-scenario-error"), progress = $("tile-scenario-progress");
  button.disabled = true; error.hidden = true; progress.hidden = false;
  const random = (globalThis.crypto?.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(4))).map((value) => value.toString(16).padStart(2,"0")).join("") : Math.random().toString(16).slice(2,10));
  const importId = `tile-scenario-${Date.now()}-${random}`;
  try {
    const trtChunks = tileScenarioChunk(tileScenarioState.trtRows, 100);
    for (let index = 0; index < trtChunks.length; index += 1) {
      progress.textContent = `Сохраняю ТРТ… ${index + 1} / ${trtChunks.length}`;
      await api("/admin/sales-import", {
        method: "POST", timeout: 90000,
        body: JSON.stringify({ scope: "tile_scenario", operation: "commit_trt", importId, rows: trtChunks[index] }),
      });
    }
    const groupChunks = tileScenarioChunk(tileScenarioState.groupRows.filter((row) => row.trtRowNumber), 200);
    for (let index = 0; index < groupChunks.length; index += 1) {
      progress.textContent = `Сохраняю группы… ${index + 1} / ${groupChunks.length}`;
      await api("/admin/sales-import", {
        method: "POST", timeout: 90000,
        body: JSON.stringify({ scope: "tile_scenario", operation: "commit_groups", importId, rows: groupChunks[index] }),
      });
    }
    progress.textContent = "Активирую новую структуру сценарки…";
    await api("/admin/sales-import", {
      method: "POST", timeout: 90000,
      body: JSON.stringify({
        scope: "tile_scenario", operation: "finalize", importId,
        fileName: tileScenarioState.fileName, sourceYear: tileScenarioState.sourceYear,
        summary: tileScenarioState.summary,
      }),
    });
    progress.textContent = `Готово. Сохранено ${tileScenarioState.summary.trtCount.toLocaleString("ru-RU")} ТРТ и ${tileScenarioState.summary.groupCount.toLocaleString("ru-RU")} строк групп.`;
    showToast("Сценарка плитки сохранена");
  } catch (exc) {
    error.textContent = exc?.message || String(exc); error.hidden = false; progress.hidden = true;
  } finally {
    button.disabled = !tileScenarioState.previewReady;
  }
}

// ---------------------------------------------------------------------------
// FDIY v1 — федеральные DIY-сети: справочник источника продаж и загрузка.
// ---------------------------------------------------------------------------
let fdiyDirectoryState = { loaded: false, loading: false, clients: [], networks: [], summary: {} };
let fdiyImportState = { rows: [], preview: null, fileName: "", mode: "", sourceSheet: "", historical: false, detectedPeriodCount: 0 };

function fdiyNorm(value) {
  return String(value ?? "").trim().toLowerCase().replace(/ё/g, "е")
    .replace(/[—–_-]+/g, " ").replace(/[^0-9a-zа-я]+/gi, " ").replace(/\s+/g, " ").trim();
}

function fdiyMonthNumber(value) {
  const text = fdiyNorm(value);
  if (!text) return 0;
  if (/^\d{1,2}$/.test(text)) { const n = Number(text); return n >= 1 && n <= 12 ? n : 0; }
  for (const [name, number] of Object.entries(ANALYSIS_MONTHS)) {
    if (new RegExp(`(^|\\s)${name}(\\s|$)`).test(text)) return Number(number);
  }
  return 0;
}

function fdiyLeadingCode(value) {
  const match = String(value ?? "").match(/^\s*0*(\d{1,6})\b/);
  if (!match) return "";
  const n = Number(match[1]);
  return n < 1000 ? String(n).padStart(3, "0") : String(n);
}

function fdiyResolveNetwork(value) {
  const key = fdiyNorm(value);
  if (!key) return null;
  return fdiyDirectoryState.networks.find((item) =>
    String(item.networkId || "") === String(value || "") ||
    fdiyNorm(item.networkName) === key || fdiyNorm(item.clientName) === key
  ) || null;
}

function initializeFdiyPeriods() {
  const start = $("fdiy-start-year"), monthlyYear = $("fdiy-month-year"), monthlyMonth = $("fdiy-month");
  if (start && !start.options.length) {
    for (let year = 2024; year <= new Date().getFullYear() + 2; year += 1) start.add(new Option(String(year), String(year)));
    start.value = "2025";
  }
  if (monthlyYear && !monthlyYear.options.length) {
    for (let year = 2024; year <= new Date().getFullYear() + 2; year += 1) monthlyYear.add(new Option(String(year), String(year)));
    const prev = new Date(); prev.setMonth(prev.getMonth() - 1);
    monthlyYear.value = String(prev.getFullYear());
    if (monthlyMonth) monthlyMonth.value = String(prev.getMonth() + 1);
  }
}

function fillFdiyNetworkSelect() {
  const select = $("fdiy-network");
  if (!select) return;
  const previous = select.value;
  const activeNetworks = fdiyDirectoryState.networks.filter((item) => item.isActive);
  select.innerHTML = '<option value="">Из файла / выберите сеть</option>' + activeNetworks
    .map((item) => `<option value="${escapeHtml(item.networkId)}">${escapeHtml(item.networkName || item.clientName || item.networkId)}</option>`).join("");
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  else if (activeNetworks.length === 1) select.value = activeNetworks[0].networkId;
  else {
    const lemana = activeNetworks.find((item) => fdiyNorm(item.networkName).includes("лемана"));
    if (lemana) select.value = lemana.networkId;
  }
}

async function loadFdiyDirectory(force = false) {
  if (!isSystemAdmin()) return;
  if (fdiyDirectoryState.loading || (fdiyDirectoryState.loaded && !force)) { fillFdiyNetworkSelect(); return; }
  fdiyDirectoryState.loading = true;
  const progress = $("fdiy-directory-progress"), error = $("fdiy-directory-error");
  if (progress) progress.hidden = false;
  if (error) error.hidden = true;
  try {
    const payload = await api("/admin/sales-import", { method: "POST", timeout: 90000, body: JSON.stringify({ scope: "fdiy", operation: "directory" }) });
    fdiyDirectoryState = { loaded: true, loading: false, clients: payload.clients || [], networks: payload.networks || [], summary: payload.summary || {} };
    fillFdiyNetworkSelect(); renderFdiyDirectory(); initializeFdiyPeriods();
  } catch (exc) {
    fdiyDirectoryState.loading = false;
    if (error) { error.textContent = exc?.message || String(exc); error.hidden = false; }
  } finally { if (progress) progress.hidden = true; }
}

function renderFdiyDirectory() {
  const summary = fdiyDirectoryState.summary || {};
  if ($("fdiy-directory-clients")) $("fdiy-directory-clients").textContent = Number(summary.clientCount || 0).toLocaleString("ru-RU");
  if ($("fdiy-directory-networks")) $("fdiy-directory-networks").textContent = Number(summary.fdiyClientCount || 0).toLocaleString("ru-RU");
  if ($("fdiy-directory-trt")) $("fdiy-directory-trt").textContent = Number(summary.fdiyTrtCount || 0).toLocaleString("ru-RU");
  const search = fdiyNorm($("fdiy-directory-search")?.value || "");
  const filter = $("fdiy-directory-filter")?.value || "all";
  const source = fdiyDirectoryState.clients || [];
  const indexes = source.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (filter === "fdiy" && item.salesMode !== "FDIY") return false;
    if (filter === "standard" && item.salesMode === "FDIY") return false;
    if (search && !fdiyNorm(`${item.clientName || ""} ${item.network?.networkName || ""}`).includes(search)) return false;
    return true;
  });
  const visible = indexes.slice(0, 300);
  if ($("fdiy-directory-visible")) $("fdiy-directory-visible").textContent = `Показано: ${visible.length.toLocaleString("ru-RU")}${indexes.length > visible.length ? ` из ${indexes.length.toLocaleString("ru-RU")}` : ""}`;
  const body = $("fdiy-directory-body"); if (!body) return;
  body.innerHTML = visible.map(({ item, index }) => {
    const network = item.network || {};
    const fdiy = item.salesMode === "FDIY";
    return `<tr data-fdiy-directory-index="${index}">
      <td><strong>${escapeHtml(item.clientName || "—")}</strong></td>
      <td>${Number(item.trtCount || 0).toLocaleString("ru-RU")}</td>
      <td>${Number(item.pointLinkedCount || 0).toLocaleString("ru-RU")}</td>
      <td>${escapeHtml((item.directions || []).join(", ") || "—")}</td>
      <td><select data-fdiy-mode><option value="standard"${fdiy ? "" : " selected"}>Обычный</option><option value="FDIY"${fdiy ? " selected" : ""}>FDIY</option></select></td>
      <td><input data-fdiy-network-name type="text" value="${escapeHtml(network.networkName || item.clientName || "")}" ${fdiy ? "" : "disabled"}></td>
      <td><select data-fdiy-code-mode ${fdiy ? "" : "disabled"}><option value="manual"${network.storeCodeMode === "leading_number" ? "" : " selected"}>Вручную / из файла</option><option value="leading_number"${network.storeCodeMode === "leading_number" ? " selected" : ""}>Цифры в начале названия</option></select></td>
      <td><button class="secondary-button" type="button" data-fdiy-save-rule>Сохранить</button></td>
    </tr>`;
  }).join("");
}

async function saveFdiyDirectoryRow(button) {
  const tr = button.closest("tr[data-fdiy-directory-index]"); if (!tr) return;
  const item = fdiyDirectoryState.clients[Number(tr.dataset.fdiyDirectoryIndex)]; if (!item) return;
  const mode = tr.querySelector("[data-fdiy-mode]")?.value || "standard";
  const networkName = tr.querySelector("[data-fdiy-network-name]")?.value?.trim() || item.clientName;
  const storeCodeMode = tr.querySelector("[data-fdiy-code-mode]")?.value || "manual";
  button.disabled = true;
  try {
    await api("/admin/sales-import", { method: "POST", timeout: 90000, body: JSON.stringify({
      scope: "fdiy", operation: "save_network", clientName: item.clientName, salesMode: mode,
      networkId: item.network?.networkId || "", networkName, storeCodeMode,
    }) });
    fdiyDirectoryState.loaded = false; await loadFdiyDirectory(true); showToast(mode === "FDIY" ? "Клиент отмечен как FDIY" : "Клиент переведён на обычную загрузку");
  } catch (exc) { showToast(exc?.message || String(exc)); button.disabled = false; }
}

function fdiyFindColumn(headers, aliases) {
  const normalized = headers.map((value, index) => [fdiyNorm(value), index]);
  for (const alias of aliases) {
    const key = fdiyNorm(alias); const exact = normalized.find(([value]) => value === key); if (exact) return exact[1];
  }
  return -1;
}

function fdiySelectedNetworkId() {
  const explicit = $("fdiy-network")?.value || "";
  if (explicit) return explicit;
  const active = (fdiyDirectoryState.networks || []).filter((item) => item.isActive);
  if (active.length === 1) {
    const id = String(active[0].networkId || "");
    const select = $("fdiy-network");
    if (select && id && [...select.options].some((o) => o.value === id)) select.value = id;
    return id;
  }
  return "";
}

function fdiyMetricKind(value) {
  const metric = fdiyNorm(value);
  if (!metric) return "";
  const tokens = metric.split(" ").filter(Boolean);
  if (tokens.includes("вог") || tokens.includes("vog")) return "vog";
  if (metric === "все" || metric === "всего" || metric.startsWith("общие продажи") || metric.startsWith("все продажи") || metric.startsWith("всего продаж")) return "total";
  return "";
}

function fdiyCountWidePeriods(matrix) {
  for (let r = 1; r < Math.min(matrix.length, 8); r += 1) {
    const headers = matrix[r] || [];
    const direction = fdiyFindColumn(headers, ["Направление деятельности", "Направление"]);
    const store = fdiyFindColumn(headers, ["Названия строк", "Название ТРТ", "Магазин"]);
    const address = fdiyFindColumn(headers, ["Адрес", "Адрес ТРТ"]);
    if (direction < 0 || store < 0 || address < 0) continue;
    const monthRow = matrix[r - 1] || [];
    let periods = 0;
    for (let c = Math.max(direction, store, address) + 1; c < headers.length; c += 1) {
      if (fdiyMetricKind(headers[c]) === "total" && fdiyMonthNumber(monthRow[c])) periods += 1;
    }
    return periods;
  }
  return 0;
}

function fdiyParseLongMatrix(matrix) {
  let headerIndex = -1, columns = null;
  for (let r = 0; r < Math.min(matrix.length, 8); r += 1) {
    const headers = matrix[r] || [];
    const c = {
      network: fdiyFindColumn(headers, ["Сеть", "FDIY сеть", "Network"]),
      code: fdiyFindColumn(headers, ["Код ТРТ", "Код магазина", "Номер магазина", "Store code"]),
      store: fdiyFindColumn(headers, ["Название ТРТ", "Названия строк", "Магазин", "ТРТ"]),
      address: fdiyFindColumn(headers, ["Адрес", "Адрес ТРТ"]),
      direction: fdiyFindColumn(headers, ["Направление", "Направление деятельности"]),
      year: fdiyFindColumn(headers, ["Год"]), month: fdiyFindColumn(headers, ["Месяц"]),
      total: fdiyFindColumn(headers, ["Общие продажи", "Общие продажи нат ед", "Все", "Всего"]),
      vog: fdiyFindColumn(headers, ["Продажи ВОГ", "Продажи ВОГ нат ед", "ВОГ"]),
    };
    if (c.store >= 0 && c.direction >= 0 && (c.total >= 0 || c.vog >= 0)) { headerIndex = r; columns = c; break; }
  }
  if (!columns) return null;
  const selectedNetwork = fdiySelectedNetworkId();
  if (columns.network < 0 && !selectedNetwork) throw new Error("Для файла одной FDIY-сети выберите сеть перед проверкой.");
  const selectedYear = Number($("fdiy-month-year")?.value || 0), selectedMonth = Number($("fdiy-month")?.value || 0);
  const rows = [];
  for (let r = headerIndex + 1; r < matrix.length; r += 1) {
    const src = matrix[r] || [];
    const storeName = String(src[columns.store] ?? "").trim();
    const direction = String(src[columns.direction] ?? "").trim();
    if (!storeName && !direction) continue;
    const networkRaw = columns.network >= 0 ? String(src[columns.network] ?? "").trim() : "";
    const network = fdiyResolveNetwork(networkRaw || selectedNetwork);
    const year = columns.year >= 0 && Number(src[columns.year]) ? Number(src[columns.year]) : selectedYear;
    const month = columns.month >= 0 ? (Number(src[columns.month]) || fdiyMonthNumber(src[columns.month])) : selectedMonth;
    rows.push({ rowNumber: r + 1, network: network?.networkId || networkRaw || selectedNetwork,
      storeCode: columns.code >= 0 ? String(src[columns.code] ?? "").trim() : fdiyLeadingCode(storeName),
      storeName, address: columns.address >= 0 ? String(src[columns.address] ?? "").trim() : "", direction,
      year, month, totalQuantity: columns.total >= 0 ? parseSalesQuantity(src[columns.total]) : null,
      vogQuantity: columns.vog >= 0 ? parseSalesQuantity(src[columns.vog]) : null });
  }
  return { mode: "long", rows };
}

function fdiyParseWideMatrix(matrix) {
  let headerIndex = -1, columns = null;
  for (let r = 0; r < Math.min(matrix.length, 8); r += 1) {
    const headers = matrix[r] || [];
    const direction = fdiyFindColumn(headers, ["Направление деятельности", "Направление"]);
    const store = fdiyFindColumn(headers, ["Названия строк", "Название ТРТ", "Магазин"]);
    const address = fdiyFindColumn(headers, ["Адрес", "Адрес ТРТ"]);
    if (direction >= 0 && store >= 0 && address >= 0) { headerIndex = r; columns = { direction, store, address }; break; }
  }
  if (!columns || headerIndex < 1) throw new Error("Не распознан формат FDIY. Нужны либо универсальные столбцы, либо широкая таблица с месяцами и парами Все / ВОГ.");
  const selectedNetwork = fdiySelectedNetworkId();
  if (!selectedNetwork) throw new Error("Для широкого исторического файла выберите FDIY-сеть. Если активна только одна FDIY-сеть, она должна выбираться автоматически.");
  const monthRow = matrix[headerIndex - 1] || [], metricRow = matrix[headerIndex] || [];
  let year = Number($("fdiy-start-year")?.value || 2025), lastMonth = 0, currentMonth = 0, currentYear = year;
  const periods = new Map();
  for (let c = Math.max(columns.direction, columns.store, columns.address) + 1; c < metricRow.length; c += 1) {
    const top = monthRow[c];
    if (String(top ?? "").trim()) {
      const month = fdiyMonthNumber(top);
      if (month) { if (lastMonth && month < lastMonth) currentYear += 1; currentMonth = month; lastMonth = month; }
    }
    if (!currentMonth) continue;
    const metricKind = fdiyMetricKind(metricRow[c]);
    if (!metricKind) continue;
    const key = `${currentYear}-${currentMonth}`;
    if (!periods.has(key)) periods.set(key, { year: currentYear, month: currentMonth, totalCol: -1, vogCol: -1 });
    const spec = periods.get(key);
    if (metricKind === "total") spec.totalCol = c; else spec.vogCol = c;
  }
  if (!periods.size) throw new Error("В широком FDIY файле не найдены месячные пары Все / ВОГ.");
  const vogPeriods = [...periods.values()].filter((item) => item.vogCol >= 0).length;
  const totalPeriods = [...periods.values()].filter((item) => item.totalCol >= 0).length;
  if (!vogPeriods && totalPeriods) throw new Error("В историческом FDIY-файле найдены общие продажи, но не найдены столбцы ВОГ. Загрузка остановлена, чтобы не потерять продажи ВОГ.");
  const rows = [];
  for (let r = headerIndex + 1; r < matrix.length; r += 1) {
    const src = matrix[r] || []; const storeName = String(src[columns.store] ?? "").trim(); const direction = String(src[columns.direction] ?? "").trim();
    if (!storeName && !direction) continue;
    const base = { rowNumber: r + 1, network: selectedNetwork, storeCode: fdiyLeadingCode(storeName), storeName,
      address: String(src[columns.address] ?? "").trim(), direction };
    for (const spec of periods.values()) {
      const total = spec.totalCol >= 0 ? parseSalesQuantity(src[spec.totalCol]) : null;
      const vog = spec.vogCol >= 0 ? parseSalesQuantity(src[spec.vogCol]) : null;
      if (total === null && vog === null) continue;
      rows.push({ ...base, year: spec.year, month: spec.month, totalQuantity: total, vogQuantity: vog });
    }
  }
  return { mode: "wide", rows, detectedPeriodCount: periods.size, detectedVogPeriodCount: vogPeriods, detectedTotalPeriodCount: totalPeriods };
}

function fdiyLooksWideMatrix(matrix) {
  for (let r = 1; r < Math.min(matrix.length, 8); r += 1) {
    const headers = matrix[r] || [];
    const direction = fdiyFindColumn(headers, ["Направление деятельности", "Направление"]);
    const store = fdiyFindColumn(headers, ["Названия строк", "Название ТРТ", "Магазин"]);
    const address = fdiyFindColumn(headers, ["Адрес", "Адрес ТРТ"]);
    if (direction < 0 || store < 0 || address < 0) continue;
    const monthRow = matrix[r - 1] || [];
    let monthCells = 0, metricCells = 0;
    for (let c = Math.max(direction, store, address) + 1; c < headers.length; c += 1) {
      if (fdiyMonthNumber(monthRow[c])) monthCells += 1;
      if (fdiyMetricKind(headers[c])) metricCells += 1;
    }
    // Исторический широкий файл имеет отдельную строку месяцев и повторяющиеся пары Все / ВОГ.
    // Не даём первой паре ошибочно превратить такой файл в месячный формат.
    if (monthCells >= 2 && metricCells >= 4) return true;
  }
  return false;
}

async function readFdiyFile(file) {
  if (!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  if (!workbook.SheetNames?.length) throw new Error("В файле нет листов.");

  const candidates = [];
  const errors = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
    if (!matrix.length) continue;
    try {
      const detectedWidePeriods = fdiyCountWidePeriods(matrix);
      const looksWide = detectedWidePeriods >= 2 || fdiyLooksWideMatrix(matrix);
      const parsed = looksWide ? fdiyParseWideMatrix(matrix) : fdiyParseLongMatrix(matrix);
      if (!parsed?.rows?.length) continue;
      if (detectedWidePeriods >= 2 && parsed.mode !== "wide") {
        throw new Error(`Лист содержит ${detectedWidePeriods} месяцев, но был распознан как месячный.`);
      }
      const totalValueCount = parsed.rows.filter((row) => row.totalQuantity !== null && row.totalQuantity !== undefined).length;
      const vogValueCount = parsed.rows.filter((row) => row.vogQuantity !== null && row.vogQuantity !== undefined).length;
      const periodCount = new Set(parsed.rows.map((row) => `${row.year}|${row.month}`)).size;
      const score = (looksWide ? 1000000 : 0) + (periodCount * 10000) + parsed.rows.length + (vogValueCount ? 500000 : 0);
      candidates.push({
        ...parsed,
        detectedPeriodCount: parsed.detectedPeriodCount || detectedWidePeriods || periodCount || 1,
        totalValueCount,
        vogValueCount,
        sheetName,
        score,
      });
    } catch (exc) {
      errors.push(`${sheetName}: ${exc?.message || String(exc)}`);
    }
  }

  if (!candidates.length) {
    const details = errors.length ? ` ${errors.slice(0, 3).join(" ")}` : "";
    throw new Error(`Не распознан формат FDIY файла.${details}`);
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.mode === "wide" && Number(best.detectedVogPeriodCount || 0) === 0 && best.totalValueCount > 0) {
    throw new Error("В историческом FDIY-файле не распознаны столбцы ВОГ. Загрузка остановлена.");
  }
  return best;
}

function resetFdiyImport(clearFile = true) {
  fdiyImportState = { rows: [], preview: null, fileName: "", mode: "", sourceSheet: "", historical: false, detectedPeriodCount: 0 };
  if ($("fdiy-result")) $("fdiy-result").hidden = true;
  if ($("fdiy-error")) $("fdiy-error").hidden = true;
  if ($("fdiy-progress")) $("fdiy-progress").hidden = true;
  if ($("fdiy-format-note")) $("fdiy-format-note").hidden = true;
  if ($("fdiy-commit")) $("fdiy-commit").disabled = true;
  if (clearFile && $("fdiy-file")) $("fdiy-file").value = "";
  updateFdiyPreviewButton();
}

function updateFdiyPreviewButton() {
  if ($("fdiy-preview")) $("fdiy-preview").disabled = !isSystemAdmin() || !$("fdiy-file")?.files?.[0];
}

function fdiyStatusBadge(row) {
  const status = String(row.status || "").toLowerCase();
  if (status === "matched" && !row.pointId) return '<span class="badge warning">Master найден</span>';
  if (status === "matched") return '<span class="badge success">Сопоставлено</span>';
  if (status === "ambiguous") return '<span class="badge warning">Несколько ТРТ</span>';
  if (status === "skipped") return '<span class="badge inactive">Нет данных</span>';
  if (status === "invalid") return '<span class="badge danger">Ошибка</span>';
  return '<span class="badge danger">Не найдено</span>';
}

function renderFdiyPreview(payload) {
  fdiyImportState.preview = payload; const s = payload.summary || {};
  const set = (id, value) => { if ($(id)) $(id).textContent = Number(value || 0).toLocaleString("ru-RU"); };
  set("fdiy-summary-networks", s.networkCount); set("fdiy-summary-stores", s.storeCount); set("fdiy-summary-values", s.monthlyValues);
  set("fdiy-summary-matched", s.matchedValues); set("fdiy-summary-point", s.pointLinkedStoreCount); set("fdiy-summary-unmatched", s.unmatchedValues);
  set("fdiy-summary-invalid", s.invalidValues); set("fdiy-summary-periods", s.periodCount);
  const conflicts = payload.periodsExisting || [], conflict = $("fdiy-conflict-warning");
  if (conflict) {
    conflict.hidden = !conflicts.length;
    if (conflicts.length) {
      const prefix = `Уже загружены: ${conflicts.slice(0, 12).map((x) => `${x.networkName || x.networkId} · ${x.month}.${x.year} · ${x.direction}`).join("; ")}${conflicts.length > 12 ? ` и ещё ${conflicts.length - 12}` : ""}.`;
      conflict.textContent = fdiyImportState.historical
        ? `${prefix} Историческая загрузка продолжится с отсутствующих периодов; уже загруженные будут пропущены.`
        : `${prefix} Для месячной загрузки перед заменой будет запрошено подтверждение.`;
    } else conflict.textContent = "";
  }
  const warning = $("fdiy-data-warning");
  if (warning) { const parts = []; if (Number(s.warningValues || 0)) parts.push(`Предупреждений: ${Number(s.warningValues).toLocaleString("ru-RU")} (в т.ч. отрицательные корректировки или Master без point_id).`); if (Number(s.unmatchedValues || 0)) parts.push(`Несопоставленные значения не будут записаны: ${Number(s.unmatchedValues).toLocaleString("ru-RU")}.`); warning.hidden = !parts.length; warning.textContent = parts.join(" "); }
  if ($("fdiy-table-body")) $("fdiy-table-body").innerHTML = (payload.rows || []).slice(0, 400).map((row) => `<tr>
    <td>${escapeHtml(row.rowNumber)}</td><td>${escapeHtml(row.networkName || row.networkId || "—")}</td><td>${escapeHtml(row.storeCode || "—")}</td>
    <td><strong>${escapeHtml(row.storeName || "—")}</strong><small>${escapeHtml(row.address || "")}</small></td><td>${escapeHtml(row.direction || "—")}</td>
    <td>${escapeHtml(row.masterId || "—")}<small>${escapeHtml(row.matchMethod || row.message || "")}</small></td><td>${escapeHtml(row.pointId || "—")}</td><td>${fdiyStatusBadge(row)}</td></tr>`).join("");
  if ($("fdiy-result")) $("fdiy-result").hidden = false;
  if ($("fdiy-commit")) {
    const commitButton = $("fdiy-commit");
    commitButton.disabled = Number(s.matchedValues || 0) === 0 || Number(s.invalidValues || 0) > 0;
    const totalPeriods = Number(s.periodCount || 0);
    const existingCount = conflicts.length;
    commitButton.textContent = fdiyImportState.historical && existingCount > 0 && existingCount < totalPeriods
      ? `Продолжить загрузку (${Math.max(0, totalPeriods - existingCount)})`
      : "Загрузить FDIY продажи";
  }
}

async function previewFdiyImport() {
  const file = $("fdiy-file")?.files?.[0]; if (!file) return;
  const error = $("fdiy-error"), progress = $("fdiy-progress"), button = $("fdiy-preview");
  if (error) error.hidden = true; if (progress) { progress.hidden = false; progress.textContent = "Чтение и проверка FDIY…"; } button.disabled = true;
  try {
    if (!fdiyDirectoryState.loaded) await loadFdiyDirectory();
    const parsed = await readFdiyFile(file);
    fdiyImportState = { rows: parsed.rows, preview: null, fileName: file.name, mode: parsed.mode, sourceSheet: parsed.sheetName, historical: Number(parsed.detectedPeriodCount || 0) > 1, detectedPeriodCount: Number(parsed.detectedPeriodCount || 0) };
    const formatNote = $("fdiy-format-note");
    if (formatNote) {
      const networkId = fdiySelectedNetworkId();
      const network = (fdiyDirectoryState.networks || []).find((item) => String(item.networkId || "") === String(networkId || ""));
      const formatLabel = Number(parsed.detectedPeriodCount || 0) > 1
        ? (parsed.mode === "wide" ? "исторический широкий" : "исторический длинный")
        : "месячный";
      formatNote.textContent = `Распознан формат: ${formatLabel} · лист: ${parsed.sheetName || "—"} · месяцев: ${parsed.detectedPeriodCount || 1} · общих значений: ${Number(parsed.totalValueCount || 0).toLocaleString("ru-RU")} · ВОГ значений: ${Number(parsed.vogValueCount || 0).toLocaleString("ru-RU")}${network ? ` · сеть: ${network.networkName || network.clientName}` : ""} · Web ${VOG_WEB_VERSION}`;
      formatNote.hidden = false;
    }
    const payload = await api("/admin/sales-import", { method: "POST", timeout: 90000, body: JSON.stringify({ scope: "fdiy", operation: "preview", rows: parsed.rows }) });
    renderFdiyPreview(payload); if (progress) progress.hidden = true;
  } catch (exc) { if (error) { error.textContent = exc?.message || String(exc); error.hidden = false; } if (progress) progress.hidden = true; }
  finally { updateFdiyPreviewButton(); }
}

function fdiyPeriodKey(row) { return `${String(row.network || row.networkId || "")}|${Number(row.year)}|${Number(row.month)}|${fdiyNorm(row.direction)}`; }

function fdiySleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fdiyCommitPeriodWithRetry(payload, progress, position, total) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (progress) progress.textContent = attempt === 1
        ? `Загрузка FDIY: ${position} / ${total}…`
        : `Загрузка FDIY: ${position} / ${total} · повтор ${attempt - 1} / 2…`;
      return await api("/admin/sales-import", {
        method: "POST", timeout: 90000,
        body: JSON.stringify(payload),
      });
    } catch (exc) {
      lastError = exc;
      if (attempt >= 3) break;
      await fdiySleep(attempt * 1200);
    }
  }
  throw lastError || new Error("Не удалось сохранить период FDIY");
}

async function fdiyCommitBatchWithRetry(entriesChunk, basePayload, progress, batchPosition, batchTotal, periodsDone, periodsTotal) {
  const rows = entriesChunk.flatMap(([, groupRows]) => groupRows);
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (progress) progress.textContent = attempt === 1
        ? `Быстрая загрузка/исправление FDIY: пакет ${batchPosition} / ${batchTotal} · периодов ${periodsDone} / ${periodsTotal}…`
        : `Быстрая загрузка/исправление FDIY: пакет ${batchPosition} / ${batchTotal} · повтор…`;
      return await api("/admin/sales-import", {
        method: "POST", timeout: 90000,
        body: JSON.stringify({ ...basePayload, rows }),
      });
    } catch (exc) {
      lastError = exc;
      if (attempt < 2) await fdiySleep(900);
    }
  }
  throw lastError || new Error("Не удалось сохранить пакет FDIY");
}

async function fdiyCommitBatchAdaptive(entriesChunk, basePayload, progress, stats, batchLabel) {
  try {
    const result = await fdiyCommitBatchWithRetry(
      entriesChunk, basePayload, progress,
      batchLabel.position, batchLabel.total,
      stats.periodsProcessed + entriesChunk.length, stats.periodsTotal,
    );
    stats.stored += Number(result?.storedValues || 0);
    stats.uploadedPeriods += Number(result?.periodCount || 0);
    stats.skippedDuringRetry += Number(result?.skippedExistingPeriods || 0);
    stats.periodsProcessed += entriesChunk.length;
    return;
  } catch (exc) {
    // If a larger packet hits a transient timeout, split it automatically instead of
    // forcing the user to restart the whole historical import.
    if (entriesChunk.length <= 1) throw exc;
    const mid = Math.ceil(entriesChunk.length / 2);
    const left = entriesChunk.slice(0, mid);
    const right = entriesChunk.slice(mid);
    if (progress) progress.textContent = `Пакет ответа не дождался — делю его на части (${left.length} + ${right.length})…`;
    await fdiyCommitBatchAdaptive(left, { ...basePayload, requestId: `${basePayload.requestId}-a` }, progress, stats, batchLabel);
    await fdiyCommitBatchAdaptive(right, { ...basePayload, requestId: `${basePayload.requestId}-b` }, progress, stats, batchLabel);
  }
}

async function commitFdiyImport() {
  const preview = fdiyImportState.preview || {};
  const conflicts = preview.periodsExisting || [];
  if (!fdiyImportState.rows.length) return;
  if (Number(preview.summary?.invalidValues || 0) > 0) return showToast("Сначала исправьте ошибки FDIY файла");

  const conflictKeys = new Set(conflicts.map((x) => `${x.networkId}|${Number(x.year)}|${Number(x.month)}|${fdiyNorm(x.direction)}`));
  const groups = new Map();
  for (const row of fdiyImportState.rows) {
    const key = fdiyPeriodKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const allEntries = [...groups.entries()];
  const isHistorical = fdiyImportState.historical || allEntries.length > 2;
  let replaceExisting = false;
  let entries = allEntries;
  let skippedAlready = 0;

  if (conflicts.length) {
    if (isHistorical && conflicts.length < allEntries.length) {
      entries = allEntries.filter(([key]) => !conflictKeys.has(key));
      skippedAlready = allEntries.length - entries.length;
    } else {
      const labels = conflicts.slice(0, 10).map((x) => `«${x.networkName || x.networkId}» · ${x.month}.${x.year} · ${x.direction}`).join("\n");
      const question = isHistorical
        ? `Все или почти все периоды этого исторического файла уже загружены:\n${labels}${conflicts.length > 10 ? `\n…и ещё ${conflicts.length - 10}` : ""}\n\nЗаменить существующие периоды новой версией?`
        : `Данные уже загружены:\n${labels}${conflicts.length > 10 ? `\n…и ещё ${conflicts.length - 10}` : ""}\n\nИсправить на новые? Будут заменены только перечисленные сеть/месяц/направление.`;
      if (!window.confirm(question)) return;
      replaceExisting = true;
    }
  }

  const button = $("fdiy-commit"), progress = $("fdiy-progress"), error = $("fdiy-error");
  button.disabled = true;
  if (error) error.hidden = true;
  if (progress) {
    progress.hidden = false;
    progress.textContent = skippedAlready
      ? `Продолжение FDIY: ${skippedAlready} уже загружено, осталось ${entries.length} периодов…`
      : `Подготовка загрузки FDIY: ${entries.length} периодов…`;
  }

  if (!entries.length) {
    if (progress) progress.textContent = `Готово. Все ${skippedAlready || allEntries.length} периодов уже загружены.`;
    button.textContent = "Все периоды загружены";
    return;
  }

  const sessionId = `fdiy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let stored = 0, uploadedPeriods = 0, skippedDuringRetry = 0;
  try {
    if (isHistorical) {
      // Historical import and historical correction both use multi-period packets.
      // This is critical for recovery/overwrite: replacing 38 periods must not fall back
      // to 38 slow sequential Cloud Function calls.
      const chunkSize = 6;
      const chunks = [];
      for (let i = 0; i < entries.length; i += chunkSize) chunks.push(entries.slice(i, i + chunkSize));
      const stats = {
        stored: 0, uploadedPeriods: 0, skippedDuringRetry: 0,
        periodsProcessed: 0, periodsTotal: entries.length,
      };
      for (let i = 0; i < chunks.length; i += 1) {
        if (button) button.textContent = `Загрузка пакета ${i + 1} / ${chunks.length}`;
        await fdiyCommitBatchAdaptive(chunks[i], {
          scope: "fdiy",
          operation: "commit_batch_resumable",
          fileName: fdiyImportState.fileName,
          replace: replaceExisting,
          skipExisting: !replaceExisting,
          requestId: `${sessionId}-b${String(i + 1).padStart(2, "0")}`,
        }, progress, stats, { position: i + 1, total: chunks.length });
      }
      stored = stats.stored;
      uploadedPeriods = stats.uploadedPeriods;
      skippedDuringRetry = stats.skippedDuringRetry;
    } else {
      // Monthly corrections remain deliberately one period per request so the overwrite
      // confirmation semantics stay precise.
      for (let i = 0; i < entries.length; i += 1) {
        const [key, rows] = entries[i];
        const requestId = `${sessionId}-p${String(i + 1).padStart(3, "0")}`;
        const result = await fdiyCommitPeriodWithRetry({
          scope: "fdiy",
          operation: "commit_resumable",
          fileName: fdiyImportState.fileName,
          rows,
          replace: replaceExisting && conflictKeys.has(key),
          skipExisting: isHistorical && !replaceExisting,
          requestId,
        }, progress, i + 1, entries.length);
        if (result?.skippedExisting) skippedDuringRetry += 1;
        else {
          stored += Number(result?.storedValues || 0);
          uploadedPeriods += 1;
        }
        if (button) button.textContent = `Загрузка ${i + 1} / ${entries.length}`;
      }
    }

    const totalSkipped = skippedAlready + skippedDuringRetry;
    if (progress) progress.textContent = `Готово. Добавлено периодов: ${uploadedPeriods}; уже было загружено: ${totalSkipped}; сохранено значений: ${stored.toLocaleString("ru-RU")}.`;
    if (button) { button.textContent = "Загрузка завершена"; button.disabled = true; }
    state.trtLoaded = false;
    state.marketAnalysis.loaded = false;
    showToast("FDIY продажи загружены");
  } catch (exc) {
    if (error) {
      error.textContent = `${exc?.message || String(exc)} Загрузка остановлена. Уже сохранённые периоды не потеряны — нажмите «Продолжить загрузку» ещё раз.`;
      error.hidden = false;
    }
    if (progress) progress.textContent = `Загрузка приостановлена. Повторный запуск продолжит с оставшихся периодов.`;
    if (button) { button.disabled = false; button.textContent = "Продолжить загрузку"; }
  }
}

function downloadFdiyTemplate() {
  if (!window.XLSX) return showToast("Модуль Excel не загрузился");
  const wb = XLSX.utils.book_new();
  const headers = ["Сеть","Код ТРТ","Название ТРТ","Адрес","Направление","Год","Месяц","Общие продажи","Продажи ВОГ"];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), "FDIY продажи");
  const help = [
    ["Правило","Описание"],
    ["Одна сеть","Можно выбрать сеть на сайте и оставить столбец «Сеть» пустым."],
    ["Несколько сетей","Заполните столбец «Сеть» для каждой строки."],
    ["Период","Если Год/Месяц пусты в месячном файле, используется период, выбранный на сайте."],
    ["Продажи","«Продажи ВОГ» входят в «Общие продажи». Пустое значение сохраняется как отсутствие данных, не как 0."],
    ["Повторная загрузка","Заменяется только конкретная сеть + месяц + направление после подтверждения."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), "Инструкция");
  XLSX.writeFile(wb, "VOG_FDIY_Шаблон_месячной_загрузки.xlsx");
}


function setDataImportTab(tab) {
  const allowed = ["sales", "trt-plan", "diy-sellout", "fdiy", "trt-new", "tile-scenario"];
  const next = allowed.includes(tab) ? tab : "sales";
  document.querySelectorAll("[data-import-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.importTab === next);
    button.setAttribute("aria-selected", button.dataset.importTab === next ? "true" : "false");
  });
  document.querySelectorAll("[data-import-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.importPanel !== next;
  });
}

function analysisPanel(kind) {
  return document.querySelector(`[data-analysis-import="${kind}"]`);
}

function resetAnalysisImport(kind, clearFile = true) {
  const panel = analysisPanel(kind);
  if (!panel) return;
  ANALYSIS_IMPORT_STATE[kind] = { rows: [], preview: null, fileName: "" };
  panel.querySelector("[data-analysis-result]").hidden = true;
  panel.querySelector("[data-analysis-error]").hidden = true;
  panel.querySelector("[data-analysis-progress]").hidden = true;
  panel.querySelector("[data-analysis-commit]").disabled = true;
  if (clearFile) panel.querySelector("[data-analysis-file]").value = "";
  updateAnalysisPreviewButton(kind);
}

function updateAnalysisPreviewButton(kind) {
  const panel = analysisPanel(kind);
  if (!panel) return;
  const file = panel.querySelector("[data-analysis-file]")?.files?.[0];
  const button = panel.querySelector("[data-analysis-preview]");
  if (button) button.disabled = !file || !isSystemAdmin();
}

function parseAnalysisMonthValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { year: value.getFullYear(), month: value.getMonth() + 1, normalized: `${value.getMonth() + 1} ${value.getFullYear()}` };
  }
  if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
    const decoded = XLSX.SSF.parse_date_code(value);
    if (decoded?.y && decoded?.m && decoded.y >= 2020 && decoded.y <= 2100) {
      return { year: Number(decoded.y), month: Number(decoded.m), normalized: `${decoded.m} ${decoded.y}` };
    }
  }
  return parseAnalysisMonthHeader(value);
}

function analysisHeaderIndex(row, aliases) {
  const cells = Array.isArray(row) ? row : [];
  const normalizedAliases = aliases.map(normalizeAnalysisHeader);
  for (let index = 0; index < cells.length; index += 1) {
    const key = normalizeAnalysisHeader(cells[index]);
    if (!key) continue;
    if (normalizedAliases.some((alias) => key === alias || key.includes(alias) || alias.includes(key))) return index;
  }
  return -1;
}

function analysisDetectHeaderRow(rows, kind) {
  const max = Math.min(rows.length, 10);
  for (let index = 0; index < max; index += 1) {
    const row = rows[index] || [];
    const direction = analysisHeaderIndex(row, ["Направление", "Направление деятельности", "Направление деятельности плитка или обои"]);
    const address = analysisHeaderIndex(row, ["Адрес"]);
    if (kind === "trt_plan") {
      const client = analysisHeaderIndex(row, ["Клиент", "Холдинг"]);
      const trt = analysisHeaderIndex(row, ["Название ТРТ", "ТРТ", "Торговая точка"]);
      if (direction >= 0 && client >= 0 && trt >= 0) return index;
    } else {
      const network = analysisHeaderIndex(row, ["Магазин сеть", "Магазин", "Сеть DIY", "Сеть"]);
      if (direction >= 0 && network >= 0 && address >= 0) return index;
    }
  }
  return -1;
}

async function readAnalysisImportFile(file, kind) {
  if (!window.XLSX) throw new Error("Модуль чтения Excel не загрузился. Обновите страницу и повторите попытку.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const preferred = kind === "trt_plan" ? "Планы ТРТ" : "DIY sell-out";
  const sheetName = workbook.SheetNames.includes(preferred) ? preferred : workbook.SheetNames[0];
  if (!sheetName) throw new Error("В Excel-файле нет листов.");
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
  if (!matrix.length) throw new Error(`На листе «${sheetName}» нет строк с данными.`);
  const headerRowIndex = analysisDetectHeaderRow(matrix, kind);
  if (headerRowIndex < 0) throw new Error("Не удалось определить строку заголовков. Проверьте первые строки файла.");
  const headers = matrix[headerRowIndex] || [];

  if (kind === "trt_plan") {
    const directionCol = analysisHeaderIndex(headers, ["Направление", "Направление деятельности"]);
    const managerCol = analysisHeaderIndex(headers, ["Менеджер", "Менеджнр"]);
    const clientCol = analysisHeaderIndex(headers, ["Клиент", "Холдинг"]);
    const trtCol = analysisHeaderIndex(headers, ["Название ТРТ", "ТРТ", "Торговая точка", "Торговая точка Месторасположение"]);
    const addressCol = analysisHeaderIndex(headers, ["Адрес"]);
    const missing = [[directionCol,"Направление"],[clientCol,"Клиент"],[trtCol,"Название ТРТ"]].filter(([col]) => col < 0).map(([,label]) => label);
    if (missing.length) throw new Error(`Не найдены обязательные столбцы: ${missing.join(", ")}.`);
    const monthColumns = headers.map((header, column) => ({ column, parsed: parseAnalysisMonthValue(header) })).filter((item) => item.parsed);
    if (!monthColumns.length) throw new Error("Не найдены месячные столбцы (например «Январь 26» или дата 01.01.2026).");
    // v8.14: keep one browser row per source TRT and put monthly values inside it.
    // The previous implementation expanded every TRT into 7+ JSON rows before the
    // request, which made normal files unnecessarily large for API Gateway.
    const rows = [];
    for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
      const row = matrix[rowIndex] || [];
      const trtName = String(row[trtCol] ?? "").trim();
      const client = String(row[clientCol] ?? "").trim();
      if (!trtName && !client) continue;
      const months = [];
      monthColumns.forEach(({ column, parsed }) => {
        const quantity = row[column];
        if (quantity === "" || quantity === null || quantity === undefined) return;
        months.push({ year: parsed.year, month: parsed.month, quantity });
      });
      if (!months.length) continue;
      rows.push({
        rowNumber: rowIndex + 1,
        direction: String(row[directionCol] ?? "").trim(),
        manager: managerCol >= 0 ? String(row[managerCol] ?? "").trim() : "",
        client, trtName,
        address: addressCol >= 0 ? String(row[addressCol] ?? "").trim() : "",
        months,
      });
    }
    if (!rows.length) throw new Error("В месячных столбцах нет значений плана.");
    return rows;
  }

  const directionCol = analysisHeaderIndex(headers, ["Направление деятельности", "Направление", "Направление деятельности плитка или обои"]);
  const networkCol = analysisHeaderIndex(headers, ["Магазин сеть", "Магазин", "Сеть DIY", "Сеть"]);
  const addressCol = analysisHeaderIndex(headers, ["Адрес"]);
  const missing = [[directionCol,"Направление деятельности"],[networkCol,"Магазин"],[addressCol,"Адрес"]].filter(([col]) => col < 0).map(([,label]) => label);
  if (missing.length) throw new Error(`Не найдены обязательные столбцы: ${missing.join(", ")}.`);

  const secondHeader = matrix[headerRowIndex + 1] || [];
  const hasMetricRow = secondHeader.some((value) => /общие продажи|продажи вог|vog/.test(normalizeAnalysisHeader(value)));
  const monthPairs = new Map();
  let carriedMonth = null;
  const maxCols = Math.max(headers.length, secondHeader.length);
  for (let column = 0; column < maxCols; column += 1) {
    const monthHere = parseAnalysisMonthValue(headers[column]);
    if (monthHere) carriedMonth = monthHere;
    const parsed = monthHere || carriedMonth;
    if (!parsed) continue;
    const metricText = normalizeAnalysisHeader(hasMetricRow ? secondHeader[column] : headers[column]);
    const flatText = normalizeAnalysisHeader(`${headers[column] ?? ""} ${secondHeader[column] ?? ""}`);
    const key = `${parsed.year}-${parsed.month}`;
    if (!monthPairs.has(key)) monthPairs.set(key, { year: parsed.year, month: parsed.month, total: -1, vog: -1 });
    const item = monthPairs.get(key);
    const sourceText = metricText || flatText;
    if (/общие продажи|общий объем|всего/.test(sourceText)) item.total = column;
    if (/продажи вог|вог нат|vog/.test(sourceText)) item.vog = column;
  }
  const pairs = [...monthPairs.values()].filter((item) => item.total >= 0 || item.vog >= 0);
  if (!pairs.length) throw new Error("Не найдены месячные пары «Общие продажи» / «Продажи ВОГ».");
  const incomplete = pairs.filter((item) => item.total < 0 || item.vog < 0);
  if (incomplete.length) throw new Error("Для некоторых месяцев найдена только одна колонка из пары: общие продажи / продажи ВОГ.");

  // v8.14: one browser row per DIY store; months remain nested until the API.
  const rows = [];
  const dataStart = headerRowIndex + (hasMetricRow ? 2 : 1);
  for (let rowIndex = dataStart; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const network = String(row[networkCol] ?? "").trim();
    const address = String(row[addressCol] ?? "").trim();
    if (!network && !address) continue;
    const months = [];
    pairs.forEach((item) => {
      const totalQuantity = row[item.total];
      const vogQuantity = row[item.vog];
      if ([totalQuantity, vogQuantity].every((value) => value === "" || value === null || value === undefined)) return;
      months.push({ year: item.year, month: item.month, totalQuantity, vogQuantity });
    });
    if (!months.length) continue;
    rows.push({
      rowNumber: rowIndex + 1,
      direction: String(row[directionCol] ?? "").trim(), network, address, months,
    });
  }
  if (!rows.length) throw new Error("В месячных столбцах DIY sell-out нет данных.");
  return rows;
}

function formatAnalysisNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : "—";
}

function analysisStatusBadge(row) {
  if (row.status === "matched") return '<span class="badge success">Сопоставлено</span>';
  if (row.status === "skipped") return '<span class="badge neutral">Пропуск</span>';
  return '<span class="badge danger">Проверить</span>';
}

function analysisPeriodLabel(year, month) {
  return `${SALES_IMPORT_MONTHS[Number(month) - 1] || month} ${year}`;
}


function analysisManualCandidates(row) {
  const direction = marketDirectionKey(row.direction);
  const sourceAddress = normalizeText(row.sourceAddress || row.address || "");
  const sourceName = normalizeText(row.trtName || row.network || row.client || "");
  const addressTokens = new Set(sourceAddress.split(/\s+/).filter((token) => token.length >= 3));
  const nameTokens = new Set(sourceName.split(/\s+/).filter((token) => token.length >= 3));
  return state.trtPoints.filter((point) => marketDirectionKey(point.direction) === direction).map((point) => {
    const address = normalizeText(point.address || "");
    const names = normalizeText(`${trtDisplayName(point)} ${point.holding || ""}`);
    let score = sourceAddress && address === sourceAddress ? 100 : 0;
    addressTokens.forEach((token) => { if (address.includes(token)) score += 4; });
    nameTokens.forEach((token) => { if (names.includes(token)) score += 2; });
    return { point, score };
  }).sort((a,b) => b.score - a.score || trtDisplayName(a.point).localeCompare(trtDisplayName(b.point), "ru")).slice(0, 60);
}

function analysisManualMatchControl(kind, row) {
  if (["matched", "skipped", "invalid"].includes(String(row.status || ""))) return "";
  const options = analysisManualCandidates(row).map(({ point, score }) => `<option value="${escapeHtml(point.id)}">${escapeHtml(trtDisplayName(point))} — ${escapeHtml(point.address || "без адреса")}${score ? ` · ${score}` : ""}</option>`).join("");
  return `<select class="analysis-manual-match-select" data-analysis-manual-select="${escapeHtml(kind)}" data-source-row="${escapeHtml(row.rowNumber)}"><option value="">Выбрать ТРТ вручную…</option>${options}</select>`;
}


const ANALYSIS_PREVIEW_CHUNK_SIZE = 25;
const ANALYSIS_COMMIT_CHUNK_SIZE = 25;

function analysisChunkArray(items, size) {
  const source = Array.isArray(items) ? items : [];
  const chunks = [];
  for (let index = 0; index < source.length; index += size) chunks.push(source.slice(index, index + size));
  return chunks;
}

function analysisSourcePeriods(kind, rows) {
  const result = [];
  const seen = new Set();
  (rows || []).forEach((row) => {
    const direction = marketDirectionKey(row.direction);
    (row.months || []).forEach((item) => {
      const year = Number(item.year);
      const month = Number(item.month);
      if (!year || !month) return;
      const key = kind === "trt_plan" ? `${year}-${month}-${direction}` : `${year}-${month}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(kind === "trt_plan" ? { year, month, direction } : { year, month });
    });
  });
  return result;
}

function mergeAnalysisPreviewPayloads(kind, payloads, periodsExisting, sourceRows) {
  const summary = {
    totalRows: 0, matchedRows: 0, unmatchedRows: 0, invalidRows: 0, skippedRows: 0,
    totalQuantity: 0, vogQuantity: 0, negativeNormalizedRows: 0,
    periodCount: analysisSourcePeriods(kind, sourceRows).length,
    sourceRowCount: Array.isArray(sourceRows) ? sourceRows.length : 0,
  };
  const rows = [];
  let monthlyRows = 0;
  (payloads || []).forEach((payload) => {
    const part = payload?.summary || {};
    ["totalRows","matchedRows","unmatchedRows","invalidRows","skippedRows","totalQuantity","vogQuantity","negativeNormalizedRows"].forEach((key) => {
      summary[key] += Number(part[key] || 0);
    });
    rows.push(...(Array.isArray(payload?.rows) ? payload.rows : []));
    monthlyRows += Number(payload?.transport?.monthlyRows || 0);
  });
  summary.actualShare = summary.totalQuantity > 0 ? Math.round(summary.vogQuantity / summary.totalQuantity * 10000) / 100 : 0;
  return {
    kind,
    periodsExisting: Array.isArray(periodsExisting) ? periodsExisting : [],
    summary,
    rows,
    previewRowCount: rows.length,
    transport: {
      protocol: "compact-months-v2-batched",
      sourceRows: summary.sourceRowCount,
      monthlyRows,
      chunks: (payloads || []).length,
    },
  };
}

async function requestAnalysisPreviewBatched(kind, fileName, rows, progress) {
  const chunks = analysisChunkArray(rows, ANALYSIS_PREVIEW_CHUNK_SIZE);
  const payloads = [];
  for (let index = 0; index < chunks.length; index += 1) {
    if (progress) progress.textContent = `Проверка файла… ${index + 1} / ${chunks.length}`;
    const payload = await api("/admin/sales-import", {
      method: "POST",
      timeout: 90000,
      body: JSON.stringify({
        scope: "market_analysis",
        operation: "preview",
        kind,
        fileName,
        checkPeriods: false,
        rows: chunks[index],
      }),
    });
    payloads.push(payload);
  }
  if (progress) progress.textContent = "Проверка периодов…";
  const periodPayload = await api("/admin/sales-import", {
    method: "POST",
    timeout: 60000,
    body: JSON.stringify({
      scope: "market_analysis",
      operation: "periods",
      kind,
      periods: analysisSourcePeriods(kind, rows),
    }),
  });
  return mergeAnalysisPreviewPayloads(kind, payloads, periodPayload?.periodsExisting || [], rows);
}

function analysisPreviewMatchMap(item) {
  const result = new Map();
  (item?.preview?.rows || []).forEach((row) => {
    const key = `${Number(row.rowNumber || 0)}|${marketDirectionKey(row.direction)}`;
    if (row.status === "matched" && row.pointId) result.set(key, String(row.pointId));
  });
  return result;
}

function analysisResolvedRowsForCommit(kind, item) {
  const matched = analysisPreviewMatchMap(item);
  return (item?.rows || []).map((row) => {
    const key = `${Number(row.rowNumber || 0)}|${marketDirectionKey(row.direction)}`;
    const resolvedPointId = matched.get(key);
    if (!resolvedPointId) return null;
    return { ...row, resolvedPointId };
  }).filter(Boolean);
}

function analysisCommitChunks(kind, rows) {
  if (kind !== "trt_plan") return analysisChunkArray(rows, ANALYSIS_COMMIT_CHUNK_SIZE);
  const groups = new Map();
  (rows || []).forEach((row) => {
    const key = `${marketDirectionKey(row.direction)}|${row.resolvedPointId || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const chunks = [];
  let current = [];
  for (const group of groups.values()) {
    if (current.length && current.length + group.length > ANALYSIS_COMMIT_CHUNK_SIZE) {
      chunks.push(current);
      current = [];
    }
    current.push(...group);
    if (current.length >= ANALYSIS_COMMIT_CHUNK_SIZE) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function mergeAnalysisCommitPeriods(kind, responses) {
  const map = new Map();
  (responses || []).forEach((response) => {
    (response?.periods || []).forEach((item) => {
      const direction = marketDirectionKey(item.direction);
      const key = kind === "trt_plan" ? `${item.year}-${item.month}-${direction}` : `${item.year}-${item.month}`;
      const current = map.get(key) || {
        year: Number(item.year), month: Number(item.month),
        direction: kind === "trt_plan" ? direction : "",
        rowCount: 0, totalQuantity: 0, vogQuantity: 0,
      };
      current.rowCount += Number(item.rowCount || 0);
      current.totalQuantity += Number(item.totalQuantity || 0);
      current.vogQuantity += Number(item.vogQuantity || 0);
      map.set(key, current);
    });
  });
  return [...map.values()];
}

async function repreviewAnalysisImport(kind) {
  const panel = analysisPanel(kind); const item = ANALYSIS_IMPORT_STATE[kind];
  if (!panel || !item.rows.length) return;
  const progress = panel.querySelector("[data-analysis-progress]"); const error = panel.querySelector("[data-analysis-error]");
  error.hidden = true; progress.hidden = false;
  try {
    const payload = await requestAnalysisPreviewBatched(kind, item.fileName, item.rows, progress);
    renderAnalysisImportPreview(kind, payload);
  } catch (err) { error.textContent = err.message; error.hidden = false; }
  finally { progress.hidden = true; progress.textContent = "Проверка файла…"; }
}

function renderAnalysisImportPreview(kind, payload) {
  const panel = analysisPanel(kind);
  if (!panel) return;
  ANALYSIS_IMPORT_STATE[kind].preview = payload;
  const summary = payload.summary || {};
  panel.querySelector("[data-analysis-total-rows]").textContent = formatAnalysisNumber(summary.totalRows);
  panel.querySelector("[data-analysis-matched-rows]").textContent = formatAnalysisNumber(summary.matchedRows);
  panel.querySelector("[data-analysis-unmatched-rows]").textContent = formatAnalysisNumber(summary.unmatchedRows);
  panel.querySelector("[data-analysis-invalid-rows]").textContent = formatAnalysisNumber(summary.invalidRows);
  const periodCount = panel.querySelector("[data-analysis-period-count]");
  if (periodCount) periodCount.textContent = formatAnalysisNumber(summary.periodCount);
  panel.querySelector("[data-analysis-total]").textContent = formatAnalysisNumber(summary.totalQuantity);
  const vogTotal = panel.querySelector("[data-analysis-vog-total]");
  if (vogTotal) vogTotal.textContent = formatAnalysisNumber(summary.vogQuantity);

  const warning = panel.querySelector("[data-analysis-period-warning]");
  const existing = Array.isArray(payload.periodsExisting) ? payload.periodsExisting : [];
  const warnings = [];
  if (existing.length) warnings.push(`Уже есть активные данные за: ${existing.map((p) => `${analysisPeriodLabel(p.year, p.month)}${p.direction ? ` · ${p.direction}` : ""}`).join(", ")}. При загрузке будет создана новая активная версия.`);
  if (kind === "trt_plan" && Number(summary.negativeNormalizedRows || 0) > 0) warnings.push(`Отрицательных значений плана: ${Number(summary.negativeNormalizedRows).toLocaleString("ru-RU")}. В расчётах они автоматически заменены на 0.`);
  if (Number(summary.unmatchedRows || 0) > 0) warnings.push(`Не сопоставлено: ${Number(summary.unmatchedRows).toLocaleString("ru-RU")}. Выберите ТРТ вручную в таблице либо загрузите сопоставленную часть; несопоставленные строки в базу не попадут.`);
  warning.hidden = warnings.length === 0;
  warning.textContent = warnings.join(" ");

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const problemBySource = new Map();
  rows.filter((row) => !["matched", "skipped"].includes(String(row.status || ""))).forEach((row) => {
    const key = `${row.rowNumber}|${row.direction || ""}`;
    if (!problemBySource.has(key)) problemBySource.set(key, row);
  });
  const problemRows = [...problemBySource.values()];
  const normalRows = rows.filter((row) => ["matched", "skipped"].includes(String(row.status || "")));
  const displayRows = [...problemRows, ...normalRows].slice(0, Math.max(500, problemRows.length));
  const body = panel.querySelector("[data-analysis-preview-body]");
  body.innerHTML = displayRows.map((row) => {
    const period = analysisPeriodLabel(row.year, row.month);
    const autoMatch = row.matchedName ? `<strong>${escapeHtml(row.matchedName)}</strong>${row.matchedAddress || row.address ? `<small>${escapeHtml(row.matchedAddress || row.address)}</small>` : ""}` : "—";
    const manualControl = analysisManualMatchControl(kind, row);
    const match = `${autoMatch}${manualControl}`;
    if (kind === "trt_plan") {
      return `<tr><td>${escapeHtml(row.rowNumber)}</td><td>${escapeHtml(period)}</td><td>${escapeHtml(row.direction || "—")}</td><td>${escapeHtml(row.client || "—")}</td><td>${escapeHtml(row.trtName || "—")}</td><td>${formatAnalysisNumber(row.quantity)}</td><td>${match}</td><td>${analysisStatusBadge(row)}${row.message ? `<small>${escapeHtml(row.message)}</small>` : ""}</td></tr>`;
    }
    return `<tr><td>${escapeHtml(row.rowNumber)}</td><td>${escapeHtml(period)}</td><td>${escapeHtml(row.direction || "—")}</td><td>${escapeHtml(row.network || "—")}</td><td>${escapeHtml(row.address || "—")}</td><td>${formatAnalysisNumber(row.totalQuantity)}</td><td>${formatAnalysisNumber(row.vogQuantity)}</td><td>${match}</td><td>${analysisStatusBadge(row)}${row.message ? `<small>${escapeHtml(row.message)}</small>` : ""}</td></tr>`;
  }).join("");
  const colspan = kind === "trt_plan" ? 8 : 9;
  if (rows.length > displayRows.length) body.insertAdjacentHTML("beforeend", `<tr><td colspan="${colspan}"><small>Сначала показаны все строки, требующие решения, затем часть сопоставленных значений. Всего значений: ${rows.length.toLocaleString("ru-RU")}.</small></td></tr>`);
  panel.querySelector("[data-analysis-result]").hidden = false;
  panel.querySelector("[data-analysis-commit]").disabled = Number(summary.invalidRows || 0) > 0 || Number(summary.matchedRows || 0) === 0;
}

async function previewAnalysisImport(kind) {
  if (!isSystemAdmin()) return;
  const panel = analysisPanel(kind);
  const file = panel?.querySelector("[data-analysis-file]")?.files?.[0];
  if (!panel || !file) return;
  const error = panel.querySelector("[data-analysis-error]");
  const progress = panel.querySelector("[data-analysis-progress]");
  error.hidden = true; panel.querySelector("[data-analysis-result]").hidden = true; progress.hidden = false;
  panel.querySelector("[data-analysis-preview]").disabled = true;
  try {
    await ensureTrtData();
    const rows = await readAnalysisImportFile(file, kind);
    ANALYSIS_IMPORT_STATE[kind] = { rows, preview: null, fileName: file.name };
    const payload = await requestAnalysisPreviewBatched(kind, file.name, rows, progress);
    renderAnalysisImportPreview(kind, payload);
  } catch (err) {
    error.textContent = err.message; error.hidden = false;
  } finally {
    progress.hidden = true; progress.textContent = "Проверка файла…"; updateAnalysisPreviewButton(kind);
  }
}

async function commitAnalysisImport(kind) {
  if (!isSystemAdmin()) return;
  const panel = analysisPanel(kind); const item = ANALYSIS_IMPORT_STATE[kind];
  if (!panel || !item.preview || !item.rows.length) return;
  const replace = Array.isArray(item.preview.periodsExisting) && item.preview.periodsExisting.length > 0;
  const label = kind === "trt_plan" ? "планы ТРТ" : "DIY sell-out";
  if (!window.confirm(replace ? `Загрузить новую активную версию «${label}» для месяцев из файла? Предыдущие версии останутся в истории.` : `Загрузить ${label}?`)) return;
  const button = panel.querySelector("[data-analysis-commit]"); const error = panel.querySelector("[data-analysis-error]");
  error.hidden = true; button.disabled = true; const original = button.textContent; button.textContent = "Подготовка…";
  try {
    const resolvedRows = analysisResolvedRowsForCommit(kind, item);
    if (!resolvedRows.length) throw new Error("Нет сопоставленных строк для загрузки.");
    const begin = await api("/admin/sales-import", {
      method: "POST",
      timeout: 60000,
      body: JSON.stringify({ scope: "market_analysis", operation: "commit_begin", kind, fileName: item.fileName }),
    });
    const importId = begin.importId;
    if (!importId) throw new Error("Сервер не создал пакет загрузки.");

    const chunks = analysisCommitChunks(kind, resolvedRows);
    const responses = [];
    for (let index = 0; index < chunks.length; index += 1) {
      button.textContent = `Загрузка ${index + 1} / ${chunks.length}…`;
      const response = await api("/admin/sales-import", {
        method: "POST",
        timeout: 90000,
        body: JSON.stringify({
          scope: "market_analysis",
          operation: "commit_chunk",
          kind,
          importId,
          fileName: item.fileName,
          rows: chunks[index],
        }),
      });
      responses.push(response);
    }

    button.textContent = "Активация…";
    const periods = mergeAnalysisCommitPeriods(kind, responses);
    const result = await api("/admin/sales-import", {
      method: "POST",
      timeout: 90000,
      body: JSON.stringify({
        scope: "market_analysis",
        operation: "commit_finish",
        kind,
        importId,
        fileName: item.fileName,
        replace,
        periods,
      }),
    });
    state.marketAnalysis = { loaded: false, catalog: null, plans: [], diy: [], staticPlanSources: [], staticPlanRows: null, staticPlanStats: null, staticPlanCacheKey: "" };
    showToast(result.message || "Данные загружены."); resetAnalysisImport(kind, true);
  } catch (err) {
    error.textContent = err.message; error.hidden = false; button.disabled = false;
  } finally { button.textContent = original; }
}

function downloadAnalysisTemplate(kind) {
  if (!window.XLSX) return showToast("Модуль Excel не загрузился");
  const workbook = XLSX.utils.book_new();
  if (kind === "trt_plan") {
    const headers = ["Направление","Менеджер","Клиент","Название ТРТ","Адрес","Январь 26","Февраль 26","Март 26","Апрель 26","Май 26","Июнь 26","Июль 26"];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), "Планы ТРТ");
    XLSX.writeFile(workbook, "VOG_Шаблон_планы_ТРТ.xlsx");
    return;
  }
  const monthNames = ["Январь 25","Февраль 25","Март 25","Апрель 25","Май 25","Июнь 25","Июль 25","Август 25","Сентябрь 25","Октябрь 25","Ноябрь 25","Декабрь 25","Январь 26","Февраль 26","Март 26","Апрель 26","Май 26","Июнь 26","Июль 26"];
  const top = ["Направление деятельности (плитка или обои)","Магазин","Адрес"];
  const metrics = ["","",""];
  monthNames.forEach((month) => { top.push(month, ""); metrics.push("Общие продажи, нат ед", "Продажи ВОГ, нат ед"); });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([top, metrics]), "DIY sell-out");
  XLSX.writeFile(workbook, "VOG_Шаблон_DIY_sell_out.xlsx");
}

async function logout() {
  try { await api("/auth/logout", { method: "POST", body: "{}" }); } catch { /* Локальная сессия очищается в любом случае. */ }
  clearSession();
  showLogin();
}


window.addEventListener("pageshow", () => {
  if (!state.token) resetLoginForm();
});

$("open-login-form-button").addEventListener("click", openLoginForm);

$("login-form").addEventListener("submit", login);
$("logout-button").addEventListener("click", logout);
$("employee-search").addEventListener("input", renderEmployees);
$("employee-status-filter").addEventListener("change", renderEmployees);
$("add-employee-button").addEventListener("click", openEmployeeDialog);

$("employees-table-body").addEventListener("click", (event) => {
  const button = event.target.closest("[data-invite-employee-id]");
  if (!button) return;
  inviteEmployee(button.dataset.inviteEmployeeId, button);
});
$("employee-form").addEventListener("submit", saveEmployee);
$("employee-dialog-close").addEventListener("click", closeEmployeeDialog);
$("employee-cancel-button").addEventListener("click", closeEmployeeDialog);
$("employee-generate-password").addEventListener("click", setGeneratedEmployeePassword);
$("employee-role").addEventListener("change", () => fillManagerOptions());
$("employee-direction").addEventListener("change", () => fillManagerOptions());

["task-search", "task-scope-filter", "task-status-filter", "task-assignee-filter"].forEach((id) => {
  const eventName = id === "task-search" ? "input" : "change";
  $(id).addEventListener(eventName, renderTasks);
});
$("tasks-table-body").addEventListener("click", (event) => {
  if (event.target.closest("button, a, input, select, textarea")) return;
  const row = event.target.closest("[data-task-view]");
  if (row) openTaskDetail(row.dataset.taskView);
});
$("tasks-table-body").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("[data-task-view]");
  if (!row) return;
  event.preventDefault();
  openTaskDetail(row.dataset.taskView);
});
$("task-detail-close").addEventListener("click", closeTaskDetail);
$("task-detail-modal").addEventListener("click", (event) => {
  if (event.target === $("task-detail-modal")) closeTaskDetail();
});
$("task-open-trt-button").addEventListener("click", openSelectedTaskTrt);
$("media-preview-close").addEventListener("click", closeMediaPreview);
$("media-preview-prev").addEventListener("click", () => moveMediaPreview(-1));
$("media-preview-next").addEventListener("click", () => moveMediaPreview(1));
$("media-preview-modal").addEventListener("click", (event) => {
  if (event.target === $("media-preview-modal")) closeMediaPreview();
});
$("media-preview-stage").addEventListener("touchstart", (event) => {
  mediaPreviewTouchStartX = event.touches?.[0]?.clientX ?? null;
}, {passive:true});
$("media-preview-stage").addEventListener("touchend", (event) => {
  if (mediaPreviewTouchStartX == null) return;
  const endX = event.changedTouches?.[0]?.clientX ?? mediaPreviewTouchStartX;
  const delta = endX - mediaPreviewTouchStartX;
  mediaPreviewTouchStartX = null;
  if (Math.abs(delta) < 45) return;
  moveMediaPreview(delta > 0 ? -1 : 1);
}, {passive:true});


["visit-search", "visit-employee-filter", "visit-direction-filter", "visit-date-from", "visit-date-to"].forEach((id) => {
  $(id).addEventListener(id === "visit-search" ? "input" : "change", renderVisits);
});
$("visits-table-body").addEventListener("click", (event) => {
  if (event.target.closest("button, a, input, select, textarea")) return;
  const row = event.target.closest("[data-visit-view]");
  if (row) openVisitDetail(row.dataset.visitView);
});
$("visits-table-body").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("[data-visit-view]");
  if (!row) return;
  event.preventDefault();
  openVisitDetail(row.dataset.visitView);
});
$("visit-detail-close").addEventListener("click", closeVisitDetail);
$("visit-detail-modal").addEventListener("click", (event) => {
  if (event.target === $("visit-detail-modal")) closeVisitDetail();
});
$("visit-open-trt-button").addEventListener("click", openSelectedVisitTrt);
document.addEventListener("keydown", (event) => {
  if (!$("media-preview-modal").hidden) {
    if (event.key === "ArrowLeft") { event.preventDefault(); moveMediaPreview(-1); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); moveMediaPreview(1); return; }
    if (event.key === "Escape") { event.preventDefault(); closeMediaPreview(); return; }
  }
  if (event.key === "Escape" && !$("visit-detail-modal").hidden) { closeVisitDetail(); return; }
  if (event.key === "Escape" && trtInspectorMode && state.currentPage === "trt") {
    event.preventDefault();
    closeMapInspector();
  }
});

function preserveTrtMapView(action) {
  if (!trtMap) {
    action();
    return;
  }

  const center = trtMap.getCenter();
  const zoom = trtMap.getZoom();

  action();

  if (center && Number.isFinite(zoom)) {
    trtMap.setView(center, zoom, { animate: false });
  }
}

["trt-direction-filter", "trt-manager-filter"].forEach((id) => {
  $(id).addEventListener("change", () => {
    state.trtFitRequested = hasActiveTrtFilters();
    renderTrtMap();
    if (!hasActiveTrtFilters()) resetTrtMapToDefaultView(true);
  });
});

$("trt-map-mode").addEventListener("change", () => {
  const mode = $("trt-map-mode").value;
  if (["points", "regions", "both"].includes(mode)) sessionStorage.setItem(TRT_MAP_MODE_KEY, mode);
  syncTrtDisplayControl();
  preserveTrtMapView(updateTrtMapMode);
});
const trtSmartSearchInput = $("trt-smart-search-input");
if (trtSmartSearchInput) {
  trtSmartSearchInput.addEventListener("input", () => {
    trtSmartSuggestionIndex = -1;
    renderTrtSmartSuggestions(trtSmartSearchInput.value);
  });
  trtSmartSearchInput.addEventListener("focus", () => {
    if (trtSmartSearchInput.value.trim()) renderTrtSmartSuggestions(trtSmartSearchInput.value);
  });
  trtSmartSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!trtSmartSuggestions.length) renderTrtSmartSuggestions(trtSmartSearchInput.value);
      if (trtSmartSuggestions.length) {
        trtSmartSuggestionIndex = Math.min(trtSmartSuggestionIndex + 1, trtSmartSuggestions.length - 1);
        renderTrtSmartSuggestions(trtSmartSearchInput.value);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (trtSmartSuggestions.length) {
        trtSmartSuggestionIndex = Math.max(trtSmartSuggestionIndex - 1, 0);
        renderTrtSmartSuggestions(trtSmartSearchInput.value);
      }
      return;
    }
    if (event.key === "Enter") {
      if (!trtSmartSuggestions.length) return;
      event.preventDefault();
      const index = trtSmartSuggestionIndex >= 0 ? trtSmartSuggestionIndex : 0;
      addTrtSmartFilter(trtSmartSuggestions[index]);
      return;
    }
    if (event.key === "Escape") {
      closeTrtSmartSuggestions();
      trtSmartSearchInput.blur();
      return;
    }
    if (event.key === "Backspace" && !trtSmartSearchInput.value && trtSmartFilters.length) {
      removeTrtSmartFilter(trtSmartFilterTokenKey(trtSmartFilters[trtSmartFilters.length - 1]));
    }
  });
}

$("trt-smart-search-suggestions")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-trt-suggestion-index]");
  if (!button) return;
  const suggestion = trtSmartSuggestions[Number(button.dataset.trtSuggestionIndex)];
  addTrtSmartFilter(suggestion);
});

$("trt-smart-filter-chips")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-trt-filter-remove]");
  if (!button) return;
  removeTrtSmartFilter(button.dataset.trtFilterRemove);
});

$("trt-smart-filter-clear")?.addEventListener("click", clearTrtSmartFilters);

$("trt-display-toggle")?.addEventListener("click", (event) => {
  event.stopPropagation();
  closeTrtSmartSuggestions();
  const open = !document.querySelector(".trt-display-control")?.classList.contains("open");
  setTrtDisplayPanel(open);
});

document.querySelectorAll("[data-trt-map-mode-value]").forEach((button) => {
  button.addEventListener("click", () => {
    setTrtMapMode(button.dataset.trtMapModeValue);
    setTrtDisplayPanel(false);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#trt-smart-search-control")) closeTrtSmartSuggestions();
  if (!event.target.closest(".trt-display-control")) setTrtDisplayPanel(false);
});

$("view-map-button").addEventListener("click", () => setTrtMainView("map"));
$("view-analytics-button").addEventListener("click", () => setTrtMainView("analytics"));

document.querySelectorAll(".legacy-analytics-tab").forEach((button) => {
  button.addEventListener("click", () => setTrtAnalyticsTab(button.dataset.analyticsTab));
});

$("analytics-direction").addEventListener("change", () => {
  populateAnalyticsFilters(false);
  renderActiveAnalyticsTab();
});
$("analytics-category").addEventListener("change", renderActiveAnalyticsTab);
$("analytics-period-start").addEventListener("change", renderActiveAnalyticsTab);
$("analytics-period-end").addEventListener("change", renderActiveAnalyticsTab);
$("analytics-structure-group").addEventListener("change", renderAnalyticsStructure);
$("analytics-structure-year").addEventListener("change", renderAnalyticsStructure);

$("analytics-format-control").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleAnalyticsFormatMenu();
});
$("analytics-format-menu").addEventListener("click", (event) => event.stopPropagation());
$("analytics-format-select-all").addEventListener("click", () => {
  document.querySelectorAll(".legacy-multiselect-option").forEach((option) => {
    trtAnalyticsSelectedFormats.add(option.dataset.value);
  });
  updateAnalyticsFormatControl();
  renderActiveAnalyticsTab();
});
$("analytics-format-clear").addEventListener("click", () => {
  trtAnalyticsSelectedFormats.clear();
  updateAnalyticsFormatControl();
  renderActiveAnalyticsTab();
});
document.addEventListener("click", closeAnalyticsFormatMenu);

$("trt-card-sales-preview")?.addEventListener("click", (event) => openTrtSales(event.currentTarget));
$("trt-card-sales-preview")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openTrtSales(event.currentTarget);
});
$("trt-card-fdiy-sales-toggle")?.addEventListener("click", () => {
  const point = selectedTrtPoint();
  if (!point || !isFdiyTrtPoint(point)) return;
  trtCardFdiySalesMode = trtCardFdiySalesMode === "total" ? "vog" : "total";
  updateTrtFdiySalesControl(point);
  renderTrtCardSalesChart(point);
});
$("trt-sales-modal-close").addEventListener("click", closeTrtSales);
$("trt-sales-modal").addEventListener("click", (event) => {
  if (event.target === $("trt-sales-modal")) closeTrtSales();
});
$("map-inspector-close")?.addEventListener("click", closeMapInspector);
$("region-inspector-city-body")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-region-city-toggle]");
  if (!button) return;
  const detail = $(button.dataset.regionCityToggle);
  if (!detail) return;
  const expanded = detail.hidden;
  detail.hidden = !expanded;
  button.textContent = expanded ? "−" : "+";
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
});


document.addEventListener("change", (event) => {
  const select = event.target.closest?.("[data-analysis-manual-select]");
  if (!select || !select.value) return;
  const kind = select.dataset.analysisManualSelect;
  const sourceRow = Number(select.dataset.sourceRow || 0);
  (ANALYSIS_IMPORT_STATE[kind]?.rows || []).forEach((row) => {
    if (Number(row.rowNumber) === sourceRow) row.manualPointId = select.value;
  });
  repreviewAnalysisImport(kind);
});

[["region-analysis-direction", "direction"], ["region-directory-direction", "direction"], ["region-analysis-year", "year"], ["region-directory-year", "year"], ["region-analysis-month", "month"], ["region-directory-month", "month"]].forEach(([id, kind]) => {
  $(id)?.addEventListener("change", (event) => {
    if (kind === "direction") marketAnalysisDirection = marketDirectionKey(event.target.value);
    if (kind === "year") marketAnalysisYear = Number(event.target.value);
    if (kind === "month") marketAnalysisMonth = Number(event.target.value);
    refreshOpenRegionAnalysis();
  });
});
$("region-directory-search")?.addEventListener("input", renderRegionAnalyticsDirectory);
$("region-directory-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-region-open]");
  if (button) openRegionInspectorByKey(button.dataset.regionOpen);
});

document.querySelectorAll("[data-nav-group]").forEach((button) => {
  button.addEventListener("click", () => {
    const submenu = document.querySelector(`[data-nav-submenu="${button.dataset.navGroup}"]`);
    setNavGroupExpanded(button.dataset.navGroup, submenu?.hidden !== false);
  });
});

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page, true);
    if (button.dataset.page === "trt") setTrtMainView("map");
    else if (button.dataset.trtView) setTrtMainView(button.dataset.trtView);
  });
});


// ---------------------------------------------------------------------------
// Аналитика → Логистика
// ---------------------------------------------------------------------------
function logisticsMoney(value) { return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }); }
function logisticsDecimal(value, digits = 2) { return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: digits }); }
function logisticsDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || "—") : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }); }
function logisticsBadge(color, percent) { const labels = { red: "Красный", yellow: "Жёлтый", green: "Зелёный" }; return `<span class="logistics-status logistics-status-${color}">${labels[color] || color} · ${logisticsDecimal(percent, 2)}%</span>`; }

function initializeLogisticsPeriod() {
  const year = $("logistics-year"); if (!year || year.options.length) return;
  const now = new Date(); const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  for (let item = now.getFullYear() + 1; item >= 2025; item -= 1) { const option = document.createElement("option"); option.value = item; option.textContent = item; year.append(option); }
  year.value = String(previous.getFullYear()); $("logistics-month").value = String(previous.getMonth() + 1);
}
function setLogisticsTab(tab) {
  logisticsActiveTab = tab;
  document.querySelectorAll("[data-logistics-tab]").forEach((button) => button.classList.toggle("active", button.dataset.logisticsTab === tab));
  document.querySelectorAll("[data-logistics-panel]").forEach((panel) => { panel.hidden = panel.dataset.logisticsPanel !== tab; });
  if (tab === "warehouses") { loadLogisticsDictionaries(); window.setTimeout(initializeWarehouseMap, 80); }
  if (tab === "vehicles") loadLogisticsDictionaries();
}
async function loadLogistics(force = false) {
  if (state.logistics.loaded && !force) { renderLogistics(); return; }
  const loading = $("logistics-loading"), error = $("logistics-error"); loading.hidden = false; error.hidden = true;
  try {
    const data = await api(`/logistics?year=${encodeURIComponent($("logistics-year").value)}&month=${encodeURIComponent($("logistics-month").value)}`);
    state.logistics.trips = data.trips || []; state.logistics.summary = data.summary || {}; state.logistics.loaded = true; renderLogistics();
  } catch (exc) { error.textContent = exc.message; error.hidden = false; } finally { loading.hidden = true; }
}
function renderLogistics() {
  const summary = state.logistics.summary || {};
  $("logistics-kpi-trips").textContent = Number(summary.tripCount || 0).toLocaleString("ru-RU");
  $("logistics-kpi-red").textContent = Number(summary.redTrips || 0).toLocaleString("ru-RU");
  $("logistics-kpi-yellow").textContent = Number(summary.yellowTrips || 0).toLocaleString("ru-RU");
  $("logistics-kpi-cost").textContent = logisticsMoney(summary.totalCost);
  $("logistics-kpi-percent").textContent = `${logisticsDecimal(summary.totalPercent, 2)}%`;
  const problem = (state.logistics.trips || []).filter((trip) => trip.colorStatus !== "green").sort((a,b)=>Number(b.percent||0)-Number(a.percent||0));
  $("logistics-problem-table").innerHTML = problem.map(logisticsTripRow).join(""); $("logistics-overview-empty").hidden = Boolean(problem.length || Number(summary.tripCount || 0));
  renderLogisticsTrips();
}
function logisticsTripRow(trip, all = false) {
  return `<tr class="logistics-trip-${escapeHtml(trip.colorStatus || "green")}"><td><strong>${escapeHtml(trip.tripNumber || trip.tripId || "—")}</strong></td><td>${escapeHtml(logisticsDate(trip.tripDate))}</td><td>${escapeHtml(trip.warehouse || "—")}</td><td>${escapeHtml(trip.vehicle || "—")}</td><td>${logisticsMoney(trip.shipment)}</td><td>${logisticsMoney(trip.cost)}</td><td>${logisticsBadge(trip.colorStatus, trip.percent)}</td>${all ? `<td>${logisticsDecimal(trip.weight)}</td><td>${logisticsDecimal(trip.volume)}</td>` : ""}<td>${Number(trip.stopCount || 0)}</td></tr>`;
}
function renderLogisticsTrips() {
  const query = String($("logistics-trip-search")?.value || "").trim().toLowerCase(); const color = $("logistics-color-filter")?.value || "all";
  const trips = (state.logistics.trips || []).filter((trip) => (color === "all" || trip.colorStatus === color) && (!query || JSON.stringify(trip).toLowerCase().includes(query)));
  $("logistics-trips-table").innerHTML = trips.map((trip)=>logisticsTripRow(trip,true)).join(""); $("logistics-trips-empty").hidden = Boolean(trips.length);
}
function logisticsNumber(value) { if (typeof value === "number") return Number.isFinite(value) ? value : 0; const num = Number(String(value ?? "").replace(/\s+/g, "").replace(",", ".").replace("%", "")); return Number.isFinite(num) ? num : 0; }
function excelDateIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) { const p = XLSX.SSF.parse_date_code(value); if (p) return new Date(Date.UTC(p.y,p.m-1,p.d,p.H||0,p.M||0,Math.floor(p.S||0))).toISOString(); }
  const text=String(value||"").trim(); const m=text.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/); if (!m) return text;
  return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]||0),Number(m[5]||0),Number(m[6]||0)).toISOString();
}
async function readLogisticsFile(file) {
  if (!window.XLSX) throw new Error("Модуль чтения Excel не загрузился.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("В файле нет листов.");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  if (rows.length < 7) throw new Error("Файл не содержит заданий на перевозку.");

  const trips = [];
  let current = null;
  let pendingLine = null;
  const isTripRow = (value) => /^Задание на перевозку\s+/i.test(String(value || "").trim());
  const isClientRow = (row) => Boolean(String(row[4] ?? "").trim() || String(row[5] ?? "").trim() || String(row[6] ?? "").trim());

  rows.forEach((row, index) => {
    const sourceRow = index + 1;
    const first = String(row[0] ?? "").trim();
    if (!first) return;

    if (isTripRow(first)) {
      const number = (first.match(/Задание на перевозку\s+([^\s]+)/i) || [])[1] || first;
      const date = (first.match(/от\s+(.+)$/i) || [])[1] || "";
      current = {
        tripId: `${number}-${sourceRow}`,
        tripNumber: number,
        tripDate: excelDateIso(date),
        sourceRow,
        vehicle: String(row[4] ?? row[1] ?? "").trim(),
        warehouse: "",
        shipment: logisticsNumber(row[7] ?? row[4]),
        cost: logisticsNumber(row[8] ?? row[5]),
        percent: logisticsNumber(row[10] ?? row[6]),
        costShare: logisticsNumber(row[11]),
        weight: logisticsNumber(row[12] ?? row[7]),
        volume: logisticsNumber(row[13] ?? row[8]),
        lines: [],
      };
      trips.push(current);
      pendingLine = null;
      return;
    }

    if (!current) return;

    if (isClientRow(row) || logisticsNormalizeMatchValue(first).startsWith("объект не найден")) {
      const warehouse = String(row[6] ?? row[3] ?? "").trim();
      if (warehouse && !current.warehouse) current.warehouse = warehouse;
      pendingLine = {
        rowNumber: sourceRow,
        addressRowNumber: 0,
        recipient: first,
        address: "",
        direction: String(row[4] ?? row[1] ?? "").trim(),
        zone: String(row[5] ?? row[2] ?? "").trim(),
        warehouse,
        shipment: logisticsNumber(row[7] ?? row[4]),
        cost: logisticsNumber(row[8] ?? row[5]),
        percent: logisticsNumber(row[10] ?? row[6]),
        costShare: logisticsNumber(row[11]),
        weight: logisticsNumber(row[12] ?? row[7]),
        volume: logisticsNumber(row[13] ?? row[8]),
      };
      current.lines.push(pendingLine);
      return;
    }

    // В новом отчёте 1С адрес идёт отдельной строкой сразу после клиента.
    // Числовые колонки могут дублироваться — это не новая доставка.
    if (pendingLine && !pendingLine.address) {
      pendingLine.address = first;
      pendingLine.addressRowNumber = sourceRow;
    }
  });

  if (!trips.length) throw new Error("Не найдены строки «Задание на перевозку». Проверьте структуру первого листа.");
  return trips;
}
function resetLogisticsImport(clear=true) {
  state.logistics.preview=null;
  state.logistics.sourceTrips=[];
  state.logistics.fileName="";
  state.logistics.matchResults=new Map();
  state.logistics.uniqueMatchItems=[];
  $("logistics-import-result").hidden=true;
  $("logistics-commit-button").disabled=true;
  const unresolvedWarning=$("logistics-unresolved-warning");
  if(unresolvedWarning){unresolvedWarning.hidden=true;unresolvedWarning.textContent="";}
  if(clear) $("logistics-file").value="";
  $("logistics-preview-button").disabled=!$("logistics-file").files?.[0] || !isSystemAdmin();
}
const LOGISTICS_COMMIT_CHUNK_SIZE = 10;
function mergeLogisticsSummaries(items) {
  const summary={tripCount:0,lineCount:0,ignoredCount:0,matchedCount:0,clientOnlyCount:0,unresolvedCount:0,redTrips:0,yellowTrips:0,greenTrips:0,totalShipment:0,totalCost:0,totalPercent:0};
  (items||[]).forEach((item)=>{const source=item.summary||item||{}; Object.keys(summary).filter((key)=>key!=="totalPercent").forEach((key)=>{summary[key]+=Number(source[key]||0);});});
  summary.totalPercent=summary.totalShipment>0?(summary.totalCost/summary.totalShipment)*100:0;
  return summary;
}
function logisticsNormalizeMatchValue(value){
  return String(value||"").toLowerCase().replaceAll("ё","е").replace(/[^a-zа-я0-9]+/gi," ").trim().replace(/\s+/g," ");
}
function logisticsLineIsIgnored(line){return logisticsNormalizeMatchValue(line?.recipient).startsWith("объект не найден");}
function logisticsLineMatchKey(line){return `${logisticsNormalizeMatchValue(line?.recipient)}\u241f${logisticsNormalizeMatchValue(line?.address)}\u241f${logisticsNormalizeMatchValue(line?.direction)}`;}
function logisticsLocalColor(percent){const value=Number(percent||0); return value>10?"red":value>=6?"yellow":"green";}
function collectUniqueLogisticsMatches(trips){
  const groups=new Map();
  (trips||[]).forEach((trip)=>{(trip.lines||[]).forEach((line)=>{
    if(logisticsLineIsIgnored(line)) return;
    const key=logisticsLineMatchKey(line);
    let group=groups.get(key);
    if(!group){group={key,recipient:String(line.recipient||"").trim(),address:String(line.address||"").trim(),direction:String(line.direction||"").trim(),occurrences:0,totalCost:0,zones:new Set(),rows:[]};groups.set(key,group);}
    group.occurrences+=1; group.totalCost+=Number(line.cost||0); if(line.zone)group.zones.add(String(line.zone)); if(line.rowNumber)group.rows.push(line.rowNumber);
  });});
  return [...groups.values()].map((group)=>({...group,zones:[...group.zones],rows:group.rows.slice(0,8)}));
}

async function loadLogisticsAliasCatalog(force=false){
  if(state.logistics.aliasCatalog&&!force)return state.logistics.aliasCatalog;
  const data=await api("/logistics?view=aliases",{timeout:60000});
  state.logistics.aliasCatalog=data||{};
  state.logistics.aliasMap=new Map();
  state.logistics.suggestionMap=new Map();
  (data.aliases||[]).forEach((item)=>{
    const key=String(item.key||`${logisticsNormalizeMatchValue(item.sourceName)}\u241f${logisticsNormalizeMatchValue(item.sourceAddress)}\u241f${logisticsNormalizeMatchValue(item.direction)}`);
    state.logistics.aliasMap.set(key,item);
  });
  (data.suggestions||[]).forEach((item)=>state.logistics.suggestionMap.set(String(item.key||""),item.candidates||[]));
  return data;
}
function logisticsAutomaticSuggestion(candidates){
  const ranked=[...(candidates||[])].filter((item)=>item?.pointId).sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  if(!ranked.length)return null;
  const top=ranked[0];
  const topScore=Number(top.score||0);
  const topAddress=Number(top.addressScore||0);
  const secondScore=ranked.length>1?Number(ranked[1].score||0):0;
  const margin=topScore-secondScore;
  // Автоматически принимаем только действительно очевидный вариант.
  // Равные кандидаты по одному адресу всегда остаются на ручную проверку.
  if(ranked.length===1 && (topScore>=0.92 || topAddress>=0.95))return top;
  if(topScore>=0.98 && margin>=0.04)return top;
  if(topAddress>=0.96 && topScore>=0.92 && margin>=0.05)return top;
  if(topScore>=0.94 && margin>=0.10)return top;
  return null;
}
function buildLogisticsMatchesFromCatalog(items){
  return (items||[]).map((item)=>{
    const saved=state.logistics.aliasMap.get(item.key);
    if(saved?.pointId){
      return {key:item.key,status:"matched",pointId:saved.pointId,clientName:saved.clientName||"",reason:"Готовая таблица соответствий",savedAlias:true,candidates:[]};
    }
    if(saved?.clientName){
      return {key:item.key,status:"client_only",pointId:"",clientName:saved.clientName,reason:"Готовая таблица соответствий (клиент)",savedAlias:true,candidates:[]};
    }
    const candidates=state.logistics.suggestionMap.get(item.key)||[];
    const automatic=logisticsAutomaticSuggestion(candidates);
    if(automatic){
      return {key:item.key,status:"matched",pointId:automatic.pointId,clientName:automatic.clientName||"",reason:"Автоматически принято очевидное совпадение",automatic:true,score:Number(automatic.score||0),addressScore:Number(automatic.addressScore||0),candidates};
    }
    return {key:item.key,status:"unresolved",pointId:"",clientName:"",reason:"Требуется проверка неоднозначного совпадения",candidates,clientCandidates:[]};
  });
}
function applyLogisticsMatchesToSource(){
  (state.logistics.sourceTrips||[]).forEach((trip)=>{(trip.lines||[]).forEach((line)=>{
    line._matchKey=logisticsLineMatchKey(line);
    line.manualPointId=""; line.manualClientName="";
    if(logisticsLineIsIgnored(line)){line.status="ignored";line.reason="Сторонний сборный груз";line.candidates=[];line.clientCandidates=[];return;}
    const match=state.logistics.matchResults.get(line._matchKey)||{status:"unresolved",reason:"Сопоставление не выполнено",candidates:[],clientCandidates:[]};
    Object.assign(line,match);
    if(match.status==="matched"&&match.pointId)line.manualPointId=match.pointId;
    if(match.status==="client_only"&&match.clientName)line.manualClientName=match.clientName;
  });});
}
function buildLocalLogisticsPreview(){
  const summary={tripCount:0,lineCount:0,ignoredCount:0,matchedCount:0,clientOnlyCount:0,unresolvedCount:0,redTrips:0,yellowTrips:0,greenTrips:0,totalShipment:0,totalCost:0,totalPercent:0};
  const warehouseAliases=new Set(),vehicleAliases=new Set();
  const trips=(state.logistics.sourceTrips||[]).map((trip)=>{
    summary.tripCount+=1; summary.totalShipment+=Number(trip.shipment||0); summary.totalCost+=Number(trip.cost||0);
    if(trip.warehouse)warehouseAliases.add(trip.warehouse); if(trip.vehicle)vehicleAliases.add(trip.vehicle);
    let ignoredCount=0,unresolvedCount=0; const stops=new Set();
    (trip.lines||[]).forEach((line)=>{summary.lineCount+=1;
      if(line.status==="ignored"){summary.ignoredCount+=1;ignoredCount+=1;}
      else if(line.status==="matched"){summary.matchedCount+=1;stops.add(`point:${line.pointId}`);}
      else if(line.status==="client_only"){summary.clientOnlyCount+=1;stops.add(`client:${logisticsNormalizeMatchValue(line.clientName)}`);}
      else{summary.unresolvedCount+=1;unresolvedCount+=1;}
    });
    const percent=Number(trip.percent||((Number(trip.shipment||0)>0)?Number(trip.cost||0)/Number(trip.shipment||0)*100:0)); const colorStatus=logisticsLocalColor(percent);
    summary[`${colorStatus}Trips`]+=1;
    return {...trip,percent,colorStatus,lineCount:(trip.lines||[]).length,ignoredCount,unresolvedCount,stopCount:stops.size};
  });
  summary.totalPercent=summary.totalShipment>0?summary.totalCost/summary.totalShipment*100:0;
  const monthName=$("logistics-month")?.selectedOptions?.[0]?.textContent||String($("logistics-month")?.value||"");
  return {periodExists:Number(state.logistics.summary?.tripCount||0)>0,periodLabel:`${monthName} ${$("logistics-year")?.value||""}`,summary,warehouseAliases:[...warehouseAliases].sort(),vehicleAliases:[...vehicleAliases].sort(),trips};
}
async function previewLogisticsFile(){
  const file=$("logistics-file").files?.[0]; if(!file)return;
  const progress=$("logistics-import-progress"); progress.hidden=false; $("logistics-preview-button").disabled=true; $("logistics-error").hidden=true;
  try{
    progress.textContent="Чтение файла…";
    const trips=await readLogisticsFile(file); state.logistics.sourceTrips=trips; state.logistics.fileName=file.name;
    const uniqueItems=collectUniqueLogisticsMatches(trips); state.logistics.uniqueMatchItems=uniqueItems; state.logistics.matchResults=new Map();
    progress.textContent="Применение готовой таблицы соответствий…";
    await loadLogisticsAliasCatalog();
    buildLogisticsMatchesFromCatalog(uniqueItems).forEach((match)=>state.logistics.matchResults.set(match.key,match));
    applyLogisticsMatchesToSource();
    const data=buildLocalLogisticsPreview(); state.logistics.preview=data; state.logistics.observedWarehouses=data.warehouseAliases||[]; state.logistics.observedVehicles=data.vehicleAliases||[];
    renderLogisticsPreview(); $("logistics-error").hidden=true;
  }catch(exc){$("logistics-error").textContent=exc.message;$("logistics-error").hidden=false;}
  finally{progress.textContent="Разбор файла…";progress.hidden=true;$("logistics-preview-button").disabled=false;}
}
function unresolvedLogisticsGroups(){
  const groups=new Map();
  (state.logistics.preview?.trips||[]).forEach((trip)=>(trip.lines||[]).forEach((line)=>{if(line.status!=="unresolved")return;const key=line._matchKey||logisticsLineMatchKey(line);let group=groups.get(key);if(!group){const base=state.logistics.uniqueMatchItems.find((item)=>item.key===key)||{};group={key,recipient:line.recipient,direction:line.direction,zones:new Set(),rows:[],tripNumbers:new Set(),cost:0,occurrences:0,candidates:line.candidates||[],clientCandidates:line.clientCandidates||[],...base};group.zones=new Set(base.zones||[]);group.rows=[];group.tripNumbers=new Set();groups.set(key,group);}group.occurrences+=1;group.cost+=Number(line.cost||0);if(line.zone)group.zones.add(line.zone);if(line.rowNumber&&group.rows.length<8)group.rows.push(line.rowNumber);if(trip.tripNumber)group.tripNumbers.add(trip.tripNumber);}));
  return [...groups.values()];
}
function renderLogisticsPreview(){
  const data=state.logistics.preview,s=data.summary||{}; $("logistics-preview-trips").textContent=s.tripCount||0; $("logistics-preview-lines").textContent=s.lineCount||0; $("logistics-preview-matched").textContent=s.matchedCount||0; $("logistics-preview-client-only").textContent=s.clientOnlyCount||0; $("logistics-preview-ignored").textContent=s.ignoredCount||0; $("logistics-preview-unresolved").textContent=s.unresolvedCount||0;
  const warning=$("logistics-period-warning"); warning.hidden=!data.periodExists; warning.textContent=data.periodExists?`Данные за ${data.periodLabel} уже загружены. Новая загрузка заменит активную версию месяца.`:"";
  const unresolved=unresolvedLogisticsGroups();
  $("logistics-match-table").innerHTML=unresolved.map((group)=>`<tr><td>${escapeHtml(group.rows.join(", ")||"—")}<small>${group.occurrences>1?`Повторов: ${group.occurrences}`:""}</small></td><td><strong>${escapeHtml(group.recipient)}</strong><small>${escapeHtml(group.address||"Адрес не указан")}</small><small>${escapeHtml([...group.tripNumbers].slice(0,3).join(", "))}</small></td><td>${escapeHtml(group.direction||"—")}</td><td>${escapeHtml([...group.zones].slice(0,4).join(", ")||"—")}</td><td>${logisticsMoney(group.cost)}</td><td><select class="logistics-match-select" data-match-key="${escapeHtml(encodeURIComponent(group.key))}"><option value="">Выберите ТРТ или клиента</option>${(group.candidates||[]).map((c)=>`<option value="point:${escapeHtml(c.pointId)}">ТРТ: ${escapeHtml(c.label)} · адрес ${Math.round(Number(c.addressScore||0)*100)}% · итог ${Math.round(Number(c.score||0)*100)}%</option>`).join("")}${(group.clientCandidates||[]).map((c)=>`<option value="client:${escapeHtml(c.clientName)}">Только клиент: ${escapeHtml(c.clientName)} · ${Math.round(Number(c.score||0)*100)}%</option>`).join("")}</select></td></tr>`).join("");
  $("logistics-match-empty").hidden=Boolean(unresolved.length);
  $("logistics-import-result").hidden=false;
  const commitButton=$("logistics-commit-button");
  const readyTrips=(Array.isArray(state.logistics.sourceTrips)&&state.logistics.sourceTrips.length)
    ? state.logistics.sourceTrips
    : (Array.isArray(state.logistics.preview?.trips)?state.logistics.preview.trips:[]);
  // После успешного разбора файла кнопка всегда должна быть кликабельной.
  // Проверка наличия рейсов выполняется уже внутри commitLogistics(),
  // чтобы HTML-атрибут disabled не мог оставить кнопку «мёртвой».
  commitButton.disabled=false;
  commitButton.removeAttribute("disabled");
  commitButton.setAttribute("aria-disabled","false");
  commitButton.dataset.webVersion="7.10";
  commitButton.title=unresolved.length
    ? `Можно загрузить сейчас. Требуют сопоставления: ${Number(s.unresolvedCount||0)} строк.`
    : "Все рабочие строки сопоставлены и готовы к загрузке.";
  const unresolvedWarning=$("logistics-unresolved-warning");
  if(unresolvedWarning){
    unresolvedWarning.hidden=!unresolved.length;
    unresolvedWarning.textContent=unresolved.length
      ? `Не определено: ${Number(s.unresolvedCount||0)} строк (${unresolved.length} групп). Их можно сопоставить ниже либо загрузить сейчас. Несопоставленные строки сохранятся со статусом «Не определено» и не будут распределены по ТРТ или клиентам до исправления.`
      : "";
  }
  populateLogisticsAliasSelects();
}
async function applyLogisticsManualMatch(select){
  const key=decodeURIComponent(select.dataset.matchKey||""); const group=unresolvedLogisticsGroups().find((item)=>item.key===key); if(!group||!select.value)return;
  select.disabled=true; const previous=state.logistics.matchResults.get(key); let match;
  if(select.value.startsWith("point:")){const pointId=select.value.slice(6);const candidate=(group.candidates||[]).find((item)=>item.pointId===pointId)||{};match={status:"matched",pointId,clientName:candidate.clientName||"",reason:"Ручное сопоставление",manual:true,candidates:group.candidates||[],clientCandidates:group.clientCandidates||[]};}
  else{const clientName=select.value.slice(7);match={status:"client_only",pointId:"",clientName,reason:"Ручное сопоставление с клиентом",manual:true,candidates:group.candidates||[],clientCandidates:group.clientCandidates||[]};}
  try{
    await api("/admin/logistics",{method:"POST",body:JSON.stringify({operation:"save_recipient_alias",sourceName:group.recipient,sourceAddress:group.address||"",direction:group.direction,pointId:match.pointId||"",clientName:match.clientName||""}),timeout:60000});
    state.logistics.matchResults.set(key,match); state.logistics.aliasMap.set(key,{key,sourceName:group.recipient,sourceAddress:group.address||"",direction:group.direction,pointId:match.pointId||"",clientName:match.clientName||"",matchSource:"manual"}); applyLogisticsMatchesToSource(); state.logistics.preview=buildLocalLogisticsPreview(); renderLogisticsPreview(); showToast(`Сопоставление сохранено для ${group.occurrences} строк`);
  }catch(exc){if(previous)state.logistics.matchResults.set(key,previous);else state.logistics.matchResults.delete(key);select.disabled=false;$("logistics-error").textContent=exc.message;$("logistics-error").hidden=false;}
}
async function commitLogisticsChunkAdaptive(importId, chunk, context) {
  try {
    return [await api("/admin/logistics-import",{
      method:"POST",
      body:JSON.stringify({
        operation:"commit_chunk",
        year:Number($("logistics-year").value),
        month:Number($("logistics-month").value),
        importId,
        trips:chunk,
      }),
      timeout:180000,
    })];
  } catch (error) {
    if (chunk.length <= 1) {
      const trip=chunk[0]||{};
      throw new Error(`Не удалось загрузить рейс ${trip.tripNumber||trip.tripId||context}: ${error.message}`);
    }
    const middle=Math.ceil(chunk.length/2);
    const left=await commitLogisticsChunkAdaptive(importId,chunk.slice(0,middle),context);
    const right=await commitLogisticsChunkAdaptive(importId,chunk.slice(middle),context);
    return [...left,...right];
  }
}
async function commitLogistics() {
  const button=$("logistics-commit-button");
  const progress=$("logistics-import-progress");
  const errorBox=$("logistics-error");
  if(!button || button.dataset.commitBusy==="1") return;

  const trips=(Array.isArray(state.logistics.sourceTrips)&&state.logistics.sourceTrips.length)
    ? state.logistics.sourceTrips
    : (Array.isArray(state.logistics.preview?.trips)?state.logistics.preview.trips:[]);

  if(!state.logistics.preview || !trips.length){
    const message="Файл ещё не готов к загрузке. Нажмите «Другой файл», выберите Excel и дождитесь завершения проверки.";
    if(errorBox){errorBox.textContent=message;errorBox.hidden=false;errorBox.scrollIntoView({block:"nearest"});}
    showToast(message);
    return;
  }

  button.dataset.commitBusy="1";
  button.disabled=true;
  button.textContent="Запускаем загрузку…";
  progress.hidden=false;
  progress.textContent="Подготовка загрузки логистики…";
  if(errorBox) errorBox.hidden=true;

  try {
    const year=Number($("logistics-year").value);
    const month=Number($("logistics-month").value);
    const replace=Boolean(state.logistics.preview?.periodExists);
    const unresolvedCount=Number(state.logistics.preview?.summary?.unresolvedCount||0);

    if(unresolvedCount>0){
      progress.textContent=`Подготовка загрузки. Несопоставленных строк: ${unresolvedCount}…`;
    }

    const started=await api("/admin/logistics-import",{
      method:"POST",
      body:JSON.stringify({operation:"commit_start",year,month,fileName:state.logistics.fileName,replace}),
      timeout:60000,
    });
    if(!started?.importId) throw new Error("Сервер не вернул идентификатор загрузки.");

    const results=[];
    let completed=0;
    for(let start=0;start<trips.length;start+=LOGISTICS_COMMIT_CHUNK_SIZE){
      const chunk=trips.slice(start,start+LOGISTICS_COMMIT_CHUNK_SIZE);
      progress.textContent=`Загрузка рейсов ${start+1}–${start+chunk.length} из ${trips.length}…`;
      const chunkResults=await commitLogisticsChunkAdaptive(started.importId,chunk,`${start+1}–${start+chunk.length}`);
      results.push(...chunkResults);
      completed+=chunk.length;
      progress.textContent=`Загружено ${completed} из ${trips.length} рейсов…`;
    }

    const summary=mergeLogisticsSummaries(results);
    progress.textContent="Завершение месячной загрузки…";
    const result=await api("/admin/logistics-import",{
      method:"POST",
      body:JSON.stringify({
        operation:"commit_finalize",year,month,importId:started.importId,
        fileName:state.logistics.fileName,replace,summary,
      }),
      timeout:60000,
    });

    showToast(result.message||"Логистика загружена");
    resetLogisticsImport(true);
    state.logistics.loaded=false;
    await loadLogistics(true);
    setLogisticsTab("overview");
  } catch(exc){
    const message=`Ошибка загрузки логистики: ${exc?.message||String(exc)}`;
    if(errorBox){
      errorBox.textContent=message;
      errorBox.hidden=false;
      errorBox.scrollIntoView({behavior:"smooth",block:"center"});
    }
    showToast(message);
    window.alert(message);
  } finally {
    delete button.dataset.commitBusy;
    progress.textContent="Разбор файла…";
    progress.hidden=true;
    button.textContent="Загрузить логистику";
    if(state.logistics.preview && trips.length){
      button.disabled=false;
      button.removeAttribute("disabled");
      button.setAttribute("aria-disabled","false");
    }
  }
}


function manualTrtSelectOptions(id, values, preferred = "") {
  const select = $(id);
  if (!select) return;
  const unique = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru"));
  select.innerHTML = '<option value="">Выберите</option>' + unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (preferred && unique.includes(preferred)) select.value = preferred;
  else if (unique.length === 1) select.value = unique[0];
}

function setManualTrtLocation(lat, lon, { center = true, status = "Координаты выбраны." } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  $("trt-add-point-lat").value = latitude.toFixed(6);
  $("trt-add-point-lon").value = longitude.toFixed(6);
  const statusNode = $("trt-add-point-location-status");
  statusNode.textContent = status;
  statusNode.classList.remove("error");
  if (!trtManualMap) return;
  if (trtManualMarker) trtManualMarker.remove();
  trtManualMarker = L.circleMarker([latitude, longitude], {
    radius: 9, weight: 3, color: "#ffffff", fillColor: "#4b5563", fillOpacity: 1,
  }).addTo(trtManualMap);
  if (center) trtManualMap.setView([latitude, longitude], Math.max(trtManualMap.getZoom(), 15));
}

function trtManualAddressProperties(feature) {
  return feature?.properties || {};
}

function trtManualAddressLabel(feature) {
  const props = trtManualAddressProperties(feature);
  const city = trtRussianCityName(props.city || props.town || props.village || props.locality || props.district || "");
  const street = String(props.street || ((props.osm_value === "street" || props.type === "street") ? props.name : "") || "").trim();
  const house = String(props.housenumber || props.house_number || "").trim();
  const name = String(props.name || "").trim();
  const region = String(props.state || props.county || "").trim();
  const parts = [];
  if (city) parts.push(city);
  if (street) parts.push(`${street}${house ? `, ${house}` : ""}`);
  else if (name && normalizeText(name) !== normalizeText(city)) parts.push(`${name}${house ? `, ${house}` : ""}`);
  if (region && !parts.some((part) => normalizeText(part) === normalizeText(region)) && !/область|район|республика/i.test(parts.join(" "))) parts.push(region);
  return parts.filter(Boolean).join(", ") || name || city || "Адрес";
}

function trtManualAddressHasHouse(feature) {
  const props = trtManualAddressProperties(feature);
  return Boolean(String(props.housenumber || props.house_number || "").trim());
}

function trtManualAddressCoordinates(feature) {
  const coords = feature?.geometry?.coordinates || [];
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function hideManualTrtAddressSuggestions() {
  const host = $("trt-add-point-address-suggestions");
  if (host) { host.hidden = true; host.innerHTML = ""; }
  trtManualAddressSuggestions = [];
  trtManualAddressSuggestionIndex = -1;
}

function renderManualTrtAddressSuggestions() {
  const host = $("trt-add-point-address-suggestions");
  if (!host) return;
  if (!trtManualAddressSuggestions.length) return hideManualTrtAddressSuggestions();
  host.innerHTML = trtManualAddressSuggestions.map((item, index) => `
    <button type="button" class="trt-address-suggestion${index === trtManualAddressSuggestionIndex ? " active" : ""}" data-trt-address-suggestion="${index}" role="option" aria-selected="${index === trtManualAddressSuggestionIndex ? "true" : "false"}">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${item.hasHouse ? "Точный адрес" : "Можно уточнить номер дома"}</span>
    </button>`).join("") + '<div class="trt-address-suggest-source">Подсказки адресов · OpenStreetMap</div>';
  host.hidden = false;
}

async function fetchManualTrtAddressSuggestions(query, { limit = 7, explicit = false } = {}) {
  const text = String(query || "").trim();
  if (text.length < 3) { hideManualTrtAddressSuggestions(); return []; }
  if (trtManualAddressSuggestAbort) trtManualAddressSuggestAbort.abort();
  const controller = new AbortController();
  trtManualAddressSuggestAbort = controller;
  const center = trtManualMap?.getCenter?.() || trtMap?.getCenter?.();
  const payload = {
    scope: "trt_address_lookup",
    operation: explicit ? "find" : "suggest",
    query: text,
    limit,
  };
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
    payload.lat = center.lat;
    payload.lon = center.lng;
  }
  try {
    const data = await api("/admin/sales-import", {
      method: "POST",
      timeout: explicit ? 15000 : 9000,
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    const rows = (Array.isArray(data?.features) ? data.features : [])
      .map((feature) => {
        const coords = trtManualAddressCoordinates(feature);
        if (!coords) return null;
        return { feature, ...coords, label: trtManualAddressLabel(feature), hasHouse: trtManualAddressHasHouse(feature) };
      })
      .filter((item) => item && item.label)
      .filter((item, index, all) => all.findIndex((candidate) => normalizeText(candidate.label) === normalizeText(item.label)) === index)
      .slice(0, limit);
    return rows;
  } finally {
    if (trtManualAddressSuggestAbort === controller) trtManualAddressSuggestAbort = null;
  }
}

function focusManualTrtAddressSuggestion(item) {
  if (!item) return;
  const input = $("trt-add-point-address");
  const statusNode = $("trt-add-point-location-status");
  if (input) input.value = item.label;
  hideManualTrtAddressSuggestions();
  if (item.hasHouse) {
    setManualTrtLocation(item.lat, item.lon, { status: "Адрес выбран. Координаты проставлены автоматически." });
    return;
  }
  $("trt-add-point-lat").value = "";
  $("trt-add-point-lon").value = "";
  if (trtManualMarker) { trtManualMarker.remove(); trtManualMarker = null; }
  if (trtManualMap) trtManualMap.setView([item.lat, item.lon], Math.max(trtManualMap.getZoom(), 14));
  statusNode.textContent = "Улица или населённый пункт найден. Допишите номер дома либо поставьте точку на карте.";
  statusNode.classList.remove("error");
}

async function updateManualTrtAddressSuggestions() {
  const input = $("trt-add-point-address");
  const text = input?.value?.trim() || "";
  if (text.length < 3) return hideManualTrtAddressSuggestions();
  try {
    trtManualAddressSuggestions = await fetchManualTrtAddressSuggestions(text);
    trtManualAddressSuggestionIndex = -1;
    renderManualTrtAddressSuggestions();
  } catch (error) {
    if (error?.name === "AbortError") return;
    hideManualTrtAddressSuggestions();
    const statusNode = $("trt-add-point-location-status");
    if (statusNode) {
      statusNode.textContent = "Подсказки сейчас не ответили. Можно продолжить ввод и нажать «Найти» — точный поиск работает через сервер VOG.";
      statusNode.classList.remove("error");
    }
  }
}

function scheduleManualTrtAddressSuggestions() {
  window.clearTimeout(trtManualAddressSuggestTimer);
  trtManualAddressSuggestTimer = window.setTimeout(updateManualTrtAddressSuggestions, 280);
}

function manualTrtFallbackReverseAddress(address = {}) {
  const city = trtRussianCityName(address.city || address.town || address.village || address.municipality || address.locality || "");
  const street = String(address.road || address.pedestrian || address.residential || "").trim();
  const house = String(address.house_number || "").trim();
  const parts = [];
  if (city) parts.push(city);
  if (street) parts.push(`${street}${house ? `, ${house}` : ""}`);
  return parts.join(", ");
}

async function reverseGeocodeManualTrt(lat, lon) {
  const sequence = ++trtManualReverseSequence;
  const statusNode = $("trt-add-point-location-status");
  statusNode.textContent = "Точка выбрана. Определяю адрес…";
  statusNode.classList.remove("error");
  let displayName = "";
  try {
    const result = await api("/admin/sales-import", {
      method: "POST",
      timeout: 15000,
      body: JSON.stringify({ scope: "trt_address_lookup", operation: "reverse", lat, lon }),
    });
    const feature = Array.isArray(result?.features) ? result.features[0] : null;
    if (feature) displayName = trtManualAddressLabel(feature);
  } catch {}
  if (sequence !== trtManualReverseSequence) return;
  if (displayName) $("trt-add-point-address").value = displayName;
  statusNode.textContent = displayName ? "Координаты и адрес определены по точке на карте." : "Координаты выбраны. Адрес введите вручную.";
}

function refreshManualTrtCityLabels() {
  if (!trtManualMap || !trtManualCityLabelLayer) return;
  trtManualCityLabelLayer.clearLayers();
  const zoom = trtManualMap.getZoom();
  const mapSize = trtManualMap.getSize();
  const occupied = [];
  const rows = buildTrtCityLabelData().filter((row) => zoom >= row.minZoom);

  rows.forEach((row) => {
    const point = trtManualMap.latLngToContainerPoint([row.lat, row.lon]);
    if (point.x < -80 || point.y < -40 || point.x > mapSize.x + 80 || point.y > mapSize.y + 40) return;
    const box = trtCityLabelBox(row, point);
    if (occupied.some((existing) => trtCityLabelBoxesOverlap(existing, box))) return;
    occupied.push(box);
    L.marker([row.lat, row.lon], {
      interactive: false, keyboard: false, zIndexOffset: -250,
      icon: L.divIcon({
        className: "trt-city-label-icon",
        html: `<span class="trt-city-label trt-city-label-${row.tier}">${escapeHtml(row.city)}</span>`,
        iconSize: null,
      }),
    }).addTo(trtManualCityLabelLayer);
  });
}

function initializeManualTrtMap() {
  const host = $("trt-add-point-map");
  if (!host || !window.L) return;
  if (!trtManualMap) {
    const center = trtMap?.getCenter?.();
    const initialCenter = center ? [center.lat, center.lng] : DEFAULT_MAP_VIEW.center;
    const initialZoom = trtMap ? Math.max(5, Math.min(12, trtMap.getZoom())) : 5;
    trtManualMap = L.map(host).setView(initialCenter, initialZoom);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 20, attribution: "© OpenStreetMap contributors · © CARTO",
    }).addTo(trtManualMap);
    trtManualMap.attributionControl.setPrefix("");
    trtManualCityLabelLayer = L.layerGroup().addTo(trtManualMap);
    trtManualMap.on("moveend zoomend", refreshManualTrtCityLabels);
    refreshManualTrtCityLabels();
    trtManualMap.on("click", ({ latlng }) => {
      hideManualTrtAddressSuggestions();
      setManualTrtLocation(latlng.lat, latlng.lng, { center: false, status: "Точка выбрана. Определяю адрес…" });
      reverseGeocodeManualTrt(latlng.lat, latlng.lng);
    });
  }
  window.setTimeout(() => { trtManualMap?.invalidateSize(); refreshManualTrtCityLabels(); }, 60);
}

function resetManualTrtForm() {
  const form = $("trt-add-point-form");
  form?.reset();
  $("trt-add-point-status").value = "НАКБ";
  $("trt-add-point-lat").value = "";
  $("trt-add-point-lon").value = "";
  $("trt-add-point-error").hidden = true;
  const statusNode = $("trt-add-point-location-status");
  statusNode.textContent = "Начните вводить город, улицу или дом — появятся подсказки. Либо поставьте точку на карте справа.";
  statusNode.classList.remove("error");
  trtManualReverseSequence += 1;
  window.clearTimeout(trtManualAddressSuggestTimer);
  if (trtManualAddressSuggestAbort) trtManualAddressSuggestAbort.abort();
  trtManualAddressSuggestAbort = null;
  hideManualTrtAddressSuggestions();
  if (trtManualMarker) { trtManualMarker.remove(); trtManualMarker = null; }
}

async function openManualTrtDialog() {
  if (!isSystemAdmin()) return;
  try { await ensureTrtData(); } catch (error) { showToast(error.message); return; }
  resetManualTrtForm();
  const currentDirection = $("trt-direction-filter")?.value || trtSmartFilters.find((item) => item.type === "direction")?.value || "";
  manualTrtSelectOptions("trt-add-point-direction", state.trtPoints.map((point) => point.direction), currentDirection);
  manualTrtSelectOptions("trt-add-point-format", state.trtPoints.map((point) => point.format));
  const dialog = $("trt-add-point-dialog");
  if (!dialog) return;
  dialog.showModal();
  initializeManualTrtMap();
  window.setTimeout(() => $("trt-add-point-client")?.focus(), 80);
}

function closeManualTrtDialog() {
  hideManualTrtAddressSuggestions();
  const dialog = $("trt-add-point-dialog");
  if (dialog?.open) dialog.close();
}

async function geocodeManualTrtAddress() {
  const address = $("trt-add-point-address").value.trim();
  const statusNode = $("trt-add-point-location-status");
  if (!address) return showToast("Введите адрес ТРТ");
  statusNode.textContent = "Ищу адрес…";
  statusNode.classList.remove("error");
  try {
    const rows = await fetchManualTrtAddressSuggestions(address, { limit: 7, explicit: true });
    trtManualAddressSuggestions = rows;
    if (!rows.length) throw new Error("Адрес не найден. Попробуйте ввести город и часть улицы или поставьте точку на карте.");
    const exact = rows.find((item) => item.hasHouse);
    if (exact) {
      focusManualTrtAddressSuggestion(exact);
      return;
    }
    trtManualAddressSuggestionIndex = 0;
    renderManualTrtAddressSuggestions();
    const first = rows[0];
    if (trtManualMap) trtManualMap.setView([first.lat, first.lon], Math.max(trtManualMap.getZoom(), 13));
    statusNode.textContent = "Нашла несколько вариантов. Выберите подсказку; если это улица — допишите номер дома.";
  } catch (error) {
    if (error?.name === "AbortError") return;
    statusNode.textContent = error.message || "Не удалось найти адрес.";
    statusNode.classList.add("error");
  }
}

async function saveManualTrt(event) {
  event?.preventDefault();
  if (!isSystemAdmin()) return;
  const errorBox = $("trt-add-point-error");
  const button = $("trt-add-point-save");
  errorBox.hidden = true;
  const latRaw = $("trt-add-point-lat").value.trim();
  const lonRaw = $("trt-add-point-lon").value.trim();
  const payload = {
    sourceType: "new_manual",
    client: $("trt-add-point-client").value.trim(),
    address: $("trt-add-point-address").value.trim(),
    direction: $("trt-add-point-direction").value,
    format: $("trt-add-point-format").value,
    status: $("trt-add-point-status").value,
    lat: latRaw ? Number(latRaw) : null,
    lon: lonRaw ? Number(lonRaw) : null,
  };
  if (!payload.client || !payload.address || !payload.direction || !payload.format) {
    errorBox.textContent = "Заполните название, адрес, направление и формат."; errorBox.hidden = false; return;
  }
  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lon)) {
    errorBox.textContent = "Сначала найдите адрес или поставьте точку на карте."; errorBox.hidden = false; return;
  }
  const original = button.textContent;
  button.disabled = true; button.textContent = "Добавление…";
  try {
    const result = await api("/trt", { method: "POST", timeout: 60000, body: JSON.stringify(payload) });
    const newPointId = String(result?.point?.id || "");
    state.trtLoaded = false;
    await ensureTrtData();
    initTrtMap();
    trtSmartFilters = [{ type: "source", value: "new_bulk", label: trtOriginLabel("new_bulk") }];
    persistTrtSmartFilters();
    renderTrtSmartFilterChips();
    renderTrtMap();
    closeManualTrtDialog();
    showToast("Новая ТРТ добавлена");
    if (newPointId) window.setTimeout(() => openTrtCard(newPointId, true), 80);
  } catch (error) {
    errorBox.textContent = error.message || "Не удалось добавить ТРТ."; errorBox.hidden = false;
  } finally {
    button.disabled = false; button.textContent = original;
  }
}

async function loadLogisticsDictionaries(force=false) { if(state.logistics.dictionaries&&!force){renderLogisticsDictionaries();return;} try{state.logistics.dictionaries=await api("/logistics?view=dictionaries");renderLogisticsDictionaries();}catch(exc){$("logistics-error").textContent=exc.message;$("logistics-error").hidden=false;} }
function populateLogisticsAliasSelects(){ const wa=new Set(state.logistics.observedWarehouses||[]), va=new Set(state.logistics.observedVehicles||[]); (state.logistics.dictionaries?.warehouseAliases||[]).forEach(a=>wa.add(a.sourceAlias)); (state.logistics.dictionaries?.vehicleAliases||[]).forEach(a=>va.add(a.sourceAlias));
  const w=$("warehouse-source-alias"), v=$("vehicle-source-alias"); if(w) w.innerHTML='<option value="">Выберите обозначение</option>'+[...wa].sort().map(a=>`<option>${escapeHtml(a)}</option>`).join(""); if(v) v.innerHTML='<option value="">Выберите обозначение</option>'+[...va].sort().map(a=>`<option>${escapeHtml(a)}</option>`).join(""); }
function renderLogisticsDictionaries(){ const d=state.logistics.dictionaries||{}; const wa=d.warehouseAliases||[], va=d.vehicleAliases||[];
  $("warehouses-table").innerHTML=(d.warehouses||[]).map(w=>`<tr data-warehouse-id="${escapeHtml(w.warehouseId)}"><td><strong>${escapeHtml(w.officialName)}</strong></td><td>${escapeHtml(w.address)}</td><td>${logisticsDecimal(w.lat,6)}, ${logisticsDecimal(w.lon,6)}</td><td>${wa.filter(a=>a.warehouseId===w.warehouseId).map(a=>escapeHtml(a.sourceAlias)).join("<br>")||"—"}</td></tr>`).join(""); $("warehouses-empty").hidden=Boolean((d.warehouses||[]).length);
  $("vehicles-table").innerHTML=(d.vehicles||[]).map(v=>`<tr><td><strong>${escapeHtml(v.officialName)}</strong></td><td>${logisticsDecimal(v.capacityTons,1)} т</td><td>${logisticsDecimal(v.volumeM3,1)} м³</td><td>${va.filter(a=>a.vehicleId===v.vehicleId).map(a=>escapeHtml(a.sourceAlias)).join("<br>")||"—"}</td></tr>`).join(""); $("vehicles-empty").hidden=Boolean((d.vehicles||[]).length); populateLogisticsAliasSelects(); renderWarehouseMarkers(); }
function initializeWarehouseMap(){ if(warehouseMap){warehouseMap.invalidateSize();return;} const el=$("warehouse-map"); if(!el||!window.L)return; warehouseMap=L.map(el).setView([55.75,37.62],5); L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png",{subdomains:"abcd",maxZoom:20,attribution:"© OpenStreetMap contributors · © CARTO"}).addTo(warehouseMap); warehouseMap.attributionControl.setPrefix(""); warehouseMap.on("click",({latlng})=>setWarehousePoint(latlng.lat,latlng.lng)); renderWarehouseMarkers(); }
function setWarehousePoint(lat,lon){ $("warehouse-lat").value=Number(lat).toFixed(6); $("warehouse-lon").value=Number(lon).toFixed(6); if(!warehouseMap)return; if(warehouseMarker)warehouseMarker.remove(); warehouseMarker=L.marker([lat,lon]).addTo(warehouseMap); warehouseMap.setView([lat,lon],14); }
function renderWarehouseMarkers(){ if(!warehouseMap||!state.logistics.dictionaries)return; (state.logistics.dictionaries.warehouses||[]).forEach(w=>L.circleMarker([w.lat,w.lon],{radius:7}).addTo(warehouseMap).bindPopup(`<strong>${escapeHtml(w.officialName)}</strong><br>${escapeHtml(w.address)}`)); }
async function geocodeWarehouse(){ const address=$("warehouse-address").value.trim(); if(!address)return showToast("Введите адрес склада"); try{const response=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(address)}`,{headers:{"Accept":"application/json"}}); const rows=await response.json(); if(!rows.length)throw new Error("Адрес не найден"); setWarehousePoint(Number(rows[0].lat),Number(rows[0].lon));}catch(exc){showToast(exc.message||"Не удалось найти адрес");} }
async function saveWarehouse(){ try{await api("/admin/logistics",{method:"POST",body:JSON.stringify({operation:"save_warehouse",warehouseId:$("warehouse-id").value,sourceAlias:$("warehouse-source-alias").value,officialName:$("warehouse-name").value,address:$("warehouse-address").value,lat:Number($("warehouse-lat").value),lon:Number($("warehouse-lon").value),isActive:true})}); showToast("Склад сохранён"); state.logistics.dictionaries=null; await loadLogisticsDictionaries(true);}catch(exc){showToast(exc.message);} }
async function saveVehicle(){ try{await api("/admin/logistics",{method:"POST",body:JSON.stringify({operation:"save_vehicle",vehicleId:$("vehicle-id").value,sourceAlias:$("vehicle-source-alias").value,officialName:$("vehicle-name").value,capacityTons:Number($("vehicle-capacity").value),volumeM3:Number($("vehicle-volume").value),isActive:true})}); showToast("Автомобиль сохранён"); state.logistics.dictionaries=null; await loadLogisticsDictionaries(true);}catch(exc){showToast(exc.message);} }



$("trt-add-point-button")?.addEventListener("click", openManualTrtDialog);
$("trt-add-point-close")?.addEventListener("click", closeManualTrtDialog);
$("trt-add-point-cancel")?.addEventListener("click", closeManualTrtDialog);
$("trt-add-point-geocode")?.addEventListener("click", geocodeManualTrtAddress);
$("trt-add-point-form")?.addEventListener("submit", saveManualTrt);
$("trt-add-point-address")?.addEventListener("input", scheduleManualTrtAddressSuggestions);
$("trt-add-point-address")?.addEventListener("focus", scheduleManualTrtAddressSuggestions);
$("trt-add-point-address")?.addEventListener("blur", () => window.setTimeout(hideManualTrtAddressSuggestions, 180));
$("trt-add-point-address")?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && trtManualAddressSuggestions.length) { event.preventDefault(); trtManualAddressSuggestionIndex = Math.min(trtManualAddressSuggestions.length - 1, trtManualAddressSuggestionIndex + 1); renderManualTrtAddressSuggestions(); return; }
  if (event.key === "ArrowUp" && trtManualAddressSuggestions.length) { event.preventDefault(); trtManualAddressSuggestionIndex = Math.max(0, trtManualAddressSuggestionIndex - 1); renderManualTrtAddressSuggestions(); return; }
  if (event.key === "Escape") { hideManualTrtAddressSuggestions(); return; }
  if (event.key === "Enter") {
    event.preventDefault();
    if (trtManualAddressSuggestionIndex >= 0 && trtManualAddressSuggestions[trtManualAddressSuggestionIndex]) focusManualTrtAddressSuggestion(trtManualAddressSuggestions[trtManualAddressSuggestionIndex]);
    else geocodeManualTrtAddress();
  }
});
$("trt-add-point-address-suggestions")?.addEventListener("mousedown", (event) => {
  const button = event.target.closest?.("[data-trt-address-suggestion]");
  if (!button) return;
  event.preventDefault();
  const item = trtManualAddressSuggestions[Number(button.dataset.trtAddressSuggestion)];
  if (item) focusManualTrtAddressSuggestion(item);
});
$("trt-add-point-dialog")?.addEventListener("cancel", (event) => { event.preventDefault(); closeManualTrtDialog(); });

$("trt-import-file")?.addEventListener("change", () => { resetTrtBulkImport(false); updateTrtBulkPreviewButton(); });
$("trt-import-preview-button")?.addEventListener("click", previewTrtBulkImport);
$("trt-import-reset-button")?.addEventListener("click", () => resetTrtBulkImport(true));
$("trt-import-commit-button")?.addEventListener("click", commitTrtBulkImport);
$("trt-import-map-button")?.addEventListener("click", openBulkNewTrtOnMap);
$("trt-import-include-warning")?.addEventListener("change", updateTrtBulkCommitButton);
["trt-import-direction", "trt-import-format", "trt-import-status"].forEach((id) => $(id)?.addEventListener("change", updateTrtBulkCommitButton));

$("tile-scenario-file")?.addEventListener("change", () => { resetTileScenario(false); updateTileScenarioPreviewButton(); });
$("tile-scenario-year")?.addEventListener("change", () => resetTileScenario(false));
$("tile-scenario-preview")?.addEventListener("click", previewTileScenario);
$("tile-scenario-reset")?.addEventListener("click", () => resetTileScenario(true));
$("tile-scenario-commit")?.addEventListener("click", commitTileScenario);
$("tile-scenario-filter")?.addEventListener("change", renderTileScenario);

$("fdiy-directory-refresh")?.addEventListener("click", () => loadFdiyDirectory(true));
$("fdiy-directory-search")?.addEventListener("input", renderFdiyDirectory);
$("fdiy-directory-filter")?.addEventListener("change", renderFdiyDirectory);
$("fdiy-directory-body")?.addEventListener("change", (event) => {
  const tr = event.target.closest?.("tr[data-fdiy-directory-index]"); if (!tr) return;
  if (event.target.matches("[data-fdiy-mode]")) { const fdiy = event.target.value === "FDIY"; tr.querySelector("[data-fdiy-network-name]").disabled = !fdiy; tr.querySelector("[data-fdiy-code-mode]").disabled = !fdiy; }
});
$("fdiy-directory-body")?.addEventListener("click", (event) => { const button = event.target.closest?.("[data-fdiy-save-rule]"); if (button) saveFdiyDirectoryRow(button); });
$("fdiy-file")?.addEventListener("change", () => { resetFdiyImport(false); updateFdiyPreviewButton(); });
$("fdiy-network")?.addEventListener("change", () => resetFdiyImport(false));
$("fdiy-start-year")?.addEventListener("change", () => resetFdiyImport(false));
$("fdiy-month-year")?.addEventListener("change", () => resetFdiyImport(false));
$("fdiy-month")?.addEventListener("change", () => resetFdiyImport(false));
$("fdiy-preview")?.addEventListener("click", previewFdiyImport);
$("fdiy-reset")?.addEventListener("click", () => resetFdiyImport(true));
$("fdiy-commit")?.addEventListener("click", commitFdiyImport);
$("fdiy-template")?.addEventListener("click", downloadFdiyTemplate);

$("sales-import-file").addEventListener("change", () => {
  resetSalesImport(false);
  updateSalesImportPreviewButton();
});
$("sales-import-year").addEventListener("change", () => resetSalesImport(false));
$("sales-import-month").addEventListener("change", () => resetSalesImport(false));
$("sales-import-preview-button").addEventListener("click", previewSalesImport);
$("sales-import-reset-button").addEventListener("click", () => resetSalesImport(true));
$("sales-import-commit-button").addEventListener("click", commitSalesImport);

document.querySelectorAll("[data-import-tab]").forEach((button) => {
  button.addEventListener("click", () => setDataImportTab(button.dataset.importTab));
});
document.querySelectorAll("[data-analysis-import]").forEach((panel) => {
  const kind = panel.dataset.analysisImport;
  panel.querySelector("[data-analysis-file]")?.addEventListener("change", () => updateAnalysisPreviewButton(kind));
  panel.querySelector("[data-analysis-preview]")?.addEventListener("click", () => previewAnalysisImport(kind));
  panel.querySelector("[data-analysis-reset]")?.addEventListener("click", () => resetAnalysisImport(kind, true));
  panel.querySelector("[data-analysis-commit]")?.addEventListener("click", () => commitAnalysisImport(kind));
  panel.querySelector("[data-analysis-template]")?.addEventListener("click", () => downloadAnalysisTemplate(kind));
});

["activity-search", "activity-employee-filter", "activity-action-filter", "activity-source-filter", "activity-date-from", "activity-date-to"].forEach((id) => {
  const element = $(id);
  if (!element) return;
  element.addEventListener(id === "activity-search" ? "input" : "change", renderActivity);
});
$("activity-refresh")?.addEventListener("click", () => loadActivity(true));


document.querySelectorAll("[data-logistics-tab]").forEach((button)=>button.addEventListener("click",()=>setLogisticsTab(button.dataset.logisticsTab)));
$("logistics-refresh")?.addEventListener("click",()=>{state.logistics.loaded=false;loadLogistics(true);});
$("logistics-year")?.addEventListener("change",()=>{state.logistics.loaded=false;loadLogistics(true);});
$("logistics-month")?.addEventListener("change",()=>{state.logistics.loaded=false;loadLogistics(true);});
$("logistics-trip-search")?.addEventListener("input",renderLogisticsTrips);
$("logistics-color-filter")?.addEventListener("change",renderLogisticsTrips);
$("logistics-file")?.addEventListener("change",()=>{resetLogisticsImport(false);$("logistics-preview-button").disabled=!$("logistics-file").files?.[0]||!isSystemAdmin();});
$("logistics-preview-button")?.addEventListener("click",previewLogisticsFile);
$("logistics-reset-button")?.addEventListener("click",()=>resetLogisticsImport(true));
const logisticsCommitButton=$("logistics-commit-button");
if(logisticsCommitButton){
  logisticsCommitButton.dataset.webVersion="7.10";
  logisticsCommitButton.addEventListener("click",(event)=>{
    event.preventDefault();
    commitLogistics();
  });
}
// Резервный обработчик: защищает кнопку от потери прямого listener при повторной отрисовке DOM.
document.addEventListener("click",(event)=>{
  const button=event.target?.closest?.("#logistics-commit-button");
  if(!button || event.defaultPrevented) return;
  event.preventDefault();
  commitLogistics();
},true);
$("logistics-match-table")?.addEventListener("change",(event)=>{if(event.target.matches(".logistics-match-select"))applyLogisticsManualMatch(event.target);});
$("warehouse-geocode")?.addEventListener("click",geocodeWarehouse);
$("warehouse-save")?.addEventListener("click",saveWarehouse);
$("vehicle-save")?.addEventListener("click",saveVehicle);

$("trt-master-audit-search")?.addEventListener("input", renderTrtMasterAudit);
$("trt-master-audit-filter")?.addEventListener("change", renderTrtMasterAudit);
$("trt-master-audit-refresh")?.addEventListener("click", () => loadTrtMasterAudit(true));

window.addEventListener("hashchange", () => {
  const page = location.hash.slice(1);
  if (PAGES.has(page)) showPage(page, false);
});

mountTrtToolsInMainSidebar();
restoreTrtSmartFilters();
restoreTrtMapMode();
restoreSession();