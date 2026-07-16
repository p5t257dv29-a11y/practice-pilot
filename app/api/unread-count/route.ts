import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data: settings } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
  const lastViewedAt = settings?.communications_last_viewed_at || null;

  if (!lastViewedAt) {
    return NextResponse.json({ count: 0 });
  }

  const [{ data: taxComps }, { data: accounts }, { data: ctComps }, { data: quotes }] = await Promise.all([
    supabase.from("tax_computations").select("approved_at, queried_at").not("status", "is", null).neq("status", "Draft"),
    supabase.from("trial_balances").select("approved_at, queried_at").not("approval_status", "is", null),
    supabase.from("corporation_tax_computations").select("approved_at, queried_at").not("status", "is", null).neq("status", "Draft"),
    supabase.from("quotes").select("accepted_at, declined_at").not("status", "is", null).neq("status", "Draft"),
  ]);

  const respondedDates = [
    ...(taxComps || []).map((t) => t.approved_at || t.queried_at),
    ...(accounts || []).map((a) => a.approved_at || a.queried_at),
    ...(ctComps || []).map((c) => c.approved_at || c.queried_at),
    ...(quotes || []).map((q) => q.accepted_at || q.declined_at),
  ].filter(Boolean);

  const count = respondedDates.filter((d) => d! > lastViewedAt).length;

  return NextResponse.json({ count });
}
