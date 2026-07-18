import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2026/27 figures. Class 1A NIC was consistent across sources at time of writing.
// The fuel multiplier and official rate of interest genuinely varied between sources —
// treat these as sensible defaults and confirm against GOV.UK before relying on them.
export const P11D_RATES = {
  class1ANicRate: 0.15,
  defaultFuelMultiplier: 29200,
  defaultOfficialRateOfInterest: 3.75,
  loanDeMinimis: 10000, // no benefit arises if total loan balance never exceeds this
  carContributionCap: 5000, // max capital contribution that reduces the car's list price
};

export function calculateP11D(input: {
  carListPrice: number;
  carBenefitPercentage: number;
  carCapitalContribution: number;
  carAvailableDays: number;
  fuelProvided: boolean;
  fuelBenefitMultiplier: number;
  medicalPremium: number;
  medicalEmployeeContribution: number;
  loanBalance: number;
  loanInterestPaid: number;
  officialRateOfInterest: number;
  otherBenefitsAmount: number;
}) {
  const proration = Math.min(1, Math.max(0, input.carAvailableDays / 365));

  const adjustedListPrice = Math.max(0, input.carListPrice - Math.min(input.carCapitalContribution, P11D_RATES.carContributionCap));
  const carBenefit = input.carListPrice > 0
    ? adjustedListPrice * (input.carBenefitPercentage / 100) * proration
    : 0;

  const fuelBenefit = input.fuelProvided && carBenefit > 0
    ? input.fuelBenefitMultiplier * (input.carBenefitPercentage / 100) * proration
    : 0;

  const medicalBenefit = Math.max(0, input.medicalPremium - input.medicalEmployeeContribution);

  // No benefit at all if the loan never exceeded the de minimis threshold
  const loanBenefit = input.loanBalance > P11D_RATES.loanDeMinimis
    ? Math.max(0, input.loanBalance * (input.officialRateOfInterest / 100) - input.loanInterestPaid)
    : 0;

  const otherBenefit = input.otherBenefitsAmount;

  const totalBenefits = carBenefit + fuelBenefit + medicalBenefit + loanBenefit + otherBenefit;
  const class1ANIC = totalBenefits * P11D_RATES.class1ANicRate;

  return { carBenefit, fuelBenefit, medicalBenefit, loanBenefit, otherBenefit, totalBenefits, class1ANIC };
}

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  const employee_name = get("employee_name");
  if (!client_id || !employee_name) return;

  await supabase.from("p11d_computations").insert({
    client_id,
    employee_name,
    employee_client_id: get("employee_client_id") || null,
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
  });

  revalidatePath("/p11d");
}

async function deleteComputation(id: string) {
  "use server";
  await supabase.from("p11d_computations").delete().eq("id", id);
  revalidatePath("/p11d");
}

export default async function P11DPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; browseClient?: string }>;
}) {
  const { mode, browseClient: browseClientId } = await searchParams;

  const [{ data: computations, error }, { data: clients }] = await Promise.all([
    supabase
      .from("p11d_computations")
      .select("*, clients:client_id(client_name)")
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
  ]);

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

  const browseRows = browseClientId ? rows.filter((r) => r.comp.client_id === browseClientId) : [];

  const renderRow = ({ comp, result }: (typeof rows)[number]) => (
    <div key={comp.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
      <a href={`/p11d/${comp.id}`} className="flex-1">
        <p className="font-semibold text-slate-900">
          {comp.employee_name} — {(comp.clients as any)?.client_name || "No employer"}
        </p>
        <p className="text-sm text-slate-500">
          {comp.tax_year} · Total benefits: £{result.totalBenefits.toFixed(2)} · Class 1A NIC: £{result.class1ANIC.toFixed(2)}
        </p>
      </a>
      <form action={deleteComputation.bind(null, comp.id)}>
        <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
          Delete
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">P11D — Benefits in Kind</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Computes taxable benefit values per employee and the employer's Class 1A NIC, using 2026/27 rates.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load computations: {error.message}
          </div>
        )}

        {/* Entry choice: Browse existing vs Start New */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <a href="/p11d?mode=browse"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "browse" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "browse" ? "text-white" : "text-slate-900"}`}>Browse Existing</p>
            <p className={`text-sm mt-1 ${mode === "browse" ? "text-slate-300" : "text-slate-500"}`}>Find an employer's P11D computations</p>
          </a>
          <a href="/p11d?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Computation</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>One per employee/director per tax year</p>
          </a>
        </div>

        {/* BROWSE MODE */}
        {mode === "browse" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Find Employer</h2>
            <form method="get" className="mt-4 flex gap-2">
              <input type="hidden" name="mode" value="browse" />
              <select name="browseClient" defaultValue={browseClientId || ""}
                className="flex-1 max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">Select an employer</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
              <button type="submit"
                className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Show
              </button>
            </form>

            {browseClientId && (
              <div className="mt-6 space-y-3">
                {browseRows.map(renderRow)}
                {browseRows.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">No P11D computations on file for this employer yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE */}
        {mode === "new" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">New P11D Computation</h2>
            <p className="text-sm text-slate-500 mt-0.5">One per employee/director per tax year. Leave any benefit blank if it doesn't apply.</p>

            <form action={createComputation} className="mt-6 space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Employer (Client) *</label>
                  <select name="client_id" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select the employer</option>
                    {(clients || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.client_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Employee/Director Name *</label>
                  <input name="employee_name" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Link to Client (optional)</label>
                  <select name="employee_client_id"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">No linked client</option>
                    {(clients || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.client_name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">If they're also a Personal Tax client, this lets you push the benefit total across.</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 max-w-xs">Tax Year</label>
                <select name="tax_year" defaultValue="2026/27"
                  className="w-full max-w-xs rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="2026/27">2026/27</option>
                </select>
              </div>

              {/* Company Car */}
              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-sm font-bold text-slate-900 mb-1">Company Car</h3>
                <p className="text-xs text-slate-400 mb-3">Look up the correct benefit % for the car's CO2 emissions/fuel type from HMRC's published table.</p>
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">List Price (£)</label>
                    <input name="car_list_price" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Benefit %</label>
                    <input name="car_benefit_percentage" type="number" step="0.01" min="0" max="37" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="e.g. 4 for EV" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Capital Contribution (£)</label>
                    <input name="car_capital_contribution" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="Max £5,000 reduces list price" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Days Available</label>
                    <input name="car_available_days" type="number" min="0" max="365" defaultValue="365"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-3">
                  <input name="fuel_provided" type="checkbox" className="w-4 h-4 rounded" />
                  <span className="text-sm font-medium text-slate-700">Employer also provides private fuel</span>
                </label>
                <div className="mt-2 max-w-xs">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fuel Benefit Multiplier (£)</label>
                  <input name="fuel_benefit_multiplier" type="number" step="0.01" min="0" defaultValue={P11D_RATES.defaultFuelMultiplier}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <p className="text-xs text-slate-400 mt-1">Confirm current figure against GOV.UK before relying on this default.</p>
                </div>
              </div>

              {/* Medical */}
              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-sm font-bold text-slate-900 mb-3">Private Medical Insurance</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Premium Paid by Employer (£)</label>
                    <input name="medical_premium" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Employee Contribution (£)</label>
                    <input name="medical_employee_contribution" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              {/* Beneficial Loan */}
              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-sm font-bold text-slate-900 mb-1">Beneficial Loan</h3>
                <p className="text-xs text-slate-400 mb-3">No benefit arises if the balance never exceeds £10,000 in the year — often relevant for an overdrawn director's loan account.</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Loan Balance (£)</label>
                    <input name="loan_balance" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Interest Actually Paid (£)</label>
                    <input name="loan_interest_paid" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Official Rate of Interest (%)</label>
                    <input name="official_rate_of_interest" type="number" step="0.01" min="0" defaultValue={P11D_RATES.defaultOfficialRateOfInterest}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    <p className="text-xs text-slate-400 mt-1">Confirm current figure against GOV.UK.</p>
                  </div>
                </div>
              </div>

              {/* Other */}
              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-sm font-bold text-slate-900 mb-3">Other Benefits</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                    <input name="other_benefits_description"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="e.g. Gym membership, assets provided" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Cash Equivalent (£)</label>
                    <input name="other_benefits_amount" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <button type="submit"
                className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Calculate & Save
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
