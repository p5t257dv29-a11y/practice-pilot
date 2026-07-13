import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateP11D, P11D_RATES } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function P11DBPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; tax_year?: string }>;
}) {
  const { client: clientId, tax_year: taxYear } = await searchParams;

  if (!clientId || !taxYear) notFound();

  const { data: client } = await supabase
    .from("clients")
    .select("client_name, company_number")
    .eq("id", clientId)
    .single();

  if (!client) notFound();

  const { data: computations } = await supabase
    .from("p11d_computations")
    .select("*")
    .eq("client_id", clientId)
    .eq("tax_year", taxYear);

  const rows = (computations || []).map((comp) => {
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
    return { comp, result };
  });

  const totalBenefits = rows.reduce((s, r) => s + r.result.totalBenefits, 0);
  const totalClass1ANIC = rows.reduce((s, r) => s + r.result.class1ANIC, 0);

  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Class 1A NIC deadline: 19 July (cheque) / 22 July (electronic) following the tax year end
  const startYear = parseInt(taxYear.split("/")[0], 10);
  const class1ADeadline = new Date(Date.UTC(startYear + 1, 6, 22));
  const p11dFilingDeadline = new Date(Date.UTC(startYear + 1, 6, 6));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <a href="/p11d" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to P11D
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">P11D(b) Summary</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Use your browser's print function (⌘P) to save as PDF.
        </p>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">

          <div className="bg-slate-900 text-white px-6 py-5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Employer's Declaration</p>
            <h2 className="text-lg font-bold mt-1">P11D(b) — {taxYear}</h2>
          </div>

          <div className="p-6 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs">Employer</p>
                <p className="font-medium text-slate-900">{client.client_name}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Company Registration Number</p>
                <p className="font-medium text-slate-900">{client.company_number || "Not on file"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Tax Year</p>
                <p className="font-medium text-slate-900">{taxYear}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Employees with Benefits</p>
                <p className="font-medium text-slate-900">{rows.length}</p>
              </div>
            </div>
          </div>

          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Benefits by Employee</p>
            <div className="space-y-2">
              {rows.map(({ comp, result }) => (
                <div key={comp.id} className="flex justify-between text-sm py-1.5 border-b border-slate-50">
                  <span className="text-slate-700">{comp.employee_name}</span>
                  <span className="font-mono font-medium">£{fmt(result.totalBenefits)}</span>
                </div>
              ))}
              {rows.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No P11D computations found for this employer and tax year.</p>
              )}
            </div>
          </div>

          <div className="p-6 bg-slate-50">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Total Value of Benefits (all employees)</span>
                <span className="font-medium">£{fmt(totalBenefits)}</span>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base">
                <span>Class 1A NIC Due ({(P11D_RATES.class1ANicRate * 100).toFixed(0)}%)</span>
                <span>£{fmt(totalClass1ANIC)}</span>
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-slate-100 text-xs text-slate-600 space-y-1">
            <p>P11D filing deadline: {p11dFilingDeadline.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
            <p>Class 1A NIC payment deadline (electronic): {class1ADeadline.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>Working paper for review — not a filable P11D(b).</strong> Submit through HMRC's online service or recognised payroll software. Confirm every employee with a benefit in this tax year is included before relying on this total.
          </p>
        </div>
      </div>
    </div>
  );
}
