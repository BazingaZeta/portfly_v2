"use client";

import { useActionState, useState } from "react";
import { login, signup } from "@/app/actions/auth";
import type { AuthState } from "@/app/actions/auth";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginState, loginAction, loginPending] = useActionState<AuthState, FormData>(login, undefined);
  const [signupState, signupAction, signupPending] = useActionState<AuthState, FormData>(signup, undefined);

  const state = mode === "login" ? loginState : signupState;
  const action = mode === "login" ? loginAction : signupAction;
  const pending = mode === "login" ? loginPending : signupPending;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <span
            className="grid place-items-center size-11 rounded-2xl shadow-lg"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
              boxShadow: "0 4px 20px color-mix(in srgb, var(--accent) 40%, transparent)",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
              <path d="M6 21 L13 14 L18 18 L26 9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 9 L26 9 L26 14" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-bold text-xl tracking-tight">Finance Bot</span>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
          {/* Tab switcher */}
          <div className="flex rounded-xl bg-[var(--surface-2)] p-1 mb-6 gap-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                mode === "login"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Accedi
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                mode === "register"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Registrati
            </button>
          </div>

          <form action={action} className="flex flex-col gap-4">
            {/* Name field (register only) */}
            {mode === "register" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="name" className="text-sm font-medium">
                  Nome
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Mario Rossi"
                  className="input"
                  required
                />
                {signupState?.errors?.name && (
                  <p className="text-xs text-[var(--negative)]">{signupState.errors.name[0]}</p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="mario@esempio.it"
                className="input"
                required
              />
              {state?.errors?.email && (
                <p className="text-xs text-[var(--negative)]">{state.errors.email[0]}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "register" ? "Almeno 8 caratteri" : "••••••••"}
                className="input"
                required
              />
              {state?.errors?.password && (
                <p className="text-xs text-[var(--negative)]">{state.errors.password[0]}</p>
              )}
            </div>

            {state?.errors?.form && (
              <div className="rounded-xl border border-[var(--negative)] bg-[var(--negative)]/10 px-4 py-3 text-sm text-[var(--negative)]">
                {state.errors.form[0]}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="btn-primary w-full mt-2"
            >
              {pending
                ? mode === "login"
                  ? "Accesso in corso…"
                  : "Registrazione…"
                : mode === "login"
                ? "Accedi"
                : "Crea account"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--muted)] mt-6">
          Solo per invito — uso personale e non commerciale.
        </p>
      </div>
    </div>
  );
}
