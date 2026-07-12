import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculateCapitalGain } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateComputation(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  await supabase.from("capital_gains_computations").update({
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
    linked_tax_computation_id: get("linked_tax_computation_id") || null,
    notes: get("notes"),
  }).eq("id", id);

  revalidatePath(`/capital-gains/${id}`);
  revalidatePath("/capital-gains");
}

export default async function CapitalGainsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("capital_gains_computations")
    .select("*, clients(client_name), jobs(job_name)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const { data: taxComputations } = await supabase
    .from("tax_computations")
    .select("id, tax_year")
    .eq("client_id", comp.client_id);

  let taxableIncome = 0;
  let linkedTaxYear = "";
  if (comp.linked_tax_computation_id) {
    const { data: tc } = await supabase
      .from("tax_computations")
      .select("employment_income, self_employment_income, rental_income, pension_income, tax_year")
      .eq("id", comp.linked_tax_computation_id)
      .single();
    if (tc) {
      const total = Number(tc.employment_income) + Number(tc.self_employment_income) + Number(tc.rental_income) + Number(tc.pension_income);
      taxableIncome = Math.max(0, total - 12570);
      linkedTaxYear = tc.tax_year;
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

  const is60Day = comp.entity_type === "Individual" && comp.asset_category === "Residential Property";
  const deadline = is60Day ? new Date(new Date(comp.disposal_date).getTime() + 60 * 24 * 60 * 60 * 1000) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const updateWithId = updateComputation.bind(null, id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/capital-gains" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Capital Gains
        </a>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{(comp.clients as any)?.client_name || "No client"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {comp.asset_description} · {comp.entity_type}
            {(comp.jobs as any)?.job_name && ` · Job: ${(comp.jobs as any).job_name}`}
          </p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {is60Day && daysLeft !== null && (
            <div className={`rounded-2xl p-4 border ${
              daysLeft < 0 ? "bg-red-50 border-red-100" : daysLeft <= 14 ? "bg-orange-50 border-orange-100" : "bg-blue-50 border-blue-100"
            }`}>
              <p className={`text-sm font-bold ${daysLeft < 0 ? "text-red-700" : daysLeft <= 14 ? "text-orange-700" : "text-blue-700"}`}>
                {daysLeft < 0
                  ? `⚠ 60-Day Property Return overdue — was due ${deadline!.toLocaleDateString("en-GB")}`
                  : `60-Day Property Return due ${deadline!.toLocaleDateString("en-GB")} (${daysLeft} days left)`}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                UK residential property disposals by individuals must be reported and paid via HMRC's online service within 60 days of completion — separately from the Self Assessment return.
              </p>
            </div>
          )}

          {/* Gain Computation */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Gain Computation</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Disposal Proceeds</span><span className="font-medium">{fmt(Number(comp.disposal_proceeds))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Less: Acquisition Cost</span><span className="font-medium text-red-600">({fmt(Number(comp.acquisition_cost))})</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Less: Incidental Costs</span><span className="font-medium text-red-600">({fmt(Number(comp.incidental_costs))})</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Less: Improvement Costs</span><span className="font-medium text-red-600">({fmt(Number(comp.improvement_costs))})</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Gross Gain</span>
                <span>{fmt(result.grossGain)}</span>
              </div>

              {comp.rollover_relief_claimed && (
                <>
                  <div className="flex justify-between text-slate-500 pt-1"><span>Less: Gain Rolled Over</span><span className="text-red-600 font-medium">({fmt(result.gainRolledOver)})</span></div>
                  <div className="flex justify-between font-medium"><span>Gain Chargeable Now</span><span>{fmt(result.gainChargeableNow)}</span></div>
                </>
              )}

              {!result.isCompany && (
                <div className="flex justify-between"><span className="text-slate-500">Less: Annual Exempt Amount</span><span className="font-medium text-red-600">({fmt(result.aeaApplied)})</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Less: Losses Brought Forward Used</span><span className="font-medium text-red-600">({fmt(result.lossesUsed)})</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                <span>{result.isCompany ? "Chargeable Gain" : "Taxable Gain"}</span>
                <span>{fmt(result.taxableGain)}</span>
              </div>
              {result.lossesCarriedForward > 0 && (
                <div className="flex justify-between text-slate-500 pt-1">
                  <span>Losses Carried Forward</span>
                  <span>{fmt(result.lossesCarriedForward)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tax Calculation */}
          {!result.isCompany ? (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">CGT Calculation</h2>
              {comp.badr_eligible ? (
                <p className="text-xs text-slate-400 mt-1">Business Asset Disposal Relief applied — flat 18% rate, subject to the £1m lifetime limit (not tracked across computations here).</p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">
                  {linkedTaxYear ? `Based on taxable income from the ${linkedTaxYear} Personal Tax computation.` : "No linked Personal Tax computation — assumed £0 other taxable income, so the gain may be taxed more favourably than it should be. Link a computation for accuracy."}
                </p>
              )}
              <div className="mt-4 space-y-2 text-sm">
                {!comp.badr_eligible && (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500">Gain at Basic Rate (18%)</span><span className="font-medium">{fmt(result.gainAtBasicRate)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Gain at Higher Rate (24%)</span><span className="font-medium">{fmt(result.gainAtHigherRate)}</span></div>
                  </>
                )}
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                  <span>CGT Due</span>
                  <span>{fmt(result.cgtDue)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Corporation Tax Treatment</h2>
              <p className="text-sm text-slate-600 mt-2">
                Companies pay Corporation Tax on chargeable gains rather than CGT — there's no Annual Exempt Amount or separate CGT rate. Add the chargeable gain of <strong>{fmt(result.taxableGain)}</strong> as an adjustment to Accounting Profit when preparing this company's Corporation Tax computation for the period covering this disposal.
              </p>
              <a href="/corporation-tax" className="inline-block mt-3 text-sm font-semibold text-blue-600 hover:underline">
                Go to Corporation Tax →
              </a>
            </div>
          )}

          {comp.rollover_relief_claimed && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Rollover Relief</h2>
              <p className="text-xs text-slate-400 mt-1">
                The rolled-over gain reduces the base cost of the replacement asset — it becomes chargeable when that asset is eventually disposed of without further rollover.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Disposal Proceeds</span><span className="font-medium">{fmt(Number(comp.disposal_proceeds))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Amount Reinvested</span><span className="font-medium">{fmt(Number(comp.amount_reinvested))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Proceeds Not Reinvested</span><span className="font-medium">{fmt(Math.max(0, Number(comp.disposal_proceeds) - Number(comp.amount_reinvested)))}</span></div>
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                  <span>Gain Rolled Over (Deferred)</span>
                  <span>{fmt(result.gainRolledOver)}</span>
                </div>
                {Number(comp.replacement_asset_cost) > 0 && (
                  <>
                    <div className="flex justify-between pt-2"><span className="text-slate-500">Cost of Replacement Asset</span><span className="font-medium">{fmt(Number(comp.replacement_asset_cost))}</span></div>
                    <div className="flex justify-between font-bold">
                      <span>Adjusted Base Cost (for future disposal)</span>
                      <span>{fmt(result.adjustedReplacementBaseCost)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {comp.notes && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Notes</h2>
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{comp.notes}</p>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-slate-900 p-6 shadow-sm text-white">
            <h2 className="text-lg font-bold">{result.isCompany ? "Chargeable Gain" : "CGT Due"}</h2>
            <p className="mt-4 text-3xl font-bold">{fmt(result.isCompany ? result.taxableGain : result.cgtDue)}</p>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              Uses 2026/27 rates (£3,000 Annual Exempt Amount, 18%/24%, BADR 18%). Does not track cumulative BADR lifetime limit usage, Private Residence Relief, or indexation allowance for older corporate assets. Always verify before filing — property disposals by individuals must still be reported via HMRC's 60-day service separately from Self Assessment.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Computation</h2>
            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
                <select name="entity_type" defaultValue={comp.entity_type}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Individual</option>
                  <option>Company</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Asset Description</label>
                <input name="asset_description" required defaultValue={comp.asset_description}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Asset Category</label>
                <select name="asset_category" defaultValue={comp.asset_category}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Other Assets</option>
                  <option>Residential Property</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Acquisition Date</label>
                <input name="acquisition_date" type="date" defaultValue={comp.acquisition_date || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Acquisition Cost (£)</label>
                <input name="acquisition_cost" type="number" step="0.01" min="0" defaultValue={comp.acquisition_cost}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Disposal Date</label>
                <input name="disposal_date" type="date" required defaultValue={comp.disposal_date}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Disposal Proceeds (£)</label>
                <input name="disposal_proceeds" type="number" step="0.01" min="0" defaultValue={comp.disposal_proceeds}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Incidental Costs (£)</label>
                <input name="incidental_costs" type="number" step="0.01" min="0" defaultValue={comp.incidental_costs}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Improvement Costs (£)</label>
                <input name="improvement_costs" type="number" step="0.01" min="0" defaultValue={comp.improvement_costs}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Losses Brought Forward (£)</label>
                <input name="losses_brought_forward" type="number" step="0.01" min="0" defaultValue={comp.losses_brought_forward}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Linked Personal Tax Computation</label>
                <select name="linked_tax_computation_id" defaultValue={comp.linked_tax_computation_id || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">None</option>
                  {(taxComputations || []).map((tc) => (
                    <option key={tc.id} value={tc.id}>{tc.tax_year}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input name="badr_eligible" type="checkbox" defaultChecked={comp.badr_eligible} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700">Eligible for Business Asset Disposal Relief</span>
              </label>
              <div className="rounded-xl border border-slate-100 p-3">
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input name="rollover_relief_claimed" type="checkbox" defaultChecked={comp.rollover_relief_claimed} className="w-4 h-4 rounded" />
                  <span className="text-sm font-medium text-slate-700">Claiming Rollover Relief</span>
                </label>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Amount Reinvested (£)</label>
                    <input name="amount_reinvested" type="number" step="0.01" min="0" defaultValue={comp.amount_reinvested}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Cost of Replacement Asset (£)</label>
                    <input name="replacement_asset_cost" type="number" step="0.01" min="0" defaultValue={comp.replacement_asset_cost}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={comp.notes || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save & Recalculate
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
