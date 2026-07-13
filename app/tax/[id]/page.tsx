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

  await supabase.from("tax_computations").update({
    employment_income: num("employment_income"),
    self_employment_income: num("self_employment_income"),
    rental_income: num("rental_income"),
    pension_income: num("pension_income"),
    interest_income: num("interest_income"),
    dividend_income: num("dividend_income"),
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
    pensionIncome: Number(comp.pension_income),
    interestIncome: Number(comp.interest_income),
    dividendIncome: Number(comp.dividend_income),
    taxYear: comp.tax_year,
  });

  const balanceDue = result.totalLiability - Number(comp.tax_paid_at_source);
  const schedule = getPaymentSchedule(comp.tax_year, result.totalLiability, Number(comp.tax_paid_at_source));
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

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
              <div className="flex justify-between"><span className="text-slate-500">Rental Income</span><span className="font-medium">{fmt(Number(comp.rental_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pension Income</span><span className="font-medium">{fmt(Number(comp.pension_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Interest Received</span><span className="font-medium">{fmt(Number(comp.interest_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Dividend Income</span><span className="font-medium">{fmt(Number(comp.dividend_income))}</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Total Gross Income</span>
                <span>{fmt(result.nonDividendIncome + Number(comp.interest_income) + Number(comp.dividend_income))}</span>
              </div>
            </div>
          </div>

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
                {Number(comp.interest_income) === 0 && (
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
              This is an estimate based on {comp.tax_year} rates for England, Wales & Northern Ireland. It does not account for pension contributions, Gift Aid, marriage allowance, student loans, the High Income Child Benefit Charge, or Scottish tax rates. Always verify before filing.
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Rental Income (£)</label>
                <input name="rental_income" type="number" step="0.01" min="0" defaultValue={comp.rental_income}
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
