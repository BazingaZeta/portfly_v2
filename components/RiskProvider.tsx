"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface RiskCtx {
  accountSize: number;
  riskPct: number;
  setAccountSize: (n: number) => void;
  setRiskPct: (n: number) => void;
  ready: boolean;
}

const DEFAULTS = { accountSize: 10000, riskPct: 1 };

const Ctx = createContext<RiskCtx>({
  ...DEFAULTS,
  setAccountSize: () => {},
  setRiskPct: () => {},
  ready: false,
});

export function RiskProvider({ children }: { children: React.ReactNode }) {
  const [accountSize, setAccountSizeState] = useState(DEFAULTS.accountSize);
  const [riskPct, setRiskPctState] = useState(DEFAULTS.riskPct);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const a = Number(localStorage.getItem("risk.accountSize"));
    const r = Number(localStorage.getItem("risk.riskPct"));
    if (Number.isFinite(a) && a > 0) setAccountSizeState(a);
    if (Number.isFinite(r) && r > 0) setRiskPctState(r);
    setReady(true);
  }, []);

  const setAccountSize = useCallback((n: number) => {
    setAccountSizeState(n);
    try {
      localStorage.setItem("risk.accountSize", String(n));
    } catch {}
  }, []);

  const setRiskPct = useCallback((n: number) => {
    setRiskPctState(n);
    try {
      localStorage.setItem("risk.riskPct", String(n));
    } catch {}
  }, []);

  return (
    <Ctx.Provider value={{ accountSize, riskPct, setAccountSize, setRiskPct, ready }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRisk() {
  return useContext(Ctx);
}
