"use server";

import { redirect } from "next/navigation";
import { createSession, deleteSession } from "@/lib/auth";
import { getUserByEmail, createUser, verifyPassword, userCount } from "@/lib/authDb";

export type AuthState =
  | { errors?: { email?: string[]; password?: string[]; name?: string[]; form?: string[] } }
  | undefined;

export async function login(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { errors: { form: ["Email e password sono obbligatori."] } };
  }

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { errors: { form: ["Email o password non corretti."] } };
  }

  await createSession({ userId: user.id, email: user.email, name: user.name });
  redirect("/");
}

export async function signup(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !name || !password) {
    return { errors: { form: ["Tutti i campi sono obbligatori."] } };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { errors: { email: ["Email non valida."] } };
  }
  if (password.length < 8) {
    return { errors: { password: ["La password deve avere almeno 8 caratteri."] } };
  }

  if (getUserByEmail(email)) {
    return { errors: { email: ["Questa email è già registrata."] } };
  }

  // Only allow registrations while the user count is low (≤ 10) — invite-only model.
  if (userCount() >= 10) {
    return { errors: { form: ["Registrazioni chiuse. Contatta l'amministratore."] } };
  }

  const user = createUser(email, name, password);
  await createSession({ userId: user.id, email: user.email, name: user.name });
  redirect("/");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
