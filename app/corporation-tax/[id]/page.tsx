import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getCtRates, calculateFullCorporationTax } from "../page";
import { calculateS455 } from "../../directors-loan-account/page";
import SendCTButton from "../../send-ct-button";

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
    .select("*, clients(client_name, company_number, corporation_tax_reference, email), jobs(job_name)")
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

  const { data: linkedDLAs } = await supabase
    .from("directors_loan_accounts")
    .select("*")
    .eq("corporation_tax_id", id);

  const dlaResults = (linkedDLAs || []).map((dla) => ({
    dla,
    result: calculateS455({
      closingBalance: Number(dla.closing_balance),
      periodEnd: dla.period_end,
      repaidByDueDate: dla.repaid_by_due_date,
      s455Rate: Number(dla.s455_rate),
    }),
  }));
  const totalS455 = dlaResults.reduce((s, r) => s + r.result.s455Due, 0);

  const ctRates = await getCtRates("2026/27");
  const full = await calculateFullCorporationTax(comp, assets || [], ctRates);
  const { periods, isSplit, totalCorporationTax, totalLossesCarriedForward } = full;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");
  const updateWithId = updateComputation.bind(null, id);

  // Renders one sub-period's figures. Used once when there's no split, and
  // twice (stacked) when there is.
  const renderPeriodBreakdown = (p: any, index: number, total: number) => (
    <div key={index} className={total > 1 ? "rounded-xl border border-slate-100 p-4" : ""}>
      {total > 1 && (
        <p className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-3">
          CT600 {index + 1} of {total} · {fmtDate(p.periodStart)} to {fmtDate(p.periodEnd)}
        </p>
      )}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Accounting Profit{total > 1 ? " (apportioned)" : ""}</span><span className="font-medium">{fmt(p.accountingProfitShare)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Add: Depreciation</span><span className="font-medium">{fmt(p.depreciationShare)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Add: Other Disallowable Expenses</span><span className="font-medium">{fmt(p.disallowableShare)}</span></div>
        <div className="flex justify-between border-t border-slate-100 pt-2">
          <span className="text-slate-500">Less: Capital Allowances</span>
          <span className="font-medium text-red-600">({fmt(p.ca.totalCapitalAllowances)})</span>
        </div>
        <div className="flex justify-between"><span className="text-slate-500">Less: Other Allowable Deductions</span><span className="font-medium text-red-600">({fmt(p.otherDeductionsShare)})</span></div>
        {p.profitOnDisposalShare !== 0 && (
          <div className="flex justify-between"><span className="text-slate-500">Less: Profit/(Loss) on Disposal Per Accounts</span><span className="font-medium text-red-600">({fmt(p.profitOnDisposalShare)})</span></div>
        )}
        {p.totalChargeableGains > 0 && (
          <div className="flex justify-between"><span className="text-slate-500">Add: Chargeable Gains</span><span className="font-medium">{fmt(p.totalChargeableGains)}</span></div>
        )}
        <div className="border-t border-slate-100 pt-2 flex justify-between font-medium">
          <span>Profit Before Loss Relief</span>
          <span>{fmt(p.taxableProfitBeforeLosses)}</span>
        </div>
        <div className="flex justify-between"><span className="text-slate-500">Less: Losses Used This Period</span><span className="font-medium text-red-600">({fmt(p.loss.lossesUsed)})</span></div>
        <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
          <span>Taxable Profit</span>
          <span>{fmt(p.loss.taxableProfitAfterLosses)}</span>
        </div>
        <div className="flex justify-between text-slate-500 pt-1">
          <span>Losses Carried Forward</span>
          <span className="font-medium">{fmt(p.loss.lossesCarriedForward)}</span>
        </div>
        <div className="border-t border-slate-100 pt-2 mt-2">
          <div className="flex justify-between">
            <span className="text-slate-500">Band</span>
            <span className="font-medium">{p.ct.band}</span>
          </div>
          <div className="flex justify-between"><span className="text-slate-500">Effective Rate</span><span className="font-medium">{(p.ct.effectiveRate * 100).toFixed(2)}%</span></div>
          <div className="flex justify-between font-bold text-base pt-1">
            <span>Corporation Tax Due</span>
            <span>{fmt(p.ct.corporationTax)}</span>
          </div>
        </div>
        {p.ca.additions.length > 0 && (
          <p className="text-xs text-slate-400 pt-2">
            {p.ca.additions.length} asset addition{p.ca.additions.length !== 1 ? "s" : ""} in this sub-period ·{" "}
            <a href={`/fixed-assets/capital-allowances?client=${comp.client_id}&period_start=${p.periodStart}&period_end=${p.periodEnd}&main_pool_bfwd=${index === 0 ? comp.main_pool_bfwd : periods[index - 1].ca.mainPoolClosingBalance}&special_rate_pool_bfwd=${index === 0 ? comp.special_rate_pool_bfwd : periods[index - 1].ca.specialRateClosingBalance}`}
              className="text-blue-600 hover:underline">
              View full capital allowances detail →
            </a>
          </p>
        )}
        {p.gainRows.length > 0 && (
          <div className="pt-2 space-y-1">
            {p.gainRows.map(({ comp: g, result: gResult }: any) => (
              <a key={g.id} href={`/capital-gains/${g.id}`} className="flex justify-between text-xs hover:bg-slate-50 rounded px-1 py-0.5 -mx-1">
                <span className="text-slate-400">{g.asset_description} · {fmtDate(g.disposal_date)}</span>
                <span className="text-slate-500">{fmt(gResult.taxableGain)}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <a href="/corporation-tax" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to Corporation Tax
          </a>
          <a href={`/corporation-tax/${id}/ct600`}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            View CT600 Summary →
          </a>
        </div>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{(comp.clients as any)?.client_name || "No client"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Accounting period {fmtDate(comp.period_start)} to {fmtDate(comp.period_end)}
            {(comp.jobs as any)?.job_name && ` · Job: ${(comp.jobs as any)?.job_name}`}
          </p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {isSplit && (
            <div className="rounded-2xl bg-purple-50 border border-purple-200 p-4">
              <p className="text-sm font-bold text-purple-800">
                ⚠ This accounting period is longer than HMRC's 12-month limit for a single Corporation Tax accounting period.
              </p>
              <p className="text-xs text-purple-700 mt-1">
                It has been automatically split into two separate CT600s below: the first covers the initial 12 months, the second covers the remainder. Trading profit, depreciation, and other whole-period adjustments are apportioned by day count between the two. Capital allowances and chargeable gains are calculated separately for each sub-period from the actual asset and disposal dates, not apportioned — this matches HMRC's rules. Two separate CT600 returns will need to be filed.
              </p>
            </div>
          )}

          {/* Taxable Profit & CT Calculation — one block per sub-period */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">
              {isSplit ? "Taxable Profit & Corporation Tax — Both Periods" : "Taxable Profit & Corporation Tax Calculation"}
            </h2>
            <div className={isSplit ? "mt-4 space-y-4" : "mt-4"}>
              {periods.map((p: any, i: number) => renderPeriodBreakdown(p, i, periods.length))}
            </div>
            {isSplit && (
              <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between font-bold text-lg">
                <span>Total Corporation Tax Due (both periods)</span>
                <span>{fmt(totalCorporationTax)}</span>
              </div>
            )}
          </div>

          {dlaResults.length > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">S455 — Loans to Participators</h2>
                <a href="/directors-loan-account" className="text-xs font-semibold text-blue-600 hover:underline">Manage DLA records →</a>
              </div>
              <p className="text-xs text-slate-400 mt-1">Linked from the Director's Loan Account tracker.</p>
              <div className="mt-4 space-y-2 text-sm">
                {dlaResults.map(({ dla, result }) => (
                  <div key={dla.id} className="flex justify-between">
                    <span className="text-slate-500">
                      {dla.director_name} {result.s455Due === 0 && result.isOverdrawn ? "(cleared in time)" : ""}
                    </span>
                    <span className="font-medium">{fmt(result.s455Due)}</span>
                  </div>
                ))}
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                  <span>Total S455 Charge</span>
                  <span>{fmt(totalS455)}</span>
                </div>
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
            <h2 className="text-lg font-bold">Total Tax Payable</h2>
            <p className="mt-4 text-3xl font-bold">{fmt(totalCorporationTax + totalS455)}</p>
            <div className="mt-3 space-y-1 text-sm text-slate-300 border-t border-slate-700 pt-3">
              <div className="flex justify-between"><span>Corporation Tax{isSplit && " (both periods)"}</span><span>{fmt(totalCorporationTax)}</span></div>
              {totalS455 > 0 && (
                <div className="flex justify-between"><span>S455 (Loans to Participators)</span><span>{fmt(totalS455)}</span></div>
              )}
            </div>
            {totalLossesCarriedForward > 0 && (
              <p className="mt-3 text-sm text-slate-300">{fmt(totalLossesCarriedForward)} losses carried forward</p>
            )}
            <p className="mt-4 text-xs text-slate-400">
              {isSplit
                ? "Each CT600 is due nine months and one day after the end of its own accounting period."
                : "Due nine months and one day after the end of the accounting period."}
            </p>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              Uses 2026/27 Corporation Tax rates. Marginal relief assumes augmented profits equal taxable profits (no exempt group dividends). Doesn't yet account for R&D reliefs, group relief, or ring-fence profits. Always verify before filing.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Send to Client</h2>
            <p className="text-sm text-slate-500 mt-0.5">Send this computation by email for digital approval.</p>
            <div className="mt-4">
              <SendCTButton
                computationId={id}
                defaultEmail={comp.client_email || (comp.clients as any)?.email || ""}
                computationToken={comp.token}
                status={comp.status}
                approvedAt={comp.approved_at}
                queriedAt={comp.queried_at}
              />
            </div>
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
                <p className="text-xs text-slate-400 mt-1">If over 12 months from the start date, this will split into two CT600s automatically.</p>
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Turnover (£)</label>
                <input name="turnover" type="number" step="0.01" min="0" defaultValue={comp.turnover}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Profit/(Loss) on Disposal Per Accounts (£)</label>
                <input name="accounting_profit_on_disposal" type="number" step="0.01" defaultValue={comp.accounting_profit_on_disposal || 0}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                <p className="text-xs text-slate-400 mt-1">
                  If Accounting Profit already includes a profit/(loss) on disposal, enter it here to remove it — the tax-basis chargeable gain is added automatically from the Capital Gains module instead. If the period is split, this is apportioned by day count between the two sub-periods.
                </p>
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
                <p className="text-xs text-slate-400 mt-1">Used as the brought-forward balance for the first sub-period if the accounting period is split.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Special Rate Pool Brought Forward (£)</label>
                <input name="special_rate_pool_bfwd" type="number" step="0.01" min="0" defaultValue={comp.special_rate_pool_bfwd}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Paid on Account (£)</label>
                <input name="tax_paid_on_account" type="number" step="0.01" min="0" defaultValue={comp.tax_paid_on_account}
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
