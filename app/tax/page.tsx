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

// "2026/27" -> "2025/26"
export function previousTaxYear(taxYear: string) {
  const startYear = parseInt(taxYear.split("/")[0], 10);
  return `${startYear - 1}/${String(startYear).slice(-2)}`;
}

type TaxInput = {
  employmentIncome: number;
  selfEmploymentIncome: number;
  rentalIncome: number; // gross UK rental income
  propertyExpenses?: number; // allowable UK property expenses excluding finance costs
  propertyFinanceCosts?: number; // UK finance costs for the year
  financeCostsBf?: number; // unused UK finance costs brought forward
  pensionIncome: number;
  interestIncome: number;
  dividendIncome: number;
  foreignEmploymentIncome?: number;
  foreignInterestIncome?: number;
  foreignDividendIncome?: number;
  foreignRentalIncome?: number; // gross foreign rental income
  foreignPropertyExpenses?: number;
  foreignPropertyFinanceCosts?: number;
  foreignFinanceCostsBf?: number;
  foreignTaxPaid?: number; // total foreign tax suffered, for credit relief
  taxYear: string;
};

// Core banding computation — everything except Foreign Tax Credit Relief,
// which the exported calculateTax derives by calling this twice (see below).
// UK and foreign property are kept as separate pools throughout, matching
// how HMRC treats them as distinct property businesses, even though both
// feed into the same combined non-savings income tier for band purposes.
function computeCore(input: TaxInput) {
  const r = TAX_RATES[input.taxYear] || TAX_RATES["2026/27"];
  const propertyExpenses = input.propertyExpenses || 0;
  const propertyFinanceCosts = input.propertyFinanceCosts || 0;
  const financeCostsBf = input.financeCostsBf || 0;
  const foreignEmploymentIncome = input.foreignEmploymentIncome || 0;
  const foreignInterestIncome = input.foreignInterestIncome || 0;
  const foreignDividendIncome = input.foreignDividendIncome || 0;
  const foreignRentalIncome = input.foreignRentalIncome || 0;
  const foreignPropertyExpenses = input.foreignPropertyExpenses || 0;
  const foreignPropertyFinanceCosts = input.foreignPropertyFinanceCosts || 0;
  const foreignFinanceCostsBf = input.foreignFinanceCostsBf || 0;

  // Property profit excludes finance costs entirely — since 2020/21 these no
  // longer reduce property profit, they only generate a 20% tax reducer,
  // separately capped and carried forward for the UK and overseas businesses.
  const propertyProfit = Math.max(0, input.rentalIncome - propertyExpenses);
  const foreignPropertyProfit = Math.max(0, foreignRentalIncome - foreignPropertyExpenses);

  const combinedInterestIncome = input.interestIncome + foreignInterestIncome;
  const combinedDividendIncome = input.dividendIncome + foreignDividendIncome;

  // Tier 1: non-savings, non-dividend income — UK and foreign sources combined
  const nonSavingsIncome =
    input.employmentIncome + foreignEmploymentIncome + input.selfEmploymentIncome +
    propertyProfit + foreignPropertyProfit + input.pensionIncome;
  const totalIncome = nonSavingsIncome + combinedInterestIncome + combinedDividendIncome;

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

  // Property finance cost tax reducer (s274A ITTOIA / "Section 24"): relief is
  // 20% of the LOWER of (a) finance costs for the year plus any brought-forward
  // unused amount, (b) property profit, (c) "adjusted total income" — non-savings/
  // non-dividend income less the personal allowance, floored at 0 (= taxableNonSavings,
  // since the personal allowance is applied against non-savings income first).
  // UK and overseas property are each capped independently against the same
  // adjustedTotalIncome figure — this mirrors HMRC's own worked examples, which
  // apply the cap per property business rather than splitting it between them.
  const adjustedTotalIncome = taxableNonSavings;

  const totalFinanceCostsAvailable = propertyFinanceCosts + financeCostsBf;
  const financeCostReliefCap = Math.max(0, Math.min(totalFinanceCostsAvailable, propertyProfit, adjustedTotalIncome));
  const financeCostTaxReducer = financeCostReliefCap * r.basicRate;
  const unusedFinanceCostsCf = Math.max(0, totalFinanceCostsAvailable - financeCostReliefCap);

  const totalForeignFinanceCostsAvailable = foreignPropertyFinanceCosts + foreignFinanceCostsBf;
  const foreignFinanceCostReliefCap = Math.max(0, Math.min(totalForeignFinanceCostsAvailable, foreignPropertyProfit, adjustedTotalIncome));
  const foreignFinanceCostTaxReducer = foreignFinanceCostReliefCap * r.basicRate;
  const unusedForeignFinanceCostsCf = Math.max(0, totalForeignFinanceCostsAvailable - foreignFinanceCostReliefCap);

  // Tier 2: savings income (interest) — apply remaining PA, then starting rate band, then PSA
  const paUsedAgainstSavings = Math.min(paRemaining, combinedInterestIncome);
  paRemaining -= paUsedAgainstSavings;
  const savingsAfterPA = Math.max(0, combinedInterestIncome - paUsedAgainstSavings);

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
  const dividendsAfterPA = Math.max(0, combinedDividendIncome - paRemaining);
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

  // Class 4 NI on UK self-employment profit only
  const class4Basic = Math.max(0, Math.min(input.selfEmploymentIncome, r.class4UpperLimit) - r.class4LowerLimit);
  const class4Upper = Math.max(0, input.selfEmploymentIncome - r.class4UpperLimit);
  const class4NI = Math.max(0, class4Basic) * r.class4MainRate + class4Upper * r.class4UpperRate;

  const totalReducer = financeCostTaxReducer + foreignFinanceCostTaxReducer;
  const nonDividendTaxAfterReducer = Math.max(0, nonDividendTax - totalReducer);
  const totalIncomeTax = nonDividendTaxAfterReducer + savingsTax + dividendTax;

  return {
    personalAllowance,
    nonDividendIncome: nonSavingsIncome,
    taxableNonDividend: taxableNonSavings,
    nonDividendTax: nonDividendTaxAfterReducer,
    nonDividendTaxBeforeReducer: nonDividendTax,
    startingRateUsed,
    psaUsed,
    taxableSavings,
    savingsTax,
    dividendAllowanceUsed,
    taxableDividends,
    dividendTax,
    class4NI,
    totalIncomeTax,
    propertyProfit,
    foreignPropertyProfit,
    totalFinanceCostsAvailable,
    adjustedTotalIncome,
    financeCostReliefCap,
    financeCostTaxReducer,
    unusedFinanceCostsCf,
    totalForeignFinanceCostsAvailable,
    foreignFinanceCostReliefCap,
    foreignFinanceCostTaxReducer,
    unusedForeignFinanceCostsCf,
    bands: {
      basicBandNonDiv, higherBandNonDiv, additionalBandNonDiv,
      savingsBasic, savingsHigher, savingsAdditional,
      divBasic, divHigher, divAdditional,
    },
  };
}

export function calculateTax(input: TaxInput) {
  const actual = computeCore(input);

  // Foreign Tax Credit Relief: capped at the LOWER of the foreign tax actually
  // suffered and the UK tax attributable to the foreign income. That UK-tax
  // figure is derived by comparing the actual computation against a baseline
  // with all foreign income (and the foreign property pool) zeroed out — the
  // difference is the marginal UK tax generated by adding the foreign income.
  // This is a practical, source-blind approximation (it doesn't allocate relief
  // between different foreign countries/rates individually) rather than a full
  // per-source DTA calculation — reasonable for an estimate, but worth checking
  // against the actual foreign tax certificates before filing.
  const baseline = computeCore({
    ...input,
    foreignEmploymentIncome: 0,
    foreignInterestIncome: 0,
    foreignDividendIncome: 0,
    foreignRentalIncome: 0,
    foreignPropertyExpenses: 0,
    foreignPropertyFinanceCosts: 0,
    foreignFinanceCostsBf: 0,
  });

  const ukTaxOnForeignIncome = Math.max(0, actual.totalIncomeTax - baseline.totalIncomeTax);
  const foreignTaxPaid = input.foreignTaxPaid || 0;
  const foreignTaxCreditRelief = Math.min(foreignTaxPaid, ukTaxOnForeignIncome);
  const unusedForeignTaxCredit = Math.max(0, foreignTaxPaid - foreignTaxCreditRelief);

  const totalIncomeTax = Math.max(0, actual.totalIncomeTax - foreignTaxCreditRelief);
  const totalLiability = totalIncomeTax + actual.class4NI;

  return {
    ...actual,
    totalIncomeTaxBeforeFTCR: actual.totalIncomeTax,
    totalIncomeTax,
    totalLiability,
    ukTaxOnForeignIncome,
    foreignTaxCreditRelief,
    unusedForeignTaxCredit,
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
  const tax_year = get("tax_year") || "2026/27";
  if (!client_id) return;

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
    taxYear: tax_year,
  };
  const result = calculateTax(input);

  await supabase.from("tax_computations").insert({
    client_id,
    tax_year,
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
  });

  revalidatePath("/tax");
}

async function deleteComputation(id: string) {
  "use server";
  await supabase.from("tax_computations").delete().eq("id", id);
  revalidatePath("/tax");
}

export default async function PersonalTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; client?: string; self_employment?: string; browseClient?: string; tax_year?: string }>;
}) {
  const { mode: modeParam, client: selectedClient, self_employment: prefillSelfEmployment, browseClient: browseClientId, tax_year: selectedTaxYear } = await searchParams;

  // Arriving with a pre-filled client (e.g. handed off from Partnership Tax) should
  // land straight in the New form, without needing that other module to know about modes.
  const mode = modeParam || (selectedClient ? "new" : undefined);
  const taxYear = selectedTaxYear || "2026/27";

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

  // Look up the prior tax year's unused finance costs (UK and foreign) for this
  // client, so the New form can default the brought-forward figures instead of
  // relying on the preparer to remember and re-type them.
  let financeCostsBfDefault = 0;
  let foreignFinanceCostsBfDefault = 0;
  if (selectedClient) {
    const { data: priorComp } = await supabase
      .from("tax_computations")
      .select("finance_costs_cf, foreign_finance_costs_cf")
      .eq("client_id", selectedClient)
      .eq("tax_year", previousTaxYear(taxYear))
      .maybeSingle();
    financeCostsBfDefault = Number(priorComp?.finance_costs_cf || 0);
    foreignFinanceCostsBfDefault = Number(priorComp?.foreign_finance_costs_cf || 0);
  }

  const withResult = (comp: any) => {
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
    return { comp, result, balanceDue };
  };

  const browseRows = browseClientId
    ? (computations || []).filter((c) => c.client_id === browseClientId).map(withResult)
    : [];

  const renderRow = ({ comp, result, balanceDue }: ReturnType<typeof withResult>) => {
    const carryForwardNote = [
      result.unusedFinanceCostsCf > 0 ? `£${result.unusedFinanceCostsCf.toFixed(2)} UK finance costs c/f` : null,
      result.unusedForeignFinanceCostsCf > 0 ? `£${result.unusedForeignFinanceCostsCf.toFixed(2)} foreign finance costs c/f` : null,
    ].filter(Boolean).join(" · ");
    return (
    <div key={comp.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
      <a href={`/tax/${comp.id}`} className="flex-1">
        <p className="font-semibold text-slate-900">
          {comp.clients?.client_name || "No client"} — {comp.tax_year}
        </p>
        <p className="text-sm text-slate-500">
          Total liability: £{result.totalLiability.toFixed(2)}
          {carryForwardNote && ` · ${carryForwardNote}`}
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
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Personal Tax</h1>
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

        {/* Entry choice: Browse existing vs Start New */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <a href="/tax?mode=browse"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "browse" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "browse" ? "text-white" : "text-slate-900"}`}>Browse Existing</p>
            <p className={`text-sm mt-1 ${mode === "browse" ? "text-slate-300" : "text-slate-500"}`}>Find a client's personal tax computations</p>
          </a>
          <a href="/tax?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Computation</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Enter income figures for a client's tax year</p>
          </a>
        </div>

        {/* BROWSE MODE */}
        {mode === "browse" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
            <form method="get" className="mt-4 flex gap-2">
              <input type="hidden" name="mode" value="browse" />
              <select name="browseClient" defaultValue={browseClientId || ""}
                className="flex-1 max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                <option value="">Select a client</option>
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
                  <p className="text-sm text-slate-500 text-center py-8">No personal tax computations on file for this client yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE — step 1: pick client & tax year, so we can look up any brought-forward finance costs */}
        {mode === "new" && !selectedClient && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Select Client & Tax Year</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              We'll check for any unused property finance costs carried forward from the prior year automatically.
            </p>
            <form method="get" className="mt-4 flex gap-2 items-end">
              <input type="hidden" name="mode" value="new" />
              {prefillSelfEmployment && <input type="hidden" name="self_employment" value={prefillSelfEmployment} />}
              <div className="flex-1 max-w-md">
                <select name="client"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Select a client</option>
                  {(clients || []).map((client) => (
                    <option key={client.id} value={client.id}>{client.client_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <select name="tax_year" defaultValue="2026/27"
                  className="rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="2026/27">2026/27</option>
                </select>
              </div>
              <button type="submit"
                className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Continue
              </button>
            </form>
          </div>
        )}

        {/* NEW MODE — step 2: full form */}
        {mode === "new" && selectedClient && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">New Tax Computation</h2>
              <a href="/tax?mode=new" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {(clients || []).find((c) => c.id === selectedClient)?.client_name} · {taxYear}. All bands, allowances, and Class 4 NI are calculated automatically using {taxYear} rates.
            </p>

            {prefillSelfEmployment && (
              <div className="mt-4 rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-800">
                Self-Employment Profit has been pre-filled with £{parseFloat(prefillSelfEmployment).toLocaleString("en-GB", { minimumFractionDigits: 2 })} from a linked Partnership Tax profit share.
              </div>
            )}

            {financeCostsBfDefault > 0 && (
              <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800">
                Found £{financeCostsBfDefault.toLocaleString("en-GB", { minimumFractionDigits: 2 })} of unused property finance costs carried forward from {previousTaxYear(taxYear)} — pre-filled below.
              </div>
            )}

            <form action={createComputation} className="mt-6">
              <input type="hidden" name="client_id" value={selectedClient} />
              <input type="hidden" name="tax_year" value={taxYear} />

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Employment Income (£)</label>
                  <input name="employment_income" type="number" step="0.01" min="0" defaultValue="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="P60 gross pay" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Self-Employment Profit (£) {prefillSelfEmployment && <span className="text-green-600 font-normal">(auto-filled)</span>}
                  </label>
                  <input name="self_employment_income" type="number" step="0.01" min="0"
                    defaultValue={prefillSelfEmployment || "0"}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Net profit after expenses" />
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
              </div>

              {/* Property income section */}
              <div className="mt-6 rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-900">Rental Property Income</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Finance costs (mortgage interest) no longer reduce property profit directly — they generate a 20% tax reducer instead, capped by profit and income, with any unused amount carried forward.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Gross Rental Income (£)</label>
                    <input name="rental_income" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Allowable Property Expenses (£)</label>
                    <input name="property_expenses" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="Excluding finance costs" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Finance Costs for the Year (£)</label>
                    <input name="property_finance_costs" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="Mortgage interest etc." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Unused Finance Costs B/F (£)</label>
                    <input name="finance_costs_bf" type="number" step="0.01" min="0" defaultValue={financeCostsBfDefault || "0"}
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                </div>
              </div>

              {/* Foreign income section */}
              <div className="mt-6 rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-900">Foreign Income</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Foreign employment, interest and dividends are taxed together with the equivalent UK income. Foreign rental property is kept as its own pool, with the same finance cost restriction and carry-forward as UK property. Foreign tax already paid is relieved via a tax credit, capped at the UK tax due on that income.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Employment Income (£)</label>
                    <input name="foreign_employment_income" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Interest (£)</label>
                    <input name="foreign_interest_income" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Dividends (£)</label>
                    <input name="foreign_dividend_income" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Foreign Tax Paid (£)</label>
                    <input name="foreign_tax_paid" type="number" step="0.01" min="0" defaultValue="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      placeholder="Total foreign tax suffered, all sources" />
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Foreign Rental Property</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Gross Foreign Rental Income (£)</label>
                      <input name="foreign_rental_income" type="number" step="0.01" min="0" defaultValue="0"
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Allowable Property Expenses (£)</label>
                      <input name="foreign_property_expenses" type="number" step="0.01" min="0" defaultValue="0"
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        placeholder="Excluding finance costs" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Finance Costs for the Year (£)</label>
                      <input name="foreign_property_finance_costs" type="number" step="0.01" min="0" defaultValue="0"
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Unused Finance Costs B/F (£)</label>
                      <input name="foreign_finance_costs_bf" type="number" step="0.01" min="0" defaultValue={foreignFinanceCostsBfDefault || "0"}
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                  </div>
                  {foreignFinanceCostsBfDefault > 0 && (
                    <p className="text-xs text-blue-700 mt-2">
                      Found £{foreignFinanceCostsBfDefault.toLocaleString("en-GB", { minimumFractionDigits: 2 })} of unused foreign finance costs carried forward from {previousTaxYear(taxYear)} — pre-filled above.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <button type="submit"
                className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Calculate & Save
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
