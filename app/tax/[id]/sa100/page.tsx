import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateTax, getPaymentSchedule } from "../../page";
import PrintButton from "../../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function SA100SummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("tax_computations")
    .select("*, clients(client_name, hmrc_utr)")
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

  const schedule = getPaymentSchedule(comp.tax_year, result.totalLiability, Number(comp.tax_paid_at_source));

  const client = comp.clients as any;
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const Box = ({ number, label, value, note }: { number: string; label: string; value: string; note?: string }) => (
    <div className="flex items-start justify-between border-b border-slate-100 py-2.5 gap-4">
      <div className="flex items-start gap-3 flex-1">
        <span className="text-xs font-mono font-bold text-slate-400 mt-0.5 w-12 flex-shrink-0">{number}</span>
        <div>
          <p className="text-sm text-slate-700">{label}</p>
          {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
        </div>
      </div>
      <span className="text-sm font-mono font-semibold text-slate-900 flex-shrink-0">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <div className="flex items-center justify-between">
          <a href={`/tax/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to Computation
          </a>
          <PrintButton />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">SA100 Summary</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Mirrors the HMRC Self Assessment tax return's box structure. For working papers and review — use your browser's print function (⌘P) to save as PDF.
        </p>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none">

          {/* Header */}
          <div className="bg-slate-900 text-white px-6 py-5 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
            <p className="text-xs text-slate-400 uppercase tracking-wide print:text-slate-500">Self Assessment Tax Return</p>
            <h2 className="text-lg font-bold mt-1">SA100 Summary</h2>
          </div>

          {/* Taxpayer details */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Taxpayer Details</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs">Name</p>
                <p className="font-medium text-slate-900">{client?.client_name || "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Unique Taxpayer Reference (UTR)</p>
                <p className="font-medium text-slate-900">{client?.hmrc_utr || "Not on file"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Tax Year</p>
                <p className="font-medium text-slate-900">{comp.tax_year}</p>
              </div>
            </div>
          </div>

          {/* Employment */}
          {Number(comp.employment_income) > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Employment (SA102)</p>
              <Box number="1" label="Pay from this employment — total from P60" value={`£${fmt(Number(comp.employment_income))}`} />
              <Box number="2" label="UK tax taken off pay in box 1" value={`£${fmt(Number(comp.tax_paid_at_source))}`} />
            </div>
          )}

          {/* Self Employment */}
          {Number(comp.self_employment_income) > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Self-Employment (SA103)</p>
              <Box number="31" label="Net profit" value={`£${fmt(Number(comp.self_employment_income))}`}
                note="Assumed already adjusted for allowable expenses — not separately tracked by this system" />
            </div>
          )}

          {/* UK Property */}
          {(Number(comp.rental_income) > 0 || Number(comp.finance_costs_bf) > 0) && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">UK Property (SA105)</p>
              <Box number="20" label="Total rents and other income from property" value={`£${fmt(Number(comp.rental_income))}`} />
              <Box number="24" label="Property expenses" value={`£${fmt(Number(comp.property_expenses))}`} note="Excludes finance costs" />
              <Box number="26" label="Net profit" value={`£${fmt(result.propertyProfit)}`} />
              <Box number="44" label="Residential property finance costs" value={`£${fmt(Number(comp.property_finance_costs))}`} />
              {Number(comp.finance_costs_bf) > 0 && (
                <Box number="45" label="Unused residential finance costs brought forward" value={`£${fmt(Number(comp.finance_costs_bf))}`} />
              )}
              {result.unusedFinanceCostsCf > 0 && (
                <Box number="—" label="Unused finance costs carried forward" value={`£${fmt(result.unusedFinanceCostsCf)}`} />
              )}
            </div>
          )}

          {/* Foreign */}
          {(Number(comp.foreign_employment_income) > 0 || Number(comp.foreign_interest_income) > 0 || Number(comp.foreign_dividend_income) > 0 || result.foreignPropertyProfit > 0) && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Foreign (SA106)</p>
              {Number(comp.foreign_employment_income) > 0 && (
                <Box number="1" label="Foreign employment income" value={`£${fmt(Number(comp.foreign_employment_income))}`} />
              )}
              {Number(comp.foreign_interest_income) > 0 && (
                <Box number="3" label="Foreign interest" value={`£${fmt(Number(comp.foreign_interest_income))}`} />
              )}
              {Number(comp.foreign_dividend_income) > 0 && (
                <Box number="6" label="Foreign dividends" value={`£${fmt(Number(comp.foreign_dividend_income))}`} />
              )}
              {result.foreignPropertyProfit > 0 && (
                <Box number="7" label="Foreign property net profit" value={`£${fmt(result.foreignPropertyProfit)}`} />
              )}
              {Number(comp.foreign_tax_paid) > 0 && (
                <Box number="2" label="Foreign tax paid on employment/other income" value={`£${fmt(Number(comp.foreign_tax_paid))}`} />
              )}
            </div>
          )}

          {/* Pension */}
          {Number(comp.pension_income) > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Pensions (Main Return)</p>
              <Box number="8" label="State Pension and other pension income" value={`£${fmt(Number(comp.pension_income))}`} />
            </div>
          )}

          {/* Interest and dividends */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Interest and Dividends (Main Return)</p>
            <Box number="2" label="UK interest — banks, building societies etc." value={`£${fmt(Number(comp.interest_income))}`} />
            <Box number="4" label="UK dividends" value={`£${fmt(Number(comp.dividend_income))}`} />
          </div>

          {/* Taxable income summary */}
          <div className="p-6 border-b border-slate-100 bg-slate-50 print:bg-white">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Taxable Income Summary (not official box numbers — see workings)</p>
            <Box number="—" label="Personal Allowance" value={`£${fmt(result.personalAllowance)}`}
              note={result.personalAllowance < 12570 ? "Tapered — total income exceeds £100,000" : undefined} />
            <Box number="—" label="Taxable non-savings, non-dividend income" value={`£${fmt(result.taxableNonDividend)}`} />
            <Box number="—" label="Taxable savings income" value={`£${fmt(result.taxableSavings)}`}
              note={result.startingRateUsed > 0 || result.psaUsed > 0 ? `After £${fmt(result.startingRateUsed)} starting rate band and £${fmt(result.psaUsed)} Personal Savings Allowance` : undefined} />
            <Box number="—" label="Taxable dividend income" value={`£${fmt(result.taxableDividends)}`}
              note={`After £${fmt(result.dividendAllowanceUsed)} dividend allowance`} />
          </div>

          {/* Tax calculation */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tax Calculation</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Tax on non-savings, non-dividend income</span><span className="font-medium">£{fmt(result.nonDividendTax)}</span></div>
              {(result.financeCostTaxReducer > 0 || result.foreignFinanceCostTaxReducer > 0) && (
                <div className="flex justify-between"><span className="text-slate-500">Less: property finance cost tax reducer (20%)</span><span className="font-medium text-red-600">(£{fmt(result.financeCostTaxReducer + result.foreignFinanceCostTaxReducer)})</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Tax on savings income</span><span className="font-medium">£{fmt(result.savingsTax)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Tax on dividend income</span><span className="font-medium">£{fmt(result.dividendTax)}</span></div>
              {result.foreignTaxCreditRelief > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Less: Foreign Tax Credit Relief</span><span className="font-medium text-red-600">(£{fmt(result.foreignTaxCreditRelief)})</span></div>
              )}
              <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base">
                <span>Income Tax Due</span>
                <span>£{fmt(result.totalIncomeTax)}</span>
              </div>
              {result.class4NI > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Class 4 National Insurance</span><span className="font-medium">£{fmt(result.class4NI)}</span></div>
              )}
              <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base">
                <span>Total Liability</span>
                <span>£{fmt(result.totalLiability)}</span>
              </div>
            </div>
          </div>

          {/* Reconciliation and payment schedule */}
          <div className="p-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Tax Payable and Payment Schedule</p>
            <Box number="—" label="Tax already paid at source (PAYE)" value={`£${fmt(Number(comp.tax_paid_at_source))}`} />
            <div className="flex justify-between border-t border-slate-200 pt-3 mt-2 font-bold text-base">
              <span>{schedule.balanceDue >= 0 ? "Balance Due" : "Overpaid"}</span>
              <span>£{fmt(Math.abs(schedule.balanceDue))}</span>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{fmtDate(schedule.balancingPaymentDate)}</p>
                <div className="mt-1 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Balancing payment ({comp.tax_year})</span>
                    <span className="font-medium">£{fmt(schedule.balanceDue)}</span>
                  </div>
                  {schedule.poaRequired && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">1st payment on account ({schedule.nextTaxYear})</span>
                      <span className="font-medium">£{fmt(schedule.poaAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-slate-200 pt-1">
                    <span>Total due</span>
                    <span>£{fmt(schedule.dueAtBalancingPayment)}</span>
                  </div>
                </div>
              </div>

              {schedule.poaRequired && (
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{fmtDate(schedule.poa2Date)}</p>
                  <div className="mt-1 flex justify-between text-sm font-bold">
                    <span>2nd payment on account ({schedule.nextTaxYear})</span>
                    <span>£{fmt(schedule.dueAtPoa2)}</span>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Payments on account apply where the balance due exceeds £1,000 and less than 80% of the year's liability was collected at source.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>This is a working-paper summary, not a filable return.</strong> It mirrors the official SA100 form's box numbers for the fields this system tracks, using 2026/27 HMRC rates and bands. It does not support electronic submission to HMRC — actual filing requires HMRC-recognised software. Boxes for capital gains, additional pension reliefs, Gift Aid, and other supplementary pages are not covered. Always verify all figures before filing, and use recognised commercial software or HMRC's own online service to submit.
          </p>
        </div>
      </div>
    </div>
  );
}