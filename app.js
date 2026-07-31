"use strict";

const API_BASE = "https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net";
const SESSION_KEY = "trt_web_session";
const TRT_MAP_VIEW_KEY = "trt_web_map_view";
const TRT_MAP_DEFAULT_CENTER = [55.7558, 37.6173];
const TRT_MAP_DEFAULT_ZOOM = 10;
const PAGES = new Set(["employees", "tasks", "visits", "trt"]);

const state = {
  token: localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "",
  user: null,
  employees: [],
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
  trtPoints: [],
  trtLoaded: false,
  trtSelectedId: "",
  trtFitRequested: true,
  currentPage: PAGES.has(location.hash.slice(1)) ? location.hash.slice(1) : "employees",
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
  state.trtPoints = [];
  state.trtLoaded = false;
  state.trtSelectedId = "";
  state.trtFitRequested = true;
}

function isGeneralDirector() {
  return String(state.user?.role || "").toUpperCase() === "GD";
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || "Некорректный ответ сервера." }; }

  if (response.status === 401 && path !== "/auth/login") {
    clearSession();
    showLogin();
  }

  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
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

function showPage(page, updateHash = true) {
  const nextPage = PAGES.has(page) ? page : "employees";
  state.currentPage = nextPage;

  document.querySelectorAll(".page-view").forEach((section) => {
    section.hidden = section.id !== `page-${nextPage}`;
  });

  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === nextPage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  if (updateHash && location.hash !== `#${nextPage}`) {
    history.replaceState(null, "", `#${nextPage}`);
  }

  if (nextPage === "employees" && state.token && state.employees.length === 0) {
    loadEmployees();
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
  $("sidebar-user-name").textContent = shortPersonName(state.user?.full_name || state.user?.fullName) || "—";
  $("add-employee-button").hidden = true;
  $("add-employee-button").title = "Структура сотрудников загружается из справочника";
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
        device_name: "ТРТ веб-кабинет",
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

async function loadEmployees() {
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
  const canEditStructure = false;

  $("employees-total").textContent = state.employees.length;
  $("employees-active").textContent = state.employees.filter((x) => x.isActive).length;
  $("employees-accounts").textContent = state.employees.filter((x) => x.hasAccount).length;
  $("employees-loading").hidden = true;
  $("employees-empty").hidden = items.length > 0;

  $("employees-table-body").innerHTML = items.map((item) => {
    const displayName = shortPersonName(item.displayName || item.fullName) || "—";
    const managerName = shortPersonName(item.managerName) || "—";
    return `
      <tr>
        <td><span class="employee-name">${escapeHtml(displayName)}</span></td>
        <td>${escapeHtml(item.position)}</td>
        <td>${escapeHtml(managerName)}</td>
        <td>${item.hasAccount
          ? `<span class="badge account">${escapeHtml(item.login || "Есть доступ")}</span>`
          : `<span class="badge">Без учётной записи</span>`}
        </td>
        <td>${item.isActive
          ? `<span class="badge success">Активен</span>`
          : `<span class="badge inactive">Отключён</span>`}
        </td>
        <td>${canEditStructure ? `<button class="edit-button" type="button" data-edit-id="${escapeHtml(item.employeeId)}">Изменить</button>` : ""}</td>
      </tr>`;
  }).join("");

  document.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => openEmployeeDialog(button.dataset.editId));
  });
}

function fillManagerOptions(currentEmployeeId = "", selectedManagerId = "") {
  const options = state.employees
    .filter((item) => item.employeeId !== currentEmployeeId && item.isActive)
    .map((item) => {
      const name = shortPersonName(item.displayName || item.fullName);
      return `<option value="${escapeHtml(item.employeeId)}">${escapeHtml(name)} — ${escapeHtml(item.position)}</option>`;
    })
    .join("");
  $("employee-manager").innerHTML = `<option value="">Нет руководителя</option>${options}`;
  $("employee-manager").value = selectedManagerId || "";
}

function openEmployeeDialog(employeeId = "") {
  const item = state.employees.find((employee) => employee.employeeId === employeeId);
  $("employee-form-error").hidden = true;
  $("employee-id").value = item?.employeeId || "";
  $("employee-full-name").value = item?.fullName || "";
  $("employee-position").value = item?.position || "";
  $("employee-role").value = item?.role || "employee";
  $("employee-active").checked = item?.isActive ?? true;
  $("employee-dialog-title").textContent = item ? shortPersonName(item.displayName || item.fullName) : "Новый сотрудник";
  fillManagerOptions(item?.employeeId || "", item?.managerId || "");
  $("employee-dialog").showModal();
}

function closeEmployeeDialog() {
  $("employee-dialog").close();
}

async function saveEmployee(event) {
  event.preventDefault();
  const error = $("employee-form-error");
  const button = $("employee-save-button");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Сохранение…";

  try {
    await api("/employees", {
      method: "POST",
      body: JSON.stringify({
        employeeId: $("employee-id").value,
        fullName: $("employee-full-name").value.trim(),
        position: $("employee-position").value.trim(),
        managerId: $("employee-manager").value,
        role: $("employee-role").value,
        isActive: $("employee-active").checked,
      }),
    });
    closeEmployeeDialog();
    showToast("Карточка сотрудника сохранена.");
    await loadEmployees();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Сохранить";
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
      <tr>
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
        <td><button class="edit-button" type="button" data-task-view="${escapeHtml(task.id)}">Просмотр</button></td>
      </tr>`;
  }).join("");

  document.querySelectorAll("[data-task-view]").forEach((button) => {
    button.addEventListener("click", () => openTaskDetail(button.dataset.taskView));
  });
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
      <tr>
        <td class="visit-date-cell">${escapeHtml(formatVisitDateTime(visit))}</td>
        <td>
          <span class="task-trt-name">${escapeHtml(visitPointTitle(visit))}</span>
          ${point?.address ? `<span class="task-secondary">${escapeHtml(point.address)}</span>` : ""}
        </td>
        <td>${escapeHtml(visitEmployeeName(visit))}</td>
        <td>${escapeHtml(point?.direction || "—")}</td>
        <td><span class="visit-result-preview">${escapeHtml(result)}</span></td>
        <td>${mediaCount ? `<span class="badge badge-neutral">${mediaCount}</span>` : "—"}</td>
        <td><button class="edit-button" type="button" data-visit-view="${escapeHtml(visit.id)}">Просмотр</button></td>
      </tr>`;
  }).join("");

}

async function openVisitDetail(visitId) {
  const visit = state.visits.find((item) => String(item.id) === String(visitId));
  if (!visit) return;

  state.visitSelectedId = String(visit.id);
  const point = visitPoint(visit);
  const mediaItems = visitMediaItems(visit.id);
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
  $("visit-detail-distance").textContent = formatVisitDistance(visit);
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

function renderTaskMedia(containerId, emptyId, items) {
  const container = $(containerId);
  const empty = $(emptyId);
  container.innerHTML = "";

  if (!items.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  container.innerHTML = items.map((item) => {
    const href = escapeHtml(item.downloadUrl || "#");
    const mediaId = escapeHtml(item.id || "");
    const name = escapeHtml(item.name || (item.mediaKind === "video" ? "Видео" : "Фото"));
    if (String(item.type || "").startsWith("image/")) {
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
    const item = state.media.find((media) => String(media.id) === String(button.dataset.mediaPreview));
    if (!item) return;
    hydrateTaskMediaImage(button, item);
    button.addEventListener("click", () => openMediaPreview(item));
  });
}

async function openMediaPreview(item) {
  const modal = $("media-preview-modal");
  const image = $("media-preview-image");
  const loading = $("media-preview-loading");
  const original = $("media-preview-original");

  $("media-preview-title").textContent = item.name || "Фото";
  image.hidden = true;
  image.removeAttribute("src");
  loading.hidden = false;
  loading.textContent = "Загрузка превью…";
  original.hidden = true;
  modal.hidden = false;

  try {
    const preview = await ensureMediaPreview(item);
    image.src = preview.thumbnailUrl;
    image.hidden = false;
    loading.hidden = true;
    original.href = preview.downloadUrl || item.downloadUrl || "#";
    original.hidden = !original.href || original.href.endsWith("#");
  } catch (error) {
    loading.textContent = `Не удалось открыть фото: ${error.message}`;
    original.href = item.downloadUrl || "#";
    original.hidden = !item.downloadUrl;
  }
}

function closeMediaPreview() {
  $("media-preview-modal").hidden = true;
  $("media-preview-image").removeAttribute("src");
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
    const taskMedia = state.media.filter((item) => String(item.taskId || "") === String(task.id));
    renderTaskMedia(
      "task-materials",
      "task-materials-empty",
      taskMedia.filter((item) => item.purpose === "task_material"),
    );
    renderTaskMedia(
      "task-result-media",
      "task-result-media-empty",
      taskMedia.filter((item) => item.purpose === "task_result"),
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
$("add-employee-button").addEventListener("click", () => openEmployeeDialog());
$("employee-form").addEventListener("submit", saveEmployee);
$("employee-dialog-close").addEventListener("click", closeEmployeeDialog);
$("employee-cancel-button").addEventListener("click", closeEmployeeDialog);

["task-search", "task-scope-filter", "task-status-filter", "task-assignee-filter"].forEach((id) => {
  const eventName = id === "task-search" ? "input" : "change";
  $(id).addEventListener(eventName, renderTasks);
});
$("task-detail-close").addEventListener("click", closeTaskDetail);
$("task-detail-modal").addEventListener("click", (event) => {
  if (event.target === $("task-detail-modal")) closeTaskDetail();
});
$("task-open-trt-button").addEventListener("click", openSelectedTaskTrt);
$("media-preview-close").addEventListener("click", closeMediaPreview);
$("media-preview-modal").addEventListener("click", (event) => {
  if (event.target === $("media-preview-modal")) closeMediaPreview();
});


["visit-search", "visit-employee-filter", "visit-direction-filter", "visit-date-from", "visit-date-to"].forEach((id) => {
  $(id).addEventListener(id === "visit-search" ? "input" : "change", renderVisits);
});
$("visits-table-body").addEventListener("click", (event) => {
  const button = event.target.closest("[data-visit-view]");
  if (button) openVisitDetail(button.dataset.visitView);
});
$("visit-detail-close").addEventListener("click", closeVisitDetail);
$("visit-detail-modal").addEventListener("click", (event) => {
  if (event.target === $("visit-detail-modal")) closeVisitDetail();
});
$("visit-open-trt-button").addEventListener("click", openSelectedVisitTrt);
document.addEventListener("keydown", (event) => {
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

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.page, true));
});

window.addEventListener("hashchange", () => {
  const page = location.hash.slice(1);
  if (PAGES.has(page)) showPage(page, false);
});

restoreSession();
