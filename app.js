"use strict";

const API_BASE = "https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net";
const SESSION_KEY = "trt_web_session";
const PAGES = new Set(["employees", "tasks", "trt"]);

const state = {
  token: localStorage.getItem(SESSION_KEY) || "",
  user: null,
  employees: [],
  currentPage: PAGES.has(location.hash.slice(1)) ? location.hash.slice(1) : "employees",
};

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
  localStorage.removeItem(SESSION_KEY);
}

function showLogin() {
  $("app-shell").hidden = true;
  $("login-screen").hidden = false;
  $("password").value = "";
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
}

function showApp() {
  $("login-screen").hidden = true;
  $("app-shell").hidden = false;
  $("sidebar-user-name").textContent = shortPersonName(state.user?.full_name || state.user?.fullName) || "—";
  $("add-employee-button").hidden = String(state.user?.role || "").toLowerCase() !== "admin";
  showPage(state.currentPage, true);
}

async function login(event) {
  event.preventDefault();
  const button = $("login-button");
  const error = $("login-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Вход…";

  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: $("login").value.trim(),
        password: $("password").value,
        device_name: "ТРТ веб-кабинет",
      }),
    });
    state.token = result.session_token;
    state.user = result.user;
    localStorage.setItem(SESSION_KEY, state.token);
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
    return [item.fullName, item.displayName, item.position, item.managerName, item.login]
      .join(" ").toLowerCase().includes(query);
  });
}

function renderEmployees() {
  const items = filteredEmployees();
  const isAdmin = String(state.user?.role || "").toLowerCase() === "admin";

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
        <td>${isAdmin ? `<button class="edit-button" type="button" data-edit-id="${escapeHtml(item.employeeId)}">Изменить</button>` : ""}</td>
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

async function logout() {
  try { await api("/auth/logout", { method: "POST", body: "{}" }); } catch { /* Локальная сессия очищается в любом случае. */ }
  clearSession();
  showLogin();
}

$("login-form").addEventListener("submit", login);
$("logout-button").addEventListener("click", logout);
$("employee-search").addEventListener("input", renderEmployees);
$("employee-status-filter").addEventListener("change", renderEmployees);
$("add-employee-button").addEventListener("click", () => openEmployeeDialog());
$("employee-form").addEventListener("submit", saveEmployee);
$("employee-dialog-close").addEventListener("click", closeEmployeeDialog);
$("employee-cancel-button").addEventListener("click", closeEmployeeDialog);

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.page, true));
});

window.addEventListener("hashchange", () => {
  const page = location.hash.slice(1);
  if (PAGES.has(page)) showPage(page, false);
});

restoreSession();
