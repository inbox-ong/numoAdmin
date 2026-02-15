import bcrypt from "bcryptjs";
import { getUserByUsername } from "./db.js";

async function login(username, password) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export { login };
