import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { calculateTax, getPaymentSchedule, getTaxRates } from "../../tax/page";
import { calculateCapitalGain, getCgtRates, ukTaxYearOf } from "../../capital-gains/page";
import PrintButton from "../../print-button";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function approveComputation(token: string) {
  "use server";
  await supabase
    .from("tax_computations")
    .update({ status: "Approved", approved_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/t/${token}`);
}

async function queryComputation(token: string) {
  "use server";
  await supabase
    .from("tax_computations")
    .update({ status: "Queried", queried_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/t/${token}`);
}

export default async function PublicTaxComputationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [{ data: comp, error }, { data: practiceSettings }] = await Promise.all([
    supabase
      .from("tax_computations")
      .select("*, clients(client_name)")
      .eq("token", token)
      .single(),
    supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle(),
  ]);

  if (error || !comp) notFound();

  const firmName = practiceSettings?.firm_name || "Your Accountant";

  const approveWithToken = approveComputation.bind(null, token);
  const queryWithToken = queryComputation.bind(null, token);

  const isApproved = comp.status === "Approved";
  const isQueried = comp.status === "Queried";
  const isResponded = isApproved || isQueried;

  const rates = await getTaxRates(comp.tax_year);

  const result = calculateTax({
    employmentIncome: Number(comp.employment_income),
    selfEmploymentIncome: Number(comp.self_employment_income),
    rentalIncome: Number(comp.rental_income),
    propertyExpenses: Number(comp.property_expenses),
    propertyFinanceCosts: Number(comp.property_finance_costs),
    financeCostsBf: Number(comp.finance_costs_bf),
    pensionIncome: Number(comp.pension_income),
    interestIncome: Number(comp.interest_income),
    dividendIncome: Number(comp.dividend_income),
    foreignEmploymentIncome: Number(comp.foreign_employment_income),
    foreignInterestIncome: Number(comp.foreign_interest_income),
    foreignDividendIncome: Number(comp.foreign_dividend_income),
    foreignRentalIncome: Number(comp.foreign_rental_income),
    foreignPropertyExpenses: Number(comp.foreign_property_expenses),
    foreignPropertyFinanceCosts: Number(comp.foreign_property_finance_costs),
    foreignFinanceCostsBf: Number(comp.foreign_finance_costs_bf),
    foreignTaxPaid: Number(comp.foreign_tax_paid),
    taxYear: comp.tax_year,
  }, rates);
  const schedule = getPaymentSchedule(comp.tax_year, result.totalLiability, Number(comp.tax_paid_at_source));

  // --- Capital Gains Tax linked to this computation ---
  // Any CGT disposals the practice has linked to this specific Personal Tax
  // computation are pulled in here, using the same per-tax-year AEA and
  // rate-band aggregation — and now the same Private Residence Relief
  // calculation — as the Capital Gains module itself, so the figure shown
  // to the client always matches what's shown internally.
  const { data: linkedGains } = await supabase
    .from("capital_gains_computations")
    .select("*")
    .eq("linked_tax_computation_id", comp.id)
    .neq("entity_type", "Company");

  const cgtRates = await getCgtRates("2026/27");

  // Same rough income proxy the Capital Gains module uses for band stacking
  // when a disposal is linked to this computation.
  const taxableIncomeForGains = Math.max(0,
    Number(comp.employment_income) + Number(comp.self_employment_income) +
    Number(comp.rental_income) + Number(comp.pension_income) - 12570
  );

  const sortedGains = (linkedGains || [])
    .filter((g) => ukTaxYearOf(g.disposal_date) === comp.tax_year)
    .sort((a, b) => {
      const diff = new Date(a.disposal_date).getTime() - new Date(b.disposal_date).getTime();
      if (diff !== 0) return diff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  let aeaUsedSoFar = 0;
  let gainsStackedSoFar = 0;
  const cgtRows = sortedGains.map((g) => {
    const gResult = calculateCapitalGain({
      entityType: g.entity_type,
      disposalProceeds: Number(g.disposal_proceeds),
      acquisitionCost: Number(g.acquisition_cost),
      incidentalCosts: Number(g.incidental_costs),
      improvementCosts: Number(g.improvement_costs),
      lossesBroughtForward: Number(g.losses_brought_forward),
      badrEligible: g.badr_eligible,
      taxableIncomeForBandStacking: taxableIncomeForGains,
      aeaAlreadyUsedThisYear: aeaUsedSoFar,
      gainsStackedAheadThisYear: gainsStackedSoFar,
      rolloverReliefClaimed: g.rollover_relief_claimed,
      amountReinvested: Number(g.amount_reinvested),
      replacementAssetCost: Number(g.replacement_asset_cost),
      acquisitionDate: g.acquisition_date,
      disposalDate: g.disposal_date,
      prrClaimed: g.main_residence_relief_claimed,
      mainResidenceFrom: g.main_residence_from,
      mainResidenceTo: g.main_residence_to,
    }, cgtRates);

    aeaUsedSoFar += gResult.aeaApplied;
    gainsStackedSoFar += gResult.taxableGain;

    const isProperty = g.asset_category === "Residential Property";
    return { comp: g, result: gResult, isProperty };
  });

  const nonPropertyCgtDue = cgtRows.filter((r) => !r.isProperty).reduce((sum, r) => sum + r.result.cgtDue, 0);
  const propertyCgtDue = cgtRows.filter((r) => r.isProperty).reduce((sum, r) => sum + r.result.cgtDue, 0);
  const hasCgt = cgtRows.length > 0;

  const grandTotalAtBalancingPayment = schedule.dueAtBalancingPayment + nonPropertyCgtDue;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fmtDateTime = (d: string) =>
    `${new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at ${new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  const hasPropertyIncome = Number(comp.rental_income) > 0 || Number(comp.finance_costs_bf) > 0;

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">

      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-6 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{firmName}</h1>
            <p className="text-slate-400 text-sm mt-0.5 print:text-slate-500">Practice Management</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400 print:text-slate-500">Tax Computation</p>
            <p className="font-bold text-lg">{comp.tax_year}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        <div className="flex justify-end mb-4 print:hidden">
          <PrintButton />
        </div>

        {/* Status Banner */}
        {isApproved && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center print:hidden">
            <p className="text-green-700 font-bold text-lg">✓ Computation Approved</p>
            <p className="text-green-600 text-sm mt-1">
              Thank you! We'll proceed to file your return.
            </p>
            {comp.approved_at && (
              <p className="text-green-500 text-xs mt-2">
                Approved on {fmtDateTime(comp.approved_at)}
              </p>
            )}
          </div>
        )}

        {isQueried && (
          <div className="mb-6 rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-center print:hidden">
            <p className="text-yellow-700 font-bold text-lg">Query Raised</p>
            <p className="text-yellow-600 text-sm mt-1">
              Thanks for letting us know. We'll be in touch to go through it with you.
            </p>
            {comp.queried_at && (
              <p className="text-yellow-500 text-xs mt-2">
                Raised on {fmtDateTime(comp.queried_at)}
              </p>
            )}
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none">

          {/* Client Info */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Prepared for</p>
            <p className="mt-1 font-bold text-slate-900 text-lg">
              {comp.clients?.client_name || "Client"}
            </p>
          </div>

          {/* Income Summary */}
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Income Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Employment Income</span><span className="font-medium">{fmt(Number(comp.employment_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Self-Employment Profit</span><span className="font-medium">{fmt(Number(comp.self_employment_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Rental Property Profit</span><span className="font-medium">{fmt(result.propertyProfit)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pension Income</span><span className="font-medium">{fmt(Number(comp.pension_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Interest Received</span><span className="font-medium">{fmt(Number(comp.interest_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Dividend Income</span><span className="font-medium">{fmt(Number(comp.dividend_income))}</span></div>
              {Number(comp.foreign_employment_income) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Foreign Employment Income</span><span className="font-medium">{fmt(Number(comp.foreign_employment_income))}</span></div>
              )}
              {result.foreignPropertyProfit > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Foreign Rental Property Profit</span><span className="font-medium">{fmt(result.foreignPropertyProfit)}</span></div>
              )}
              {Number(comp.foreign_interest_income) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Foreign Interest</span><span className="font-medium">{fmt(Number(comp.foreign_interest_income))}</span></div>
              )}
              {Number(comp.foreign_dividend_income) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Foreign Dividends</span><span className="font-medium">{fmt(Number(comp.foreign_dividend_income))}</span></div>
              )}
            </div>
          </div>

          {/* Property finance cost relief, shown for transparency when relevant */}
          {hasPropertyIncome && (
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Rental Property Finance Costs</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Finance costs for the year</span><span className="font-medium">{fmt(Number(comp.property_finance_costs))}</span></div>
                {Number(comp.finance_costs_bf) > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Unused finance costs brought forward</span><span className="font-medium">{fmt(Number(comp.finance_costs_bf))}</span></div>
                )}
                <div className="flex justify-between font-medium text-green-600">
                  <span>Tax reducer applied (20%)</span>
                  <span>−{fmt(result.financeCostTaxReducer)}</span>
                </div>
                {result.unusedFinanceCostsCf > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Carried forward to next year</span>
                    <span>{fmt(result.unusedFinanceCostsCf)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Foreign property finance costs, shown for transparency when relevant */}
          {(Number(comp.foreign_rental_income) > 0 || Number(comp.foreign_finance_costs_bf) > 0) && (
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Foreign Rental Property Finance Costs</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Finance costs for the year</span><span className="font-medium">{fmt(Number(comp.foreign_property_finance_costs))}</span></div>
                {Number(comp.foreign_finance_costs_bf) > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Unused finance costs brought forward</span><span className="font-medium">{fmt(Number(comp.foreign_finance_costs_bf))}</span></div>
                )}
                <div className="flex justify-between font-medium text-green-600">
                  <span>Tax reducer applied (20%)</span>
                  <span>−{fmt(result.foreignFinanceCostTaxReducer)}</span>
                </div>
                {result.unusedForeignFinanceCostsCf > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Carried forward to next year</span>
                    <span>{fmt(result.unusedForeignFinanceCostsCf)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Foreign Tax Credit Relief, shown for transparency when relevant */}
          {Number(comp.foreign_tax_paid) > 0 && (
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Foreign Tax Credit Relief</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Foreign tax paid</span><span className="font-medium">{fmt(Number(comp.foreign_tax_paid))}</span></div>
                <div className="flex justify-between font-medium text-green-600">
                  <span>Credit relief given</span>
                  <span>−{fmt(result.foreignTaxCreditRelief)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Tax Breakdown */}
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Tax & National Insurance</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Income Tax</span><span className="font-medium">{fmt(result.totalIncomeTax)}</span></div>
              {Number(comp.self_employment_income) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Class 4 National Insurance</span><span className="font-medium">{fmt(result.class4NI)}</span></div>
              )}
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Total Liability</span>
                <span>{fmt(result.totalLiability)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Already paid at source (PAYE)</span>
                <span>{fmt(Number(comp.tax_paid_at_source))}</span>
              </div>
            </div>
          </div>

          {/* Capital Gains Tax, shown when any disposals are linked to this computation */}
          {hasCgt && (
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Capital Gains Tax</h2>
              <div className="space-y-3">
                {cgtRows.map((row) => (
                  <div key={row.comp.id} className="text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">
                        {row.comp.asset_description}{row.isProperty && " (residential property)"}
                        {row.comp.main_residence_relief_claimed && " · PRR applied"}
                      </span>
                      <span className="font-medium">{fmt(row.result.cgtDue)}</span>
                    </div>
                    {row.isProperty && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        Reported and paid separately via HMRC's 60-day property service — not included in the 31 January balancing payment below.
                      </p>
                    )}
                  </div>
                ))}
                <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                  <span>Total Capital Gains Tax</span>
                  <span>{fmt(nonPropertyCgtDue + propertyCgtDue)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Payment Schedule */}
          <div className="p-6 bg-slate-50 print:bg-white">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Payment Schedule</h2>
            <div className="space-y-3">
              <div className="rounded-xl bg-white border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{fmtDate(schedule.balancingPaymentDate)}</p>
                <div className="mt-1 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Balancing payment ({comp.tax_year})</span>
                    <span className="font-medium">{fmt(schedule.balanceDue)}</span>
                  </div>
                  {nonPropertyCgtDue > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Capital Gains Tax (non-property)</span>
                      <span className="font-medium">{fmt(nonPropertyCgtDue)}</span>
                    </div>
                  )}
                  {schedule.poaRequired && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">1st payment on account ({schedule.nextTaxYear})</span>
                      <span className="font-medium">{fmt(schedule.poaAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-slate-100 pt-1">
                    <span>Total due</span>
                    <span>{fmt(grandTotalAtBalancingPayment)}</span>
                  </div>
                </div>
              </div>

              {schedule.poaRequired && (
                <div className="rounded-xl bg-white border border-slate-100 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{fmtDate(schedule.poa2Date)}</p>
                  <div className="mt-1 flex justify-between text-sm font-bold">
                    <span>2nd payment on account ({schedule.nextTaxYear})</span>
                    <span>{fmt(schedule.dueAtPoa2)}</span>
                  </div>
                </div>
              )}

              {propertyCgtDue > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Separately reported</p>
                  <div className="mt-1 flex justify-between text-sm font-bold text-amber-800">
                    <span>Capital Gains Tax (property, via 60-day service)</span>
                    <span>{fmt(propertyCgtDue)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Approve / Query Buttons */}
        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:hidden">
            <h2 className="text-lg font-bold text-slate-900 text-center">
              Do these figures look correct?
            </h2>
            <p className="text-sm text-slate-500 text-center mt-1">
              Please approve below, or raise a query if anything needs checking.
            </p>

            <div className="mt-6 flex gap-4 justify-center">
              <form action={approveWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-green-600 px-8 py-3 text-sm font-bold text-white hover:bg-green-700 transition-colors"
                >
                  ✓ Approve
                </button>
              </form>

              <form action={queryWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-white border border-slate-200 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  I Have a Question
                </button>
              </form>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          This computation was prepared by {firmName} · {comp.tax_year} · This is an estimate for approval purposes and does not constitute a filed return.
        </p>

      </div>
    </div>
  );
}
