import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";

  if (q.length < 2) {
    return NextResponse.json({ clients: [], jobs: [], quotes: [], invoices: [], fixedAssets: [], capitalGains: [], corporationTax: [], personalTax: [] });
  }

  const like = `%${q}%`;

  const [
    { data: clients },
    { data: jobs },
    { data: quotes },
    { data: invoices },
    { data: fixedAssets },
    { data: capitalGains },
    { data: corporationTax },
    { data: personalTax },
  ] = await Promise.all([
    supabase.from("clients").select("id, client_name, entity_type").ilike("client_name", like).limit(6),
    supabase.from("jobs").select("id, job_name, job_type, clients(client_name)").ilike("job_name", like).limit(6),
    supabase.from("quotes").select("id, quote_number, status, clients(client_name)").ilike("quote_number", like).limit(6),
    supabase.from("invoices").select("id, invoice_number, status, clients(client_name)").ilike("invoice_number", like).limit(6),
    supabase.from("fixed_assets").select("id, description, clients(client_name)").ilike("description", like).limit(6),
    supabase.from("capital_gains_computations").select("id, asset_description, clients(client_name)").ilike("asset_description", like).limit(6),
    supabase.from("corporation_tax_computations").select("id, period_start, period_end, clients(client_name)").limit(50),
    supabase.from("tax_computations").select("id, tax_year, clients(client_name)").limit(50),
  ]);

  // Client name isn't directly filterable on the joined tables via ilike, so
  // filter these two in memory against the client name after fetching a page
  const qLower = q.toLowerCase();
  const filteredCT = (corporationTax || [])
    .filter((c) => ((c.clients as any)?.client_name || "").toLowerCase().includes(qLower))
    .slice(0, 6);
  const filteredPersonalTax = (personalTax || [])
    .filter((c) => ((c.clients as any)?.client_name || "").toLowerCase().includes(qLower))
    .slice(0, 6);

  return NextResponse.json({
    clients: clients || [],
    jobs: jobs || [],
    quotes: quotes || [],
    invoices: invoices || [],
    fixedAssets: fixedAssets || [],
    capitalGains: capitalGains || [],
    corporationTax: filteredCT,
    personalTax: filteredPersonalTax,
  });
}
