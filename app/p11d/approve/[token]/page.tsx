import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { calculateP11D, P11D_RATES } from "../../page";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function approveComputation(token: string) {
  "use server";
  await supabase
    .from("p11d_computations")
    .update({ status: "Approved", approved_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/p11d/approve/${token}`);
}

async function queryComputation(token: string) {
  "use server";
  await supabase
    .from("p11d_computations")
    .update({ status: "Queried", queried_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/p11d/approve/${token}`);
}

export default async function PublicP11DPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: comp, error } = await supabase
    .from("p11d_computations")
    .select("*, clients!p11d_computations_client_id_fkey(client_name)")
    .eq("token", token)
    .single();

  if (error || !comp) {
    console.error("P11D approve page lookup failed:", { token, error });
    notFound();
  }

  const approveWithToken = approveComputation.bind(null, token);
  const queryWithToken = queryComputation.bind(null, token);

  const isApproved = comp.status === "Approved";
  const isQueried = comp.status === "Queried";
  const isResponded = isApproved || isQueried;

  const result = calculateP11D({
    carListPrice: Number(comp.car_list_price),
    carBenefitPercentage: Number(comp.car_benefit_percentage),
    carCapitalContribution: Number(comp.car_capital_contribution),
    carAvailableDays: Number(comp.car_available_days),
    fuelProvided: comp.fuel_provided,
    fuelBenefitMultiplier: Number(comp.fuel_benefit_multiplier),
    medicalPremium: Number(comp.medical_premium),
    medicalEmployeeContribution: Number(comp.medical_employee_contribution),
    loanBalance: Number(comp.loan_balance),
    loanInterestPaid: Number(comp.loan_interest_paid),
    officialRateOfInterest: Number(comp.official_rate_of_interest),
    otherBenefitsAmount: Number(comp.other_benefits_amount),
  });

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDateTime = (d: string) =>
    `${new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at ${new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-slate-900 text-white px-8 py-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">E&P Accountancy Services</h1>
            <p className="text-slate-400 text-sm mt-0.5">Practice Management</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400">P11D — Benefits in Kind</p>
            <p className="font-bold text-lg">{comp.tax_year}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        {isApproved && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center">
            <p className="text-green-700 font-bold text-lg">✓ P11D Approved</p>
            <p className="text-green-600 text-sm mt-1">Thank you! We'll proceed to file this.</p>
            {comp.approved_at && (
              <p className="text-green-500 text-xs mt-2">Approved on {fmtDateTime(comp.approved_at)}</p>
            )}
          </div>
        )}

        {isQueried && (
          <div className="mb-6 rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-center">
            <p className="text-yellow-700 font-bold text-lg">Query Raised</p>
            <p className="text-yellow-600 text-sm mt-1">Thanks for letting us know. We'll be in touch to go through it with you.</p>
            {comp.queried_at && (
              <p className="text-yellow-500 text-xs mt-2">Raised on {fmtDateTime(comp.queried_at)}</p>
            )}
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Prepared for</p>
            <p className="mt-1 font-bold text-slate-900 text-lg">{comp.employee_name}</p>
            <p className="text-sm text-slate-500 mt-0.5">{comp.clients?.client_name || "Employer"}</p>
          </div>

          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Benefits Breakdown</h2>
            <div className="space-y-2 text-sm">
              {Number(comp.car_list_price) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Company Car ({comp.car_benefit_percentage}% × {fmt(Number(comp.car_list_price))})</span>
                  <span className="font-medium">{fmt(result.carBenefit)}</span>
                </div>
              )}
              {result.fuelBenefit > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Car Fuel Benefit</span><span className="font-medium">{fmt(result.fuelBenefit)}</span></div>
              )}
              {result.medicalBenefit > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Private Medical Insurance</span><span className="font-medium">{fmt(result.medicalBenefit)}</span></div>
              )}
              {Number(comp.loan_balance) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">
                    Beneficial Loan {Number(comp.loan_balance) <= P11D_RATES.loanDeMinimis && "(under £10,000 de minimis — no benefit)"}
                  </span>
                  <span className="font-medium">{fmt(result.loanBenefit)}</span>
                </div>
              )}
              {result.otherBenefit > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">{comp.other_benefits_description || "Other Benefits"}</span><span className="font-medium">{fmt(result.otherBenefit)}</span></div>
              )}
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Total Taxable Benefits</span>
                <span>{fmt(result.totalBenefits)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Employer's Class 1A NIC ({(P11D_RATES.class1ANicRate * 100).toFixed(0)}%)</span>
                <span>{fmt(result.class1ANIC)}</span>
              </div>
            </div>
          </div>
        </div>

        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900 text-center">Do these figures look correct?</h2>
            <p className="text-sm text-slate-500 text-center mt-1">Please approve below, or raise a query if anything needs checking.</p>

            <div className="mt-6 flex gap-4 justify-center">
              <form action={approveWithToken}>
                <button type="submit" className="rounded-xl bg-green-600 px-8 py-3 text-sm font-bold text-white hover:bg-green-700 transition-colors">
                  ✓ Approve
                </button>
              </form>
              <form action={queryWithToken}>
                <button type="submit" className="rounded-xl bg-white border border-slate-200 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                  I Have a Question
                </button>
              </form>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          This document was prepared by E&P Accountancy Services · {comp.tax_year} · Working paper for approval purposes only, not a filed P11D or P11D(b).
        </p>
      </div>
    </div>
  );
}