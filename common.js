const state = {
  coreUrl: localStorage.getItem("coreUrl") || "http://localhost:8082",
  dirUrl: localStorage.getItem("dirUrl") || "http://localhost:8080",
  dirToken: localStorage.getItem("dirToken") || "changeme",
  keysUrl: localStorage.getItem("keysUrl") || "http://localhost:8085",
  ledgerUrl: localStorage.getItem("ledgerUrl") || "http://localhost:8086",
  trustUrl: localStorage.getItem("trustUrl") || "http://localhost:8089",
  useProxy: localStorage.getItem("useProxy") === "true",
  user: null,
};

let themeLoaded = false;

const navItems = [
  { id: "config", label: "Configurações", href: "config.html" },
  { id: "health", label: "Saúde", href: "health.html" },
  { id: "participants", label: "Participantes", href: "participants.html" },
  { id: "accounts", label: "Saldos & Contas", href: "accounts.html" },
  { id: "keys", label: "Keys", href: "keys.html" },
  { id: "payments", label: "Transferências", href: "payments.html" },
  { id: "pay-key", label: "Via Key", href: "pay-key.html" },
  { id: "ledger", label: "Ledger", href: "ledger.html" },
  { id: "audit", label: "Auditoria", href: "audit.html" },
  { id: "trust", label: "Trust/PKI", href: "trust.html" },
  { id: "profile", label: "Perfil", href: "profile.html" },
];

const qs = (sel) => document.querySelector(sel);

function ensureThemeAssets() {
  if (themeLoaded) return;
  const head = document.head;
  const existing = head.querySelector('link[data-ta-theme="style"]');
  if (!existing) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/tailadmin/style.css";
    link.setAttribute("data-ta-theme", "style");
    head.appendChild(link);
  }
  const icon = head.querySelector('link[rel="icon"]');
  if (!icon) {
    const fav = document.createElement("link");
    fav.rel = "icon";
    fav.href = "/assets/tailadmin/favicon.ico";
    head.appendChild(fav);
  }
  const script = document.createElement("script");
  script.defer = true;
  script.src = "/assets/tailadmin/bundle.js";
  script.setAttribute("data-ta-theme", "bundle");
  head.appendChild(script);
  themeLoaded = true;
}

function loadConfigFields() {
  const m = new Map([
    ["#core-url", state.coreUrl],
    ["#dir-url", state.dirUrl],
    ["#dir-token", state.dirToken],
    ["#keys-url", state.keysUrl],
    ["#ledger-url", state.ledgerUrl],
    ["#trust-url", state.trustUrl],
  ]);
  m.forEach((val, sel) => {
    const el = qs(sel);
    if (el) el.value = val;
  });
}

function saveConfigFromPage() {
  if (qs("#core-url")) state.coreUrl = qs("#core-url").value.trim();
  if (qs("#dir-url")) state.dirUrl = qs("#dir-url").value.trim();
  if (qs("#dir-token")) state.dirToken = qs("#dir-token").value.trim();
  if (qs("#keys-url")) state.keysUrl = qs("#keys-url").value.trim();
  if (qs("#ledger-url")) state.ledgerUrl = qs("#ledger-url").value.trim();
  if (qs("#trust-url")) state.trustUrl = qs("#trust-url").value.trim();
  if (qs("#use-proxy")) state.useProxy = qs("#use-proxy").checked;
  localStorage.setItem("coreUrl", state.coreUrl);
  localStorage.setItem("dirUrl", state.dirUrl);
  localStorage.setItem("dirToken", state.dirToken);
  localStorage.setItem("keysUrl", state.keysUrl);
  localStorage.setItem("ledgerUrl", state.ledgerUrl);
  localStorage.setItem("trustUrl", state.trustUrl);
  localStorage.setItem("useProxy", state.useProxy);
}

async function readBody(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return await res.json(); } catch {}
  }
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

async function fetchStatus(url, token) {
  try {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { ok: res.ok, msg: res.status };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

function authHeader() {
  return state.dirToken ? { Authorization: `Bearer ${state.dirToken}` } : {};
}

function setNavActive(current) {
  document.querySelectorAll("[data-nav-id]").forEach((a) => {
    const match = a.dataset.navId === current || current.includes(a.dataset.navId);
    a.classList.toggle("bg-slate-100", match);
    a.classList.toggle("text-slate-900", match);
    a.classList.toggle("font-semibold", match);
  });
}

async function requireSession() {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) {
    window.location = "/signin.html";
    return null;
  }
  try {
    const user = await res.json();
    state.user = user;
    return user;
  } catch {
    window.location = "/signin.html";
    return null;
  }
}

function renderUserProfile(containerId) {
  const el = document.getElementById(containerId);
  if (!el || !state.user) return;
  el.textContent = state.user.username;
}
async function apiFetch(url, options = {}) {
  if (!state.useProxy) {
    return fetch(url, options);
  }
  const { method = "GET", headers = {}, body } = options;
  const proxiedHeaders = { ...headers };
  // Directory token injection if not present
  if (url.startsWith(state.dirUrl) && state.dirToken && !proxiedHeaders["Authorization"]) {
    proxiedHeaders["Authorization"] = `Bearer ${state.dirToken}`;
  }
  const payload = {
    url,
    method,
    headers: proxiedHeaders,
  };
  if (body) {
    if (typeof body === "string") payload.body = JSON.parse(body);
    else payload.body = body;
  }
  return fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (resp) => {
    const data = await resp.json();
    return new Response(
      JSON.stringify(data.body),
      { status: data.status, statusText: data.ok ? "OK" : "ERROR", headers: { "Content-Type": "application/json" } }
    );
  });
}

// --- Login/Audit Helpers ---
const AUTH_KEY = "adminAuth";
const AUDIT_KEY = "adminAuditLog";

function ensureAuth() {
  return requireSession();
}

function getStoredAuth() {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function setStoredAuth(user, pass) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ user, pass: btoa(pass) }));
}

function validateAuth(user, pass) {
  const stored = getStoredAuth();
  if (!stored) return false;
  return stored.user === user && stored.pass === btoa(pass);
}

function showLoginOverlay(show) {
  let overlay = document.getElementById("login-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.innerHTML = `
      <div class="login-modal">
        <h2>Login</h2>
        <p class="muted">Defina ou informe credenciais para acessar o Admin.</p>
        <div class="form-row"><label>Usuário</label><input id="auth-user" type="text"></div>
        <div class="form-row"><label>Senha</label><input id="auth-pass" type="password"></div>
        <div class="section-actions">
          <button id="auth-submit">Entrar</button>
        </div>
        <div id="auth-msg" class="muted"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("auth-submit").onclick = () => {
      const u = document.getElementById("auth-user").value.trim();
      const p = document.getElementById("auth-pass").value.trim();
      if (!u || !p) {
        document.getElementById("auth-msg").textContent = "Informe usuário e senha.";
        return;
      }
      const existing = getStoredAuth();
      if (!existing) {
        setStoredAuth(u, p);
        logAudit("auth:set", { user: u });
        overlay.classList.add("hidden");
      } else if (validateAuth(u, p)) {
        logAudit("auth:login", { user: u });
        overlay.classList.add("hidden");
      } else {
        document.getElementById("auth-msg").textContent = "Credenciais inválidas.";
      }
    };
  }
  overlay.classList.toggle("hidden", !show);
}

function logAudit(action, detail) {
  // backend audit
  fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, detail }),
  }).catch(() => {});
  // local fallback
  const raw = localStorage.getItem(AUDIT_KEY);
  let items = [];
  if (raw) {
    try { items = JSON.parse(raw); } catch { items = []; }
  }
  items.unshift({ action, detail, at: new Date().toISOString() });
  if (items.length > 200) items = items.slice(0, 200);
  localStorage.setItem(AUDIT_KEY, JSON.stringify(items));
}

function getAuditLogs() {
  const raw = localStorage.getItem(AUDIT_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function buildNavLinks(active) {
  return navItems.map(item => `
    <a data-nav-id="${item.id}" href="${item.href}" class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors ${active === item.id ? "bg-slate-100 text-slate-900 font-semibold" : ""}">
      <span>${item.label}</span>
    </a>
  `).join("");
}

function upgradeToTailAdmin({ pageId, title, subtitle }) {
  ensureThemeAssets();
  if (document.body.dataset.layout === "tailadmin") return;
  const main = document.querySelector("main");
  const content = main ? main.innerHTML : document.body.innerHTML;
  document.body.dataset.layout = "tailadmin";
  document.body.className = "bg-slate-100";
  document.body.innerHTML = `
    <div class="min-h-screen flex bg-slate-100 text-slate-800">
      <aside class="flex w-64 bg-white shadow-sm flex-col border-r border-slate-200">
        <div class="px-6 py-5 border-b border-slate-200">
          <div class="text-xl font-bold text-slate-900">NumoAdmin</div>
          <p class="text-xs text-slate-500">Cockpit Numo</p>
        </div>
        <nav class="flex-1 overflow-y-auto p-3 space-y-1 ta-nav">
          ${buildNavLinks(pageId)}
        </nav>
        <div class="border-t border-slate-200 px-4 py-4 flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">UA</div>
          <div class="leading-tight">
            <div class="text-sm font-semibold text-slate-900" id="sidebar-user">Admin</div>
            <div class="text-xs text-slate-500" id="sidebar-role">admin</div>
          </div>
        </div>
      </aside>
      <div class="flex-1 flex flex-col">
        <header class="bg-white shadow-sm border-b border-slate-200 px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <p class="text-[11px] uppercase tracking-wide text-slate-400">Admin</p>
            <h1 class="text-xl font-semibold text-slate-900">${title || "Numo Admin"}</h1>
            ${subtitle ? `<p class="text-slate-500 text-sm">${subtitle}</p>` : ""}
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right leading-tight">
              <div class="text-sm font-semibold text-slate-900" id="header-user">Admin</div>
              <div class="text-xs text-slate-500" id="header-role">admin</div>
            </div>
            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">UA</div>
          </div>
        </header>
        <main class="p-4 sm:p-6">
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6" id="page-container">
            ${content}
          </div>
        </main>
      </div>
    </div>
  `;
}

// Populate user info in header/sidebar if session exists
fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(user => {
  if (!user) return;
  const fill = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  fill("header-user", user.username || "User");
  fill("header-role", user.role || "admin");
  fill("sidebar-user", user.username || "User");
  fill("sidebar-role", user.role || "admin");
}).catch(() => {});
