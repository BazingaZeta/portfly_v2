import { db } from "./db";
import bcrypt from "bcryptjs";

export type User = { id: number; email: string; name: string };
type UserRow = { id: number; email: string; name: string; password_hash: string };

export function getUserByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = db()
    .prepare(`SELECT id, email, name, password_hash FROM users WHERE email = ?`)
    .get(email) as UserRow | undefined;
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash };
}

export function createUser(email: string, name: string, password: string): User {
  const hash = bcrypt.hashSync(password, 12);
  const info = db()
    .prepare(`INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)`)
    .run(email, name, hash, new Date().toISOString());
  return { id: Number(info.lastInsertRowid), email, name };
}

export function userCount(): number {
  const row = db().prepare(`SELECT COUNT(*) as n FROM users`).get() as { n: number };
  return row.n;
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
