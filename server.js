import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import basicAuth from "basic-auth";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import fs from "fs";
import fsp from "fs/promises";
import https from "https";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { initConfigStore, getConfig, setConfig } from "./internal/configStore.js";
import session from "express-session";
import bcrypt from "bcryptjs";
import { initDb, getUserByUsername, createAudit, listAudit, clearAudit } from "./internal/db.js";
import { login } from "./internal/auth.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = process.env.PORT || 4173;
const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";
const AUDIT_FILE = process.env.AUDIT_FILE || path.join(__dirname, "audit-log.json");
const TLS_CERT = process.env.TLS_CERT || "";
const TLS_KEY = process.env.TLS_KEY || "";
const TLS_CA = process.env.TLS_CA || "";
const CLIENT_CERT = process.env.CLIENT_CERT || "";
const CLIENT_KEY = process.env.CLIENT_KEY || "";
const UPSTREAM_JWT = process.env.UPSTREAM_JWT || "";
const PROXY_ALLOW_HOSTS = (process.env.PROXY_ALLOW_HOSTS || "").split(",").map(h => h.trim()).filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";

const apiAuth = (req, res, next) => {
  if (ADMIN_JWT_SECRET) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).send("Unauthorized");
    try {
      const payload = jwt.verify(token, ADMIN_JWT_SECRET);
      req.user = payload;
      return next();
    } catch {
      return res.status(401).send("Invalid token");
    }
  }
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  if (ADMIN_USER && ADMIN_PASS) {
    const creds = basicAuth(req);
    if (!creds || creds.name !== ADMIN_USER || creds.pass !== ADMIN_PASS) {
      res.set("WWW-Authenticate", 'Basic realm="NumoAdmin"');
      return res.status(401).send("Unauthorized");
    }
    req.user = { username: creds.name };
    return next();
  }
  return res.status(401).send("Unauthorized");
};

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(morgan("dev"));
app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: "lax" },
}));

const staticDir = __dirname;
app.use((req, res, next) => {
  // allow auth endpoints and signin
  const openPaths = ["/signin.html", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/favicon.ico"];
  if (openPaths.includes(req.path) || req.path.startsWith("/assets")) {
    return next();
  }
  if (req.path === "/" || req.path.endsWith(".html")) {
    if (ADMIN_JWT_SECRET) return next(); // JWT mode
    if (!req.session.user) return res.redirect("/signin.html");
  }
  next();
});
app.use(express.static(staticDir));
app.get("/", (_req, res) => {
  res.redirect("/config.html");
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "credenciais obrigatórias" });
  const user = await login(username, password);
  if (!user) return res.status(401).json({ error: "credenciais inválidas" });
  req.session.user = user;
  res.json({ ok: true, user });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (req.session && req.session.user) {
    return res.json(req.session.user);
  }
  return res.status(401).json({ error: "unauthenticated" });
});

// Audit log (persisted)
const auditLog = [];
const loadAudit = async () => {
  try {
    const data = await fsp.readFile(AUDIT_FILE, "utf-8");
    const items = JSON.parse(data);
    if (Array.isArray(items)) {
      auditLog.push(...items.slice(0, 500));
    }
  } catch {
    // ignore
  }
};

const persistAudit = async () => {
  try {
    await fsp.writeFile(AUDIT_FILE, JSON.stringify(auditLog.slice(0, 500), null, 2));
  } catch {
    // ignore
  }
};

const pushAudit = async (event) => {
  auditLog.unshift({ ...event, at: new Date().toISOString() });
  if (auditLog.length > 500) auditLog.splice(500);
  await persistAudit();
};

app.post("/api/audit", apiAuth, (req, res) => {
  const { action, detail } = req.body || {};
  if (!action) {
    return res.status(400).json({ error: "action obrigatório" });
  }
  const userId = req.user?.id || null;
  createAudit(userId, action, detail).catch(() => {});
  pushAudit({ action, detail }).then(() => {
    return res.status(201).json({ ok: true });
  }).catch(() => res.status(201).json({ ok: true }));
});

app.get("/api/audit", apiAuth, (_req, res) => {
  listAudit().then(rows => res.json(rows)).catch(() => res.json(auditLog));
});

app.delete("/api/audit", apiAuth, (_req, res) => {
  auditLog.length = 0;
  clearAudit().catch(() => {});
  persistAudit().finally(() => res.json({ ok: true }));
});

// Proxy com JWT/mTLS opcional
const httpsAgent = (TLS_CERT || TLS_KEY || TLS_CA || CLIENT_CERT || CLIENT_KEY) ? new https.Agent({
  cert: CLIENT_CERT ? fs.readFileSync(CLIENT_CERT) : undefined,
  key: CLIENT_KEY ? fs.readFileSync(CLIENT_KEY) : undefined,
  ca: TLS_CA ? fs.readFileSync(TLS_CA) : undefined,
  rejectUnauthorized: !!TLS_CA,
}) : undefined;

app.post("/api/proxy", apiAuth, async (req, res) => {
  const { url, method = "GET", headers = {}, body } = req.body || {};
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "url inválida" });
  }
  try {
    const targetHost = new URL(url).hostname;
    if (PROXY_ALLOW_HOSTS.length && !PROXY_ALLOW_HOSTS.includes(targetHost)) {
      return res.status(403).json({ error: "host não permitido" });
    }
    const finalHeaders = { ...headers };
    if (UPSTREAM_JWT && !finalHeaders["authorization"]) {
      finalHeaders["authorization"] = `Bearer ${UPSTREAM_JWT}`;
    }
    const resp = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body ? JSON.stringify(body) : undefined,
      agent: httpsAgent,
    });
    const ct = resp.headers.get("content-type") || "";
    let data;
    if (ct.includes("application/json")) {
      data = await resp.json();
    } else {
      data = await resp.text();
    }
    res.status(resp.status).json({ ok: resp.ok, status: resp.status, body: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Config APIs (persist backend)
app.get("/api/config", apiAuth, async (_req, res) => {
  try {
    const cfg = await getConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/config", apiAuth, async (req, res) => {
  try {
    const cfg = await setConfig(req.body || {});
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const startServer = async () => {
  await loadAudit();
  await initConfigStore().catch(() => {});
  await initDb().catch((e) => {
    console.error("DB init failed", e);
    process.exit(1);
  });
  if (TLS_CERT && TLS_KEY) {
    const options = {
      cert: await fsp.readFile(TLS_CERT),
      key: await fsp.readFile(TLS_KEY),
      requestCert: false,
      rejectUnauthorized: false,
    };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`NumoAdmin backend (HTTPS) listening on port ${PORT}`);
    });
  } else {
    app.listen(PORT, () => {
      console.log(`NumoAdmin backend listening on http://localhost:${PORT}`);
    });
  }
};

startServer().catch((err) => {
  console.error("Failed to start NumoAdmin server:", err);
  process.exit(1);
});
