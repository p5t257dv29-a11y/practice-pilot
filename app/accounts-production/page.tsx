import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Standard categories a trial balance line can be mapped to.
// P&L categories roll up into the Profit & Loss account; Balance Sheet
// categories roll up into the Balance Sheet. Covers a typical small company.
export const PL_CATEGORIES = [
  "Turnover",
  "Cost of Sales",
  "Gross Wages and Salaries",
  "Employer's NI and Pension Costs",
  "Rent and Rates",
  "Motor Expenses",
  "Travel and Subsistence",
  "Repairs and Renewals",
  "Insurance",
  "Telephone and Internet",
  "Printing, Postage and Stationery",
  "Professional Fees",
  "Bank Charges and Interest Payable",
  "Depreciation",
  "Other Administrative Expenses",
  "Interest Receivable",
];

export const BS_CATEGORIES = [
  "Tangible Fixed Assets",
  "Stock",
  "Trade Debtors",
  "Prepayments and Accrued Income",
  "Cash at Bank and in Hand",
  "Trade Creditors",
  "Accruals and Deferred Income",
  "VAT Liability",
  "PAYE/NI Liability",
  "Corporation Tax Liability",
  "Directors' Loan Account",
  "Bank Loans - Due Within One Year",
  "Bank Loans - Due After One Year",
  "Called Up Share Capital",
  "Profit and Loss Reserve",
];

export const ALL_CATEGORIES = [...PL_CATEGORIES, ...BS_CATEGORIES];

// Categories that are naturally CREDIT balances (income, liabilities, equity).
// Everything else is treated as a naturally DEBIT balance (assets, expenses).
export const CREDIT_NORMAL = new Set([
  "Turnover", "Interest Receivable",
  "Trade Creditors", "Accruals and Deferred Income", "VAT Liability", "PAYE/NI Liability",
  "Corporation Tax Liability", "Bank Loans - Due Within One Year", "Bank Loans - Due After One Year",
  "Called Up Share Capital", "Profit and Loss Reserve",
]);

const ADMIN_EXPENSE_CATEGORIES = [
  "Gross Wages and Salaries", "Employer's NI and Pension Costs", "Rent and Rates",
  "Motor Expenses", "Travel and Subsistence", "Repairs and Renewals", "Insurance",
  "Telephone and Internet", "Printing, Postage and Stationery", "Professional Fees",
  "Depreciation", "Other Administrative Expenses",
];

// Computes a Profit & Loss summary from a set of mapped trial balance lines.
// Shared by the formatted accounts page and the Corporation Tax auto-fill.
export function calculateProfitAndLoss(lines: any[]) {
  const totals = new Map<string, number>();
  (lines || []).forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category)
      ? Number(l.credit) - Number(l.debit)
      : Number(l.debit) - Number(l.credit);
    totals.set(l.category, (totals.get(l.category) || 0) + net);
  });
  const get = (cat: string) => totals.get(cat) || 0;

  const turnover = get("Turnover");
  const costOfSales = get("Cost of Sales");
  const grossProfit = turnover - costOfSales;
  const depreciation = get("Depreciation");
  const adminExpenses = ADMIN_EXPENSE_CATEGORIES.reduce((s, c) => s + get(c), 0);
  const operatingProfit = grossProfit - adminExpenses;
  const interestReceivable = get("Interest Receivable");
  const interestPayable = get("Bank Charges and Interest Payable");
  const profitBeforeTax = operatingProfit + interestReceivable - interestPayable;

  return { totals, turnover, costOfSales, grossProfit, depreciation, adminExpenses, operatingProfit, interestReceivable, interestPayable, profitBeforeTax };
}

// Simple CSV line parser handling quoted fields with commas inside them
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function uploadTrialBalance(formData: FormData) {
  "use server";

  const client_id = String(formData.get("client_id") || "").trim();
  const job_id = String(formData.get("job_id") || "").trim() || null;
  const period_start = String(formData.get("period_start") || "").trim();
  const period_end = String(formData.get("period_end") || "").trim();
  const file = formData.get("csv_file") as File | null;

  if (!client_id || !period_start || !period_end || !file || file.size === 0) {
    return;
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return;

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const codeIdx = headers.findIndex((h) => h.includes("code"));
  const descIdx = headers.findIndex((h) => h.includes("description") || h.includes("name"));
  const debitIdx = headers.findIndex((h) => h.includes("debit"));
  const creditIdx = headers.findIndex((h) => h.includes("credit"));

  // Create the trial balance record
  const { data: tb, error: tbError } = await supabase
    .from("trial_balances")
    .insert({
      client_id,
      job_id,
      period_start,
      period_end,
      filename: file.name,
    })
    .select()
    .single();

  if (tbError || !tb) {
    console.error("Could not create trial balance:", tbError?.message);
    return;
  }

  // Load client-specific mappings (highest priority) and the master
  // Chart of Accounts (fallback for codes not yet seen for this client)
  const [{ data: clientMappings }, { data: masterAccounts }] = await Promise.all([
    supabase.from("nominal_code_mappings").select("nominal_code, category").eq("client_id", client_id),
    supabase.from("chart_of_accounts").select("nominal_code, category"),
  ]);

  const clientLookup = new Map((clientMappings || []).map((m) => [m.nominal_code, m.category]));
  const masterLookup = new Map((masterAccounts || []).map((m) => [m.nominal_code, m.category]));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const nominal_code = codeIdx >= 0 ? cols[codeIdx] : null;
    const description = descIdx >= 0 ? cols[descIdx] : cols[0] || "Unnamed line";
    const debit = debitIdx >= 0 ? parseFloat(cols[debitIdx].replace(/[£,]/g, "")) || 0 : 0;
    const credit = creditIdx >= 0 ? parseFloat(cols[creditIdx].replace(/[£,]/g, "")) || 0 : 0;

    if (!description) continue;

    const category = nominal_code
      ? clientLookup.get(nominal_code) || masterLookup.get(nominal_code) || null
      : null;

    rows.push({
      trial_balance_id: tb.id,
      nominal_code,
      description,
      debit,
      credit,
      category,
    });
  }

  if (rows.length > 0) {
    const { error: linesError } = await supabase.from("trial_balance_lines").insert(rows);
    if (linesError) {
      console.error("Could not insert trial balance lines:", linesError.message);
    }
  }

  revalidatePath("/accounts-production");
  redirect(`/accounts-production/${tb.id}`);
}

async function deleteTrialBalance(id: string) {
  "use server";
  await supabase.from("trial_balances").delete().eq("id", id);
  revalidatePath("/accounts-production");
}

export default async function AccountsProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job: jobId } = await searchParams;

  const [{ data: trialBalances, error }, { data: clients }, { data: jobs }] = await Promise.all([
    supabase
      .from("trial_balances")
      .select("*, clients(client_name), jobs(job_name), trial_balance_lines(id, category)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, job_name, client_id, period_start, period_end, clients(client_name)")
      .order("job_name", { ascending: true }),
  ]);

  const selectedJob = jobId ? (jobs || []).find((j) => j.id === jobId) : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Accounts Production</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Upload a trial balance, map nominal codes to categories, and build towards a full set of accounts.
            </p>
          </div>
          <a href="/chart-of-accounts"
            className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            Chart of Accounts →
          </a>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load trial balances: {error.message}
          </div>
        )}

        {/* Step 1: select a job — client and period derive automatically */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Select Job</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Client and period are taken automatically from the job's own dates.
          </p>
          <form method="get" className="mt-4 flex gap-2 items-end">
            <div className="flex-1 max-w-md">
              <select name="job" defaultValue={jobId || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a job</option>
                {(jobs || []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {(j.clients as any)?.client_name} — {j.job_name}
                    {j.period_start && j.period_end && ` (${new Date(j.period_start).toLocaleDateString("en-GB")} – ${new Date(j.period_end).toLocaleDateString("en-GB")})`}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit"
              className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
              Continue
            </button>
          </form>
        </div>

        {/* Upload form — appears once a job is selected, or via manual fallback below */}
        {selectedJob && (
          <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Upload Trial Balance</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              CSV with columns for Nominal Code, Description, Debit, and Credit (column order and naming are flexible — headers are matched automatically).
            </p>

            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <span className="text-sm font-medium text-slate-700">
                Client: {(selectedJob.clients as any)?.client_name} · Job: {selectedJob.job_name}
              </span>
              <a href="/accounts-production" className="text-xs font-semibold text-blue-600 hover:underline">Change job</a>
            </div>

            <form action={uploadTrialBalance} className="mt-4 grid gap-4 md:grid-cols-2">
              <input type="hidden" name="client_id" value={selectedJob.client_id} />
              <input type="hidden" name="job_id" value={selectedJob.id} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
                <input name="period_start" type="date" required defaultValue={selectedJob.period_start || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
                <input name="period_end" type="date" required defaultValue={selectedJob.period_end || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Trial Balance CSV *</label>
                <input name="csv_file" type="file" accept=".csv" required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white" />
              </div>
              <div className="md:col-span-2">
                <button type="submit"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Upload & Continue
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Fallback: manual client + period, for clients without a job set up */}
        <details className="mt-4 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <summary className="text-sm font-semibold text-slate-600 cursor-pointer">
            Or select client and period manually →
          </summary>
          <form action={uploadTrialBalance} className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select name="client_id" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <div></div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
              <input name="period_start" type="date" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
              <input name="period_end" type="date" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Trial Balance CSV *</label>
              <input name="csv_file" type="file" accept=".csv" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white" />
            </div>
            <div className="md:col-span-2">
              <button type="submit"
                className="rounded-xl bg-slate-100 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Upload & Continue
              </button>
            </div>
          </form>
        </details>

        {/* List */}
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Trial Balances ({trialBalances?.length ?? 0})</h2>
          <div className="mt-4 space-y-2">
            {(trialBalances || []).map((tb) => {
              const lineCount = tb.trial_balance_lines?.length || 0;
              const mappedCount = (tb.trial_balance_lines || []).filter((l: any) => l.category).length;
              const fullyMapped = lineCount > 0 && mappedCount === lineCount;

              return (
                <div key={tb.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                  <a href={`/accounts-production/${tb.id}`} className="flex-1">
                    <p className="font-semibold text-slate-900">
                      {(tb.clients as any)?.client_name || "No client"} — {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {lineCount} lines{(tb.jobs as any)?.job_name && ` · Job: ${(tb.jobs as any).job_name}`}
                    </p>
                  </a>
                  <div className="flex items-center gap-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      fullyMapped ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                    }`}>
                      {fullyMapped ? "Fully mapped" : `${mappedCount}/${lineCount} mapped`}
                    </span>
                    <form action={deleteTrialBalance.bind(null, tb.id)}>
                      <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
            {(!trialBalances || trialBalances.length === 0) && (
              <p className="text-sm text-slate-500 text-center py-8">No trial balances uploaded yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
