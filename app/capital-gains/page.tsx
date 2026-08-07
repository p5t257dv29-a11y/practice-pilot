import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2026/27 Capital Gains Tax rates (unified since the 30 Oct 2024 Budget —
// property and other assets now share the same rate structure)
export const CGT_RATES: Record<string, any> = {
  "2026/27": {
    annualExemptAmount: 3000,
    basicRate: 0.18,
    higherRate: 0.24,
    badrRate: 0.18, // Business Asset Disposal Relief, £1m lifetime limit (not tracked cumulatively here)
    basicRateBandWidth: 37700,
  },
};

// Private Residence Relief final-period exemption: the last 9 months of
// ownership always count as exempt occupation, regardless of whether the
// client actually lived there then, as long as the property was their main
// residence at some point during ownership. This has been 9 months since
// April 2020 (was 18, then 36, months before that).
const PRR_FINAL_PERIOD_MONTHS = 9;

// Fetches live rates from the tax_rates table (editable via Practice Settings →
// Tax Rates), falling back to the hardcoded defaults above if no row exists
// for that year yet. This is the single point every CGT calculation should
// go through, so rate updates take effect without a code change.
export async function getCgtRates(taxYear: string) {
  const { data } = await supabase.from("tax_rates").select("capital_gains_tax").eq("tax_year", taxYear).maybeSingle();
  return data?.capital_gains_tax || CGT_RATES[taxYear] || CGT_RATES["2026/27"];
}

// Works out which UK tax year (6 April to 5 April) a given date falls into.
// Used to group a client's disposals together so the Annual Exempt Amount,
// rate-band stacking, and current-year loss offset are shared across the
// whole tax year, not reset for every individual disposal.
export function ukTaxYearOf(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const aprilSixth = new Date(Date.UTC(year, 3, 6)); // 6 April
  const startYear = d >= aprilSixth ? year : year - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

// Works out the fraction of a residential property's ownership period that
// qualifies for Private Residence Relief: actual occupation as main
// residence, unioned with the automatic final-9-months exemption (so the
// two aren't double-counted if they overlap). Returns a fraction between 0
// and 1 to apply to the gain.
function calculatePRRFraction(input: {
  acquisitionDate: string;
  disposalDate: string;
  mainResidenceFrom: string;
  mainResidenceTo: string;
}): { prrFraction: number; qualifyingDays: number; totalOwnershipDays: number } {
  const ownershipStart = new Date(input.acquisitionDate);
  const ownershipEnd = new Date(input.disposalDate);
  const totalOwnershipDays = Math.max(1, Math.round((ownershipEnd.getTime() - ownershipStart.getTime()) / (24 * 60 * 60 * 1000)) + 1);

  const occStart = new Date(Math.max(new Date(input.mainResidenceFrom).getTime(), ownershipStart.getTime()));
  const occEnd = new Date(Math.min(new Date(input.mainResidenceTo).getTime(), ownershipEnd.getTime()));
  const occupationDays = occEnd >= occStart ? Math.round((occEnd.getTime() - occStart.getTime()) / (24 * 60 * 60 * 1000)) + 1 : 0;

  const finalPeriodStartRaw = new Date(ownershipEnd);
  finalPeriodStartRaw.setUTCMonth(finalPeriodStartRaw.getUTCMonth() - PRR_FINAL_PERIOD_MONTHS);
  finalPeriodStartRaw.setUTCDate(finalPeriodStartRaw.getUTCDate() + 1);
  const finalPeriodStart = new Date(Math.max(finalPeriodStartRaw.getTime(), ownershipStart.getTime()));
  const finalPeriodDays = Math.round((ownershipEnd.getTime() - finalPeriodStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  const overlapStart = new Date(Math.max(occStart.getTime(), finalPeriodStart.getTime()));
  const overlapEnd = new Date(Math.min(occEnd.getTime(), ownershipEnd.getTime()));
  const overlapDays = overlapEnd >= overlapStart ? Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (24 * 60 * 60 * 1000)) + 1 : 0;

  const qualifyingDaysRaw = occupationDays + finalPeriodDays - overlapDays;
  const qualifyingDays = Math.min(Math.max(0, qualifyingDaysRaw), totalOwnershipDays);

  const prrFraction = totalOwnershipDays > 0 ? qualifyingDays / totalOwnershipDays : 0;

  return { prrFraction, qualifyingDays, totalOwnershipDays };
}

export function calculateCapitalGain(input: {
  entityType: string;
  disposalProceeds: number;
  acquisitionCost: number;
  incidentalCosts: number;
  improvementCosts: number;
  lossesBroughtForward: number;
  badrEligible: boolean;
  taxableIncomeForBandStacking: number; // individuals only — taxable income before the gain
  aeaAlreadyUsedThisYear?: number; // individuals only — AEA already consumed by earlier same-tax-year disposals
  gainsStackedAheadThisYear?: number; // individuals only — taxable gains from earlier same-tax-year disposals, for rate-band stacking
  currentYearLossesAvailable?: number; // pooled losses from other same-year disposals not yet absorbed — applies before AEA (individuals) or before brought-forward losses (companies)
  rolloverReliefClaimed: boolean;
  amountReinvested: number;
  replacementAssetCost: number;
  acquisitionDate?: string; // required if prrClaimed is true
  disposalDate?: string; // required if prrClaimed is true
  prrClaimed?: boolean;
  mainResidenceFrom?: string;
  mainResidenceTo?: string;
}, liveRates?: any) {
  const rates = liveRates || CGT_RATES["2026/27"];

  // The raw result — proceeds less costs — can be negative. Rollover relief,
  // PRR, AEA, and rate bands only ever reduce a gain, so a negative result
  // is simply an allowable loss: recorded and returned immediately, to be
  // pooled and offset against other same-year gains upstream (mandatory),
  // with any excess carried forward. Previously this was floored at zero,
  // which silently discarded any loss-making disposal entirely.
  const rawGainOrLoss = input.disposalProceeds - input.acquisitionCost - input.incidentalCosts - input.improvementCosts;

  if (rawGainOrLoss < 0) {
    const lossAmount = Math.abs(rawGainOrLoss);
    return {
      grossGain: rawGainOrLoss, aeaApplied: 0, lossesUsed: 0, taxableGain: 0,
      lossesCarriedForward: input.lossesBroughtForward, gainAtBasicRate: 0, gainAtHigherRate: 0,
      cgtDue: 0, isCompany: input.entityType === "Company", isLoss: true, lossAmount,
      currentYearLossOffset: 0,
      gainRolledOver: 0, gainChargeableNow: 0, adjustedReplacementBaseCost: 0,
      prrFraction: 0, prrAmount: 0,
    };
  }

  const grossGain = rawGainOrLoss; // guaranteed >= 0 from here on

  // Rollover Relief: applies before any other relief, since it defers the gain
  // arising on the disposal itself. If proceeds aren't fully reinvested, tax is
  // due now on the gain up to whatever wasn't reinvested; the rest is deferred
  // into the base cost of the replacement asset.
  let gainRolledOver = 0;
  let gainChargeableNow = grossGain;
  let adjustedReplacementBaseCost = 0;

  if (input.rolloverReliefClaimed) {
    const proceedsNotReinvested = Math.max(0, input.disposalProceeds - input.amountReinvested);
    gainChargeableNow = Math.min(grossGain, proceedsNotReinvested);
    gainRolledOver = grossGain - gainChargeableNow;
    adjustedReplacementBaseCost = Math.max(0, input.replacementAssetCost - gainRolledOver);
  }

  const gainAfterRollover = gainChargeableNow;

  // Private Residence Relief: individuals only, applies before AEA/losses
  // since it's specific to this disposal rather than an annual allowance.
  let prrFraction = 0;
  let prrAmount = 0;
  if (input.entityType !== "Company" && input.prrClaimed && input.acquisitionDate && input.disposalDate && input.mainResidenceFrom && input.mainResidenceTo) {
    const prr = calculatePRRFraction({
      acquisitionDate: input.acquisitionDate,
      disposalDate: input.disposalDate,
      mainResidenceFrom: input.mainResidenceFrom,
      mainResidenceTo: input.mainResidenceTo,
    });
    prrFraction = prr.prrFraction;
    prrAmount = gainAfterRollover * prrFraction;
  }

  const gainAfterPRR = Math.max(0, gainAfterRollover - prrAmount);

  if (input.entityType === "Company") {
    // Companies pay Corporation Tax on chargeable gains, not CGT — no AEA, no
    // CGT rates. Same-period losses from other company disposals (pooled
    // upstream) offset first, mandatorily, then brought-forward losses.
    const currentYearLossesAvailable = input.currentYearLossesAvailable || 0;
    const currentYearLossOffset = Math.min(gainAfterPRR, currentYearLossesAvailable);
    const gainAfterCurrentYearLosses = Math.max(0, gainAfterPRR - currentYearLossOffset);

    const lossesUsed = Math.min(input.lossesBroughtForward, gainAfterCurrentYearLosses);
    const chargeableGain = gainAfterCurrentYearLosses - lossesUsed;
    const lossesCarriedForward = input.lossesBroughtForward - lossesUsed;
    return {
      grossGain, aeaApplied: 0, lossesUsed, taxableGain: chargeableGain,
      lossesCarriedForward, gainAtBasicRate: 0, gainAtHigherRate: 0,
      cgtDue: 0, isCompany: true, isLoss: false, lossAmount: 0, currentYearLossOffset,
      gainRolledOver, gainChargeableNow, adjustedReplacementBaseCost,
      prrFraction: 0, prrAmount: 0,
    };
  }

  // Individual: same-tax-year losses from other disposals offset first
  // (mandatory, even if it wastes some of the AEA), then AEA applied
  // (protecting it from being wasted against a small gain further than
  // necessary), then brought-forward losses applied after AEA, only as far
  // as needed. AEA is shared across the whole tax year, so we subtract
  // whatever earlier same-tax-year disposals have already used.
  const currentYearLossesAvailable = input.currentYearLossesAvailable || 0;
  const currentYearLossOffset = Math.min(gainAfterPRR, currentYearLossesAvailable);
  const gainAfterCurrentYearLosses = Math.max(0, gainAfterPRR - currentYearLossOffset);

  const aeaAlreadyUsed = input.aeaAlreadyUsedThisYear || 0;
  const aeaRemaining = Math.max(0, rates.annualExemptAmount - aeaAlreadyUsed);
  const aeaApplied = Math.min(gainAfterCurrentYearLosses, aeaRemaining);
  const gainAfterAEA = Math.max(0, gainAfterCurrentYearLosses - aeaApplied);
  const lossesUsed = Math.min(input.lossesBroughtForward, gainAfterAEA);
  const taxableGain = gainAfterAEA - lossesUsed;
  const lossesCarriedForward = input.lossesBroughtForward - lossesUsed;

  let gainAtBasicRate = 0;
  let gainAtHigherRate = 0;
  let cgtDue = 0;

  if (input.badrEligible) {
    cgtDue = taxableGain * rates.badrRate;
  } else {
    const gainsStackedAhead = input.gainsStackedAheadThisYear || 0;
    const remainingBasicBand = Math.max(0,
      rates.basicRateBandWidth - input.taxableIncomeForBandStacking - gainsStackedAhead
    );
    gainAtBasicRate = Math.min(taxableGain, remainingBasicBand);
    gainAtHigherRate = taxableGain - gainAtBasicRate;
    cgtDue = gainAtBasicRate * rates.basicRate + gainAtHigherRate * rates.higherRate;
  }

  return {
    grossGain, aeaApplied, lossesUsed, taxableGain, lossesCarriedForward,
    gainAtBasicRate, gainAtHigherRate, cgtDue, isCompany: false, isLoss: false, lossAmount: 0,
    currentYearLossOffset,
    gainRolledOver, gainChargeableNow, adjustedReplacementBaseCost,
    prrFraction, prrAmount,
  };
}

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  if (!client_id) return;

  const { error: insertError } = await supabase.from("capital_gains_computations").insert({
    client_id,
    job_id: get("job_id") || null,
    linked_tax_computation_id: get("linked_tax_computation_id") || null,
    entity_type: get("entity_type") || "Individual",
    asset_description: get("asset_description"),
    asset_category: get("asset_category") || "Other Assets",
    acquisition_date: get("acquisition_date") || null,
    acquisition_cost: num("acquisition_cost"),
    disposal_date: get("disposal_date"),
    disposal_proceeds: num("disposal_proceeds"),
    incidental_costs: num("incidental_costs"),
    improvement_costs: num("improvement_costs"),
    losses_brought_forward: num("losses_brought_forward"),
    badr_eligible: formData.get("badr_eligible") === "on",
    rollover_relief_claimed: formData.get("rollover_relief_claimed") === "on",
    amount_reinvested: num("amount_reinvested"),
    replacement_asset_cost: num("replacement_asset_cost"),
    main_residence_relief_claimed: formData.get("main_residence_relief_claimed") === "on",
    main_residence_from: get("main_residence_from") || null,
    main_residence_to: get("main_residence_to") || null,
    notes: get("notes"),
  });

  if (insertError) {
    throw new Error(`Failed to save Capital Gains computation: ${insertError.message}`);
  }

  revalidatePath("/capital-gains");
}

async function deleteComputation(id: string) {
  "use server";
  await supabase.from("capital_gains_computations").delete().eq("id", id);
  revalidatePath("/capital-gains");
}

export default async function CapitalGainsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; browseClient?: string }>;
}) {
  const { mode, browseClient: browseClientId } = await searchParams;

  const [{ data: computations, error }, { data: clients }, { data: jobs }, { data: taxComputations }] = await Promise.all([
    supabase
      .from("capital_gains_computations")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id, client_name, entity_type").order("client_name", { ascending: true }),
    supabase.from("jobs").select("id, job_name, client_id").order("job_name", { ascending: true }),
    supabase.from("tax_computations").select("id, tax_year, client_id"),
  ]);

  // --- Per-tax-year aggregation of AEA, rate-band stacking, and current-year
  // loss offset --- Group this client's disposals by UK tax year, process
  // them in chronological order within each group. Same-year losses are
  // mandatorily offset against gains first, then AEA and rate-band stacking
  // proceed as before. Company disposals don't share AEA/bands but DO share
  // a same-period loss pool with other company disposals for this client.
  const groups = new Map<string, any[]>();
  for (const comp of computations || []) {
    const key = `${comp.client_id}:${ukTaxYearOf(comp.disposal_date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(comp);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => new Date(a.disposal_date).getTime() - new Date(b.disposal_date).getTime());
  }

  const cgtRates = await getCgtRates("2026/27");
  const resultByCompId = new Map<string, any>();

  for (const group of groups.values()) {
    // Individuals and companies pool separately — individuals share AEA,
    // companies never have AEA, so keep the loss pools distinct too.
    const rawGainOf = (c: any) =>
      Number(c.disposal_proceeds) - Number(c.acquisition_cost) - Number(c.incidental_costs) - Number(c.improvement_costs);

    let individualLossPool = group
      .filter((c) => c.entity_type !== "Company" && rawGainOf(c) < 0)
      .reduce((sum, c) => sum + Math.abs(rawGainOf(c)), 0);
    let companyLossPool = group
      .filter((c) => c.entity_type === "Company" && rawGainOf(c) < 0)
      .reduce((sum, c) => sum + Math.abs(rawGainOf(c)), 0);

    let aeaUsedSoFar = 0;
    let gainsStackedSoFar = 0;

    for (const comp of group) {
      let taxableIncome = 0;
      if (comp.linked_tax_computation_id) {
        const { data: tc } = await supabase
          .from("tax_computations")
          .select("employment_income, self_employment_income, rental_income, pension_income")
          .eq("id", comp.linked_tax_computation_id)
          .single();
        if (tc) {
          const total = Number(tc.employment_income) + Number(tc.self_employment_income) + Number(tc.rental_income) + Number(tc.pension_income);
          taxableIncome = Math.max(0, total - 12570);
        }
      }

      const isCompanyRow = comp.entity_type === "Company";
      const result = calculateCapitalGain({
        entityType: comp.entity_type,
        disposalProceeds: Number(comp.disposal_proceeds),
        acquisitionCost: Number(comp.acquisition_cost),
        incidentalCosts: Number(comp.incidental_costs),
        improvementCosts: Number(comp.improvement_costs),
        lossesBroughtForward: Number(comp.losses_brought_forward),
        badrEligible: comp.badr_eligible,
        taxableIncomeForBandStacking: taxableIncome,
        aeaAlreadyUsedThisYear: aeaUsedSoFar,
        gainsStackedAheadThisYear: gainsStackedSoFar,
        currentYearLossesAvailable: isCompanyRow ? companyLossPool : individualLossPool,
        rolloverReliefClaimed: comp.rollover_relief_claimed,
        amountReinvested: Number(comp.amount_reinvested),
        replacementAssetCost: Number(comp.replacement_asset_cost),
        acquisitionDate: comp.acquisition_date,
        disposalDate: comp.disposal_date,
        prrClaimed: comp.main_residence_relief_claimed,
        mainResidenceFrom: comp.main_residence_from,
        mainResidenceTo: comp.main_residence_to,
      }, cgtRates);

      if (isCompanyRow) {
        companyLossPool -= result.currentYearLossOffset;
      } else {
        individualLossPool -= result.currentYearLossOffset;
        aeaUsedSoFar += result.aeaApplied;
        gainsStackedSoFar += result.taxableGain;
      }

      resultByCompId.set(comp.id, result);
    }
  }

  const rows = (computations || []).map((comp) => ({
    comp,
    result: resultByCompId.get(comp.id),
  }));

  const openRows = rows.filter((r) => r.comp.status !== "Approved");
  const completedRows = rows.filter((r) => r.comp.status === "Approved");
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

  const renderRow = ({ comp, result }: (typeof rows)[number]) => {
    const is60Day = comp.entity_type === "Individual" && comp.asset_category === "Residential Property";
    const deadline = is60Day ? new Date(new Date(comp.disposal_date).getTime() + 60 * 24 * 60 * 60 * 1000) : null;
    const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;

    return (
      <div key={comp.id} className="rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center justify-between">
          <a href={`/capital-gains/${comp.id}`} className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900">
                {(comp.clients as any)?.client_name || "No client"} — {comp.asset_description}
              </p>
              {statusBadge(comp.status)}
              {comp.main_residence_relief_claimed && (
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-teal-100 text-teal-700">PRR</span>
              )}
              {result.isLoss && (
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-rose-100 text-rose-700">Loss</span>
              )}
            </div>
            <p className="text-sm text-slate-500">
              {comp.entity_type} · Disposed {new Date(comp.disposal_date).toLocaleDateString("en-GB")}
              {comp.badr_eligible && " · BADR"}
            </p>
          </a>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-bold text-slate-900">
                {result.isLoss
                  ? `(£${result.lossAmount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                  : result.isCompany
                    ? `£${result.taxableGain.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : `£${result.cgtDue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </p>
              <p className="text-xs text-slate-400">{result.isLoss ? "allowable loss" : result.isCompany ? "chargeable gain" : "CGT due"}</p>
            </div>
            <form action={deleteComputation.bind(null, comp.id)}>
              <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                Delete
              </button>
            </form>
          </div>
        </div>
        {is60Day && daysLeft !== null && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${
            daysLeft < 0 ? "bg-red-100 text-red-700" : daysLeft <= 14 ? "bg-orange-100 text-orange-700" : "bg-blue-50 text-blue-700"
          }`}>
            {daysLeft < 0
              ? `⚠ 60-day property return was due ${deadline!.toLocaleDateString("en-GB")} — overdue`
              : `60-day property return due ${deadline!.toLocaleDateString("en-GB")} (${daysLeft} days left)`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Capital Gains Tax</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Computes CGT for individuals (2026/27 rates) and chargeable gains for companies, including the 60-day UK property reporting deadline, Private Residence Relief, and mandatory same-year loss offset.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load computations: {error.message}
          </div>
        )}

        {/* Entry choice: Open / Completed / Browse Existing / New */}
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <a href="/capital-gains?mode=open"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "open" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "open" ? "text-white" : "text-slate-900"}`}>Open</p>
            <p className={`text-sm mt-1 ${mode === "open" ? "text-slate-300" : "text-slate-500"}`}>{openRows.length} not yet completed</p>
          </a>
          <a href="/capital-gains?mode=completed"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "completed" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "completed" ? "text-white" : "text-slate-900"}`}>Completed</p>
            <p className={`text-sm mt-1 ${mode === "completed" ? "text-slate-300" : "text-slate-500"}`}>{completedRows.length} approved</p>
          </a>
          <a href="/capital-gains?mode=browse"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "browse" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "browse" ? "text-white" : "text-slate-900"}`}>Browse Existing</p>
            <p className={`text-sm mt-1 ${mode === "browse" ? "text-slate-300" : "text-slate-500"}`}>Find a client's CGT computations</p>
          </a>
          <a href="/capital-gains?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Computation</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Record a disposal for a client</p>
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

        {/* BROWSE MODE */}
        {mode === "browse" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
            <form method="get" className="mt-4 flex gap-2">
              <input type="hidden" name="mode" value="browse" />
              <select name="browseClient" defaultValue={browseClientId || ""}
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
              <div className="mt-6 space-y-3">
                {browseRows.map(renderRow)}
                {browseRows.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">No CGT computations on file for this client yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE */}
        {mode === "new" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">New Capital Gains Computation</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              For a company, this calculates the chargeable gain to include in its Corporation Tax computation — companies don't pay CGT directly. If disposal proceeds are lower than costs, this is recorded as an allowable loss instead of a gain.
            </p>

            <form action={createComputation} className="mt-6 grid gap-4 md:grid-cols-3">
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
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
                <select name="entity_type" defaultValue="Individual"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Individual</option>
                  <option>Company</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Linked Job (optional)</label>
                <select name="job_id"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">No linked job</option>
                  {(jobs || []).map((j) => (
                    <option key={j.id} value={j.id}>{j.job_name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Asset Description *</label>
                <input name="asset_description" required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. 12 Elm Street buy-to-let, or Shares in XYZ Ltd" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Asset Category</label>
                <select name="asset_category" defaultValue="Other Assets"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Other Assets</option>
                  <option>Residential Property</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Acquisition Date</label>
                <input name="acquisition_date" type="date"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Acquisition Cost (£)</label>
                <input name="acquisition_cost" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Improvement Costs (£)</label>
                <input name="improvement_costs" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Disposal Date *</label>
                <input name="disposal_date" type="date" required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Disposal Proceeds (£)</label>
                <input name="disposal_proceeds" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Incidental Costs (£)</label>
                <input name="incidental_costs" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Legal fees, agent fees etc." />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Losses Brought Forward (£)</label>
                <input name="losses_brought_forward" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                <p className="text-xs text-slate-400 mt-1">Unused losses from earlier tax years only — losses arising in this same tax year from other disposals are offset automatically.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Linked Personal Tax Computation</label>
                <select name="linked_tax_computation_id"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">None</option>
                  {(taxComputations || []).map((tc) => (
                    <option key={tc.id} value={tc.id}>{tc.tax_year}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Individuals only — used to estimate remaining basic rate band for the gain.</p>
              </div>
              <div className="flex items-end pb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input name="badr_eligible" type="checkbox" className="w-4 h-4 rounded" />
                  <span className="text-sm font-medium text-slate-700">Eligible for Business Asset Disposal Relief</span>
                </label>
              </div>

              <div className="md:col-span-3 rounded-xl border border-slate-100 p-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input name="rollover_relief_claimed" type="checkbox" className="w-4 h-4 rounded" />
                  <span className="text-sm font-medium text-slate-700">Claiming Business Asset Rollover Relief</span>
                </label>
                <p className="text-xs text-slate-400 mb-3">
                  Defers the gain by rolling it into the cost of a replacement business asset. Applies to individuals and companies. If proceeds aren't fully reinvested, tax is due now on the shortfall.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount Reinvested (£)</label>
                    <input name="amount_reinvested" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Cost of Replacement Asset (£)</label>
                    <input name="replacement_asset_cost" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              <div className="md:col-span-3 rounded-xl border border-teal-100 bg-teal-50/50 p-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input name="main_residence_relief_claimed" type="checkbox" className="w-4 h-4 rounded" />
                  <span className="text-sm font-medium text-slate-700">Claiming Private Residence Relief (individuals only — this was their home)</span>
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Exempts the fraction of the gain covering the period the property was the client's main residence, plus an automatic final 9 months of ownership. Doesn't yet account for deemed periods of absence (working abroad, job-related accommodation) or Letting Relief — check these manually if they apply.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Main Residence From</label>
                    <input name="main_residence_from" type="date"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Main Residence To</label>
                    <input name="main_residence_to" type="date"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    <p className="text-xs text-slate-400 mt-1">Doesn't need to be the disposal date — the final 9 months are added automatically.</p>
                  </div>
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
                  Calculate & Save
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
