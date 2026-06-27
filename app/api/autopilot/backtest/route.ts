import { NextResponse } from "next/server";
import { runAutoBacktest } from "@/lib/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const result = await runAutoBacktest(5);
  return NextResponse.json(result);
}
