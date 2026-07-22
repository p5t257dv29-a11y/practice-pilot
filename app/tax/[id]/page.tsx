import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculateTax, getPaymentSchedule } from "../page";
import SendComputationButton from "./send-computation-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateComputation(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const { data: existing } = await supabase.from("tax_computations").select("tax_year").eq("id", id).single();

  const input = {
    employmentIncome: num("employment_income"),
    selfEmploymentIncome: num("self_employment_income"),
    rentalIncome: num("rental_income"),
    propertyExpenses: num("property_expenses"),
    propertyFinanceCosts: num("property_finance_costs"),
    financeCostsBf: num("finance_costs_bf"),
    pensionIncome: num("pension_income"),
    interestIncome: num("interest_income"),
    dividendIncome: num("dividend_income"),
    foreignEmploymentIncome: num("foreign_employment_income"),
    foreignInterestIncome: num("foreign_interest_income"),
    foreignDividendIncome: num("foreign_dividend_income"),
    foreignRentalIncome: num("foreign_rental_income"),
    foreignPropertyExpenses: num("foreign_property_expenses"),
    foreignPropertyFinanceCosts: num("foreign_property_finance_costs"),
    foreignFinanceCostsBf: num("foreign_finance_costs_bf"),
    foreignTaxPaid: num("foreign_tax_paid"),
    taxYear: existing?.tax_year || "2026/27",
  };
  const result = calculateTax(input);

  await supabase.from("tax_computations").update({
    employment_income: input.employmentIncome,
    self_employment_income: input.selfEmploymentIncome,
    rental_income: input.rentalIncome,
    property_expenses: input.propertyExpenses,
    property_finance_costs: input.propertyFinanceCosts,
    finance_costs_bf: input.financeCostsBf,
    finance_costs_cf: result.unusedFinanceCostsCf,
    pension_income: input.pensionIncome,
    interest_income: input.interestIncome,
    dividend_income: input.dividendIncome,
    foreign_employment_income: input.foreignEmploymentIncome,
    foreign_interest_income: input.foreignInterestIncome,
    foreign_dividend_income: input.foreignDividendIncome,
    foreign_rental_income: input.foreignRentalIncome,
    foreign_property_expenses: input.foreignPropertyExpenses,
    foreign_property_finance_costs: input.foreignPropertyFinanceCosts,
    foreign_finance_costs_bf: input.foreignFinanceCostsBf,
    foreign_finance_costs_cf: result.unusedForeignFinanceCostsCf,
    foreign_tax_paid: input.foreignTaxPaid,
    tax_paid_at_source: num("tax_paid_at_source"),
    notes: get("notes"),
  }).eq("id", id);

  revalidatePath(`/tax/${id}`);
  revalidatePath("/tax");
}

export default async function TaxComputationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("tax_computations")
    .select("*, clients(client_name, email)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

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
  });

  const balanceDue = result.totalLiability - Number(comp.tax_paid_at_source);
  const schedule = getPaymentSchedule(comp.tax_year, result.totalLiability, Number(comp.tax_paid_at_source));
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const hasForeignIncome = Number(comp.foreign_employment_income) > 0 || Number(comp.foreign_interest_income) > 0 ||
    Number(comp.foreign_dividend_income) > 0 || Number(comp.foreign_rental_income) > 0 || Number(comp.foreign_finance_costs_bf) > 0;
  const hasPropertyIncome = Number(comp.rental_income) > 0 || Number(comp.finance_costs_bf) > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/tax" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Tax
        </a>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">
            {comp.clients?.client_name || "No client"}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Tax Year {comp.tax_year}</p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        {/* Left - breakdown */}
        <div className="lg:col-span-2 space-y-6">

          {/* Income Summary */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Income Summary</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Employment Income</span><span className="font-medium">{fmt(Number(comp.employment_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Self-Employment Profit</span><span className="font-medium">{fmt(Number(comp.self_employment_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Rental Property Profit</span><span className="font-medium">{fmt(result.propertyProfit)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pension Income</span><span className="font-medium">{fmt(Number(comp.pension_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Interest Received</span><span className="font-medium">{fmt(Number(comp.interest_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Dividend Income</span><span className="font-medium">{fmt(Number(comp.dividend_income))}</span></div>
              {hasForeignIncome && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Employment Income</span><span className="font-medium">{fmt(Number(comp.foreign_employment_income))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Rental Property Profit</span><span className="font-medium">{fmt(result.foreignPropertyProfit)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Interest</span><span className="font-medium">{fmt(Number(comp.foreign_interest_income))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Foreign Dividends</span><span className="font-medium">{fmt(Number(comp.foreign_dividend_income))}</span></div>
                </>
              )}
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Total Gross Income</span>
                <span>{fmt(result.nonDividendIncome + Number(comp.interest_income) + Number(comp.foreign_interest_income) + Number(comp.dividend_income) + Number(comp.foreign_dividend_income))}</span>
              </div>
            </div>
          </div>

          {/* Property Income & Finance Costs */}
          {hasPropertyIncome && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Rental Property & Finance Costs</h2>
              <p className="text-xs text-slate-400 mt-1">
                Finance costs don't reduce property profit — they generate a 20% tax reducer, capped by the lower of finance costs, property profit, and adjusted total income.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Gross Rental Income</span><span className="font-medium">{fmt(Number(comp.rental_income))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Allowable Property Expenses</span><span className="font-medium">({fmt(Number(comp.property_expenses))})</span></div>
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                  <span>Property Profit</span>
                  <span>{fmt(result.propertyProfit)}</span>
                </div>

                <div className="border-t border-slate-100 pt-3 mt-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Finance Cost Relief</p>
                  <div className="flex justify-between"><span className="text-slate-500">Finance costs for the year</span><span className="font-medium">{fmt(Number(comp.property_finance_costs))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Unused finance costs b/f</span><span className="font-medium">{fmt(Number(comp.finance_costs_bf))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total available</span><span className="font-medium">{fmt(result.totalFinanceCostsAvailable)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Adjusted total income (cap)</span><span className="font-medium">{fmt(result.adjustedTotalIncome)}</span></div>
                  <div className="flex justify-between font-medium"><span className="text-slate-700">Relief given (lower of the above, x property profit)</span><span>{fmt(result.financeCostReliefCap)}</span></div>
                  <div className="flex justify-between font-bold text-green-600">
                    <span>Tax reducer (20%)</span>
                    <span>−{fmt(result.financeCostTaxReducer)}</span>
                  </div>
                </div>

                {result.unusedFinanceCostsCf > 0 && (
                  <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3">
                    <p className="text-sm font-bold text-amber-800">
                      {fmt(result.unusedFinanceCostsCf)} unused finance costs carried forward to {(() => {
                        const y = parseInt(comp.tax_year.split("/")[0], 10);
                        return `${y + 1}/${String(y + 2).slice(-2)}`;
                      })()}
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      This will be picked up automatically if next year's computation is started for this client from the New Computation screen.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Foreign Rental Property & Finance Costs */}
          {(Number(comp.foreign_rental_income) > 0 || Number(comp.foreign_finance_costs_bf) > 0) && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Foreign Rental Property & Finance Costs</h2>
              <p className="text-xs text-slate-400 mt-1">
                Kept as a separate business from UK property, but the same finance cost restriction and carry-forward mechanism applies.
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Gross Foreign Rental Income</span><span className="font-medium">{fmt(Number(comp.foreign_rental_income))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Allowable Property Expenses</span><span className="font-medium">({fmt(Number(comp.foreign_property_expenses))})</span></div>
                <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                  <span>Foreign Property Profit</span>
                  <span>{fmt(result.foreignPropertyProfit)}</span>
                </div>

                <div className="border-t border-slate-100 pt-3 mt-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Finance Cost Relief</p>
                  <div className="flex justify-between"><span className="text-slate-500">Finance costs for the year</span><span className="font-medium">{fmt(Number(comp.foreign_property_finance_costs))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Unused finance costs b/f</span><span className="font-medium">{fmt(Number(comp.foreign_finance_costs_bf))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total available</span><span className="font-medium">{fmt(result.totalForeignFinanceCostsAvailable)}</span></div>
                  <div className="flex justify-between font-medium"><span className="text-slate-700">Relief given</span><span>{fmt(result.foreignFinanceCostReliefCap)}</span></div>
                  <div className="flex justify-between font-bold text-green-600">
                    <span>Tax reducer (20%)</span>
                    <span>−{fmt(result.foreignFinanceCostTaxReducer)}</span>
                  </div>
                </div>

                {result.unusedForeignFinanceCostsCf > 0 && (
                  <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3">
                    <p className="text-sm font-bold text-amber-800">
                      {fmt(result.unusedForeignFinanceCostsCf)} unused foreign finance costs carried forward
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Picked up automatically when next year's computation is started for this client.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Foreign Tax Credit Relief */}
          {Number(comp.foreign_tax_paid) > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Foreign Tax Credit Relief</h2>
              <p className="text-xs text-slate-400 mt-1">
                Relief for foreign tax already paid is capped at the lower of the foreign tax suffered and the UK tax attributable to the foreign income (estimated by comparing the computation with and without the foreign income).
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Foreign tax paid</span><span className="font-medium">{fmt(Number(comp.foreign_tax_paid))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">UK tax attributable to foreign income</span><span className="font-medium">{fmt(result.ukTaxOnForeignIncome)}</span></div>
                <div className="flex justify-between font-bold text-green-600 border-t border-slate-100 pt-2">
                  <span>Credit relief given</span>
                  <span>−{fmt(result.foreignTaxCreditRelief)}</span>
                </div>
                {result.unusedForeignTaxCredit > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    £{result.unusedForeignTaxCredit.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of foreign tax paid exceeds the UK tax due on that income and cannot be relieved (not carried forward under UK rules).
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Income Tax Breakdown */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Income Tax Breakdown</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Personal Allowance {result.personalAllowance < 12570 ? "(tapered)" : ""}</span><span className="font-medium">{fmt(result.personalAllowance)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Taxable Non-Dividend Income</span><span className="font-medium">{fmt(result.taxableNonDividend)}</span></div>

              <div className="border-t border-slate-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Non-Dividend Income Tax</p>
                {result.bands.basicBandNonDiv > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Basic rate (20%) on {fmt(result.bands.basicBandNonDiv)}</span><span className="font-medium">{fmt(result.bands.basicBandNonDiv * 0.20)}</span></div>
                )}
                {result.bands.higherBandNonDiv > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Higher rate (40%) on {fmt(result.bands.higherBandNonDiv)}</span><span className="font-medium">{fmt(result.bands.higherBandNonDiv * 0.40)}</span></div>
                )}
                {result.bands.additionalBandNonDiv > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Additional rate (45%) on {fmt(result.bands.additionalBandNonDiv)}</span><span className="font-medium">{fmt(result.bands.additionalBandNonDiv * 0.45)}</span></div>
                )}
                {result.financeCostTaxReducer > 0 && (
                  <div className="flex justify-between text-green-600 font-medium"><span>Less: UK property finance cost tax reducer</span><span>−{fmt(result.financeCostTaxReducer)}</span></div>
                )}
                {result.foreignFinanceCostTaxReducer > 0 && (
                  <div className="flex justify-between text-green-600 font-medium"><span>Less: foreign property finance cost tax reducer</span><span>−{fmt(result.foreignFinanceCostTaxReducer)}</span></div>
                )}
                <div className="flex justify-between font-medium border-t border-slate-50 pt-1 mt-1">
                  <span>Non-dividend tax after reducer{result.foreignTaxCreditRelief > 0 ? "s" : ""}</span>
                  <span>{fmt(result.nonDividendTax)}</span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Savings (Interest) Tax</p>
                {result.startingRateUsed > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Starting rate (0%) on {fmt(result.startingRateUsed)}</span><span className="font-medium">{fmt(0)}</span></div>
                )}
                {result.psaUsed > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Personal Savings Allowance used</span><span className="font-medium">{fmt(result.psaUsed)}</span></div>
                )}
                {result.bands.savingsBasic > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Basic rate (20%) on {fmt(result.bands.savingsBasic)}</span><span className="font-medium">{fmt(result.bands.savingsBasic * 0.20)}</span></div>
                )}
                {result.bands.savingsHigher > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Higher rate (40%) on {fmt(result.bands.savingsHigher)}</span><span className="font-medium">{fmt(result.bands.savingsHigher * 0.40)}</span></div>
                )}
                {result.bands.savingsAdditional > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Additional rate (45%) on {fmt(result.bands.savingsAdditional)}</span><span className="font-medium">{fmt(result.bands.savingsAdditional * 0.45)}</span></div>
                )}
                {Number(comp.interest_income) === 0 && Number(comp.foreign_interest_income) === 0 && (
                  <p className="text-xs text-slate-400">No interest received.</p>
                )}
              </div>

              <div className="border-t border-slate-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Dividend Tax</p>
                <div className="flex justify-between"><span className="text-slate-500">Dividend allowance used</span><span className="font-medium">{fmt(result.dividendAllowanceUsed)}</span></div>
                {result.bands.divBasic > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Basic rate (10.75%) on {fmt(result.bands.divBasic)}</span><span className="font-medium">{fmt(result.bands.divBasic * 0.1075)}</span></div>
                )}
                {result.bands.divHigher > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Higher rate (35.75%) on {fmt(result.bands.divHigher)}</span><span className="font-medium">{fmt(result.bands.divHigher * 0.3575)}</span></div>
                )}
                {result.bands.divAdditional > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Additional rate (39.35%) on {fmt(result.bands.divAdditional)}</span><span className="font-medium">{fmt(result.bands.divAdditional * 0.3935)}</span></div>
                )}
              </div>

              {result.foreignTaxCreditRelief > 0 && (
                <div className="border-t border-slate-100 pt-2 mt-2 flex justify-between text-green-600 font-medium">
                  <span>Less: Foreign Tax Credit Relief</span>
                  <span>−{fmt(result.foreignTaxCreditRelief)}</span>
                </div>
              )}

              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Total Income Tax</span>
                <span>{fmt(result.totalIncomeTax)}</span>
              </div>
            </div>
          </div>

          {/* Class 4 NI */}
          {Number(comp.self_employment_income) > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Class 4 National Insurance</h2>
              <p className="text-xs text-slate-400 mt-1">
                Calculated on self-employment profit only (6% between £12,570–£50,270, 2% above).
              </p>
              <div className="mt-4 flex justify-between text-sm font-bold">
                <span>Class 4 NI Due</span>
                <span>{fmt(result.class4NI)}</span>
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

        {/* Right - totals */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-slate-900 p-6 shadow-sm text-white">
            <h2 className="text-lg font-bold">Total Liability</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-300">Income Tax</span><span>{fmt(result.totalIncomeTax)}</span></div>
              <div className="flex justify-between"><span className="text-slate-300">Class 4 NI</span><span>{fmt(result.class4NI)}</span></div>
              <div className="border-t border-slate-700 pt-2 flex justify-between font-bold text-base">
                <span>Total Due</span>
                <span>{fmt(result.totalLiability)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Balance</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Total Liability</span><span className="font-medium">{fmt(result.totalLiability)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Already Paid (PAYE)</span><span className="font-medium">{fmt(Number(comp.tax_paid_at_source))}</span></div>
              <div className={`border-t border-slate-100 pt-2 flex justify-between font-bold ${balanceDue >= 0 ? "text-slate-900" : "text-green-600"}`}>
                <span>{balanceDue >= 0 ? "Balance Due" : "Refund Due"}</span>
                <span>{fmt(Math.abs(balanceDue))}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Send to Client</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Send this computation by email for digital approval.
            </p>
            <div className="mt-4">
              <SendComputationButton
                computationId={id}
                defaultEmail={comp.client_email || comp.clients?.email || ""}
                computationToken={comp.token}
                status={comp.status}
                approvedAt={comp.approved_at}
                queriedAt={comp.queried_at}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Payment Schedule</h2>
            <p className="text-xs text-slate-400 mt-1">
              {schedule.poaRequired
                ? `Payments on account towards ${schedule.nextTaxYear} are required (SA bill over £1,000 and less than 80% collected at source).`
                : "No payments on account required for the following year."}
            </p>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {fmtDate(schedule.balancingPaymentDate)}
                </p>
                <div className="mt-1 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Balancing payment ({comp.tax_year})</span>
                    <span className="font-medium">{fmt(schedule.balanceDue)}</span>
                  </div>
                  {schedule.poaRequired && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">1st payment on account ({schedule.nextTaxYear})</span>
                      <span className="font-medium">{fmt(schedule.poaAmount)}</span>
                    </div>
                  )}
                  <div className="border-t border-slate-100 pt-1 flex justify-between font-bold">
                    <span>Total due</span>
                    <span>{fmt(schedule.dueAtBalancingPayment)}</span>
                  </div>
                </div>
              </div>

              {schedule.poaRequired && (
                <div className="rounded-xl border border-slate-100 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {fmtDate(schedule.poa2Date)}
                  </p>
                  <div className="mt-1 flex justify-between text-sm font-bold">
                    <span>2nd payment on account ({schedule.nextTaxYear})</span>
                    <span>{fmt(schedule.dueAtPoa2)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              This is an estimate based on {comp.tax_year} rates for England, Wales & Northern Ireland. It does not account for pension contributions, Gift Aid, marriage allowance, student loans, the High Income Child Benefit Charge, property income losses, or Scottish tax rates. Always verify before filing.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Computation</h2>
            <p className="text-sm text-slate-500 mt-0.5">Update income figures and recalculate.</p>
            <form action={updateComputation.bind(null, id)} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Employment Income (£)</label>
                <input name="employment_income" type="number" step="0.01" min="0" defaultValue={comp.employment_income}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Self-Employment Profit (£)</label>
                <input name="self_employment_income" type="number" step="0.01" min="0" defaultValue={comp.self_employment_income}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pension Income (£)</label>
                <input name="pension_income" type="number" step="0.01" min="0" defaultValue={comp.pension_income}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Interest Received (£)</label>
                <input name="interest_income" type="number" step="0.01" min="0" defaultValue={comp.interest_income}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Dividend Income (£)</label>
                <input name="dividend_income" type="number" step="0.01" min="0" defaultValue={comp.dividend_income}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Rental Property</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Gross Rental Income (£)</label>
                    <input name="rental_income" type="number" step="0.01" min="0" defaultValue={comp.rental_income}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Allowable Property Expenses (£)</label>
                    <input name="property_expenses" type="number" step="0.01" min="0" defaultValue={comp.property_expenses}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Finance Costs for the Year (£)</label>
                    <input name="property_finance_costs" type="number" step="0.01" min="0" defaultValue={comp.property_finance_costs}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Unused Finance Costs B/F (£)</label>
                    <input name="finance_costs_bf" type="number" step="0.01" min="0" defaultValue={comp.finance_costs_bf}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Foreign Income</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Employment Income (£)</label>
                    <input name="foreign_employment_income" type="number" step="0.01" min="0" defaultValue={comp.foreign_employment_income}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Interest (£)</label>
                    <input name="foreign_interest_income" type="number" step="0.01" min="0" defaultValue={comp.foreign_interest_income}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Dividends (£)</label>
                    <input name="foreign_dividend_income" type="number" step="0.01" min="0" defaultValue={comp.foreign_dividend_income}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Tax Paid (£)</label>
                    <input name="foreign_tax_paid" type="number" step="0.01" min="0" defaultValue={comp.foreign_tax_paid}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Gross Foreign Rental Income (£)</label>
                    <input name="foreign_rental_income" type="number" step="0.01" min="0" defaultValue={comp.foreign_rental_income}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Property Expenses (£)</label>
                    <input name="foreign_property_expenses" type="number" step="0.01" min="0" defaultValue={comp.foreign_property_expenses}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Property Finance Costs (£)</label>
                    <input name="foreign_property_finance_costs" type="number" step="0.01" min="0" defaultValue={comp.foreign_property_finance_costs}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Finance Costs B/F (£)</label>
                    <input name="foreign_finance_costs_bf" type="number" step="0.01" min="0" defaultValue={comp.foreign_finance_costs_bf}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Paid at Source / PAYE (£)</label>
                <input name="tax_paid_at_source" type="number" step="0.01" min="0" defaultValue={comp.tax_paid_at_source}
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
