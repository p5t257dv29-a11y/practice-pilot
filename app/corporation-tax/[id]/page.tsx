import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculateCorporationTax, applyLossRelief } from "../page";
import { calculateCapitalAllowances } from "../../fixed-assets/capital-allowances/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateComputation(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  await supabase.from("corporation_tax_computations").update({
    period_start: get("period_start"),
    period_end: get("period_end"),
    job_id: get("job_id") || null,
    accounting_profit: num("accounting_profit"),
    depreciation_addback: num("depreciation_addback"),
    disallowable_expenses: num("disallowable_expenses"),
    other_allowable_deductions: num("other_allowable_deductions"),
    brought_forward_losses: num("brought_forward_losses"),
    associated_companies: parseInt(get("associated_companies")) || 0,
    main_pool_bfwd: num("main_pool_bfwd"),
    special_rate_pool_bfwd: num("special_rate_pool_bfwd"),
    notes: get("notes"),
  }).eq("id", id);

  revalidatePath(`/corporation-tax/${id}`);
  revalidatePath("/corporation-tax");
}

export default async function CorporationTaxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("corporation_tax_computations")
    .select("*, clients(client_name), jobs(job_name)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const { data: assets } = await supabase
    .from("fixed_assets")
    .select("*")
    .eq("client_id", comp.client_id);

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, job_name")
    .eq("client_id", comp.client_id)
    .order("job_name", { ascending: true });

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

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const updateWithId = updateComputation.bind(null, id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/corporation-tax" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Corporation Tax
        </a>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{comp.clients?.client_name || "No client"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Accounting period {new Date(comp.period_start).toLocaleDateString("en-GB")} to {new Date(comp.period_end).toLocaleDateString("en-GB")}
            {comp.jobs?.job_name && ` · Job: ${comp.jobs.job_name}`}
          </p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {/* Taxable Profit Computation */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Taxable Profit Computation</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Accounting Profit</span><span className="font-medium">{fmt(Number(comp.accounting_profit))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Add: Depreciation</span><span className="font-medium">{fmt(Number(comp.depreciation_addback))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Add: Other Disallowable Expenses</span><span className="font-medium">{fmt(Number(comp.disallowable_expenses))}</span></div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="text-slate-500">Less: Capital Allowances</span>
                <span className="font-medium text-red-600">({fmt(ca.totalCapitalAllowances)})</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">Less: Other Allowable Deductions</span><span className="font-medium text-red-600">({fmt(Number(comp.other_allowable_deductions))})</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-medium">
                <span>Profit Before Loss Relief</span>
                <span>{fmt(taxableProfitBeforeLosses)}</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">Losses Brought Forward</span><span className="font-medium">{fmt(Number(comp.brought_forward_losses))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Less: Losses Used This Period</span><span className="font-medium text-red-600">({fmt(loss.lossesUsed)})</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                <span>Taxable Profit</span>
                <span>{fmt(loss.taxableProfitAfterLosses)}</span>
              </div>
              <div className="flex justify-between text-slate-500 pt-2">
                <span>Losses Carried Forward to Next Period</span>
                <span className="font-medium">{fmt(loss.lossesCarriedForward)}</span>
              </div>
            </div>
          </div>

          {/* Capital Allowances — linked from Fixed Asset Register */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Capital Allowances</h2>
              <a href={`/fixed-assets/capital-allowances?client=${comp.client_id}&period_start=${comp.period_start}&period_end=${comp.period_end}&main_pool_bfwd=${comp.main_pool_bfwd}&special_rate_pool_bfwd=${comp.special_rate_pool_bfwd}`}
                className="text-xs font-semibold text-blue-600 hover:underline">
                Open standalone summary →
              </a>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {comp.job_id
                ? `Pulled automatically from assets linked to the job "${comp.jobs?.job_name}" in the Fixed Asset Register.`
                : "Pulled automatically from assets acquired within this date range in the Fixed Asset Register."}
              {" "}AIA limit for this period: {fmt(ca.aiaLimit)}
            </p>

            {/* Additions in period */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Additions in Period ({ca.additions.length})
              </p>
              <div className="space-y-1">
                {ca.additions.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-1.5">
                    <div>
                      <p className="text-sm text-slate-900">{a.description}</p>
                      <p className="text-xs text-slate-400">{a.capital_allowance_pool}</p>
                    </div>
                    <p className="text-sm font-medium">{fmt(Number(a.cost))}</p>
                  </div>
                ))}
                {ca.additions.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-3">No asset additions in this period.</p>
                )}
              </div>
            </div>

            {/* AIA & FYA allocation */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">AIA & First Year Allowances</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">AIA on Special Rate Pool additions (used first)</span><span className="font-medium">{fmt(ca.aiaOnSpecialRate)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">AIA on Main Pool additions</span><span className="font-medium">{fmt(ca.aiaOnMainPool)}</span></div>
                <div className="flex justify-between font-medium border-t border-slate-100 pt-1"><span>Total AIA Claimed</span><span>{fmt(ca.totalAIAClaimed)}</span></div>
                <div className="flex justify-between mt-1"><span className="text-slate-500">100% FYA — Zero Emission Cars</span><span className="font-medium">{fmt(ca.totalFYA)}</span></div>
              </div>
            </div>

            {/* WDA pools */}
            <div className="mt-4 border-t border-slate-100 pt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Main Pool (14%)</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Brought forward</span><span>{fmt(Number(comp.main_pool_bfwd))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Additions not covered by AIA</span><span>{fmt(ca.mainPoolAdditionsAfterAIA)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Cars (Main Pool)</span><span>{fmt(ca.mainPoolCarsTotal)}</span></div>
                  <div className="flex justify-between font-medium border-t border-slate-100 pt-1"><span>Pool balance</span><span>{fmt(ca.mainPoolBalance)}</span></div>
                  <div className="flex justify-between text-green-700 font-bold"><span>WDA claimed (14%)</span><span>{fmt(ca.mainPoolWDA)}</span></div>
                  <div className="flex justify-between text-slate-500"><span>Closing balance (c/fwd)</span><span>{fmt(ca.mainPoolClosingBalance)}</span></div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Special Rate Pool (6%)</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Brought forward</span><span>{fmt(Number(comp.special_rate_pool_bfwd))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Additions not covered by AIA</span><span>{fmt(ca.specialRateAdditionsAfterAIA)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Cars (Special Rate)</span><span>{fmt(ca.specialRateCarsTotal)}</span></div>
                  <div className="flex justify-between font-medium border-t border-slate-100 pt-1"><span>Pool balance</span><span>{fmt(ca.specialRateBalance)}</span></div>
                  <div className="flex justify-between text-green-700 font-bold"><span>WDA claimed (6%)</span><span>{fmt(ca.specialRateWDA)}</span></div>
                  <div className="flex justify-between text-slate-500"><span>Closing balance (c/fwd)</span><span>{fmt(ca.specialRateClosingBalance)}</span></div>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4 flex justify-between font-bold">
              <span>Total Capital Allowances</span>
              <span>{fmt(ca.totalCapitalAllowances)}</span>
            </div>
          </div>

          {/* CT Calculation */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Corporation Tax Calculation</h2>
            <p className="text-xs text-slate-400 mt-1">
              Small profits threshold: {fmt(ct.smallProfitsThreshold)} · Main rate threshold: {fmt(ct.mainRateThreshold)}
              {comp.associated_companies > 0 && ` (adjusted for ${comp.associated_companies} associated compan${comp.associated_companies === 1 ? "y" : "ies"})`}
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Band</span>
                <span className="font-medium">{ct.band}</span>
              </div>
              {ct.band === "Marginal Relief" && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Tax at Main Rate (25%)</span><span className="font-medium">{fmt(ct.profit * 0.25)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Less: Marginal Relief</span><span className="font-medium text-red-600">({fmt(ct.marginalRelief)})</span></div>
                </>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Effective Rate</span><span className="font-medium">{(ct.effectiveRate * 100).toFixed(2)}%</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                <span>Corporation Tax Due</span>
                <span>{fmt(ct.corporationTax)}</span>
              </div>
            </div>
          </div>

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
            <h2 className="text-lg font-bold">Corporation Tax Due</h2>
            <p className="mt-4 text-3xl font-bold">{fmt(ct.corporationTax)}</p>
            <p className="mt-1 text-sm text-slate-300">{ct.band} · {(ct.effectiveRate * 100).toFixed(2)}% effective</p>
            <p className="mt-4 text-xs text-slate-400">
              Due nine months and one day after the end of the accounting period.
            </p>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              Uses 2026/27 Corporation Tax rates. Marginal relief assumes augmented profits equal taxable profits (no exempt group dividends). Doesn't yet account for R&D reliefs, group relief, or ring-fence profits. Always verify before filing.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Computation</h2>
            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period Start</label>
                <input name="period_start" type="date" defaultValue={comp.period_start}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period End</label>
                <input name="period_end" type="date" defaultValue={comp.period_end}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Linked Job (optional)</label>
                <select name="job_id" defaultValue={comp.job_id || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">No linked job (use date range)</option>
                  {(jobs || []).map((j) => (
                    <option key={j.id} value={j.id}>{j.job_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Accounting Profit (£)</label>
                <input name="accounting_profit" type="number" step="0.01" defaultValue={comp.accounting_profit}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Add-back (£)</label>
                <input name="depreciation_addback" type="number" step="0.01" min="0" defaultValue={comp.depreciation_addback}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Other Disallowable Expenses (£)</label>
                <input name="disallowable_expenses" type="number" step="0.01" min="0" defaultValue={comp.disallowable_expenses}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Other Allowable Deductions (£)</label>
                <input name="other_allowable_deductions" type="number" step="0.01" min="0" defaultValue={comp.other_allowable_deductions}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Brought Forward Losses (£)</label>
                <input name="brought_forward_losses" type="number" step="0.01" min="0" defaultValue={comp.brought_forward_losses}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Associated Companies</label>
                <input name="associated_companies" type="number" step="1" min="0" defaultValue={comp.associated_companies}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Main Pool Brought Forward (£)</label>
                <input name="main_pool_bfwd" type="number" step="0.01" min="0" defaultValue={comp.main_pool_bfwd}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Special Rate Pool Brought Forward (£)</label>
                <input name="special_rate_pool_bfwd" type="number" step="0.01" min="0" defaultValue={comp.special_rate_pool_bfwd}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
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
