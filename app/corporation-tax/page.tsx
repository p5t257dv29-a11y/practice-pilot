import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { calculateCapitalAllowances } from "../fixed-assets/capital-allowances/page";
import { calculateProfitAndLoss } from "../accounts-production/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2026/27 Corporation Tax rates
const CT_RATES = {
  smallProfitsRate: 0.19,
  mainRate: 0.25,
  smallProfitsThreshold: 50000,
  mainRateThreshold: 250000,
  marginalReliefFraction: 3 / 200,
};

// Applies brought-forward trading losses against current period profit.
// Losses can only offset up to the available profit; anything unused (plus
// any fresh loss made this period) carries forward to the next computation.
export function applyLossRelief(taxableProfitBeforeLosses: number, lossesBroughtForward: number) {
  let lossesUsed = 0;
  let newLossThisPeriod = 0;
  let taxableProfitAfterLosses = 0;

  if (taxableProfitBeforeLosses > 0) {
    lossesUsed = Math.min(taxableProfitBeforeLosses, lossesBroughtForward);
    taxableProfitAfterLosses = taxableProfitBeforeLosses - lossesUsed;
  } else {
    newLossThisPeriod = Math.abs(taxableProfitBeforeLosses);
    taxableProfitAfterLosses = 0;
  }

  const lossesCarriedForward = (lossesBroughtForward - lossesUsed) + newLossThisPeriod;

  return { lossesUsed, newLossThisPeriod, taxableProfitAfterLosses, lossesCarriedForward };
}

export function calculateCorporationTax(input: {
  taxableProfit: number;
  periodStart: string;
  periodEnd: string;
  associatedCompanies: number;
}) {
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  const periodMonths = Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000)));

  const divisor = input.associatedCompanies + 1;
  const smallProfitsThreshold = (CT_RATES.smallProfitsThreshold * (periodMonths / 12)) / divisor;
  const mainRateThreshold = (CT_RATES.mainRateThreshold * (periodMonths / 12)) / divisor;

  const profit = Math.max(0, input.taxableProfit);
  let corporationTax = 0;
  let marginalRelief = 0;
  let band = "";
  let effectiveRate = 0;

  if (profit <= smallProfitsThreshold) {
    corporationTax = profit * CT_RATES.smallProfitsRate;
    band = "Small Profits Rate";
    effectiveRate = CT_RATES.smallProfitsRate;
  } else if (profit >= mainRateThreshold) {
    corporationTax = profit * CT_RATES.mainRate;
    band = "Main Rate";
    effectiveRate = CT_RATES.mainRate;
  } else {
    // Marginal relief band. Assumes augmented profits = taxable profits (no exempt group dividends).
    const taxAtMainRate = profit * CT_RATES.mainRate;
    marginalRelief = (mainRateThreshold - profit) * CT_RATES.marginalReliefFraction;
    corporationTax = taxAtMainRate - marginalRelief;
    band = "Marginal Relief";
    effectiveRate = profit > 0 ? corporationTax / profit : 0;
  }

  return {
    periodMonths,
    smallProfitsThreshold,
    mainRateThreshold,
    profit,
    corporationTax,
    marginalRelief,
    band,
    effectiveRate,
  };
}

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  if (!client_id) return;

  await supabase.from("corporation_tax_computations").insert({
    client_id,
    job_id: get("job_id") || null,
    period_start: get("period_start"),
    period_end: get("period_end"),
    turnover: num("turnover"),
    accounting_profit: num("accounting_profit"),
    depreciation_addback: num("depreciation_addback"),
    disallowable_expenses: num("disallowable_expenses"),
    other_allowable_deductions: num("other_allowable_deductions"),
    brought_forward_losses: num("brought_forward_losses"),
    associated_companies: parseInt(get("associated_companies")) || 0,
    main_pool_bfwd: num("main_pool_bfwd"),
    special_rate_pool_bfwd: num("special_rate_pool_bfwd"),
    tax_paid_on_account: num("tax_paid_on_account"),
    notes: get("notes"),
  });

  revalidatePath("/corporation-tax");
}

async function deleteComputation(id: string) {
  "use server";
  await supabase.from("corporation_tax_computations").delete().eq("id", id);
  revalidatePath("/corporation-tax");
}

export default async function CorporationTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; job?: string }>;
}) {
  const { client: selectedClientId, job: selectedJobId } = await searchParams;

  const [{ data: computations, error }, { data: clients }, { data: jobs }] = await Promise.all([
    supabase
      .from("corporation_tax_computations")
      .select("*, clients(client_name), jobs(job_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, job_name, client_id")
      .order("job_name", { ascending: true }),
  ]);

  // Compute results for each row, pulling capital allowances live from the fixed asset register
  const rows = await Promise.all(
    (computations || []).map(async (comp) => {
      const { data: assets } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("client_id", comp.client_id);

      const ca = calculateCapitalAllowances({
        assets: assets || [],
        periodStart: comp.period_start,
        periodEnd: comp.period_end,
        mainPoolBfwd: Number(comp.main_pool_bfwd),
        specialRatePoolBfwd: Number(comp.special_rate_pool_bfwd),
        jobId: comp.job_id,
      });

      const taxableProfitBeforeLosses =
        Number(comp.accounting_profit) +
        Number(comp.depreciation_addback) +
        Number(comp.disallowable_expenses) -
        ca.totalCapitalAllowances -
        Number(comp.other_allowable_deductions);

      const loss = applyLossRelief(taxableProfitBeforeLosses, Number(comp.brought_forward_losses));

      const ct = calculateCorporationTax({
        taxableProfit: loss.taxableProfitAfterLosses,
        periodStart: comp.period_start,
        periodEnd: comp.period_end,
        associatedCompanies: comp.associated_companies,
      });

      return { comp, ca, taxableProfitBeforeLosses, loss, ct };
    })
  );

  // Suggest brought-forward losses from the selected client's most recent prior computation
  let suggestedLossesBfwd = 0;
  let priorComputation: any = null;
  if (selectedClientId) {
    const clientRows = rows
      .filter((r) => r.comp.client_id === selectedClientId)
      .sort((a, b) => new Date(b.comp.period_end).getTime() - new Date(a.comp.period_end).getTime());
    if (clientRows.length > 0) {
      priorComputation = clientRows[0];
      suggestedLossesBfwd = priorComputation.loss.lossesCarriedForward;
    }
  }

  const selectedClient = (clients || []).find((c) => c.id === selectedClientId);

  // If a job is selected, look up its most recent linked trial balance and
  // suggest Turnover / Accounting Profit / Depreciation from the accounts
  let linkedTrialBalance: any = null;
  let suggestedTurnover = 0;
  let suggestedAccountingProfit = 0;
  let suggestedDepreciation = 0;
  let suggestedPeriodStart = "";
  let suggestedPeriodEnd = "";

  if (selectedJobId) {
    const { data: tb } = await supabase
      .from("trial_balances")
      .select("*, trial_balance_lines(*)")
      .eq("job_id", selectedJobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tb) {
      linkedTrialBalance = tb;
      const pl = calculateProfitAndLoss(tb.trial_balance_lines || []);
      suggestedTurnover = pl.turnover;
      suggestedAccountingProfit = pl.profitBeforeTax;
      suggestedDepreciation = pl.depreciation;
      suggestedPeriodStart = tb.period_start;
      suggestedPeriodEnd = tb.period_end;
    }
  }

  const selectedJobRecord = selectedJobId ? (jobs || []).find((j) => j.id === selectedJobId) : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Corporation Tax</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Computes Corporation Tax liability using 2026/27 rates, pulling capital allowances live from the Fixed Asset Register.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load computations: {error.message}
          </div>
        )}

        {/* New Computation Form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">New Corporation Tax Computation</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Capital allowances are calculated automatically from assets acquired in this period in the Fixed Asset Register.
          </p>

          {/* Step 1: pick a client so we can look up their prior losses carried forward */}
          <form method="get" className="mt-4 flex gap-2 items-end">
            <div className="flex-1 max-w-sm">
              <label className="block text-sm font-medium text-slate-700 mb-1">Client</label>
              <select name="client" defaultValue={selectedClientId || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">Select a client to start</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <button type="submit"
              className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
              Continue
            </button>
          </form>

          {selectedClientId && selectedClient && selectedJobId === undefined && (
            <div className="mt-4">
              <form method="get" className="flex gap-2 items-end">
                <input type="hidden" name="client" value={selectedClientId} />
                <div className="flex-1 max-w-sm">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Linked Job (optional)</label>
                  <select name="job" defaultValue=""
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                    <option value="">No linked job</option>
                    {(jobs || []).filter((j) => j.client_id === selectedClientId).map((j) => (
                      <option key={j.id} value={j.id}>{j.job_name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    If linked, capital allowances pull from that job's assets, and Turnover/Accounting Profit/Depreciation pre-fill from any linked trial balance.
                  </p>
                </div>
                <button type="submit"
                  className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                  Continue
                </button>
              </form>
              <a href={`/corporation-tax?client=${selectedClientId}&job=`}
                className="inline-block mt-2 text-xs font-semibold text-blue-600 hover:underline">
                Skip — continue without a job →
              </a>
            </div>
          )}

          {selectedClientId && selectedClient && selectedJobId !== undefined && (
            <>
              {priorComputation && (
                <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800">
                  Prior computation found for {selectedClient.client_name}, period ending {new Date(priorComputation.comp.period_end).toLocaleDateString("en-GB")}:
                  {" "}losses carried forward of <strong>£{suggestedLossesBfwd.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</strong> have been pre-filled below.
                </div>
              )}

              {linkedTrialBalance && (
                <div className="mt-4 rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-800">
                  Trial balance found for this job, period {new Date(suggestedPeriodStart).toLocaleDateString("en-GB")} to {new Date(suggestedPeriodEnd).toLocaleDateString("en-GB")}:
                  {" "}Turnover, Accounting Profit, and Depreciation have been pre-filled from the accounts below.
                </div>
              )}

              <form action={createComputation} className="mt-4 grid gap-4 md:grid-cols-3">
                <input type="hidden" name="client_id" value={selectedClientId} />
                <input type="hidden" name="job_id" value={selectedJobId || ""} />
                <div className="md:col-span-3 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">
                    Client: {selectedClient.client_name}
                    {selectedJobRecord && ` · Job: ${selectedJobRecord.job_name}`}
                  </span>
                  <a href="/corporation-tax" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Accounting Period Start *</label>
                  <input name="period_start" type="date" required defaultValue={suggestedPeriodStart || ""}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Accounting Period End *</label>
                  <input name="period_end" type="date" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Turnover (£) {linkedTrialBalance && <span className="text-green-600 font-normal">(auto-filled)</span>}
                  </label>
                  <input name="turnover" type="number" step="0.01" min="0" defaultValue={suggestedTurnover || 0}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Total trading turnover, for CT600 Box 145" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Accounting Profit (£) {linkedTrialBalance && <span className="text-green-600 font-normal">(auto-filled)</span>}
                  </label>
                  <input name="accounting_profit" type="number" step="0.01" defaultValue={suggestedAccountingProfit || 0}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Pre-tax profit per accounts" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Depreciation Add-back (£) {linkedTrialBalance && <span className="text-green-600 font-normal">(auto-filled)</span>}
                  </label>
                  <input name="depreciation_addback" type="number" step="0.01" min="0" defaultValue={suggestedDepreciation || 0}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Accounting depreciation charged" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Other Disallowable Expenses (£)</label>
                  <input name="disallowable_expenses" type="number" step="0.01" min="0" defaultValue="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="e.g. client entertainment" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Other Allowable Deductions (£)</label>
                  <input name="other_allowable_deductions" type="number" step="0.01" min="0" defaultValue="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Brought Forward Losses (£) {priorComputation && <span className="text-blue-600 font-normal">(auto-filled)</span>}
                  </label>
                  <input name="brought_forward_losses" type="number" step="0.01" min="0" defaultValue={suggestedLossesBfwd || 0}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Associated Companies</label>
                  <input name="associated_companies" type="number" step="1" min="0" defaultValue="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Main Pool Brought Forward (£)</label>
                  <input name="main_pool_bfwd" type="number" step="0.01" min="0" defaultValue={priorComputation?.ca.mainPoolClosingBalance || 0}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Special Rate Pool Brought Forward (£)</label>
                  <input name="special_rate_pool_bfwd" type="number" step="0.01" min="0" defaultValue={priorComputation?.ca.specialRateClosingBalance || 0}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tax Paid on Account (£)</label>
                  <input name="tax_paid_on_account" type="number" step="0.01" min="0" defaultValue="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Instalment payments already made" />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <textarea name="notes" rows={2}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div className="md:col-span-3">
                  <button type="submit"
                    className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                    Calculate & Save
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        {/* List */}
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Computations ({rows.length})</h2>
          <div className="mt-4 space-y-3">
            {rows.map(({ comp, ca, loss, ct }) => (
              <div key={comp.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                <a href={`/corporation-tax/${comp.id}`} className="flex-1">
                  <p className="font-semibold text-slate-900">
                    {(comp.clients as any)?.client_name || "No client"} — {new Date(comp.period_start).toLocaleDateString("en-GB")} to {new Date(comp.period_end).toLocaleDateString("en-GB")}
                    {(comp.jobs as any)?.job_name && ` · ${(comp.jobs as any)?.job_name}`}
                  </p>
                  <p className="text-sm text-slate-500">
                    Taxable profit: £{loss.taxableProfitAfterLosses.toFixed(2)} · Capital allowances: £{ca.totalCapitalAllowances.toFixed(2)} · {ct.band}
                    {loss.lossesCarriedForward > 0 && ` · £${loss.lossesCarriedForward.toFixed(2)} losses c/fwd`}
                  </p>
                </a>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-bold text-slate-900">£{ct.corporationTax.toFixed(2)}</p>
                    <p className="text-xs text-slate-400">CT due</p>
                  </div>
                  <form action={deleteComputation.bind(null, comp.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No computations yet. Create your first one above.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
