import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { calculateTax, getPaymentSchedule } from "../../tax/page";

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

  const { data: comp, error } = await supabase
    .from("tax_computations")
    .select("*, clients(client_name)")
    .eq("token", token)
    .single();

  if (error || !comp) notFound();

  const approveWithToken = approveComputation.bind(null, token);
  const queryWithToken = queryComputation.bind(null, token);

  const isApproved = comp.status === "Approved";
  const isQueried = comp.status === "Queried";
  const isResponded = isApproved || isQueried;

  const result = calculateTax({
    employmentIncome: Number(comp.employment_income),
    selfEmploymentIncome: Number(comp.self_employment_income),
    rentalIncome: Number(comp.rental_income),
    pensionIncome: Number(comp.pension_income),
    interestIncome: Number(comp.interest_income),
    dividendIncome: Number(comp.dividend_income),
    taxYear: comp.tax_year,
  });
  const schedule = getPaymentSchedule(comp.tax_year, result.totalLiability, Number(comp.tax_paid_at_source));
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">E&P Accountancy Services</h1>
            <p className="text-slate-400 text-sm mt-0.5">Practice Management</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400">Tax Computation</p>
            <p className="font-bold text-lg">{comp.tax_year}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        {/* Status Banner */}
        {isApproved && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center">
            <p className="text-green-700 font-bold text-lg">✓ Computation Approved</p>
            <p className="text-green-600 text-sm mt-1">
              Thank you! We'll proceed to file your return.
            </p>
          </div>
        )}

        {isQueried && (
          <div className="mb-6 rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-center">
            <p className="text-yellow-700 font-bold text-lg">Query Raised</p>
            <p className="text-yellow-600 text-sm mt-1">
              Thanks for letting us know. We'll be in touch to go through it with you.
            </p>
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">

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
              <div className="flex justify-between"><span className="text-slate-500">Rental Income</span><span className="font-medium">{fmt(Number(comp.rental_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pension Income</span><span className="font-medium">{fmt(Number(comp.pension_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Interest Received</span><span className="font-medium">{fmt(Number(comp.interest_income))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Dividend Income</span><span className="font-medium">{fmt(Number(comp.dividend_income))}</span></div>
            </div>
          </div>

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

          {/* Payment Schedule */}
          <div className="p-6 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Payment Schedule</h2>
            <div className="space-y-3">
              <div className="rounded-xl bg-white border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{fmtDate(schedule.balancingPaymentDate)}</p>
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
                  <div className="flex justify-between font-bold border-t border-slate-100 pt-1">
                    <span>Total due</span>
                    <span>{fmt(schedule.dueAtBalancingPayment)}</span>
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
            </div>
          </div>
        </div>

        {/* Approve / Query Buttons */}
        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
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
          This computation was prepared by E&P Accountancy Services · {comp.tax_year} · This is an estimate for approval purposes and does not constitute a filed return.
        </p>

      </div>
    </div>
  );
}
