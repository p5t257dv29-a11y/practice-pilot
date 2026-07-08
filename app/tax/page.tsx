import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// UK tax year rates. Add a new entry each April when HMRC rates change.
export const TAX_RATES: Record<string, any> = {
  "2026/27": {
    personalAllowance: 12570,
    paTaperStart: 100000,
    paTaperEnd: 125140,
    basicRateLimit: 37700, // width of basic rate band, applied to taxable (post-allowance) income
    additionalRateThreshold: 125140, // taxable income threshold
    basicRate: 0.20,
    higherRate: 0.40,
    additionalRate: 0.45,
    dividendAllowance: 500,
    dividendBasicRate: 0.1075,
    dividendHigherRate: 0.3575,
    dividendAdditionalRate: 0.3935,
    startingRateForSavingsBand: 5000, // 0% band, only available if non-savings income is low
    startingRateForSavings: 0,
    personalSavingsAllowanceBasic: 1000,
    personalSavingsAllowanceHigher: 500,
    personalSavingsAllowanceAdditional: 0,
    class4LowerLimit: 12570,
    class4UpperLimit: 50270,
    class4MainRate: 0.06,
    class4UpperRate: 0.02,
  },
};

export function calculateTax(input: {
  employmentIncome: number;
  selfEmploymentIncome: number;
  rentalIncome: number;
  pensionIncome: number;
  interestIncome: number;
  dividendIncome: number;
  taxYear: string;
}) {
  const r = TAX_RATES[input.taxYear] || TAX_RATES["2026/27"];

  // Tier 1: non-savings, non-dividend income (employment, self-employment, rental, pensions)
  const nonSavingsIncome =
    input.employmentIncome + input.selfEmploymentIncome + input.rentalIncome + input.pensionIncome;
  const totalIncome = nonSavingsIncome + input.interestIncome + input.dividendIncome;

  // Personal allowance taper: £1 lost for every £2 of total income over £100,000
  let personalAllowance = r.personalAllowance;
  if (totalIncome > r.paTaperStart) {
    const reduction = Math.floor((totalIncome - r.paTaperStart) / 2);
    personalAllowance = Math.max(0, r.personalAllowance - reduction);
  }

  // Apply personal allowance to non-savings income first, spill remainder to savings, then dividends
  const paUsedAgainstNonSavings = Math.min(personalAllowance, nonSavingsIncome);
  let paRemaining = personalAllowance - paUsedAgainstNonSavings;

  const taxableNonSavings = Math.max(0, nonSavingsIncome - paUsedAgainstNonSavings);

  const basicBandNonDiv = Math.min(taxableNonSavings, r.basicRateLimit);
  const higherBandNonDiv = Math.min(
    Math.max(0, taxableNonSavings - r.basicRateLimit),
    r.additionalRateThreshold - r.basicRateLimit
  );
  const additionalBandNonDiv = Math.max(0, taxableNonSavings - r.additionalRateThreshold);

  const nonDividendTax =
    basicBandNonDiv * r.basicRate +
    higherBandNonDiv * r.higherRate +
    additionalBandNonDiv * r.additionalRate;

  // Tier 2: savings income (interest) — apply remaining PA, then starting rate band, then PSA
  const paUsedAgainstSavings = Math.min(paRemaining, input.interestIncome);
  paRemaining -= paUsedAgainstSavings;
  const savingsAfterPA = Math.max(0, input.interestIncome - paUsedAgainstSavings);

  // Starting rate band (0%) — only has room if non-savings income hasn't already used it up
  const startingRateRemaining = Math.max(0, r.startingRateForSavingsBand - taxableNonSavings);
  const startingRateUsed = Math.min(savingsAfterPA, startingRateRemaining);
  const afterStartingRate = savingsAfterPA - startingRateUsed;

  // Personal Savings Allowance depends on the band reached by non-savings income
  let psa = r.personalSavingsAllowanceBasic;
  if (taxableNonSavings >= r.additionalRateThreshold) psa = r.personalSavingsAllowanceAdditional;
  else if (taxableNonSavings >= r.basicRateLimit) psa = r.personalSavingsAllowanceHigher;

  const psaUsed = Math.min(afterStartingRate, psa);
  const taxableSavings = afterStartingRate - psaUsed;

  // Savings stacks on top of non-savings income for band purposes
  const savingsBase = taxableNonSavings;
  const savingsBasicRemaining = Math.max(0, r.basicRateLimit - savingsBase);
  const savingsHigherRemaining = Math.max(0, r.additionalRateThreshold - Math.max(savingsBase, r.basicRateLimit));

  const savingsBasic = Math.min(taxableSavings, savingsBasicRemaining);
  const savingsHigher = Math.min(Math.max(0, taxableSavings - savingsBasic), savingsHigherRemaining);
  const savingsAdditional = Math.max(0, taxableSavings - savingsBasic - savingsHigher);

  const savingsTax =
    savingsBasic * r.basicRate +
    savingsHigher * r.higherRate +
    savingsAdditional * r.additionalRate;

  // Tier 3: dividends stack on top of non-savings + savings income
  const dividendsAfterPA = Math.max(0, input.dividendIncome - paRemaining);
  const dividendAllowanceUsed = Math.min(r.dividendAllowance, dividendsAfterPA);
  const taxableDividends = dividendsAfterPA - dividendAllowanceUsed;

  const dividendBase = taxableNonSavings + startingRateUsed + psaUsed + taxableSavings;
  const divBasicRemaining = Math.max(0, r.basicRateLimit - dividendBase);
  const divHigherRemaining = Math.max(0, r.additionalRateThreshold - Math.max(dividendBase, r.basicRateLimit));

  const divBasic = Math.min(taxableDividends, divBasicRemaining);
  const divHigher = Math.min(Math.max(0, taxableDividends - divBasic), divHigherRemaining);
  const divAdditional = Math.max(0, taxableDividends - divBasic - divHigher);

  const dividendTax =
    divBasic * r.dividendBasicRate +
    divHigher * r.dividendHigherRate +
    divAdditional * r.dividendAdditionalRate;

  // Class 4 NI on self-employment profit only
  const class4Basic = Math.max(0, Math.min(input.selfEmploymentIncome, r.class4UpperLimit) - r.class4LowerLimit);
  const class4Upper = Math.max(0, input.selfEmploymentIncome - r.class4UpperLimit);
  const class4NI = Math.max(0, class4Basic) * r.class4MainRate + class4Upper * r.class4UpperRate;

  const totalIncomeTax = nonDividendTax + savingsTax + dividendTax;
  const totalLiability = totalIncomeTax + class4NI;

  return {
    personalAllowance,
    nonDividendIncome: nonSavingsIncome,
    taxableNonDividend: taxableNonSavings,
    nonDividendTax,
    startingRateUsed,
    psaUsed,
    taxableSavings,
    savingsTax,
    dividendAllowanceUsed,
    taxableDividends,
    dividendTax,
    class4NI,
    totalIncomeTax,
    totalLiability,
    bands: {
      basicBandNonDiv, higherBandNonDiv, additionalBandNonDiv,
      savingsBasic, savingsHigher, savingsAdditional,
      divBasic, divHigher, divAdditional,
    },
  };
}

// Computes the Self Assessment payment schedule: balancing payment + payments on account
// towards the following tax year, following HMRC's actual rules.
export function getPaymentSchedule(taxYear: string, totalLiability: number, taxPaidAtSource: number) {
  const balanceDue = totalLiability - taxPaidAtSource;

  // Payments on account are required if the SA bill exceeds £1,000
  // and less than 80% of the total liability was collected at source (e.g. PAYE)
  const proportionAtSource = totalLiability > 0 ? taxPaidAtSource / totalLiability : 1;
  const poaRequired = balanceDue > 1000 && proportionAtSource < 0.8;
  const poaAmount = poaRequired ? balanceDue / 2 : 0;

  // Parse "2026/27" -> startYear 2026. Balancing payment & first POA due 31 Jan two years after start.
  const startYear = parseInt(taxYear.split("/")[0], 10);
  const balancingPaymentDate = new Date(Date.UTC(startYear + 2, 0, 31)); // 31 January
  const poa2Date = new Date(Date.UTC(startYear + 2, 6, 31)); // 31 July

  return {
    balanceDue,
    poaRequired,
    poaAmount,
    balancingPaymentDate: balancingPaymentDate.toISOString().split("T")[0],
    poa1Date: balancingPaymentDate.toISOString().split("T")[0],
    poa2Date: poa2Date.toISOString().split("T")[0],
    dueAtBalancingPayment: balanceDue + poaAmount,
    dueAtPoa2: poaAmount,
    nextTaxYear: `${startYear + 1}/${String(startYear + 2).slice(-2)}`,
  };
}

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const client_id = get("client_id");
  if (!client_id) return;

  await supabase.from("tax_computations").insert({
    client_id,
    tax_year: get("tax_year") || "2026/27",
    employment_income: num("employment_income"),
    self_employment_income: num("self_employment_income"),
    rental_income: num("rental_income"),
    pension_income: num("pension_income"),
    interest_income: num("interest_income"),
    dividend_income: num("dividend_income"),
    tax_paid_at_source: num("tax_paid_at_source"),
    notes: get("notes"),
  });

  revalidatePath("/tax");
}

async function deleteComputation(id: string) {
  "use server";
  await supabase.from("tax_computations").delete().eq("id", id);
  revalidatePath("/tax");
}

export default async function AccountsProductionPage() {
  const [{ data: computations, error }, { data: clients }] = await Promise.all([
    supabase
      .from("tax_computations")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Tax</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Personal tax computations using current HMRC rates and bands.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load computations: {error.message}
          </div>
        )}

        {/* New Computation Form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">New Tax Computation</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Enter gross income figures for the tax year. All bands, allowances, and Class 4 NI are calculated automatically using 2026/27 rates.
          </p>

          <form action={createComputation} className="mt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
                <select name="client_id" required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Select a client</option>
                  {(clients || []).map((client) => (
                    <option key={client.id} value={client.id}>{client.client_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Year</label>
                <select name="tax_year"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="2026/27">2026/27</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Employment Income (£)</label>
                <input name="employment_income" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="P60 gross pay" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Self-Employment Profit (£)</label>
                <input name="self_employment_income" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Net profit after expenses" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rental Income (£)</label>
                <input name="rental_income" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Net rental profit" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pension Income (£)</label>
                <input name="pension_income" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="State + private pension received" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Interest Received (£)</label>
                <input name="interest_income" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Bank/savings interest" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Dividend Income (£)</label>
                <input name="dividend_income" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Already Paid at Source / PAYE (£)</label>
                <input name="tax_paid_at_source" type="number" step="0.01" min="0" defaultValue="0"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="From P60, if employed" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>

            <button type="submit"
              className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Calculate & Save
            </button>
          </form>
        </div>

        {/* Computations List */}
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            All Computations ({computations?.length ?? 0})
          </h2>

          <div className="mt-4 space-y-3">
            {(computations || []).map((comp) => {
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

              return (
                <div key={comp.id}
                  className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                  <a href={`/tax/${comp.id}`} className="flex-1">
                    <p className="font-semibold text-slate-900">
                      {comp.clients?.client_name || "No client"} — {comp.tax_year}
                    </p>
                    <p className="text-sm text-slate-500">
                      Total liability: £{result.totalLiability.toFixed(2)}
                    </p>
                  </a>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className={`font-bold ${balanceDue >= 0 ? "text-slate-900" : "text-green-600"}`}>
                        {balanceDue >= 0 ? `£${balanceDue.toFixed(2)} due` : `£${Math.abs(balanceDue).toFixed(2)} refund`}
                      </p>
                    </div>
                    <form action={deleteComputation.bind(null, comp.id)}>
                      <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}

            {computations && computations.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">
                No computations yet. Create your first one above.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
