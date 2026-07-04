import { createUser as createDbUser, db, getUserByEmail as getDbUserByEmail } from "./db";
import bcrypt from "bcryptjs";

export type User = { id: number; email: string; name: string };
type UserRow = { id: number; email: string; name: string; password_hash: string };

export async function getUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
  const row = await getDbUserByEmail(email);
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash };
}

export async function createUser(email: string, name: string, password: string): Promise<User> {
  const hash = bcrypt.hashSync(password, 12);
  const user = await createDbUser(email, name, hash);
  return { id: user.id, email, name };
}

export async function userCount(): Promise<number> {
  const client = await db();
  const result = await client.execute(`SELECT COUNT(*) as n FROM users`);
  return Number(result.rows[0]?.n ?? 0);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
