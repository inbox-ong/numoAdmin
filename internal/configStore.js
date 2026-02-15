import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, "config.json");

const defaults = {
  coreUrl: process.env.CORE_URL || "http://localhost:8082",
  dirUrl: process.env.DIRECTORY_URL || "http://localhost:8080",
  dirToken: process.env.DIRECTORY_TOKEN || "changeme",
  keysUrl: process.env.KEYS_URL || "http://localhost:8085",
  ledgerUrl: process.env.LEDGER_URL || "http://localhost:8086",
  trustUrl: process.env.TRUST_URL || "http://localhost:8089",
  useProxy: false,
};

let current = { ...defaults };

async function initConfigStore() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(data);
    current = { ...current, ...parsed };
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("Config store: falling back to defaults:", err.message);
    }
  }
  // Env vars have the final word to avoid stale config files pointing to localhost
  current.dirUrl = process.env.DIRECTORY_URL || current.dirUrl;
  current.dirToken = process.env.DIRECTORY_TOKEN || current.dirToken;
  if (!current.dirUrl) current.dirUrl = defaults.dirUrl;
  if (!current.dirToken) current.dirToken = defaults.dirToken;
}

async function saveConfig() {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(current, null, 2));
}

async function getConfig() {
  return current;
}

async function setConfig(update) {
  current = { ...current, ...update };
  // avoid blank overriding defaults
  if (!current.dirUrl) current.dirUrl = defaults.dirUrl;
  if (!current.dirToken) current.dirToken = defaults.dirToken;
  await saveConfig();
  return current;
}

export { initConfigStore, getConfig, setConfig };
