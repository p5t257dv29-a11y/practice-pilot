import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { calculateCapitalAllowances } from "../fixed-assets/capital-allowances/page";
import { calculateProfitAndLoss } from "../accounts-production/page";
import { calculateCapitalGain } from "../capital-gains/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const CT_RATES: Record<string, any> = {
  "2026/27": {
    smallProfitsRate: 0.19,
    mainRate: 0.25,
    smallProfitsThreshold: 50000,
    mainRateThreshold: 250000,
    marginalReliefFraction: 3 / 200,
  },
};export async function getCtRates(taxYear: string) {
  const { data } = await supabase.from("tax_rates").select("corporation_tax").eq("tax_year", taxYear).maybeSingle();
  return data?.corporation_tax || CT_RATES[taxYear] || CT_RATES["2026/27"];
}

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

// Sums the tax-basis chargeable gains (per the Capital Gains module) for any
// Company disposals a client made within a given accounting period. Losses
// arising from other disposals in the same period are pooled and offset
// against gains first (mandatory, chronological order), before each
// disposal's own brought-forward capital losses are applied — the same
// same-period netting principle as individuals share an Annual Exempt
// Amount for, just without an AEA in the company case.
export async function getChargeableGainsForPeriod(clientId: string, periodStart: string, periodEnd: string) {
  const { data: gains } = await supabase
    .from("capital_gains_computations")
    .select("*")
    .eq("client_id", clientId)
    .eq("entity_type", "Company")
    .gte("disposal_date", periodStart)
    .lte("disposal_date", periodEnd);

  const sorted = (gains || []).sort((a, b) => {
    const dateDiff = new Date(a.disposal_date).getTime() - new Date(b.disposal_date).getTime();
    if (dateDiff !== 0) return dateDiff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const rawGainOf = (g: any) =>
    Number(g.disposal_proceeds) - Number(g.acquisition_cost) - Number(g.incidental_costs) - Number(g.improvement_costs);

  const totalPeriodLosses = sorted
    .filter((g) => rawGainOf(g) < 0)
    .reduce((sum, g) => sum + Math.abs(rawGainOf(g)), 0);

  let periodLossPool = totalPeriodLosses;

  const rows = sorted.map((g) => {
    const result = calculateCapitalGain({
      entityType: g.entity_type,
      disposalProceeds: Number(g.disposal_proceeds),
      acquisitionCost: Number(g.acquisition_cost),
      incidentalCosts: Number(g.incidental_costs),
      improvementCosts: Number(g.improvement_costs),
      lossesBroughtForward: Number(g.losses_brought_forward),
      badrEligible: g.badr_eligible,
      taxableIncomeForBandStacking: 0, // not used for companies
      currentYearLossesAvailable: periodLossPool,
      rolloverReliefClaimed: g.rollover_relief_claimed,
      amountReinvested: Number(g.amount_reinvested),
      replacementAssetCost: Number(g.replacement_asset_cost),
      acquisitionDate: g.acquisition_date,
      disposalDate: g.disposal_date,
    });
    periodLossPool -= result.currentYearLossOffset;
    return { comp: g, result };
  });

  const totalChargeableGains = rows.reduce((sum, r) => sum + r.result.taxableGain, 0);
  const unusedPeriodLosses = Math.max(0, periodLossPool);

  return { rows, totalChargeableGains, totalPeriodLosses, unusedPeriodLosses };
}

export function calculateCorporationTax(input: {
  taxableProfit: number;
  periodStart: string;
  periodEnd: string;
  associatedCompanies: number;
  taxYear?: string;
}, liveRates?: any) {
  const rates = liveRates || CT_RATES[input.taxYear || "2026/27"] || CT_RATES["2026/27"];
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  const periodMonths = Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000)));

  const divisor = input.associatedCompanies + 1;
  const smallProfitsThreshold = (rates.smallProfitsThreshold * (periodMonths / 12)) / divisor;
  const mainRateThreshold = (rates.mainRateThreshold * (periodMonths / 12)) / divisor;

  const profit = Math.max(0, input.taxableProfit);
  let corporationTax = 0;
  let marginalRelief = 0;
  let band = "";
  let effectiveRate = 0;

  if (profit <= smallProfitsThreshold) {
    corporationTax = profit * rates.smallProfitsRate;
    band = "Small Profits Rate";
    effectiveRate = rates.smallProfitsRate;
  } else if (profit >= mainRateThreshold) {
    corporationTax = profit * rates.mainRate;
    band = "Main Rate";
    effectiveRate = rates.mainRate;
  } else {
    const taxAtMainRate = profit * rates.mainRate;
    marginalRelief = (mainRateThreshold - profit) * rates.marginalReliefFraction;
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

// Splits an accounting period into the sub-periods HMRC requires when a
// period of account exceeds 12 months: the first 12 months as one
// Corporation Tax accounting period, then the remainder as a second. A
// period of 12 months or less is returned unchanged as a single period —
// this keeps the maths identical to before for the vast majority of
// computations that don't need splitting.
export function splitAccountingPeriod(periodStart: string, periodEnd: string): { start: string; end: string }[] {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  const firstPeriodEnd = new Date(start);
  firstPeriodEnd.setUTCFullYear(firstPeriodEnd.getUTCFullYear() + 1);
  firstPeriodEnd.setUTCDate(firstPeriodEnd.getUTCDate() - 1);

  if (firstPeriodEnd >= end) {
    return [{ start: periodStart, end: periodEnd }];
  }

  const secondPeriodStart = new Date(firstPeriodEnd);
  secondPeriodStart.setUTCDate(secondPeriodStart.getUTCDate() + 1);

  return [
    { start: periodStart, end: firstPeriodEnd.toISOString().split("T")[0] },
    { start: secondPeriodStart.toISOString().split("T")[0], end: periodEnd },
  ];
}

// Splits a whole-period figure (trading profit, depreciation, disallowable
// expenses, etc.) across sub-periods on a time basis — the standard default
// apportionment method HMRC accepts unless a more accurate basis applies.
// Capital allowances and chargeable gains are deliberately NOT apportioned
// this way — they're calculated separately per sub-period from the actual
// underlying data instead, since that's what HMRC requires for those items.
function apportionByDays(amount: number, subPeriods: { start: string; end: string }[]): number[] {
  const dayCounts = subPeriods.map((p) => {
    const s = new Date(p.start).getTime();
    const e = new Date(p.end).getTime();
    return Math.round((e - s) / (24 * 60 * 60 * 1000)) + 1;
  });
  const totalDays = dayCounts.reduce((a, b) => a + b, 0);
  if (totalDays === 0) return subPeriods.map(() => 0);
  return dayCounts.map((d) => amount * (d / totalDays));
}

// Orchestrates a full Corporation Tax computation for one accounting period,
// automatically splitting into two sub-periods per HMRC's rules if the
// period exceeds 12 months. This is the single place this logic lives —
// both the list page and the detail page call this, so they can never
// disagree with each other.
export async function calculateFullCorporationTax(comp: any, assets: any[], ctRates: any) {
  const subPeriods = splitAccountingPeriod(comp.period_start, comp.period_end);
  const isSplit = subPeriods.length > 1;

  const accountingProfitShares = apportionByDays(Number(comp.accounting_profit), subPeriods);
  const depreciationShares = apportionByDays(Number(comp.depreciation_addback), subPeriods);
  const disallowableShares = apportionByDays(Number(comp.disallowable_expenses), subPeriods);
  const otherDeductionsShares = apportionByDays(Number(comp.other_allowable_deductions), subPeriods);
  const profitOnDisposalShares = apportionByDays(Number(comp.accounting_profit_on_disposal || 0), subPeriods);
  const turnoverShares = apportionByDays(Number(comp.turnover), subPeriods);

  let lossesBfwd = Number(comp.brought_forward_losses);
  const periods: any[] = [];

  for (let i = 0; i < subPeriods.length; i++) {
    const sp = subPeriods[i];

    const ca = calculateCapitalAllowances({
      assets,
      periodStart: sp.start,
      periodEnd: sp.end,
      mainPoolBfwd: i === 0 ? Number(comp.main_pool_bfwd) : periods[i - 1].ca.mainPoolClosingBalance,
      specialRatePoolBfwd: i === 0 ? Number(comp.special_rate_pool_bfwd) : periods[i - 1].ca.specialRateClosingBalance,
      jobId: comp.job_id,
    });

    const { rows: gainRows, totalChargeableGains, totalPeriodLosses, unusedPeriodLosses } =
      await getChargeableGainsForPeriod(comp.client_id, sp.start, sp.end);

    const taxableProfitBeforeLosses =
      accountingProfitShares[i] +
      depreciationShares[i] +
      disallowableShares[i] -
      ca.totalCapitalAllowances -
      otherDeductionsShares[i] -
      profitOnDisposalShares[i] +
      totalChargeableGains;

    const loss = applyLossRelief(taxableProfitBeforeLosses, lossesBfwd);
    lossesBfwd = loss.lossesCarriedForward;

    const ct = calculateCorporationTax({
      taxableProfit: loss.taxableProfitAfterLosses,
      periodStart: sp.start,
      periodEnd: sp.end,
      associatedCompanies: comp.associated_companies,
    }, ctRates);

    periods.push({
      periodStart: sp.start,
      periodEnd: sp.end,
      turnoverShare: turnoverShares[i],
      accountingProfitShare: accountingProfitShares[i],
      depreciationShare: depreciationShares[i],
      disallowableShare: disallowableShares[i],
      otherDeductionsShare: otherDeductionsShares[i],
      profitOnDisposalShare: profitOnDisposalShares[i],
      ca,
      gainRows,
      totalChargeableGains,
      totalPeriodLosses,
      unusedPeriodLosses,
      taxableProfitBeforeLosses,
      loss,
      ct,
    });
  }

  const totalCorporationTax = periods.reduce((s, p) => s + p.ct.corporationTax, 0);
  const finalPeriod = periods[periods.length - 1];

  return {
    isSplit,
    periods,
    totalCorporationTax,
    totalLossesCarriedForward: finalPeriod.loss.lossesCarriedForward,
    finalMainPoolClosingBalance: finalPeriod.ca.mainPoolClosingBalance,
    finalSpecialRateClosingBalance: finalPeriod.ca.specialRateClosingBalance,
  };
}

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  if (!client_id) return;

  const { error: insertError } = await supabase.from("corporation_tax_computations").insert({
    client_id,
    job_id: get("job_id") || null,
    period_start: get("period_start"),
    period_end: get("period_end"),
    turnover: num("turnover"),
    accounting_profit: num("accounting_profit"),
    depreciation_addback: num("depreciation_addback"),
    disallowable_expenses: num("disallowable_expenses"),
    other_allowable_deductions: num("other_allowable_deductions"),
    accounting_profit_on_disposal: num("accounting_profit_on_disposal"),
    brought_forward_losses: num("brought_forward_losses"),
    associated_companies: parseInt(get("associated_companies")) || 0,
    main_pool_bfwd: num("main_pool_bfwd"),
    special_rate_pool_bfwd: num("special_rate_pool_bfwd"),
    tax_paid_on_account: num("tax_paid_on_account"),
    notes: get("notes"),
  });

  if (insertError) {
    throw new Error(`Failed to save Corporation Tax computation: ${insertError.message}`);
  }

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
  searchParams: Promise<{ mode?: string; client?: string; job?: string; browseClient?: string }>;
}) {
  const { mode, client: selectedClientId, job: selectedJobId, browseClient: browseClientId } = await searchParams;

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

  const ctRatesShared = await getCtRates("2026/27");

  const rows = await Promise.all(
    (computations || []).map(async (comp) => {
      const { data: assets } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("client_id", comp.client_id);

      const full = await calculateFullCorporationTax(comp, assets || [], ctRatesShared);

      return { comp, full };
    })
  );

  const openRows = rows.filter((r) => r.comp.status !== "Approved");
  const completedRows = rows.filter((r) => r.comp.status === "Approved");

  let suggestedLossesBfwd = 0;
  let suggestedMainPoolBfwd = 0;
  let suggestedSpecialRatePoolBfwd = 0;
  let priorComputation: any = null;
  if (selectedClientId) {
    const clientRows = rows
      .filter((r) => r.comp.client_id === selectedClientId)
      .sort((a, b) => new Date(b.comp.period_end).getTime() - new Date(a.comp.period_end).getTime());
    if (clientRows.length > 0) {
      priorComputation = clientRows[0];
      suggestedLossesBfwd = priorComputation.full.totalLossesCarriedForward;
      suggestedMainPoolBfwd = priorComputation.full.finalMainPoolClosingBalance;
      suggestedSpecialRatePoolBfwd = priorComputation.full.finalSpecialRateClosingBalance;
    }
  }

  const selectedClient = (clients || []).find((c) => c.id === selectedClientId);

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

  const browseRows = browseClientId ? rows.filter((r) => r.comp.client_id === browseClientId) : [];

  const statusBadge = (status: string | null | undefined) => {
    const s = status || "Draft";
    const style =
      s === "Sent" ? "bg-yellow-100 text-yellow-700"
      : s === "Queried" ? "bg-orange-100 text-orange-700"
      : s === "Approved" ? "bg-green-100 text-green-700"
      : "bg-slate-100 text-slate-600";
    return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{s}</span>;
  };

  const renderRow = ({ comp, full }: (typeof rows)[number]) => {
    const { periods, totalCorporationTax, isSplit, totalLossesCarriedForward } = full;
    const finalPeriod = periods[periods.length - 1];
    return (
    <div key={comp.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
      <a href={`/corporation-tax/${comp.id}`} className="flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-slate-900">
            {(comp.clients as any)?.client_name || "No client"} — {new Date(comp.period_start).toLocaleDateString("en-GB")} to {new Date(comp.period_end).toLocaleDateString("en-GB")}
            {(comp.jobs as any)?.job_name && ` · ${(comp.jobs as any)?.job_name}`}
          </p>
          {statusBadge(comp.status)}
          {isSplit && (
            <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-purple-100 text-purple-700">
              Split into 2 CT600s
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">
          {isSplit ? (
            <>Combined taxable profit: £{periods.reduce((s: number, p: any) => s + p.loss.taxableProfitAfterLosses, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
          ) : (
            <>Taxable profit: £{finalPeriod.loss.taxableProfitAfterLosses.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Capital allowances: £{finalPeriod.ca.totalCapitalAllowances.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {finalPeriod.ct.band}</>
          )}
          {totalLossesCarriedForward > 0 && ` · £${totalLossesCarriedForward.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} losses c/fwd`}
          {periods.reduce((s: number, p: any) => s + p.totalChargeableGains, 0) > 0 && ` · £${periods.reduce((s: number, p: any) => s + p.totalChargeableGains, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} chargeable gains`}
        </p>
      </a>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="font-bold text-slate-900">£{totalCorporationTax.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-slate-400">{isSplit ? "CT due (both periods)" : "CT due"}</p>
        </div>
        <form action={deleteComputation.bind(null, comp.id)}>
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
        <h1 className="text-2xl font-bold text-slate-900">Corporation Tax</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Computes Corporation Tax liability using 2026/27 rates, pulling capital allowances live from the Fixed Asset Register and chargeable gains live from the Capital Gains module, with same-period capital losses netted against gains automatically. Accounting periods over 12 months are automatically split into the two CT600s HMRC requires.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load computations: {error.message}
          </div>
        )}

        {/* Entry choice: Open / Completed / New */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <a href="/corporation-tax?mode=open"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "open" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "open" ? "text-white" : "text-slate-900"}`}>Open</p>
            <p className={`text-sm mt-1 ${mode === "open" ? "text-slate-300" : "text-slate-500"}`}>{openRows.length} not yet completed</p>
          </a>
          <a href="/corporation-tax?mode=completed"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "completed" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "completed" ? "text-white" : "text-slate-900"}`}>Completed</p>
            <p className={`text-sm mt-1 ${mode === "completed" ? "text-slate-300" : "text-slate-500"}`}>{completedRows.length} approved</p>
          </a>
          <a href="/corporation-tax?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Computation</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Select a client to start a new CT computation</p>
          </a>
        </div>

        {/* OPEN MODE */}
        {mode === "open" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Open Computations</h2>
            {openRows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No open computations — everything's approved.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {openRows.map(renderRow)}
              </div>
            )}
          </div>
        )}

        {/* COMPLETED MODE */}
        {mode === "completed" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Completed Computations</h2>
            {completedRows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">Nothing approved yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {completedRows.map(renderRow)}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE */}
        {mode === "new" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">New Corporation Tax Computation</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Capital allowances are calculated automatically from assets acquired in this period in the Fixed Asset Register. Chargeable gains are pulled automatically from any Company disposals recorded in the Capital Gains module within this accounting period, with any losses among them netted against gains automatically. If the accounting period exceeds 12 months, it will be automatically split into two CT600s per HMRC's rules once saved.
            </p>

            <form method="get" className="mt-4 flex gap-2 items-end">
              <input type="hidden" name="mode" value="new" />
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
                  <input type="hidden" name="mode" value="new" />
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
                <a href={`/corporation-tax?mode=new&client=${selectedClientId}&job=`}
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
                    <a href="/corporation-tax?mode=new" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
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
                    <p className="text-xs text-slate-400 mt-1">If over 12 months from the start date, this will be split into two CT600s automatically.</p>
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">Profit/(Loss) on Disposal Per Accounts (£)</label>
                    <input name="accounting_profit_on_disposal" type="number" step="0.01" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="Profit on disposal already included in Accounting Profit above" />
                    <p className="text-xs text-slate-400 mt-1">
                      If Accounting Profit above already includes a profit (or loss) on disposal of an asset, enter it here to remove it — the tax-basis chargeable gain from the Capital Gains module is added automatically instead.
                    </p>
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
                    <input name="main_pool_bfwd" type="number" step="0.01" min="0" defaultValue={suggestedMainPoolBfwd || 0}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Special Rate Pool Brought Forward (£)</label>
                    <input name="special_rate_pool_bfwd" type="number" step="0.01" min="0" defaultValue={suggestedSpecialRatePoolBfwd || 0}
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
        )}
      </div>
    </div>
  );
}
