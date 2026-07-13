import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculateP11D, P11D_RATES } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateComputation(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  await supabase.from("p11d_computations").update({
    employee_name: get("employee_name"),
    tax_year: get("tax_year") || "2026/27",
    car_list_price: num("car_list_price"),
    car_benefit_percentage: num("car_benefit_percentage"),
    car_capital_contribution: num("car_capital_contribution"),
    car_available_days: parseInt(get("car_available_days")) || 365,
    fuel_provided: formData.get("fuel_provided") === "on",
    fuel_benefit_multiplier: num("fuel_benefit_multiplier") || P11D_RATES.defaultFuelMultiplier,
    medical_premium: num("medical_premium"),
    medical_employee_contribution: num("medical_employee_contribution"),
    loan_balance: num("loan_balance"),
    loan_interest_paid: num("loan_interest_paid"),
    official_rate_of_interest: num("official_rate_of_interest") || P11D_RATES.defaultOfficialRateOfInterest,
    other_benefits_description: get("other_benefits_description"),
    other_benefits_amount: num("other_benefits_amount"),
    notes: get("notes"),
  }).eq("id", id);

  revalidatePath(`/p11d/${id}`);
  revalidatePath("/p11d");
}

export default async function P11DDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("p11d_computations")
    .select("*, clients:client_id(client_name)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

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
  const updateWithId = updateComputation.bind(null, id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/p11d" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to P11D
        </a>
        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{comp.employee_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {(comp.clients as any)?.client_name || "No employer"} · {comp.tax_year}
            </p>
          </div>
          <div className="flex gap-3">
            <a href={`/p11d/${id}/summary`}
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              View P11D →
            </a>
            <a href={`/p11d/p11db?client=${comp.client_id}&tax_year=${encodeURIComponent(comp.tax_year)}`}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              View P11D(b) →
            </a>
          </div>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {/* Breakdown */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Benefits Breakdown</h2>
            <div className="mt-4 space-y-2 text-sm">
              {comp.car_list_price > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Company Car ({comp.car_benefit_percentage}% × {fmt(Number(comp.car_list_price))})</span>
                  <span className="font-medium">{fmt(result.carBenefit)}</span>
                </div>
              )}
              {result.fuelBenefit > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Car Fuel Benefit</span>
                  <span className="font-medium">{fmt(result.fuelBenefit)}</span>
                </div>
              )}
              {result.medicalBenefit > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Private Medical Insurance</span>
                  <span className="font-medium">{fmt(result.medicalBenefit)}</span>
                </div>
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
                <div className="flex justify-between">
                  <span className="text-slate-500">{comp.other_benefits_description || "Other Benefits"}</span>
                  <span className="font-medium">{fmt(result.otherBenefit)}</span>
                </div>
              )}
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-base">
                <span>Total Taxable Benefits</span>
                <span>{fmt(result.totalBenefits)}</span>
              </div>
              <div className="flex justify-between text-slate-500 pt-1">
                <span>Employer's Class 1A NIC ({(P11D_RATES.class1ANicRate * 100).toFixed(0)}%)</span>
                <span>{fmt(result.class1ANIC)}</span>
              </div>
            </div>
            {result.totalBenefits === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No taxable benefits recorded for this employee.</p>
            )}
          </div>

          {comp.employee_client_id && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Personal Tax</h2>
              <p className="text-sm text-slate-600 mt-2">
                Benefits in kind are taxed the same way as salary — add {fmt(result.totalBenefits)} on top of this employee's salary in Employment Income when preparing their Personal Tax return.
              </p>
              <a href={`/tax?client=${comp.employee_client_id}`}
                className="inline-block mt-3 text-sm font-semibold text-blue-600 hover:underline">
                Go to Personal Tax →
              </a>
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
            <h2 className="text-lg font-bold">Total Taxable Benefits</h2>
            <p className="mt-4 text-3xl font-bold">{fmt(result.totalBenefits)}</p>
            <p className="mt-1 text-sm text-slate-300">Employer Class 1A NIC: {fmt(result.class1ANIC)}</p>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              Working paper only, not a filable P11D or P11D(b). Company car benefit % must be looked up from HMRC's current CO2-based table — this tool doesn't encode it. Fuel multiplier and official rate of interest are editable defaults — confirm against GOV.UK before relying on them.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Computation</h2>
            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Employee/Director Name</label>
                <input name="employee_name" required defaultValue={comp.employee_name}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <p className="text-xs font-bold text-slate-900 pt-2">Company Car</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">List Price (£)</label>
                <input name="car_list_price" type="number" step="0.01" min="0" defaultValue={comp.car_list_price}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Benefit %</label>
                <input name="car_benefit_percentage" type="number" step="0.01" min="0" max="37" defaultValue={comp.car_benefit_percentage}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Capital Contribution (£)</label>
                <input name="car_capital_contribution" type="number" step="0.01" min="0" defaultValue={comp.car_capital_contribution}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Days Available</label>
                <input name="car_available_days" type="number" min="0" max="365" defaultValue={comp.car_available_days}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input name="fuel_provided" type="checkbox" defaultChecked={comp.fuel_provided} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700">Private fuel provided</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fuel Benefit Multiplier (£)</label>
                <input name="fuel_benefit_multiplier" type="number" step="0.01" min="0" defaultValue={comp.fuel_benefit_multiplier}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <p className="text-xs font-bold text-slate-900 pt-2">Medical</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Premium (£)</label>
                <input name="medical_premium" type="number" step="0.01" min="0" defaultValue={comp.medical_premium}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Employee Contribution (£)</label>
                <input name="medical_employee_contribution" type="number" step="0.01" min="0" defaultValue={comp.medical_employee_contribution}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <p className="text-xs font-bold text-slate-900 pt-2">Beneficial Loan</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Loan Balance (£)</label>
                <input name="loan_balance" type="number" step="0.01" min="0" defaultValue={comp.loan_balance}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Interest Paid (£)</label>
                <input name="loan_interest_paid" type="number" step="0.01" min="0" defaultValue={comp.loan_interest_paid}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Official Rate (%)</label>
                <input name="official_rate_of_interest" type="number" step="0.01" min="0" defaultValue={comp.official_rate_of_interest}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <p className="text-xs font-bold text-slate-900 pt-2">Other</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <input name="other_benefits_description" defaultValue={comp.other_benefits_description || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (£)</label>
                <input name="other_benefits_amount" type="number" step="0.01" min="0" defaultValue={comp.other_benefits_amount}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={comp.notes || ""} rows={2}
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
