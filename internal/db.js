import pg from "pg";
import bcrypt from "bcryptjs";

const DEFAULT_URL = process.env.ADMIN_DB_URL || "postgres://numoAdmin:numoAdmin@admin-db:5435/numoAdmin";

const pool = new pg.Pool({
  connectionString: DEFAULT_URL,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      detail JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  const { rows } = await pool.query("SELECT id FROM users WHERE username = $1", ["numoAdmin"]);
  if (rows.length === 0) {
    const hash = await bcrypt.hash("numoAdmin", 10);
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)", ["numoAdmin", hash, "admin"]);
    console.log("Seeded default admin user numoAdmin / numoAdmin");
  }
}

async function getUserByUsername(username) {
  const { rows } = await pool.query("SELECT id, username, password_hash, role FROM users WHERE username = $1", [username]);
  return rows[0] || null;
}

async function createAudit(userId, action, detail) {
  await pool.query("INSERT INTO audit_log (user_id, action, detail) VALUES ($1,$2,$3)", [userId || null, action, detail ? JSON.stringify(detail) : null]);
}

async function listAudit(limit = 200) {
  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.detail, a.created_at, u.username
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC
     LIMIT $1`, [limit]);
  return rows;
}

async function clearAudit() {
  await pool.query("TRUNCATE audit_log");
}

export { pool, initDb, getUserByUsername, createAudit, listAudit, clearAudit };
