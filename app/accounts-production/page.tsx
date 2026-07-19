import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TANGIBLE_CATEGORY_OPTIONS, INTANGIBLE_CATEGORY_OPTIONS } from "../fixed-assets/add/page";

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
  "Hire Purchase Interest",
  "Loan Interest",
  "Depreciation",
  "Other Administrative Expenses",
  "Interest Receivable",
];

// --- Fixed asset movement schedule ---
// For each asset class (tangible or intangible) we generate a full set of
// six movement categories, matching a standard FRS102 fixed asset note:
// Cost/Valuation B/F, Additions, Disposals (Cost), Accumulated Depreciation
// B/F, Depreciation Charge for Year, Depreciation on Disposals. The Fixed
// Asset Register derives all of these automatically from each asset's
// acquisition/disposal dates — see accounts-production/[id]/page.tsx.
export type AssetMovementCategories = {
  costBf: string;
  additions: string;
  disposalsCost: string;
  depBf: string;
  depCharge: string;
  depDisposals: string;
};

function buildMovementCategories(assetClass: string, isIntangible: boolean): AssetMovementCategories {
  const dep = isIntangible ? "Amortisation" : "Depreciation";
  return {
    costBf: `${assetClass} - Cost/Valuation B/F`,
    additions: `${assetClass} - Additions`,
    disposalsCost: `${assetClass} - Disposals (Cost)`,
    depBf: `${assetClass} - Accumulated ${dep} B/F`,
    depCharge: `${assetClass} - ${dep} Charge for Year`,
    depDisposals: `${assetClass} - ${dep} on Disposals`,
  };
}

export const FIXED_ASSET_CLASSES: { assetClass: string; isIntangible: boolean }[] = [
  ...TANGIBLE_CATEGORY_OPTIONS.map((c) => ({ assetClass: c, isIntangible: false })),
  ...INTANGIBLE_CATEGORY_OPTIONS.map((c) => ({ assetClass: c, isIntangible: true })),
];

export const FIXED_ASSET_MOVEMENT: Record<string, AssetMovementCategories> = Object.fromEntries(
  FIXED_ASSET_CLASSES.map(({ assetClass, isIntangible }) => [assetClass, buildMovementCategories(assetClass, isIntangible)])
);

export const DISPOSAL_CATEGORY = "Fixed Assets - Disposal Proceeds";

const fixedAssetMovementCategoryList = FIXED_ASSET_CLASSES.flatMap(
  ({ assetClass }) => Object.values(FIXED_ASSET_MOVEMENT[assetClass])
);

// Categories within the movement schedule that are naturally CREDIT balances:
// disposing of cost, and accumulated depreciation (a contra-asset) both being
// credit-normal. Depreciation-on-disposals removes that contra, so it's debit-normal.
const fixedAssetCreditNormalCategories = FIXED_ASSET_CLASSES.flatMap(({ assetClass }) => {
  const m = FIXED_ASSET_MOVEMENT[assetClass];
  return [m.disposalsCost, m.depBf, m.depCharge];
});

// Director's Loan Account movement schedule — the flat "Directors' Loan
// Account" category still exists as a catch-all for whatever hasn't been
// split out. These sub-categories are optional detail on top of it. All are
// posted using ordinary debit/credit convention (debit = director owes the
// company more, credit = company owes the director more) — no special
// CREDIT_NORMAL handling needed, since the parent category already works
// this way and simply summing keeps that consistent.
export const DLA_MOVEMENT_CATEGORIES = [
  "Directors' Loan Account - Balance B/F",
  "Directors' Loan Account - Capital Introduced",
  "Directors' Loan Account - Drawings",
  "Directors' Loan Account - Repayments to Director",
  "Directors' Loan Account - Interest Charged",
];

export const BS_CATEGORIES = [
  "Tangible Fixed Assets",
  "Intangible Fixed Assets",
  ...fixedAssetMovementCategoryList,
  DISPOSAL_CATEGORY,
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
  ...DLA_MOVEMENT_CATEGORIES,
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
  DISPOSAL_CATEGORY,
  ...fixedAssetCreditNormalCategories,
]);

export type PLGroup = "turnover" | "cost_of_sales" | "admin_expenses" | "interest_payable" | "interest_receivable";

// Every built-in P&L category's group — this is what actually drives the
// summary totals now, not a fixed list. Custom categories (added via the
// Chart of Accounts page, stored in custom_pl_categories) supply their own
// group at read time and get merged in by callers — see accounts-production/[id]/frs102/page.tsx.
export const PL_CATEGORY_GROUPS: Record<string, PLGroup> = {
  "Turnover": "turnover",
  "Cost of Sales": "cost_of_sales",
  "Gross Wages and Salaries": "admin_expenses",
  "Employer's NI and Pension Costs": "admin_expenses",
  "Rent and Rates": "admin_expenses",
  "Motor Expenses": "admin_expenses",
  "Travel and Subsistence": "admin_expenses",
  "Repairs and Renewals": "admin_expenses",
  "Insurance": "admin_expenses",
  "Telephone and Internet": "admin_expenses",
  "Printing, Postage and Stationery": "admin_expenses",
  "Professional Fees": "admin_expenses",
  "Bank Charges and Interest Payable": "interest_payable",
  "Hire Purchase Interest": "interest_payable",
  "Loan Interest": "interest_payable",
  "Depreciation": "admin_expenses",
  "Other Administrative Expenses": "admin_expenses",
  "Interest Receivable": "interest_receivable",
};

// Computes a Profit & Loss summary from a set of mapped trial balance lines.
// Shared by the formatted accounts page and the Corporation Tax auto-fill.
// customGroups lets a caller merge in practice- or client-specific categories
// (e.g. from custom_pl_categories) without changing this function — any
// category not found in either map is simply excluded from every total, so
// an un-configured category fails safe rather than silently double-counting.
export function calculateProfitAndLoss(lines: any[], customGroups: Record<string, PLGroup> = {}) {
  const totals = new Map<string, number>();
  (lines || []).forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category)
      ? Number(l.credit) - Number(l.debit)
      : Number(l.debit) - Number(l.credit);
    totals.set(l.category, (totals.get(l.category) || 0) + net);
  });
  const get = (cat: string) => totals.get(cat) || 0;
  const groupOf = (cat: string) => PL_CATEGORY_GROUPS[cat] || customGroups[cat];

  let turnover = 0, costOfSales = 0, adminExpenses = 0, interestPayable = 0, interestReceivable = 0;
  totals.forEach((value, cat) => {
    const group = groupOf(cat);
    if (group === "turnover") turnover += value;
    else if (group === "cost_of_sales") costOfSales += value;
    else if (group === "admin_expenses") adminExpenses += value;
    else if (group === "interest_payable") interestPayable += value;
    else if (group === "interest_receivable") interestReceivable += value;
  });

  const depreciation = get("Depreciation");
  const grossProfit = turnover - costOfSales;
  const operatingProfit = grossProfit - adminExpenses;
  const profitBeforeTax = operatingProfit + interestReceivable - interestPayable;

  return { totals, turnover, costOfSales, grossProfit, depreciation, adminExpenses, operatingProfit, interestReceivable, interestPayable, profitBeforeTax };
}

// Fetches practice-defined custom P&L categories and returns them in the
// shapes callers need: a flat name list (for dropdowns, appended to
// PL_CATEGORIES) and a name->group map (for calculateProfitAndLoss).
export async function getCustomPLCategories(supabaseClient: any) {
  const { data } = await supabaseClient.from("custom_pl_categories").select("name, category_group").order("name", { ascending: true });
  const names = (data || []).map((c: any) => c.name);
  const groups: Record<string, PLGroup> = Object.fromEntries((data || []).map((c: any) => [c.name, c.category_group]));
  return { names, groups };
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
  searchParams: Promise<{ job?: string; mode?: string; client?: string }>;
}) {
  const { job: jobId, mode, client: browseClientId } = await searchParams;

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

  const browseResults = browseClientId
    ? (trialBalances || []).filter((tb) => tb.client_id === browseClientId)
    : [];

  const renderTbRow = (tb: any) => {
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
            {tb.approval_status && ` · ${tb.approval_status}`}
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
  };

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

        {/* Entry choice: Browse existing vs Start New */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <a href="/accounts-production?mode=browse"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "browse" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "browse" ? "text-white" : "text-slate-900"}`}>Browse Existing</p>
            <p className={`text-sm mt-1 ${mode === "browse" ? "text-slate-300" : "text-slate-500"}`}>Find a client's active or historical accounts</p>
          </a>
          <a href="/accounts-production?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ Start New Accounts</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Select a job or client to upload a trial balance</p>
          </a>
        </div>

        {/* BROWSE MODE */}
        {mode === "browse" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 mb-6">
            <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
            <form method="get" className="mt-4 flex gap-2">
              <input type="hidden" name="mode" value="browse" />
              <select name="client" defaultValue={browseClientId || ""}
                className="flex-1 max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">Select a client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
              <button type="submit"
                className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Show
              </button>
            </form>

            {browseClientId && (
              <div className="mt-6 space-y-2">
                {browseResults.map(renderTbRow)}
                {browseResults.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">No accounts on file for this client yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE */}
        {mode === "new" && (
          <>
            {/* Select a job — client and period derive automatically */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Select Job</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Client and period are taken automatically from the job's own dates.
              </p>
              <form method="get" className="mt-4 flex gap-2 items-end">
                <input type="hidden" name="mode" value="new" />
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
                  <a href="/accounts-production?mode=new" className="text-xs font-semibold text-blue-600 hover:underline">Change job</a>
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
          </>
        )}
      </div>
    </div>
  );
}
