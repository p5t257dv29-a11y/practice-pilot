import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateP11D, P11D_RATES } from "../../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function P11DSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("p11d_computations")
    .select("*, clients:client_id(client_name, company_number)")
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

  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const client = comp.clients as any;

  const Box = ({ section, label, value, note }: { section: string; label: string; value: string; note?: string }) => (
    <div className="flex items-start justify-between border-b border-slate-100 py-2.5 gap-4">
      <div className="flex items-start gap-3 flex-1">
        <span className="text-xs font-mono font-bold text-slate-400 mt-0.5 w-10 flex-shrink-0">{section}</span>
        <div>
          <p className="text-sm text-slate-700">{label}</p>
          {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
        </div>
      </div>
      <span className="text-sm font-mono font-semibold text-slate-900 flex-shrink-0">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <a href={`/p11d/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Computation
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">P11D Summary</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Use your browser's print function (⌘P) to save as PDF.
        </p>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">

          <div className="bg-slate-900 text-white px-6 py-5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Expenses and Benefits</p>
            <h2 className="text-lg font-bold mt-1">P11D — {comp.tax_year}</h2>
          </div>

          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Employer and Employee Details</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs">Employer</p>
                <p className="font-medium text-slate-900">{client?.client_name || "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Company Registration Number</p>
                <p className="font-medium text-slate-900">{client?.company_number || "Not on file"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Employee/Director</p>
                <p className="font-medium text-slate-900">{comp.employee_name}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Tax Year</p>
                <p className="font-medium text-slate-900">{comp.tax_year}</p>
              </div>
            </div>
          </div>

          {comp.car_list_price > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Section F — Cars</p>
              <Box section="F" label="List price" value={`£${fmt(Number(comp.car_list_price))}`} />
              <Box section="F" label="Capital contribution made good" value={`£${fmt(Math.min(Number(comp.car_capital_contribution), P11D_RATES.carContributionCap))}`} />
              <Box section="F" label="Appropriate percentage" value={`${comp.car_benefit_percentage}%`} />
              <Box section="F" label="Days available" value={String(comp.car_available_days)} />
              <Box section="F" label="Cash equivalent" value={`£${fmt(result.carBenefit)}`} />
            </div>
          )}

          {result.fuelBenefit > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Section G — Car Fuel</p>
              <Box section="G" label="Fuel benefit multiplier" value={`£${fmt(Number(comp.fuel_benefit_multiplier))}`} />
              <Box section="G" label="Cash equivalent" value={`£${fmt(result.fuelBenefit)}`} />
            </div>
          )}

          {result.medicalBenefit > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Section I — Medical or Dental Insurance</p>
              <Box section="I" label="Cost to employer" value={`£${fmt(Number(comp.medical_premium))}`} />
              <Box section="I" label="Amount made good by employee" value={`£${fmt(Number(comp.medical_employee_contribution))}`} />
              <Box section="I" label="Cash equivalent" value={`£${fmt(result.medicalBenefit)}`} />
            </div>
          )}

          {Number(comp.loan_balance) > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Section H — Loans</p>
              <Box section="H" label="Maximum amount outstanding" value={`£${fmt(Number(comp.loan_balance))}`} />
              <Box section="H" label="Interest paid by employee" value={`£${fmt(Number(comp.loan_interest_paid))}`} />
              <Box section="H" label="Official rate of interest" value={`${comp.official_rate_of_interest}%`} />
              <Box section="H" label="Cash equivalent" value={`£${fmt(result.loanBenefit)}`}
                note={Number(comp.loan_balance) <= P11D_RATES.loanDeMinimis ? "Under £10,000 de minimis — no benefit arises" : undefined} />
            </div>
          )}

          {result.otherBenefit > 0 && (
            <div className="p-6 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Section M — Other Items</p>
              <Box section="M" label={comp.other_benefits_description || "Other benefit"} value={`£${fmt(result.otherBenefit)}`} />
            </div>
          )}

          <div className="p-6 bg-slate-50">
            <div className="flex justify-between font-bold text-base">
              <span>Total Cash Equivalent of Benefits</span>
              <span>£{fmt(result.totalBenefits)}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>Working paper for review — not a filable P11D.</strong> HMRC requires P11D submission through their online service or recognised payroll/P11D software; this cannot be filed directly. Sections not covered by this tool (vouchers, living accommodation, vans, mileage, other expenses payments) are omitted rather than shown as zero — check whether any apply before filing. Always verify figures, especially the company car benefit percentage, against current HMRC guidance.
          </p>
        </div>
      </div>
    </div>
  );
}
