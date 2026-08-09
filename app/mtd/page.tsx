import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// HMRC's required MTD quarterly categories. Self-Employment closely mirrors
// SA103; UK Property mirrors SA105. Foreign Property uses the same set as
// UK Property, kept as its own source type since it's reported separately.
export const MTD_CATEGORIES: Record<string, { income: string[]; expense: string[] }> = {
  "Self-Employment": {
    income: ["Turnover / Sales", "Other Business Income"],
    expense: [
      "Cost of Goods Sold",
      "Car, Van & Travel Expenses",
      "Wages, Salaries & Staff Costs",
      "Rent, Rates, Power & Insurance",
      "Repairs & Renewals",
      "Phone, Stationery & Other Office Costs",
      "Advertising & Business Entertainment",
      "Interest on Bank & Other Loans",
      "Bank, Credit Card & Other Financial Charges",
      "Irrecoverable Debts Written Off",
      "Accountancy, Legal & Other Professional Fees",
      "Depreciation & Loss on Sale of Assets (disallowable)",
      "Other Business Expenses",
    ],
  },
  "UK Property": {
    income: ["Rental Income", "Premiums for Lease Grants", "Other Property Income"],
    expense: [
      "Rent, Rates, Insurance & Ground Rents",
      "Property Repairs & Maintenance",
      "Loan Interest & Finance Costs",
      "Legal, Management & Professional Fees",
      "Costs of Services Provided (incl. Wages)",
      "Other Property Expenses",
    ],
  },
  "Foreign Property": {
    income: ["Rental Income", "Premiums for Lease Grants", "Other Property Income"],
    expense: [
      "Rent, Rates, Insurance & Ground Rents",
      "Property Repairs & Maintenance",
      "Loan Interest & Finance Costs",
      "Legal, Management & Professional Fees",
      "Costs of Services Provided (incl. Wages)",
      "Other Property Expenses",
    ],
  },
};

// The four standard UK tax-year quarters MTD ITSA reports against. HMRC also
// allows an alternative calendar-quarter election — not modelled here yet.
export function getTaxYearQuarters(taxYear: string) {
  const startYear = parseInt(taxYear.split("/")[0], 10);
  return [
    { label: "Q1 (6 Apr – 5 Jul)", start: `${startYear}-04-06`, end: `${startYear}-07-05` },
    { label: "Q2 (6 Jul – 5 Oct)", start: `${startYear}-07-06`, end: `${startYear}-10-05` },
    { label: "Q3 (6 Oct – 5 Jan)", start: `${startYear}-10-06`, end: `${startYear + 1}-01-05` },
    { label: "Q4 (6 Jan – 5 Apr)", start: `${startYear + 1}-01-06`, end: `${startYear + 1}-04-05` },
  ];
}

async function createIncomeSource(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const sourceType = get("source_type");
  if (!sourceType) return;

  const { data: source, error: insertError } = await supabase
    .from("mtd_income_sources")
    .insert({
      source_type: sourceType,
      business_name: get("business_name") || null,
      description: get("description") || null,
      start_date: get("start_date") || null,
      notes: get("notes") || null,
    })
    .select()
    .single();

  if (insertError || !source) {
    throw new Error(`Failed to create income source: ${insertError?.message}`);
  }

  const owners = [];
  for (let i = 1; i <= 4; i++) {
    const clientId = get(`owner_${i}_client_id`);
    const pct = num(`owner_${i}_percentage`);
    if (clientId && pct > 0) {
      owners.push({ income_source_id: source.id, client_id: clientId, ownership_percentage: pct });
    }
  }

  if (owners.length > 0) {
    const { error: ownersError } = await supabase.from("mtd_income_source_owners").insert(owners);
    if (ownersError) {
      throw new Error(`Income source created, but failed to save owners: ${ownersError.message}`);
    }
  }

  revalidatePath("/mtd");
}

async function deleteIncomeSource(id: string) {
  "use server";
  await supabase.from("mtd_income_sources").delete().eq("id", id);
  revalidatePath("/mtd");
}

export default async function MTDIncomeSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;

  const [{ data: sources, error }, { data: clients }] = await Promise.all([
    supabase
      .from("mtd_income_sources")
      .select("*, mtd_income_source_owners(id, ownership_percentage, clients(id, client_name))")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .in("entity_type", ["Individual", "Sole Trader"])
      .order("client_name", { ascending: true }),
  ]);

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">MTD Income Sources</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Digital record-keeping for MTD for Income Tax — sole trades and properties, with per-owner percentage splits so jointly-owned income can eventually be submitted separately for each individual.
        </p>
      </div>

      <div className="p-8">
        <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 mb-6">
          <p className="text-xs text-blue-800">
            This keeps digital records and calculates quarterly summaries, ready for when HMRC filing credentials are in place — it doesn't yet submit anything to HMRC. Nothing here is a live MTD submission.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load income sources: {error.message}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <a href="/mtd?mode=list"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode !== "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode !== "new" ? "text-white" : "text-slate-900"}`}>All Income Sources</p>
            <p className={`text-sm mt-1 ${mode !== "new" ? "text-slate-300" : "text-slate-500"}`}>{sources?.length ?? 0} on file</p>
          </a>
          <a href="/mtd?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Income Source</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>A sole trade or a property, with its owners</p>
          </a>
        </div>

        {mode !== "new" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Income Sources</h2>
            <div className="mt-4 space-y-3">
              {(sources || []).map((source: any) => {
                const owners = source.mtd_income_source_owners || [];
                const totalPct = owners.reduce((s: number, o: any) => s + Number(o.ownership_percentage), 0);
                return (
                  <div key={source.id} className="rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <a href={`/mtd/${source.id}`} className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">
                            {source.business_name || source.description || source.source_type}
                          </p>
                          <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-600">{source.source_type}</span>
                          {!source.is_active && (
                            <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-red-100 text-red-700">Inactive</span>
                          )}
                          {Math.round(totalPct) !== 100 && owners.length > 0 && (
                            <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-700">
                              ⚠ Splits total {totalPct}%
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {owners.length === 0
                            ? "No owners linked yet"
                            : owners.map((o: any) => `${o.clients?.client_name || "Unknown"} (${o.ownership_percentage}%)`).join(" · ")}
                        </p>
                      </a>
                      <form action={deleteIncomeSource.bind(null, source.id)}>
                        <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
              {(!sources || sources.length === 0) && (
                <p className="text-sm text-slate-500 text-center py-8">No income sources yet.</p>
              )}
            </div>
          </div>
        )}

        {mode === "new" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">New Income Source</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              For a solely-owned trade or property, just fill in one owner at 100%. For jointly-owned property, add each owner with their own percentage — each will get their own quarterly figures later.
            </p>

            <form action={createIncomeSource} className="mt-6 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Source Type *</label>
                <select name="source_type" required defaultValue=""
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="" disabled>Select type</option>
                  <option>Self-Employment</option>
                  <option>UK Property</option>
                  <option>Foreign Property</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Business Name / Property Address</label>
                <input name="business_name"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. Smith Joinery, or 12 Elm Street" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input name="start_date" type="date"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <input name="description"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. Carpentry and joinery services, or Buy-to-let flat" />
              </div>

              <div className="md:col-span-3 rounded-xl border border-slate-100 p-4">
                <h3 className="text-sm font-bold text-slate-900">Owners & Splits</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Percentages should add up to 100%. Leave rows blank if there are fewer than four owners.
                </p>
                <div className="mt-4 space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="grid gap-3 md:grid-cols-3 items-end">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-slate-700 mb-1">Owner {i}</label>
                        <select name={`owner_${i}_client_id`} defaultValue=""
                          className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                          <option value="">None</option>
                          {(clients || []).map((c) => (
                            <option key={c.id} value={c.id}>{c.client_name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Percentage</label>
                        <input name={`owner_${i}_percentage`} type="number" step="0.01" min="0" max="100"
                          defaultValue={i === 1 ? "100" : ""}
                          className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div className="md:col-span-3">
                <button type="submit"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Create Income Source
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
