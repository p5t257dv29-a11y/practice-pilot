import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const TAX_RATES: Record<string, any> = {
  "2026/27": {
    personalAllowance: 12570,
    paTaperStart: 100000,
    paTaperEnd: 125140,
    basicRateLimit: 37700,
    additionalRateThreshold: 125140,
    basicRate: 0.20,
    higherRate: 0.40,
    additionalRate: 0.45,
    dividendAllowance: 500,
    dividendBasicRate: 0.1075,
    dividendHigherRate: 0.3575,
    dividendAdditionalRate: 0.3935,
    startingRateForSavingsBand: 5000,
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

export function previousTaxYear(taxYear: string) {
  const startYear = parseInt(taxYear.split("/")[0], 10);
  return `${startYear - 1}/${String(startYear).slice(-2)}`;
}

type TaxInput = {
  employmentIncome: number;
  selfEmploymentIncome: number;
  rentalIncome: number;
  propertyExpenses?: number;
  propertyFinanceCosts?: number;
  financeCostsBf?: number;
  pensionIncome: number;
  interestIncome: number;
  dividendIncome: number;
  foreignEmploymentIncome?: number;
  foreignInterestIncome?: number;
  foreignDividendIncome?: number;
  foreignRentalIncome?: number;
  foreignPropertyExpenses?: number;
  foreignPropertyFinanceCosts?: number;
  foreignFinanceCostsBf?: number;
  foreignTaxPaid?: number;
  taxYear: string;
};

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

  const propertyProfit = Math.max(0, input.rentalIncome - propertyExpenses);
  const foreignPropertyProfit = Math.max(0, foreignRentalIncome - foreignPropertyExpenses);

  const combinedInterestIncome = input.interestIncome + foreignInterestIncome;
  const combinedDividendIncome = input.dividendIncome + foreignDividendIncome;

  const nonSavingsIncome =
    input.employmentIncome + foreignEmploymentIncome + input.selfEmploymentIncome +
    propertyProfit + foreignPropertyProfit + input.pensionIncome;
  const totalIncome = nonSavingsIncome + combinedInterestIncome + combinedDividendIncome;

  let personalAllowance = r.personalAllowance;
  if (totalIncome > r.paTaperStart) {
    const reduction = Math.floor((totalIncome - r.paTaperStart) / 2);
    personalAllowance = Math.max(0, r.personalAllowance - reduction);
  }

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

  const adjustedTotalIncome = taxableNonSavings;

  const totalFinanceCostsAvailable = propertyFinanceCosts + financeCostsBf;
  const financeCostReliefCap = Math.max(0, Math.min(totalFinanceCostsAvailable, propertyProfit, adjustedTotalIncome));
  const financeCostTaxReducer = financeCostReliefCap * r.basicRate;
  const unusedFinanceCostsCf = Math.max(0, totalFinanceCostsAvailable - financeCostReliefCap);

  const totalForeignFinanceCostsAvailable = foreignPropertyFinanceCosts + foreignFinanceCostsBf;
  const foreignFinanceCostReliefCap = Math.max(0, Math.min(totalForeignFinanceCostsAvailable, foreignPropertyProfit, adjustedTotalIncome));
  const foreignFinanceCostTaxReducer = foreignFinanceCostReliefCap * r.basicRate;
  const unusedForeignFinanceCostsCf = Math.max(0, totalForeignFinanceCostsAvailable - foreignFinanceCostReliefCap);

  const paUsedAgainstSavings = Math.min(paRemaining, combinedInterestIncome);
  paRemaining -= paUsedAgainstSavings;
  const savingsAfterPA = Math.max(0, combinedInterestIncome - paUsedAgainstSavings);

  const startingRateRemaining = Math.max(0, r.startingRateForSavingsBand - taxableNonSavings);
  const startingRateUsed = Math.min(savingsAfterPA, startingRateRemaining);
  const afterStartingRate = savingsAfterPA - startingRateUsed;

  let psa = r.personalSavingsAllowanceBasic;
  if (taxableNonSavings >= r.additionalRateThreshold) psa = r.personalSavingsAllowanceAdditional;
  else if (taxableNonSavings >= r.basicRateLimit) psa = r.personalSavingsAllowanceHigher;

  const psaUsed = Math.min(afterStartingRate, psa);
  const taxableSavings = afterStartingRate - psaUsed;

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

export function getPaymentSchedule(taxYear: string, totalLiability: number, taxPaidAtSource: number) {
  const balanceDue = totalLiability - taxPaidAtSource;

  const proportionAtSource = totalLiability > 0 ? taxPaidAtSource / totalLiability : 1;
  const poaRequired = balanceDue > 1000 && proportionAtSource < 0.8;
  const poaAmount = poaRequired ? balanceDue / 2 : 0;

  const startYear = parseInt(taxYear.split("/")[0], 10);
  const balancingPaymentDate = new Date(Date.UTC(startYear + 2, 0, 31));
  const poa2Date = new Date(Date.UTC(startYear + 2, 6, 31));

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
  searchParams: Promise<{ mode?: string; client?: string; self_employment?: string; tax_year?: string }>;
}) {
  const { mode: modeParam, client: selectedClient, self_employment: prefillSelfEmployment, tax_year: selectedTaxYear } = await searchParams;

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

  const allRows = (computations || []).map(withResult);
  const openRows = allRows.filter((r) => r.comp.status !== "Approved");
  const completedRows = allRows.filter((r) => r.comp.status === "Approved");

  const statusBadge = (status: string | null | undefined) => {
    const s = status || "Draft";
    const style =
      s === "Sent" ? "bg-yellow-100 text-yellow-700"
      : s === "Queried" ? "bg-orange-100 text-orange-700"
      : s === "Approved" ? "bg-green-100 text-green-700"
      : "bg-slate-100 text-slate-600";
    return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{s}</span>;
  };

  const renderRow = ({ comp, result, balanceDue }: ReturnType<typeof withResult>) => {
    const carryForwardNote = [
      result.unusedFinanceCostsCf > 0 ? `£${result.unusedFinanceCostsCf.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UK finance costs c/f` : null,
      result.unusedForeignFinanceCostsCf > 0 ? `£${result.unusedForeignFinanceCostsCf.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} foreign finance costs c/f` : null,
    ].filter(Boolean).join(" · ");
    return (
    <div key={comp.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
      <a href={`/tax/${comp.id}`} className="flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-slate-900">
            {comp.clients?.client_name || "No client"} — {comp.tax_year}
          </p>
          {statusBadge(comp.status)}
        </div>
        <p className="text-sm text-slate-500">
          Total liability: £{result.totalLiability.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {carryForwardNote && ` · ${carryForwardNote}`}
        </p>
      </a>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className={`font-bold ${balanceDue >= 0 ? "text-slate-900" : "text-green-600"}`}>
            {balanceDue >= 0 ? `£${balanceDue.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due` : `£${Math.abs(balanceDue).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} refund`}
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

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <a href="/tax?mode=open"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "open" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "open" ? "text-white" : "text-slate-900"}`}>Open</p>
            <p className={`text-sm mt-1 ${mode === "open" ? "text-slate-300" : "text-slate-500"}`}>{openRows.length} not yet completed</p>
          </a>
          <a href="/tax?mode=completed"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "completed" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "completed" ? "text-white" : "text-slate-900"}`}>Completed</p>
            <p className={`text-sm mt-1 ${mode === "completed" ? "text-slate-300" : "text-slate-500"}`}>{completedRows.length} approved</p>
          </a>
          <a href="/tax?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Computation</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Enter income figures for a client's tax year</p>
          </a>
        </div>

        {mode === "open" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Open Computations</h2>
            {openRows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No open computations — everything's approved.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {openRows.map(renderRow)}
              </div>
            )}
          </div>
        )}

        {mode === "completed" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Completed Computations</h2>
            {completedRows.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">Nothing approved yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {completedRows.map(renderRow)}
              </div>
            )}
          </div>
        )}

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
