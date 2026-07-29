"use strict";

const API_BASE = "https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net";
const SESSION_KEY = "trt_web_session";
const PAGES = new Set(["employees", "tasks", "trt"]);

const state = {
  token: sessionStorage.getItem(SESSION_KEY) || "",
  user: null,
  employees: [],
  trtPoints: [],
  trtLoaded: false,
  trtSelectedId: "",
  trtFitRequested: true,
  currentPage: PAGES.has(location.hash.slice(1)) ? location.hash.slice(1) : "employees",
};

let trtMap = null;
let trtMarkerLayer = null;
let trtSalesChart = null;

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
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

let loginWasEntered = false;
let passwordWasEntered = false;

function updateLoginButton() {
  $("login-button").disabled = !(
    loginWasEntered
    && passwordWasEntered
    && $("login").value.trim()
    && $("password").value
  );
}

function clearLoginFields() {
  const loginInput = $("login");
  const passwordInput = $("password");
  loginInput.value = "";
  passwordInput.value = "";
  loginInput.readOnly = true;
  passwordInput.readOnly = true;
  loginWasEntered = false;
  passwordWasEntered = false;
  updateLoginButton();
}

function unlockLoginInput(input) {
  input.readOnly = false;
}

function showLogin() {
  $("app-shell").hidden = true;
  $("login-screen").hidden = false;
  clearLoginFields();
  window.setTimeout(clearLoginFields, 80);
  window.setTimeout(clearLoginFields, 400);
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

  if (nextPage === "trt") {
    loadTrtMap();
    window.setTimeout(() => trtMap?.invalidateSize(), 80);
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

  if (!loginWasEntered || !passwordWasEntered) {
    error.textContent = "Введите логин и пароль вручную.";
    error.hidden = false;
    button.disabled = true;
    return;
  }

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
    sessionStorage.setItem(SESSION_KEY, state.token);
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


function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/ё/g, "е");
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trtColor(size) {
  const value = numberOrZero(size);
  if (value > 100) return "#16a34a";
  if (value > 50) return "#eab308";
  return "#dc2626";
}

function formatTrtSize(point) {
  const value = numberOrZero(point?.size);
  const unit = point?.unit || "";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}${unit ? ` ${unit}` : ""}`;
}

function formatSales(value, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const formatted = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(number);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function sumSales(values, months = 6) {
  return (Array.isArray(values) ? values : [])
    .slice(0, months)
    .reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

function selectedTrtPoint() {
  return state.trtPoints.find((point) => String(point.id) === String(state.trtSelectedId));
}

function populateSelect(selectId, values, emptyLabel, displayFormatter = (value) => value) {
  const select = $(selectId);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>${values.map((value) => (
    `<option value="${escapeHtml(value)}">${escapeHtml(displayFormatter(value))}</option>`
  )).join("")}`;
  if (values.includes(current)) select.value = current;
}

function fillTrtFilters() {
  const directions = [...new Set(state.trtPoints.map((point) => String(point.direction || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru"));
  const managers = [...new Set(state.trtPoints.map((point) => String(point.manager || "").trim()).filter(Boolean))]
    .sort((a, b) => shortPersonName(a).localeCompare(shortPersonName(b), "ru"));
  const regions = [...new Set(state.trtPoints.map((point) => String(point.region || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru"));

  populateSelect("trt-direction-filter", directions, "Все направления");
  populateSelect("trt-manager-filter", managers, "Все менеджеры", shortPersonName);
  populateSelect("trt-region-filter", regions, "Все регионы");
}

function initTrtMap() {
  if (trtMap || typeof window.L === "undefined") return;

  trtMap = L.map("trt-map", {
    zoomControl: false,
    attributionControl: true,
  }).setView([55.75, 37.62], 7);

  L.control.zoom({ position: "bottomright" }).addTo(trtMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(trtMap);

  trtMarkerLayer = typeof L.markerClusterGroup === "function"
    ? L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 46,
        spiderfyOnMaxZoom: true,
      })
    : L.layerGroup();

  trtMarkerLayer.addTo(trtMap);
}

function filteredTrtPoints() {
  const query = normalizeText($("trt-map-search").value);
  const direction = $("trt-direction-filter").value;
  const manager = $("trt-manager-filter").value;
  const region = $("trt-region-filter").value;

  return state.trtPoints.filter((point) => {
    if (direction && point.direction !== direction) return false;
    if (manager && point.manager !== manager) return false;
    if (region && point.region !== region) return false;
    if (!query) return true;
    return normalizeText([
      point.client,
      point.holding,
      point.address,
      point.format,
      point.manager,
      point.region,
    ].join(" ")).includes(query);
  });
}

function trtMarkerIcon(point) {
  return L.divIcon({
    className: "",
    html: `<span class="trt-marker-dot" style="background:${trtColor(point.size)}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -7],
  });
}

function openTrtCard(pointId, focusMap = true) {
  const point = state.trtPoints.find((item) => String(item.id) === String(pointId));
  if (!point) return;

  state.trtSelectedId = String(point.id);
  $("trt-map-empty").hidden = true;
  $("trt-map-card").hidden = false;
  $("trt-card-name").textContent = point.client || point.holding || "ТРТ";
  $("trt-card-holding").textContent = point.holding || "—";
  $("trt-card-direction").textContent = point.direction || "—";
  $("trt-card-format").textContent = point.format || "—";
  $("trt-card-manager").textContent = shortPersonName(point.manager) || "—";
  $("trt-card-region").textContent = point.region || "—";
  $("trt-card-address").textContent = point.address || "—";

  const badge = $("trt-card-size-badge");
  badge.textContent = formatTrtSize(point);
  badge.style.background = trtColor(point.size);

  const hasSales = Object.values(point.sales || {}).some((values) => (
    Array.isArray(values) && values.some((value) => Number.isFinite(Number(value)) && Number(value) !== 0)
  ));
  $("trt-sales-button").disabled = !hasSales;
  $("trt-sales-button").textContent = hasSales ? "Продажи" : "Продаж нет";

  if (focusMap && trtMap && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))) {
    trtMap.setView([Number(point.lat), Number(point.lon)], Math.max(trtMap.getZoom(), 14));
  }
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
    const marker = L.marker([lat, lon], { icon: trtMarkerIcon(point) });
    marker.bindPopup(`
      <div class="map-popup-name">${escapeHtml(point.client || point.holding || "ТРТ")}</div>
      <div class="map-popup-address">${escapeHtml(point.address || "Адрес не указан")}</div>
    `);
    marker.on("click", () => openTrtCard(point.id, false));
    trtMarkerLayer.addLayer(marker);
  });

  $("trt-visible-count").textContent = `Показано ТРТ: ${visible.length} из ${state.trtPoints.length}`;
  $("trt-data-status").textContent = `Данные на 28.07.2026 · ${state.trtPoints.length} ТРТ`;

  if (state.trtFitRequested && visible.length > 0) {
    const bounds = L.latLngBounds(coordinates);
    trtMap.fitBounds(bounds.pad(0.08), { maxZoom: 13 });
    state.trtFitRequested = false;
  }

  window.setTimeout(() => trtMap.invalidateSize(), 30);
}

async function loadTrtMap() {
  if (state.trtLoaded) {
    initTrtMap();
    renderTrtMap();
    return;
  }

  $("trt-data-status").textContent = "Загрузка карты…";
  $("trt-map-error").hidden = true;

  try {
    const payload = await api("/trt-map-data");
    const points = Array.isArray(payload.points) ? payload.points : [];
    state.trtPoints = points.filter((point) => point && point.id != null);
    state.trtLoaded = true;
    state.trtFitRequested = true;
    fillTrtFilters();
    initTrtMap();
    if (!trtMap) throw new Error("Библиотека карты не загрузилась. Обновите страницу и проверьте интернет.");
    renderTrtMap();
  } catch (error) {
    $("trt-data-status").textContent = "Карта недоступна";
    $("trt-map-error").textContent = error.message;
    $("trt-map-error").hidden = false;
  }
}

function openTrtSales() {
  const point = selectedTrtPoint();
  if (!point) return;

  const months = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const sales2025 = Array.isArray(point.sales?.["2025"]) ? point.sales["2025"] : [];
  const sales2026 = Array.isArray(point.sales?.["2026"]) ? point.sales["2026"] : [];
  const ytd2025 = sumSales(sales2025, 6);
  const ytd2026 = sumSales(sales2026, 6);
  const yoy = ytd2025 === 0 ? null : ((ytd2026 - ytd2025) / Math.abs(ytd2025)) * 100;

  $("trt-sales-modal-title").textContent = point.client || point.holding || "ТРТ";
  $("trt-sales-modal-subtitle").textContent = point.address || "";
  $("trt-sales-ytd-2025").textContent = formatSales(ytd2025, point.unit);
  $("trt-sales-ytd-2026").textContent = formatSales(ytd2026, point.unit);
  $("trt-sales-yoy").textContent = yoy == null
    ? "—"
    : `${yoy > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(yoy)}%`;

  if (trtSalesChart) trtSalesChart.destroy();
  const canvas = $("trt-sales-chart");
  if (typeof window.Chart === "function") {
    trtSalesChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: months,
        datasets: [
          { label: "2025", data: months.map((_, index) => sales2025[index] ?? null), backgroundColor: "rgba(100,116,139,.62)" },
          { label: "2026", data: months.map((_, index) => sales2026[index] ?? null), backgroundColor: "rgba(31,94,255,.78)" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: { y: { beginAtZero: true } },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${formatSales(context.raw, point.unit)}`;
              },
            },
          },
        },
      },
    });
  }

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

localStorage.removeItem(SESSION_KEY);

["login", "password"].forEach((id) => {
  const input = $(id);
  input.addEventListener("pointerdown", () => unlockLoginInput(input));
  input.addEventListener("focus", () => unlockLoginInput(input));
  input.addEventListener("keydown", () => {
    if (id === "login") loginWasEntered = true;
    else passwordWasEntered = true;
    window.setTimeout(updateLoginButton, 0);
  });
  input.addEventListener("paste", () => {
    if (id === "login") loginWasEntered = true;
    else passwordWasEntered = true;
    window.setTimeout(updateLoginButton, 0);
  });
  input.addEventListener("input", updateLoginButton);
});

window.addEventListener("pageshow", () => {
  if (!state.token) {
    clearLoginFields();
    window.setTimeout(clearLoginFields, 120);
  }
});

$("login-form").addEventListener("submit", login);
$("logout-button").addEventListener("click", logout);
$("employee-search").addEventListener("input", renderEmployees);
$("employee-status-filter").addEventListener("change", renderEmployees);
$("add-employee-button").addEventListener("click", () => openEmployeeDialog());
$("employee-form").addEventListener("submit", saveEmployee);
$("employee-dialog-close").addEventListener("click", closeEmployeeDialog);
$("employee-cancel-button").addEventListener("click", closeEmployeeDialog);

["trt-map-search", "trt-direction-filter", "trt-manager-filter", "trt-region-filter"].forEach((id) => {
  const eventName = id === "trt-map-search" ? "input" : "change";
  $(id).addEventListener(eventName, () => {
    state.trtFitRequested = true;
    renderTrtMap();
  });
});
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
