import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Wraps a CSV field in quotes if it contains a comma, quote, or newline, escaping
// any internal quotes — keeps account names with commas from breaking columns.
function csvField(value: string | null | undefined): string {
  const str = value ?? "";
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const { data: accounts, error } = await supabase
    .from("chart_of_accounts")
    .select("nominal_code, account_name, category")
    .order("nominal_code", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const header = "Nominal Code,Account Name,Category";
  const rows = (accounts || []).map((a) =>
    [csvField(a.nominal_code), csvField(a.account_name), csvField(a.category)].join(",")
  );
  const csv = [header, ...rows].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chart-of-accounts-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
