"use strict";

const API_BASE = "https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net";
const SESSION_KEY = "trt_web_session";
const TRT_MAP_VIEW_KEY = "trt_web_map_view";
const TRT_MAP_DEFAULT_CENTER = [55.7558, 37.6173];
const TRT_MAP_DEFAULT_ZOOM = 10;
const PAGES = new Set(["employees", "sales-import", "activity", "tasks", "visits", "trt", "logistics"]);

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
  currentPage: PAGES.has(location.hash.slice(1)) ? location.hash.slice(1) : "trt",
};

let trtMap = null;
let trtMarkerLayer = null;
let trtRegionLayer = null;
let trtRegionsLoading = false;
let trtSalesChart = null;
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
  state.logistics = { loaded: false, trips: [], summary: {}, dictionaries: null, aliasCatalog: null, aliasMap: new Map(), suggestionMap: new Map(), preview: null, sourceTrips: [], fileName: "", observedWarehouses: [], observedVehicles: [], matchResults: new Map(), uniqueMatchItems: [] };
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
  const isTrt = page === "trt";
  const isSettings = page === "employees" || page === "sales-import" || page === "activity";
  const isAnalytics = page === "logistics";
  if (isTrt) setNavGroupExpanded("trt", true);
  if (isSettings) setNavGroupExpanded("settings", true);
  if (isAnalytics) setNavGroupExpanded("analytics", true);

  document.querySelectorAll("[data-nav-group]").forEach((button) => {
    const group = button.dataset.navGroup;
    const active = (group === "trt" && isTrt) || (group === "settings" && isSettings) || (group === "analytics" && isAnalytics);
    button.classList.toggle("active", active);
  });
  document.querySelectorAll(".nav-subitem").forEach((button) => {
    let active = button.dataset.page === page;
    if (button.dataset.trtView) active = active && button.dataset.trtView === trtMainView;
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
    trtRegionsLoading = false;
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

function showPage(page, updateHash = true) {
  let nextPage = PAGES.has(page) ? page : "trt";
  if (["employees", "sales-import", "activity"].includes(nextPage) && !isSystemAdmin()) nextPage = "trt";
  state.currentPage = nextPage;
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
  if (nextPage === "sales-import") { initializeSalesImportPeriod(); }
  if (nextPage === "logistics") { initializeLogisticsPeriod(); loadLogistics(); }

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
  const activityPage = $("page-activity");
  const gdAdmin = isSystemAdmin();
  if (settingsNavGroup) settingsNavGroup.hidden = !gdAdmin;
  if (analyticsNavGroup) analyticsNavGroup.hidden = !["GD","KD","RRO"].includes(String(state.user?.role || "").toUpperCase()) && !gdAdmin;
  if (employeesPage && !gdAdmin) employeesPage.hidden = true;
  if (salesImportPage && !gdAdmin) salesImportPage.hidden = true;
  if (activityPage && !gdAdmin) activityPage.hidden = true;

  $("add-employee-button").hidden = !gdAdmin;
  $("add-employee-button").title = gdAdmin
    ? "Добавить сотрудника и создать ему учётную запись"
    : "Раздел доступен только администратору";

  if (!gdAdmin && ["employees", "sales-import", "activity"].includes(state.currentPage)) state.currentPage = "trt";
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

function renderTrtFourP(point) {
  const visit = latestFourPVisit(point?.id);
  const assessment = fourPAssessment(visit);
  const section = $("trt-fourp-card");
  const empty = $("trt-fourp-empty");
  const content = $("trt-fourp-content");

  section.hidden = false;
  empty.hidden = Boolean(assessment);
  content.hidden = !assessment;
  $("trt-fourp-total").textContent = fourPScoreText(assessment?.totalScore);
  if (!assessment) return;

  const product = assessment.product || {};
  const promotion = assessment.promotion || {};
  const commercial = promotion.commercialTermsScore == null
    ? (promotion.commercialTermsStatus || "Ожидает данных КУ")
    : fourPScoreText(promotion.commercialTermsScore);
  $("trt-fourp-details").innerHTML = `
    <span>Местоположение ТРТ <b>${fourPScoreText(assessment.place?.locationScore)}</b></span>
    <span>Местоположение ВОГ <b>${fourPScoreText(assessment.place?.vogPlacementScore)}</b></span>
    <span>Ассортимент <b>${Number(product.skuCount || 0).toLocaleString("ru-RU")} SKU · ${fourPScoreText(product.assortmentScore)}</b></span>
    <span>SKU от ВОГ в ассортименте ТРТ <b>${product.vogSkuCount == null ? "—" : Number(product.vogSkuCount).toLocaleString("ru-RU")} SKU · ${String(product.vogSharePercent ?? 0).replace(".", ",")}% · ${fourPScoreText(product.vogShareScore)}</b></span>
    <span>Коммерческие условия <b>${escapeHtml(commercial)}</b></span>
    <span>Мотивация <b>${promotion.sellerCount == null ? fourPScoreText(promotion.sellerMotivationScore) : `${promotion.vogClubParticipants ?? 0}/${promotion.sellerCount} · ${fourPScoreText(promotion.sellerMotivationScore)}`}</b></span>
    <span>Качество выставки ВОГ <b>${fourPScoreText(promotion.consumerPromoScore)}</b></span>`;
  $("trt-fourp-date").textContent = `Последняя оценка: ${formatVisitDateTime(visit)}`;
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
  populateAnalyticsFilters(true);
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

function initTrtMap() {
  if (trtMap || typeof window.L === "undefined") return;

  const savedView = readTrtMapView();
  trtMap = L.map("trt-map").setView(
    savedView?.center || TRT_MAP_DEFAULT_CENTER,
    savedView?.zoom ?? TRT_MAP_DEFAULT_ZOOM
  );
  trtMap.on("moveend zoomend", saveTrtMapView);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors",
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
          const color = trtColor(average);
          return L.divIcon({
            html: `<div class="legacy-cluster" style="background:${color}"><span>${markers.length}</span></div>`,
            className: "",
            iconSize: [40, 40],
          });
        },
      })
    : L.layerGroup();

  trtMarkerLayer.addTo(trtMap);
}

function filteredTrtPoints() {
  const direction = $("trt-direction-filter").value;
  const manager = $("trt-manager-filter").value;

  return state.trtPoints.filter((point) => {
    if (direction && point.direction !== direction) return false;
    if (manager && point.manager !== manager) return false;
    return true;
  });
}

function trtMarkerIcon(point) {
  return L.divIcon({
    className: "",
    html: `<div class="legacy-size-marker" style="background:${trtColor(point.size)}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function openTrtCard(pointId, focusMap = true) {
  const point = state.trtPoints.find((item) => String(item.id) === String(pointId));
  if (!point) return;

  state.trtSelectedId = String(point.id);
  $("trt-map-empty").hidden = true;
  $("trt-map-card").hidden = false;
  $("trt-card-name").textContent = point.client || point.holding || "ТРТ";
  $("trt-card-direction").textContent = point.direction || "—";
  $("trt-card-manager").textContent = shortPersonName(point.manager) || "—";
  $("trt-card-holding").textContent = point.holding || "—";
  $("trt-card-format").textContent = point.format || "—";
  $("trt-card-abc").textContent = point.abcCategory || "—";
  $("trt-card-region").textContent = point.region || "—";
  $("trt-card-address").textContent = point.address || "—";
  renderTrtFourP(point);

  const badge = $("trt-card-size-badge");
  badge.textContent = formatTrtSize(point);
  badge.style.background = trtColor(point.size);

  const hasSales = Object.values(point.sales || {}).some((values) => (
    Array.isArray(values) && values.some((value) => Number.isFinite(Number(value)))
  ));
  $("trt-sales-button").disabled = !hasSales;
  $("trt-sales-button").textContent = hasSales ? "Продажи" : "Продажи не найдены";

  if (focusMap && trtMap && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))) {
    setTrtMainView("map");
    trtMap.setView([Number(point.lat), Number(point.lon)], Math.max(trtMap.getZoom(), 14));
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

function trtRegionKey(feature) {
  const name = trtRegionFeatureName(feature).toLowerCase();
  if (
    name === "moscow"
    || name === "moskva"
    || name === "москва"
    || name.includes("moscow city")
    || name.includes("moscow oblast")
    || name.includes("moskovskaya")
    || name.includes("московская область")
  ) return "Москва и Московская область";

  if (
    name.includes("nizhny novgorod")
    || name.includes("nizhegorod")
    || name.includes("нижегород")
  ) return "Нижегородская область";

  return null;
}

function trtRegionStyle(feature) {
  const stats = recalculateTrtRegionStats();
  const key = trtRegionKey(feature);
  const item = key ? stats[key] : null;
  return {
    color: "#334155",
    weight: 1.7,
    fillColor: item ? regionResultColor(item.yoy) : "#e2e8f0",
    fillOpacity: item ? 0.45 : 0.05,
  };
}

function bindTrtRegion(feature, layer) {
  const key = trtRegionKey(feature);
  if (!key) return;
  layer.bindTooltip(key);
  layer.on({
    mouseover(event) {
      event.target.setStyle({ weight: 3, fillOpacity: 0.62 });
      event.target.bringToFront();
    },
    mouseout(event) {
      trtRegionLayer?.resetStyle(event.target);
    },
    click() {
      const rows = state.trtPoints.filter((point) => point.region === key);
      const coordinates = rows
        .filter((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon)))
        .map((point) => [Number(point.lat), Number(point.lon)]);
      if (coordinates.length) trtMap.fitBounds(L.latLngBounds(coordinates).pad(0.08));
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
      title: point.client || point.holding || "ТРТ",
    });
    marker.bindTooltip(point.client || point.holding || "ТРТ");
    marker.on("click", () => openTrtCard(point.id, false));
    trtMarkerLayer.addLayer(marker);
  });

  updateTrtMapMode();
  $("trt-visible-count").textContent = `Показано ТРТ: ${visible.length}`;
  $("trt-data-status").textContent = `Всего в базе: ${state.trtPoints.length}`;

  if (state.trtFitRequested && visible.length) {
    trtMap.fitBounds(L.latLngBounds(coordinates).pad(0.08), { maxZoom: 13 });
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

function openTrtSales() {
  const point = selectedTrtPoint();
  if (!point) return;

  const sales2025 = (Array.isArray(point.sales?.["2025"]) ? point.sales["2025"] : [])
    .concat(Array(12).fill(null)).slice(0, 12);
  const sales2026 = (Array.isArray(point.sales?.["2026"]) ? point.sales["2026"] : [])
    .concat(Array(12).fill(null)).slice(0, 12);
  const unit = trtUnit(point);
  const ytd2025 = sumSales(sales2025, 6);
  const ytd2026 = sumSales(sales2026, 6);
  const yoy = ytd2025 ? ((ytd2026 - ytd2025) / ytd2025) * 100 : null;

  $("trt-sales-modal-title").textContent = `Продажи: ${point.client || point.holding || "ТРТ"}`;
  $("trt-sales-modal-subtitle").textContent = `Сравнение 2025 и 2026 годов, единица: ${unit}`;
  $("trt-sales-ytd-2025").textContent = formatSales(ytd2025, unit);
  $("trt-sales-ytd-2026").textContent = formatSales(ytd2026, unit);
  $("trt-sales-yoy").textContent = yoy === null
    ? "—"
    : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1).replace(".", ",")}%`;

  const yoyBox = $("trt-sales-yoy-box");
  yoyBox.classList.remove("sales-yoy-positive", "sales-yoy-negative", "sales-yoy-neutral");
  if (yoy === null || yoy === 0) yoyBox.classList.add("sales-yoy-neutral");
  else if (yoy > 0) yoyBox.classList.add("sales-yoy-positive");
  else yoyBox.classList.add("sales-yoy-negative");

  if (trtSalesChart) trtSalesChart.destroy();
  trtSalesChart = new Chart($("trt-sales-chart"), {
    type: "bar",
    data: {
      labels: analyticsMonthLabels(),
      datasets: [
        {
          label: "2025",
          data: sales2025,
          backgroundColor: "#b9dcff",
          borderColor: "#8fc5f5",
          borderWidth: 1,
          borderRadius: 5,
          maxBarThickness: 34,
        },
        {
          label: "2026",
          data: sales2026,
          backgroundColor: "#1677ff",
          borderColor: "#0b5ed7",
          borderWidth: 1,
          borderRadius: 5,
          maxBarThickness: 34,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180, easing: "linear" },
      interaction: { mode: "index", intersect: false },
      datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.86 } },
      plugins: {
        legend: { position: "top", align: "end" },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${Math.round(numberOrZero(context.parsed.y)).toLocaleString("ru-RU")} ${unit}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grace: "10%",
          ticks: {
            callback(value) {
              return Math.round(Number(value)).toLocaleString("ru-RU");
            },
          },
          title: { display: true, text: unit },
        },
        x: { title: { display: true, text: "Месяц" } },
      },
    },
  });

  $("trt-sales-modal").hidden = false;
}

function closeTrtSales() {
  $("trt-sales-modal").hidden = true;
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

function normalizeSalesHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s*\.\s*/g, ".")
    .replace(/местоположение/g, "месторасположение")
    .replace(/\s+/g, " ");
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
      <td><strong>${escapeHtml(row.location || "—")}</strong>${row.message ? `<small>${escapeHtml(row.message)}</small>` : ""}</td>
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
  if (event.key === "Escape" && !$("visit-detail-modal").hidden) closeVisitDetail();
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
    state.trtFitRequested = false;
    preserveTrtMapView(renderTrtMap);
  });
});

$("trt-map-mode").addEventListener("change", () => {
  preserveTrtMapView(updateTrtMapMode);
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

$("trt-sales-button").addEventListener("click", openTrtSales);
$("trt-sales-modal-close").addEventListener("click", closeTrtSales);
$("trt-sales-modal").addEventListener("click", (event) => {
  if (event.target === $("trt-sales-modal")) closeTrtSales();
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
    if (button.dataset.trtView) setTrtMainView(button.dataset.trtView);
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
  commitButton.disabled=!readyTrips.length;
  commitButton.setAttribute("aria-disabled",commitButton.disabled?"true":"false");
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
  const unresolvedCount=Number(state.logistics.preview?.summary?.unresolvedCount||0);
  if(unresolvedCount>0){
    const confirmed=window.confirm(
      `В файле осталось ${unresolvedCount} несопоставленных строк. Они будут загружены со статусом «Не определено» и не попадут в аналитику по ТРТ/клиентам до исправления. Продолжить загрузку?`
    );
    if(!confirmed)return;
  }
  button.disabled=true;
  button.textContent="Загрузка…";
  progress.hidden=false;
  $("logistics-error").hidden=true;
  try {
    const year=Number($("logistics-year").value);
    const month=Number($("logistics-month").value);
    const replace=Boolean(state.logistics.preview?.periodExists);
    progress.textContent="Подготовка загрузки логистики…";
    const started=await api("/admin/logistics-import",{
      method:"POST",
      body:JSON.stringify({operation:"commit_start",year,month,fileName:state.logistics.fileName,replace}),
      timeout:60000,
    });
    const results=[];
    const trips=(Array.isArray(state.logistics.sourceTrips)&&state.logistics.sourceTrips.length)
      ? state.logistics.sourceTrips
      : (Array.isArray(state.logistics.preview?.trips)?state.logistics.preview.trips:[]);
    if(!trips.length)throw new Error("Файл разобран, но список рейсов пуст. Нажмите «Другой файл» и выполните проверку повторно.");
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
    $("logistics-error").textContent=exc.message;
    $("logistics-error").hidden=false;
    button.disabled=false;
  } finally {
    progress.textContent="Разбор файла…";
    progress.hidden=true;
    button.textContent="Загрузить логистику";
  }
}

async function loadLogisticsDictionaries(force=false) { if(state.logistics.dictionaries&&!force){renderLogisticsDictionaries();return;} try{state.logistics.dictionaries=await api("/logistics?view=dictionaries");renderLogisticsDictionaries();}catch(exc){$("logistics-error").textContent=exc.message;$("logistics-error").hidden=false;} }
function populateLogisticsAliasSelects(){ const wa=new Set(state.logistics.observedWarehouses||[]), va=new Set(state.logistics.observedVehicles||[]); (state.logistics.dictionaries?.warehouseAliases||[]).forEach(a=>wa.add(a.sourceAlias)); (state.logistics.dictionaries?.vehicleAliases||[]).forEach(a=>va.add(a.sourceAlias));
  const w=$("warehouse-source-alias"), v=$("vehicle-source-alias"); if(w) w.innerHTML='<option value="">Выберите обозначение</option>'+[...wa].sort().map(a=>`<option>${escapeHtml(a)}</option>`).join(""); if(v) v.innerHTML='<option value="">Выберите обозначение</option>'+[...va].sort().map(a=>`<option>${escapeHtml(a)}</option>`).join(""); }
function renderLogisticsDictionaries(){ const d=state.logistics.dictionaries||{}; const wa=d.warehouseAliases||[], va=d.vehicleAliases||[];
  $("warehouses-table").innerHTML=(d.warehouses||[]).map(w=>`<tr data-warehouse-id="${escapeHtml(w.warehouseId)}"><td><strong>${escapeHtml(w.officialName)}</strong></td><td>${escapeHtml(w.address)}</td><td>${logisticsDecimal(w.lat,6)}, ${logisticsDecimal(w.lon,6)}</td><td>${wa.filter(a=>a.warehouseId===w.warehouseId).map(a=>escapeHtml(a.sourceAlias)).join("<br>")||"—"}</td></tr>`).join(""); $("warehouses-empty").hidden=Boolean((d.warehouses||[]).length);
  $("vehicles-table").innerHTML=(d.vehicles||[]).map(v=>`<tr><td><strong>${escapeHtml(v.officialName)}</strong></td><td>${logisticsDecimal(v.capacityTons,1)} т</td><td>${logisticsDecimal(v.volumeM3,1)} м³</td><td>${va.filter(a=>a.vehicleId===v.vehicleId).map(a=>escapeHtml(a.sourceAlias)).join("<br>")||"—"}</td></tr>`).join(""); $("vehicles-empty").hidden=Boolean((d.vehicles||[]).length); populateLogisticsAliasSelects(); renderWarehouseMarkers(); }
function initializeWarehouseMap(){ if(warehouseMap){warehouseMap.invalidateSize();return;} const el=$("warehouse-map"); if(!el||!window.L)return; warehouseMap=L.map(el).setView([55.75,37.62],5); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(warehouseMap); warehouseMap.on("click",({latlng})=>setWarehousePoint(latlng.lat,latlng.lng)); renderWarehouseMarkers(); }
function setWarehousePoint(lat,lon){ $("warehouse-lat").value=Number(lat).toFixed(6); $("warehouse-lon").value=Number(lon).toFixed(6); if(!warehouseMap)return; if(warehouseMarker)warehouseMarker.remove(); warehouseMarker=L.marker([lat,lon]).addTo(warehouseMap); warehouseMap.setView([lat,lon],14); }
function renderWarehouseMarkers(){ if(!warehouseMap||!state.logistics.dictionaries)return; (state.logistics.dictionaries.warehouses||[]).forEach(w=>L.circleMarker([w.lat,w.lon],{radius:7}).addTo(warehouseMap).bindPopup(`<strong>${escapeHtml(w.officialName)}</strong><br>${escapeHtml(w.address)}`)); }
async function geocodeWarehouse(){ const address=$("warehouse-address").value.trim(); if(!address)return showToast("Введите адрес склада"); try{const response=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(address)}`,{headers:{"Accept":"application/json"}}); const rows=await response.json(); if(!rows.length)throw new Error("Адрес не найден"); setWarehousePoint(Number(rows[0].lat),Number(rows[0].lon));}catch(exc){showToast(exc.message||"Не удалось найти адрес");} }
async function saveWarehouse(){ try{await api("/admin/logistics",{method:"POST",body:JSON.stringify({operation:"save_warehouse",warehouseId:$("warehouse-id").value,sourceAlias:$("warehouse-source-alias").value,officialName:$("warehouse-name").value,address:$("warehouse-address").value,lat:Number($("warehouse-lat").value),lon:Number($("warehouse-lon").value),isActive:true})}); showToast("Склад сохранён"); state.logistics.dictionaries=null; await loadLogisticsDictionaries(true);}catch(exc){showToast(exc.message);} }
async function saveVehicle(){ try{await api("/admin/logistics",{method:"POST",body:JSON.stringify({operation:"save_vehicle",vehicleId:$("vehicle-id").value,sourceAlias:$("vehicle-source-alias").value,officialName:$("vehicle-name").value,capacityTons:Number($("vehicle-capacity").value),volumeM3:Number($("vehicle-volume").value),isActive:true})}); showToast("Автомобиль сохранён"); state.logistics.dictionaries=null; await loadLogisticsDictionaries(true);}catch(exc){showToast(exc.message);} }


$("sales-import-file").addEventListener("change", () => {
  resetSalesImport(false);
  updateSalesImportPreviewButton();
});
$("sales-import-year").addEventListener("change", () => resetSalesImport(false));
$("sales-import-month").addEventListener("change", () => resetSalesImport(false));
$("sales-import-preview-button").addEventListener("click", previewSalesImport);
$("sales-import-reset-button").addEventListener("click", () => resetSalesImport(true));
$("sales-import-commit-button").addEventListener("click", commitSalesImport);

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
  logisticsCommitButton.dataset.webVersion="7.9";
  logisticsCommitButton.addEventListener("click",commitLogistics);
}
$("logistics-match-table")?.addEventListener("change",(event)=>{if(event.target.matches(".logistics-match-select"))applyLogisticsManualMatch(event.target);});
$("warehouse-geocode")?.addEventListener("click",geocodeWarehouse);
$("warehouse-save")?.addEventListener("click",saveWarehouse);
$("vehicle-save")?.addEventListener("click",saveVehicle);

window.addEventListener("hashchange", () => {
  const page = location.hash.slice(1);
  if (PAGES.has(page)) showPage(page, false);
});

mountTrtToolsInMainSidebar();
restoreSession();
