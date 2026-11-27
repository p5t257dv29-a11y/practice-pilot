import { NextResponse } from "next/server";
import { generateDueRenewalDrafts } from "@/lib/renewals/generateDueRenewals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const overrideDate = searchParams.get("date") || undefined;

  try {
    const result = await generateDueRenewalDrafts(overrideDate);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Failed" }, { status: 500 });
  }
}