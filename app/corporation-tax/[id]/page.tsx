import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getCtRates, calculateFullCorporationTax, calculateCorporationTax } from "../page";
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

  const { error: updateError } = await supabase.from("corporation_tax_computations").update({
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
    loss_carried_back: num("loss_carried_back"),
    loss_carried_back_to_computation_id: get("loss_carried_back_to_computation_id") || null,
    associated_companies: parseInt(get("associated_companies")) || 0,
    main_pool_bfwd: num("main_pool_bfwd"),
    special_rate_pool_bfwd: num("special_rate_pool_bfwd"),
    tax_paid_on_account: num("tax_paid_on_account"),
    notes: get("notes"),
  }).eq("id", id);

  if (updateError) {
    throw new Error(`Failed to save Corporation Tax computation: ${updateError.message}`);
  }

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
  const finalPeriod = periods[periods.length - 1];
  const currentPeriodLoss = finalPeriod.loss.newLossThisPeriod;

  // --- s37 Loss Carry-Back ---
  const twelveMonthsBeforeStart = new Date(comp.period_start);
  twelveMonthsBeforeStart.setUTCFullYear(twelveMonthsBeforeStart.getUTCFullYear() - 1);

  const { data: priorCandidates } = await supabase
    .from("corporation_tax_computations")
    .select("id, period_start, period_end")
    .eq("client_id", comp.client_id)
    .lt("period_end", comp.period_start)
    .order("period_end", { ascending: false })
    .limit(5);

  const eligiblePriorCandidates = (priorCandidates || []).filter(
    (c) => new Date(c.period_end) >= twelveMonthsBeforeStart
  );

  let carryBackTarget: any = null;
  let carryBackTargetFinalPeriod: any = null;
  let maxCarryBack = 0;
  let originalPriorCT = 0;
  let adjustedPriorCT = 0;
  let carryBackRefund = 0;
  let claimedCarryBack = 0;

  const carryBackTargetId = comp.loss_carried_back_to_computation_id || eligiblePriorCandidates[0]?.id || null;

  if (carryBackTargetId && currentPeriodLoss > 0) {
    const { data: targetComp } = await supabase
      .from("corporation_tax_computations")
      .select("*")
      .eq("id", carryBackTargetId)
      .single();

    if (targetComp) {
      carryBackTarget = targetComp;
      const { data: targetAssets } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("client_id", targetComp.client_id);

      const targetFull = await calculateFullCorporationTax(targetComp, targetAssets || [], ctRates);
      carryBackTargetFinalPeriod = targetFull.periods[targetFull.periods.length - 1];

      const priorTaxableProfit = carryBackTargetFinalPeriod.loss.taxableProfitAfterLosses;
      maxCarryBack = Math.min(currentPeriodLoss, priorTaxableProfit);

      originalPriorCT = carryBackTargetFinalPeriod.ct.corporationTax;
      claimedCarryBack = Math.min(Number(comp.loss_carried_back || 0), maxCarryBack);
      const adjustedTaxableProfit = Math.max(0, priorTaxableProfit - claimedCarryBack);
      const adjustedCtResult = calculateCorporationTax({
        taxableProfit: adjustedTaxableProfit,
        periodStart: carryBackTargetFinalPeriod.periodStart,
        periodEnd: carryBackTargetFinalPeriod.periodEnd,
        associatedCompanies: targetComp.associated_companies,
      }, ctRates);
      adjustedPriorCT = adjustedCtResult.corporationTax;
      carryBackRefund = originalPriorCT - adjustedPriorCT;
    }
  }

  const netLossesCarriedForward = Math.max(0, totalLossesCarriedForward - claimedCarryBack);

  const { data: carryBackClaimsAgainstThis } = await supabase
    .from("corporation_tax_computations")
    .select("id, period_start, period_end, loss_carried_back")
    .eq("loss_carried_back_to_computation_id", id)
    .gt("loss_carried_back", 0);

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");
  const updateWithId = updateComputation.bind(null, id);

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
          <div className="flex justify-between"><span className="text-slate-500">Add: Chargeable Gains (net of same-period losses)</span><span className="font-medium">{fmt(p.totalChargeableGains)}</span></div>
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

          {carryBackClaimsAgainstThis && carryBackClaimsAgainstThis.length > 0 && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
              <p className="text-sm font-bold text-emerald-800">
                A refund has been claimed against this period via loss carry-back.
              </p>
              {carryBackClaimsAgainstThis.map((claim) => (
                <p key={claim.id} className="text-xs text-emerald-700 mt-1">
                  £{Number(claim.loss_carried_back).toLocaleString("en-GB", { minimumFractionDigits: 2 })} carried back from the period {fmtDate(claim.period_start)} to {fmtDate(claim.period_end)} —{" "}
                  <a href={`/corporation-tax/${claim.id}`} className="underline">view that computation for the calculated refund →</a>
                </p>
              ))}
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

          {/* Chargeable Gains — linked from the Capital Gains module, per sub-period */}
          {periods.some((p: any) => p.gainRows.length > 0) && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Chargeable Gains</h2>
                <a href="/capital-gains" className="text-xs font-semibold text-blue-600 hover:underline">Manage disposals →</a>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Company disposals with a disposal date inside this accounting period. Losses among them are netted against gains automatically, in date order, before any brought-forward capital losses are applied.
              </p>
              <div className={periods.length > 1 ? "mt-4 space-y-4" : "mt-4"}>
                {periods.map((p: any, i: number) => p.gainRows.length > 0 && (
                  <div key={i}>
                    {periods.length > 1 && (
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                        {fmtDate(p.periodStart)} to {fmtDate(p.periodEnd)}
                      </p>
                    )}
                    <div className="space-y-2 text-sm">
                      {p.gainRows.map(({ comp: g, result: gResult }: any) => (
                        <a key={g.id} href={`/capital-gains/${g.id}`} className="flex justify-between hover:bg-slate-50 rounded-lg px-2 py-1 -mx-2 transition-colors">
                          <span className={gResult.isLoss ? "text-rose-600" : "text-slate-500"}>
                            {g.asset_description} · {fmtDate(g.disposal_date)}{gResult.isLoss && " · loss"}
                          </span>
                          <span className="font-medium">
                            {gResult.isLoss ? `(${fmt(gResult.lossAmount)})` : fmt(gResult.taxableGain)}
                          </span>
                        </a>
                      ))}
                    </div>
                    {p.unusedPeriodLosses > 0 && (
                      <p className="text-xs text-rose-700 mt-2">
                        {fmt(p.unusedPeriodLosses)} of this period's capital losses weren't fully absorbed by this period's own gains — check the relevant disposal's own "Losses Carried Forward" figure in the Capital Gains module to confirm it's available for future disposals.
                      </p>
                    )}
                  </div>
                ))}
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                  <span>Total Chargeable Gains (both periods, net of losses)</span>
                  <span>{fmt(periods.reduce((s: number, p: any) => s + p.totalChargeableGains, 0))}</span>
                </div>
              </div>
            </div>
          )}

          {/* Loss Carry-Back (s37) — only shown when this period made a loss */}
          {currentPeriodLoss > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Loss Carry-Back (s37)</h2>
              <p className="text-xs text-slate-400 mt-1">
                This period made a trading loss of {fmt(currentPeriodLoss)}. Instead of only carrying it forward, some or all can be carried back against the total profits of an accounting period ending within the 12 months before this one started — generating a cash refund now rather than relief against an uncertain future profit. Note: this is separate from capital losses on disposals, which can only offset capital gains, not trading profits.
              </p>

              {carryBackTarget ? (
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Carrying back to period</span>
                    <a href={`/corporation-tax/${carryBackTarget.id}`} className="font-medium text-blue-600 hover:underline">
                      {fmtDate(carryBackTarget.period_start)} to {fmtDate(carryBackTarget.period_end)}
                    </a>
                  </div>
                  <div className="flex justify-between"><span className="text-slate-500">That period's taxable profit (before carry-back)</span><span className="font-medium">{fmt(carryBackTargetFinalPeriod.loss.taxableProfitAfterLosses)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">That period's CT due (before carry-back)</span><span className="font-medium">{fmt(originalPriorCT)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Maximum that can be carried back</span><span className="font-medium">{fmt(maxCarryBack)}</span></div>
                  <div className="border-t border-slate-100 pt-2 flex justify-between font-medium">
                    <span>Amount claimed (see Edit Computation)</span>
                    <span>{fmt(claimedCarryBack)}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-slate-500">That period's CT due (after carry-back)</span><span className="font-medium">{fmt(adjustedPriorCT)}</span></div>
                  <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base text-emerald-700">
                    <span>Refund Generated</span>
                    <span>{fmt(carryBackRefund)}</span>
                  </div>
                  {claimedCarryBack > 0 && (
                    <p className="text-xs text-slate-400 pt-1">
                      This reduces the losses available to carry forward from {fmt(totalLossesCarriedForward)} to {fmt(netLossesCarriedForward)}, since the same loss can't be used twice.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500 mt-4">
                  No prior Corporation Tax computation for this client ends within 12 months before this period started, so there's nothing to carry this loss back against — only carry-forward is available.
                </p>
              )}
            </div>
          )}

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
            {claimedCarryBack > 0 && (
              <div className="mt-3 rounded-lg bg-emerald-900/40 border border-emerald-700 px-3 py-2">
                <div className="flex justify-between text-sm font-bold text-emerald-300">
                  <span>Refund from loss carry-back</span>
                  <span>{fmt(carryBackRefund)}</span>
                </div>
              </div>
            )}
            {netLossesCarriedForward > 0 && (
              <p className="mt-3 text-sm text-slate-300">{fmt(netLossesCarriedForward)} losses carried forward</p>
            )}
            <p className="mt-4 text-xs text-slate-400">
              {isSplit
                ? "Each CT600 is due nine months and one day after the end of its own accounting period."
                : "Due nine months and one day after the end of the accounting period."}
            </p>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              Uses 2026/27 Corporation Tax rates. Marginal relief assumes augmented profits equal taxable profits (no exempt group dividends). Doesn't yet account for R&D reliefs, group relief, or ring-fence profits. Loss carry-back is limited to the immediately preceding 12 months per standard s37 rules — doesn't account for any temporarily extended carry-back periods that may apply in specific circumstances. Always verify before filing.
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
              {currentPeriodLoss > 0 && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-emerald-800">Loss Carry-Back (s37)</p>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Carry Back To</label>
                    <select name="loss_carried_back_to_computation_id" defaultValue={comp.loss_carried_back_to_computation_id || carryBackTargetId || ""}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                      <option value="">Don't carry back — carry forward only</option>
                      {eligiblePriorCandidates.map((c) => (
                        <option key={c.id} value={c.id}>{fmtDate(c.period_start)} to {fmtDate(c.period_end)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Amount to Carry Back (£)</label>
                    <input name="loss_carried_back" type="number" step="0.01" min="0" max={maxCarryBack || undefined} defaultValue={comp.loss_carried_back || 0}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    {maxCarryBack > 0 && (
                      <p className="text-xs text-slate-400 mt-1">Maximum: {fmt(maxCarryBack)}</p>
                    )}
                  </div>
                </div>
              )}
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
