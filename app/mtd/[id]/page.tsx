import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { MTD_CATEGORIES, getTaxYearQuarters } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function addTransaction(sourceId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const amount = parseFloat(get("amount")) || 0;
  if (amount <= 0) return;

  const { error: insertError } = await supabase.from("mtd_transactions").insert({
    income_source_id: sourceId,
    transaction_date: get("transaction_date"),
    transaction_type: get("transaction_type"),
    category: get("category"),
    description: get("description") || null,
    amount,
  });

  if (insertError) {
    throw new Error(`Failed to save transaction: ${insertError.message}`);
  }

  revalidatePath(`/mtd/${sourceId}`);
}

async function deleteTransaction(sourceId: string, transactionId: string) {
  "use server";
  await supabase.from("mtd_transactions").delete().eq("id", transactionId);
  revalidatePath(`/mtd/${sourceId}`);
}

async function updateIncomeSource(sourceId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  const { error: updateError } = await supabase.from("mtd_income_sources").update({
    business_name: get("business_name") || null,
    description: get("description") || null,
    start_date: get("start_date") || null,
    is_active: formData.get("is_active") === "on",
    notes: get("notes") || null,
  }).eq("id", sourceId);

  if (updateError) {
    throw new Error(`Failed to update income source: ${updateError.message}`);
  }

  revalidatePath(`/mtd/${sourceId}`);
}

const FINANCE_COST_CATEGORY = "Loan Interest & Finance Costs";

// Syncs one owner's annual share of this income source into their own
// Personal Tax computation for the matching tax year. Only the DELTA since
// the last sync is applied — same pattern as Director Remuneration sync on
// the Clients page — so re-syncing after edits never double-counts, and
// doesn't disturb other income the preparer has entered manually on the
// same computation. Self-Employment syncs as net profit; Property splits
// into gross income, other expenses, and finance costs (which get the 20%
// tax-reducer treatment rather than a plain deduction).
async function syncOwnerToPersonalTax(sourceId: string, ownerId: string, clientId: string, sourceType: string, taxYear: string) {
  "use server";

  const quarters = getTaxYearQuarters(taxYear);
  const { data: transactions } = await supabase
    .from("mtd_transactions")
    .select("transaction_type, category, amount")
    .eq("income_source_id", sourceId)
    .gte("transaction_date", quarters[0].start)
    .lte("transaction_date", quarters[3].end);

  const { data: owner } = await supabase
    .from("mtd_income_source_owners")
    .select("*")
    .eq("id", ownerId)
    .single();
  if (!owner) return;

  const pct = Number(owner.ownership_percentage) / 100;
  const list = transactions || [];

  const totalIncome = list.filter((t) => t.transaction_type === "Income").reduce((s, t) => s + Number(t.amount), 0) * pct;
  const totalFinanceCosts = list.filter((t) => t.transaction_type === "Expense" && t.category === FINANCE_COST_CATEGORY).reduce((s, t) => s + Number(t.amount), 0) * pct;
  const totalOtherExpenses = list.filter((t) => t.transaction_type === "Expense" && t.category !== FINANCE_COST_CATEGORY).reduce((s, t) => s + Number(t.amount), 0) * pct;

  const priorIncome = Number(owner.synced_income || 0);
  const priorExpenses = Number(owner.synced_expenses || 0);
  const priorFinanceCosts = Number(owner.synced_finance_costs || 0);

  const deltaIncome = totalIncome - priorIncome;
  const deltaExpenses = totalOtherExpenses - priorExpenses;
  const deltaFinanceCosts = totalFinanceCosts - priorFinanceCosts;
  const deltaProfit = (totalIncome - totalOtherExpenses - totalFinanceCosts) - (priorIncome - priorExpenses - priorFinanceCosts);

  const { data: existingComp } = await supabase
    .from("tax_computations")
    .select("*")
    .eq("client_id", clientId)
    .eq("tax_year", taxYear)
    .maybeSingle();

  const isUKProperty = sourceType === "UK Property";
  const isForeignProperty = sourceType === "Foreign Property";
  const isSelfEmployment = sourceType === "Self-Employment";

  if (existingComp) {
    const updates: any = {};
    if (isSelfEmployment) {
      updates.self_employment_income = Number(existingComp.self_employment_income || 0) + deltaProfit;
    } else if (isUKProperty) {
      updates.rental_income = Number(existingComp.rental_income || 0) + deltaIncome;
      updates.property_expenses = Number(existingComp.property_expenses || 0) + deltaExpenses;
      updates.property_finance_costs = Number(existingComp.property_finance_costs || 0) + deltaFinanceCosts;
    } else if (isForeignProperty) {
      updates.foreign_rental_income = Number(existingComp.foreign_rental_income || 0) + deltaIncome;
      updates.foreign_property_expenses = Number(existingComp.foreign_property_expenses || 0) + deltaExpenses;
      updates.foreign_property_finance_costs = Number(existingComp.foreign_property_finance_costs || 0) + deltaFinanceCosts;
    }
    const { error: syncUpdateError } = await supabase.from("tax_computations").update(updates).eq("id", existingComp.id);
    if (syncUpdateError) throw new Error(`Failed to sync to Personal Tax: ${syncUpdateError.message}`);
  } else {
    const insertData: any = {
      client_id: clientId,
      tax_year: taxYear,
      employment_income: 0, self_employment_income: 0, rental_income: 0, pension_income: 0, interest_income: 0, dividend_income: 0,
      property_expenses: 0, property_finance_costs: 0, finance_costs_bf: 0,
      foreign_employment_income: 0, foreign_interest_income: 0, foreign_dividend_income: 0,
      foreign_rental_income: 0, foreign_property_expenses: 0, foreign_property_finance_costs: 0, foreign_finance_costs_bf: 0,
      foreign_tax_paid: 0, tax_paid_at_source: 0,
    };
    if (isSelfEmployment) insertData.self_employment_income = deltaProfit;
    else if (isUKProperty) { insertData.rental_income = deltaIncome; insertData.property_expenses = deltaExpenses; insertData.property_finance_costs = deltaFinanceCosts; }
    else if (isForeignProperty) { insertData.foreign_rental_income = deltaIncome; insertData.foreign_property_expenses = deltaExpenses; insertData.foreign_property_finance_costs = deltaFinanceCosts; }

    const { error: syncInsertError } = await supabase.from("tax_computations").insert(insertData);
    if (syncInsertError) throw new Error(`Failed to create Personal Tax computation: ${syncInsertError.message}`);
  }

  const { error: ownerUpdateError } = await supabase.from("mtd_income_source_owners").update({
    synced_income: totalIncome,
    synced_expenses: totalOtherExpenses,
    synced_finance_costs: totalFinanceCosts,
    synced_tax_year: taxYear,
    synced_at: new Date().toISOString(),
  }).eq("id", ownerId);
  if (ownerUpdateError) throw new Error(`Synced to Personal Tax, but failed to record sync status: ${ownerUpdateError.message}`);

  revalidatePath(`/mtd/${sourceId}`);
  revalidatePath("/tax");
}

export default async function MTDIncomeSourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tax_year?: string }>;
}) {
  const { id } = await params;
  const { tax_year } = await searchParams;
  const taxYear = tax_year || "2026/27";

  const { data: source, error } = await supabase
    .from("mtd_income_sources")
    .select("*, mtd_income_source_owners(id, ownership_percentage, synced_income, synced_expenses, synced_finance_costs, synced_tax_year, synced_at, clients(id, client_name))")
    .eq("id", id)
    .single();

  if (error || !source) notFound();

  const { data: transactions } = await supabase
    .from("mtd_transactions")
    .select("*")
    .eq("income_source_id", id)
    .order("transaction_date", { ascending: false });

  const owners = source.mtd_income_source_owners || [];
  const totalPct = owners.reduce((s: number, o: any) => s + Number(o.ownership_percentage), 0);
  const categories = MTD_CATEGORIES[source.source_type] || MTD_CATEGORIES["Self-Employment"];
  const quarters = getTaxYearQuarters(taxYear);

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");

  const quarterSummaries = quarters.map((q) => {
    const inRange = (transactions || []).filter(
      (t: any) => t.transaction_date >= q.start && t.transaction_date <= q.end
    );
    const totalIncome = inRange.filter((t: any) => t.transaction_type === "Income").reduce((s: number, t: any) => s + Number(t.amount), 0);
    const totalExpense = inRange.filter((t: any) => t.transaction_type === "Expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
    const netProfit = totalIncome - totalExpense;

    const ownerShares = owners.map((o: any) => {
      const pct = Number(o.ownership_percentage) / 100;
      return {
        clientName: o.clients?.client_name || "Unknown",
        clientId: o.clients?.id,
        income: totalIncome * pct,
        expense: totalExpense * pct,
        profit: netProfit * pct,
      };
    });

    return { ...q, transactionCount: inRange.length, totalIncome, totalExpense, netProfit, ownerShares };
  });

  const annualTotalIncome = quarterSummaries.reduce((s, q) => s + q.totalIncome, 0);
  const annualTotalExpense = quarterSummaries.reduce((s, q) => s + q.totalExpense, 0);
  const annualNetProfit = annualTotalIncome - annualTotalExpense;

  // Per-owner annual figures, split into income / other expenses / finance
  // costs (property only), with sync status compared against what was last
  // pushed to that owner's own Personal Tax computation.
  const ownerAnnualSummaries = owners.map((o: any) => {
    const pct = Number(o.ownership_percentage) / 100;
    const allTx = transactions || [];
    const income = allTx.filter((t: any) => t.transaction_type === "Income").reduce((s: number, t: any) => s + Number(t.amount), 0) * pct;
    const financeCosts = allTx.filter((t: any) => t.transaction_type === "Expense" && t.category === "Loan Interest & Finance Costs").reduce((s: number, t: any) => s + Number(t.amount), 0) * pct;
    const otherExpenses = allTx.filter((t: any) => t.transaction_type === "Expense" && t.category !== "Loan Interest & Finance Costs").reduce((s: number, t: any) => s + Number(t.amount), 0) * pct;

    const isSynced = o.synced_tax_year === taxYear &&
      Math.abs(Number(o.synced_income || 0) - income) < 0.01 &&
      Math.abs(Number(o.synced_expenses || 0) - otherExpenses) < 0.01 &&
      Math.abs(Number(o.synced_finance_costs || 0) - financeCosts) < 0.01;
    const hasSyncedBefore = o.synced_at && o.synced_tax_year === taxYear;

    return { owner: o, income, financeCosts, otherExpenses, profit: income - otherExpenses - financeCosts, isSynced, hasSyncedBefore };
  });

  const updateWithId = updateIncomeSource.bind(null, id);
  const addTransactionWithId = addTransaction.bind(null, id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/mtd" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Income Sources
        </a>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{source.business_name || source.description || source.source_type}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {source.source_type}
            {owners.length > 0 && ` · ${owners.map((o: any) => `${o.clients?.client_name || "Unknown"} (${o.ownership_percentage}%)`).join(" · ")}`}
          </p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {owners.length > 0 && Math.round(totalPct) !== 100 && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
              <p className="text-sm font-bold text-amber-800">⚠ Ownership percentages total {totalPct}%, not 100%</p>
              <p className="text-xs text-amber-700 mt-1">Check the split on the Edit panel — each owner's quarterly figures below are calculated from these percentages.</p>
            </div>
          )}

          {/* Quarterly Summary */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Quarterly Summary</h2>
              <form method="get" className="flex gap-2 items-center">
                <select name="tax_year" defaultValue={taxYear}
                  className="rounded-xl border border-slate-200 p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="2026/27">2026/27</option>
                </select>
                <button type="submit" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                  Show
                </button>
              </form>
            </div>

            <div className="mt-4 space-y-4">
              {quarterSummaries.map((q) => (
                <div key={q.label} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-900">{q.label}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                      Not yet submitted — HMRC connection not yet live
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Income</p>
                      <p className="font-semibold text-slate-900">{fmt(q.totalIncome)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Expenses</p>
                      <p className="font-semibold text-slate-900">{fmt(q.totalExpense)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Net Profit</p>
                      <p className="font-semibold text-slate-900">{fmt(q.netProfit)}</p>
                    </div>
                  </div>
                  {owners.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                      {q.ownerShares.map((os: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-slate-500">{os.clientName}'s share</span>
                          <span className="font-medium text-slate-700">
                            Income {fmt(os.income)} · Expenses {fmt(os.expense)} · Profit {fmt(os.profit)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-slate-400 mt-2">{q.transactionCount} transaction{q.transactionCount !== 1 ? "s" : ""} in this quarter</p>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400">Annual Income</p>
                <p className="font-bold text-slate-900">{fmt(annualTotalIncome)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Annual Expenses</p>
                <p className="font-bold text-slate-900">{fmt(annualTotalExpense)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Annual Net Profit</p>
                <p className="font-bold text-slate-900">{fmt(annualNetProfit)}</p>
              </div>
            </div>
          </div>

          {/* Annual Totals by Owner — sync to each owner's own Personal Tax computation */}
          {owners.length > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Annual Totals by Owner</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Each owner's share of the full tax year, ready to push into their own Personal Tax computation for {taxYear}.
              </p>
              <div className="mt-4 space-y-3">
                {ownerAnnualSummaries.map(({ owner: o, income, financeCosts, otherExpenses, profit, isSynced, hasSyncedBefore }: any) => {
                  const syncAction = syncOwnerToPersonalTax.bind(null, id, o.id, o.clients?.id, source.source_type, taxYear);
                  return (
                    <div key={o.id} className="rounded-xl border border-slate-100 p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-slate-900">{o.clients?.client_name || "Unknown"} ({o.ownership_percentage}%)</p>
                        <span className={`text-xs font-semibold ${isSynced ? "text-green-600" : hasSyncedBefore ? "text-amber-600" : "text-slate-400"}`}>
                          {isSynced ? "✓ Synced" : hasSyncedBefore ? "⚠ Changed since last sync" : "Not yet synced"}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-slate-400">Income</p>
                          <p className="font-medium text-slate-900">{fmt(income)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">{source.source_type === "Self-Employment" ? "Expenses" : "Other Expenses"}</p>
                          <p className="font-medium text-slate-900">{fmt(otherExpenses)}</p>
                        </div>
                        {source.source_type !== "Self-Employment" && (
                          <div>
                            <p className="text-xs text-slate-400">Finance Costs</p>
                            <p className="font-medium text-slate-900">{fmt(financeCosts)}</p>
                          </div>
                        )}
                        {source.source_type === "Self-Employment" && (
                          <div>
                            <p className="text-xs text-slate-400">Net Profit</p>
                            <p className="font-medium text-slate-900">{fmt(profit)}</p>
                          </div>
                        )}
                      </div>
                      {!isSynced && o.clients?.id && (
                        <form action={syncAction} className="mt-3">
                          <button type="submit" className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition-colors">
                            Sync to {o.clients.client_name}'s Personal Tax →
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 mt-4">
                Syncing pushes the figures above into ({source.source_type === "Self-Employment" ? "as net profit" : "split into gross income, expenses, and finance costs"}) each owner's own {taxYear} Personal Tax computation, creating one if it doesn't exist yet. Only the change since the last sync is applied, so re-syncing after edits won't double-count or overwrite other income you've entered separately on their return.
              </p>
            </div>
          )}

          {/* Add Transaction */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Add Transaction</h2>
            <form action={addTransactionWithId} className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                <input name="transaction_date" type="date" required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select name="transaction_type" defaultValue="Expense"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Income</option>
                  <option>Expense</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (£) *</label>
                <input name="amount" type="number" step="0.01" min="0" required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                <select name="category" required defaultValue=""
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="" disabled>Select category</option>
                  <optgroup label="Income">
                    {categories.income.map((c) => <option key={c}>{c}</option>)}
                  </optgroup>
                  <optgroup label="Expense">
                    {categories.expense.map((c) => <option key={c}>{c}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <input name="description"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div className="md:col-span-3">
                <button type="submit"
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Add Transaction
                </button>
              </div>
            </form>
          </div>

          {/* Transaction List */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Transactions ({transactions?.length ?? 0})</h2>
            <div className="mt-4 space-y-2">
              {(transactions || []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t.category}</p>
                    <p className="text-xs text-slate-400">
                      {fmtDate(t.transaction_date)}{t.description && ` · ${t.description}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-semibold ${t.transaction_type === "Income" ? "text-green-600" : "text-slate-900"}`}>
                      {t.transaction_type === "Income" ? "+" : "−"}{fmt(Number(t.amount))}
                    </span>
                    <form action={deleteTransaction.bind(null, id, t.id)}>
                      <button className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              ))}
              {(!transactions || transactions.length === 0) && (
                <p className="text-sm text-slate-500 text-center py-6">No transactions recorded yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              This calculates quarterly totals from the digital records above, ready for when HMRC filing credentials and a submission channel are in place. It doesn't submit anything to HMRC yet. Uses the standard tax-year quarters (6 Apr–5 Jul etc.) — HMRC's alternative calendar-quarter election isn't modelled here.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Income Source</h2>
            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Business Name / Property Address</label>
                <input name="business_name" defaultValue={source.business_name || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <input name="description" defaultValue={source.description || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input name="start_date" type="date" defaultValue={source.start_date || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input name="is_active" type="checkbox" defaultChecked={source.is_active} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700">Active</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={source.notes || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save
              </button>
            </form>
            <p className="text-xs text-slate-400 mt-3">
              To change owners or their percentages, this needs a small owner-editing panel we haven't built yet — for now, delete and recreate the income source with the correct splits if they change.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
