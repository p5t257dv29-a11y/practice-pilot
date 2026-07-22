import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2026/27 Capital Gains Tax rates (unified since the 30 Oct 2024 Budget —
// property and other assets now share the same rate structure)
const CGT_RATES = {
  annualExemptAmount: 3000,
  basicRate: 0.18,
  higherRate: 0.24,
  badrRate: 0.18, // Business Asset Disposal Relief, £1m lifetime limit (not tracked cumulatively here)
  basicRateBandWidth: 37700,
};

export function calculateCapitalGain(input: {
  entityType: string;
  disposalProceeds: number;
  acquisitionCost: number;
  incidentalCosts: number;
  improvementCosts: number;
  lossesBroughtForward: number;
  badrEligible: boolean;
  taxableIncomeForBandStacking: number; // individuals only — taxable income before the gain
  rolloverReliefClaimed: boolean;
  amountReinvested: number;
  replacementAssetCost: number;
}) {
  const grossGain = Math.max(0,
    input.disposalProceeds - input.acquisitionCost - input.incidentalCosts - input.improvementCosts
  );

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

  if (input.entityType === "Company") {
    // Companies pay Corporation Tax on chargeable gains, not CGT — no AEA, no CGT rates.
    // Brought-forward capital losses still offset the gain directly.
    const lossesUsed = Math.min(input.lossesBroughtForward, gainAfterRollover);
    const chargeableGain = gainAfterRollover - lossesUsed;
    const lossesCarriedForward = input.lossesBroughtForward - lossesUsed;
    return {
      grossGain, aeaApplied: 0, lossesUsed, taxableGain: chargeableGain,
      lossesCarriedForward, gainAtBasicRate: 0, gainAtHigherRate: 0,
      cgtDue: 0, isCompany: true,
      gainRolledOver, gainChargeableNow, adjustedReplacementBaseCost,
    };
  }

  // Individual: AEA applied first (protecting it from being wasted against a small
  // gain), brought-forward losses applied after, only as far as needed.
  const aeaApplied = Math.min(gainAfterRollover, CGT_RATES.annualExemptAmount);
  const gainAfterAEA = Math.max(0, gainAfterRollover - aeaApplied);
  const lossesUsed = Math.min(input.lossesBroughtForward, gainAfterAEA);
  const taxableGain = gainAfterAEA - lossesUsed;
  const lossesCarriedForward = input.lossesBroughtForward - lossesUsed;

  let gainAtBasicRate = 0;
  let gainAtHigherRate = 0;
  let cgtDue = 0;

  if (input.badrEligible) {
    cgtDue = taxableGain * CGT_RATES.badrRate;
  } else {
    const remainingBasicBand = Math.max(0, CGT_RATES.basicRateBandWidth - input.taxableIncomeForBandStacking);
    gainAtBasicRate = Math.min(taxableGain, remainingBasicBand);
    gainAtHigherRate = taxableGain - gainAtBasicRate;
    cgtDue = gainAtBasicRate * CGT_RATES.basicRate + gainAtHigherRate * CGT_RATES.higherRate;
  }

  return {
    grossGain, aeaApplied, lossesUsed, taxableGain, lossesCarriedForward,
    gainAtBasicRate, gainAtHigherRate, cgtDue, isCompany: false,
    gainRolledOver, gainChargeableNow, adjustedReplacementBaseCost,
  };
}

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  if (!client_id) return;

  await supabase.from("capital_gains_computations").insert({
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
    notes: get("notes"),
  });

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

  const rows = await Promise.all(
    (computations || []).map(async (comp) => {
      let taxableIncome = 0;
      if (comp.linked_tax_computation_id) {
        const { data: tc } = await supabase
          .from("tax_computations")
          .select("employment_income, self_employment_income, rental_income, pension_income")
          .eq("id", comp.linked_tax_computation_id)
          .single();
        if (tc) {
          // Rough proxy: total non-savings income less personal allowance
          const total = Number(tc.employment_income) + Number(tc.self_employment_income) + Number(tc.rental_income) + Number(tc.pension_income);
          taxableIncome = Math.max(0, total - 12570);
        }
      }

      const result = calculateCapitalGain({
        entityType: comp.entity_type,
        disposalProceeds: Number(comp.disposal_proceeds),
        acquisitionCost: Number(comp.acquisition_cost),
        incidentalCosts: Number(comp.incidental_costs),
        improvementCosts: Number(comp.improvement_costs),
        lossesBroughtForward: Number(comp.losses_brought_forward),
        badrEligible: comp.badr_eligible,
        taxableIncomeForBandStacking: taxableIncome,
        rolloverReliefClaimed: comp.rollover_relief_claimed,
        amountReinvested: Number(comp.amount_reinvested),
        replacementAssetCost: Number(comp.replacement_asset_cost),
      });

      return { comp, result };
    })
  );

  const browseRows = browseClientId ? rows.filter((r) => r.comp.client_id === browseClientId) : [];

  const renderRow = ({ comp, result }: (typeof rows)[number]) => {
    const is60Day = comp.entity_type === "Individual" && comp.asset_category === "Residential Property";
    const deadline = is60Day ? new Date(new Date(comp.disposal_date).getTime() + 60 * 24 * 60 * 60 * 1000) : null;
    const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;

    return (
      <div key={comp.id} className="rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center justify-between">
          <a href={`/capital-gains/${comp.id}`} className="flex-1">
            <p className="font-semibold text-slate-900">
              {(comp.clients as any)?.client_name || "No client"} — {comp.asset_description}
            </p>
            <p className="text-sm text-slate-500">
              {comp.entity_type} · Disposed {new Date(comp.disposal_date).toLocaleDateString("en-GB")}
              {comp.badr_eligible && " · BADR"}
            </p>
          </a>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-bold text-slate-900">
                {result.isCompany ? `£${result.taxableGain.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `£${result.cgtDue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </p>
              <p className="text-xs text-slate-400">{result.isCompany ? "chargeable gain" : "CGT due"}</p>
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
          Computes CGT for individuals (2026/27 rates) and chargeable gains for companies, including the 60-day UK property reporting deadline.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load computations: {error.message}
          </div>
        )}

        {/* Entry choice: Browse existing vs Start New */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
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
              For a company, this calculates the chargeable gain to include in its Corporation Tax computation — companies don't pay CGT directly.
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
