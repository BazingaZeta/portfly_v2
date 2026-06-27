import { NextResponse } from "next/server";
import { fetchGeneralNews } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const news = await fetchGeneralNews(40);
  return NextResponse.json({ news });
}
