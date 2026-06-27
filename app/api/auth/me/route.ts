import { NextResponse } from "next/server";
import { deleteSession, getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: { id: session.userId, email: session.email, name: session.name } });
}

export async function POST() {
  await deleteSession();
  return NextResponse.json({ ok: true });
}
