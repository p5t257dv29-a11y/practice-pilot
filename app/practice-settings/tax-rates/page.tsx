import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateTaxRates(taxYear: string, formData: FormData) {
  "use server";
  const num = (key: string) => parseFloat(String(formData.get(key) || "0"));

  const personal_tax = {
    personalAllowance: num("pt_personalAllowance"),
    paTaperStart: num("pt_paTaperStart"),
    paTaperEnd: num("pt_paTaperEnd"),
    basicRateLimit: num("pt_basicRateLimit"),
    additionalRateThreshold: num("pt_additionalRateThreshold"),
    basicRate: num("pt_basicRate"),
    higherRate: num("pt_higherRate"),
    additionalRate: num("pt_additionalRate"),
    dividendAllowance: num("pt_dividendAllowance"),
    dividendBasicRate: num("pt_dividendBasicRate"),
    dividendHigherRate: num("pt_dividendHigherRate"),
    dividendAdditionalRate: num("pt_dividendAdditionalRate"),
    startingRateForSavingsBand: num("pt_startingRateForSavingsBand"),
    startingRateForSavings: num("pt_startingRateForSavings"),
    personalSavingsAllowanceBasic: num("pt_personalSavingsAllowanceBasic"),
    personalSavingsAllowanceHigher: num("pt_personalSavingsAllowanceHigher"),
    personalSavingsAllowanceAdditional: num("pt_personalSavingsAllowanceAdditional"),
    class4LowerLimit: num("pt_class4LowerLimit"),
    class4UpperLimit: num("pt_class4UpperLimit"),
    class4MainRate: num("pt_class4MainRate"),
    class4UpperRate: num("pt_class4UpperRate"),
  };

  const corporation_tax = {
    smallProfitsRate: num("ct_smallProfitsRate"),
    mainRate: num("ct_mainRate"),
    smallProfitsThreshold: num("ct_smallProfitsThreshold"),
    mainRateThreshold: num("ct_mainRateThreshold"),
    marginalReliefFraction: num("ct_marginalReliefFraction"),
  };

  const p11d = {
    class1ANicRate: num("p11d_class1ANicRate"),
    defaultFuelMultiplier: num("p11d_defaultFuelMultiplier"),
    defaultOfficialRateOfInterest: num("p11d_defaultOfficialRateOfInterest"),
    loanDeMinimis: num("p11d_loanDeMinimis"),
    carContributionCap: num("p11d_carContributionCap"),
  };

  const capital_gains_tax = {
    annualExemptAmount: num("cgt_annualExemptAmount"),
    basicRate: num("cgt_basicRate"),
    higherRate: num("cgt_higherRate"),
    badrRate: num("cgt_badrRate"),
    basicRateBandWidth: num("cgt_basicRateBandWidth"),
  };

  await supabase.from("tax_rates").update({
    personal_tax,
    corporation_tax,
    p11d,
    capital_gains_tax,
    updated_at: new Date().toISOString(),
  }).eq("tax_year", taxYear);

  revalidatePath("/practice-settings/tax-rates");
}

async function addNewTaxYear(formData: FormData) {
  "use server";
  const newYear = String(formData.get("new_tax_year") || "").trim();
  const copyFromYear = String(formData.get("copy_from_year") || "").trim();
  if (!newYear || !copyFromYear) return;

  const { data: source } = await supabase.from("tax_rates").select("*").eq("tax_year", copyFromYear).single();
  if (!source) return;

  await supabase.from("tax_rates").insert({
    tax_year: newYear,
    personal_tax: source.personal_tax,
    corporation_tax: source.corporation_tax,
    p11d: source.p11d,
    capital_gains_tax: source.capital_gains_tax,
  });

  revalidatePath("/practice-settings/tax-rates");
}

export default async function TaxRatesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;

  const { data: allRates } = await supabase.from("tax_rates").select("*").order("tax_year", { ascending: false });
  const activeYear = year || allRates?.[0]?.tax_year || "2026/27";
  const current = (allRates || []).find((r) => r.tax_year === activeYear);

  const updateWithYear = updateTaxRates.bind(null, activeYear);

  const Field = ({ label, name, defaultValue, step = "0.01" }: { label: string; name: string; defaultValue: number; step?: string }) => (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input name={name} type="number" step={step} defaultValue={defaultValue}
        className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Tax Rates & Thresholds</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          The single source of truth for every rate used in Personal Tax, Corporation Tax, P11D, and Capital Gains Tax calculations. Update these once a year, after the Budget confirms new figures.
        </p>

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          {(allRates || []).map((r) => (
            <a key={r.tax_year} href={`/practice-settings/tax-rates?year=${r.tax_year}`}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeYear === r.tax_year ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}>
              {r.tax_year}
            </a>
          ))}

          <form action={addNewTaxYear} className="flex items-center gap-1 ml-2">
            <input type="hidden" name="copy_from_year" value={activeYear} />
            <input name="new_tax_year" placeholder="e.g. 2027/28"
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-slate-400" />
            <button type="submit"
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
              + Add year (copies from {activeYear})
            </button>
          </form>
        </div>
      </div>

      <div className="p-8">
        {!current ? (
          <div className="rounded-2xl bg-white p-12 shadow-sm border border-slate-100 text-center">
            <p className="text-slate-500">No rates found for {activeYear}.</p>
          </div>
        ) : (
          <form action={updateWithYear} className="space-y-6">

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Personal Tax — {activeYear}</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <Field label="Personal Allowance (£)" name="pt_personalAllowance" defaultValue={current.personal_tax.personalAllowance} step="1" />
                <Field label="PA Taper Start (£)" name="pt_paTaperStart" defaultValue={current.personal_tax.paTaperStart} step="1" />
                <Field label="PA Taper End (£)" name="pt_paTaperEnd" defaultValue={current.personal_tax.paTaperEnd} step="1" />
                <Field label="Basic Rate Limit (£)" name="pt_basicRateLimit" defaultValue={current.personal_tax.basicRateLimit} step="1" />
                <Field label="Additional Rate Threshold (£)" name="pt_additionalRateThreshold" defaultValue={current.personal_tax.additionalRateThreshold} step="1" />
                <Field label="Basic Rate" name="pt_basicRate" defaultValue={current.personal_tax.basicRate} />
                <Field label="Higher Rate" name="pt_higherRate" defaultValue={current.personal_tax.higherRate} />
                <Field label="Additional Rate" name="pt_additionalRate" defaultValue={current.personal_tax.additionalRate} />
                <Field label="Dividend Allowance (£)" name="pt_dividendAllowance" defaultValue={current.personal_tax.dividendAllowance} step="1" />
                <Field label="Dividend Basic Rate" name="pt_dividendBasicRate" defaultValue={current.personal_tax.dividendBasicRate} />
                <Field label="Dividend Higher Rate" name="pt_dividendHigherRate" defaultValue={current.personal_tax.dividendHigherRate} />
                <Field label="Dividend Additional Rate" name="pt_dividendAdditionalRate" defaultValue={current.personal_tax.dividendAdditionalRate} />
                <Field label="Starting Rate for Savings Band (£)" name="pt_startingRateForSavingsBand" defaultValue={current.personal_tax.startingRateForSavingsBand} step="1" />
                <Field label="Starting Rate for Savings" name="pt_startingRateForSavings" defaultValue={current.personal_tax.startingRateForSavings} />
                <Field label="Personal Savings Allowance (Basic) (£)" name="pt_personalSavingsAllowanceBasic" defaultValue={current.personal_tax.personalSavingsAllowanceBasic} step="1" />
                <Field label="Personal Savings Allowance (Higher) (£)" name="pt_personalSavingsAllowanceHigher" defaultValue={current.personal_tax.personalSavingsAllowanceHigher} step="1" />
                <Field label="Personal Savings Allowance (Additional) (£)" name="pt_personalSavingsAllowanceAdditional" defaultValue={current.personal_tax.personalSavingsAllowanceAdditional} step="1" />
                <Field label="Class 4 Lower Limit (£)" name="pt_class4LowerLimit" defaultValue={current.personal_tax.class4LowerLimit} step="1" />
                <Field label="Class 4 Upper Limit (£)" name="pt_class4UpperLimit" defaultValue={current.personal_tax.class4UpperLimit} step="1" />
                <Field label="Class 4 Main Rate" name="pt_class4MainRate" defaultValue={current.personal_tax.class4MainRate} />
                <Field label="Class 4 Upper Rate" name="pt_class4UpperRate" defaultValue={current.personal_tax.class4UpperRate} />
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Corporation Tax — {activeYear}</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <Field label="Small Profits Rate" name="ct_smallProfitsRate" defaultValue={current.corporation_tax.smallProfitsRate} />
                <Field label="Main Rate" name="ct_mainRate" defaultValue={current.corporation_tax.mainRate} />
                <Field label="Small Profits Threshold (£)" name="ct_smallProfitsThreshold" defaultValue={current.corporation_tax.smallProfitsThreshold} step="1" />
                <Field label="Main Rate Threshold (£)" name="ct_mainRateThreshold" defaultValue={current.corporation_tax.mainRateThreshold} step="1" />
                <Field label="Marginal Relief Fraction" name="ct_marginalReliefFraction" defaultValue={current.corporation_tax.marginalReliefFraction} step="0.0001" />
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">P11D — {activeYear}</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <Field label="Class 1A NIC Rate" name="p11d_class1ANicRate" defaultValue={current.p11d.class1ANicRate} />
                <Field label="Default Fuel Multiplier (£)" name="p11d_defaultFuelMultiplier" defaultValue={current.p11d.defaultFuelMultiplier} step="1" />
                <Field label="Default Official Rate of Interest (%)" name="p11d_defaultOfficialRateOfInterest" defaultValue={current.p11d.defaultOfficialRateOfInterest} />
                <Field label="Loan De Minimis (£)" name="p11d_loanDeMinimis" defaultValue={current.p11d.loanDeMinimis} step="1" />
                <Field label="Car Contribution Cap (£)" name="p11d_carContributionCap" defaultValue={current.p11d.carContributionCap} step="1" />
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Capital Gains Tax — {activeYear}</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <Field label="Annual Exempt Amount (£)" name="cgt_annualExemptAmount" defaultValue={current.capital_gains_tax.annualExemptAmount} step="1" />
                <Field label="Basic Rate" name="cgt_basicRate" defaultValue={current.capital_gains_tax.basicRate} />
                <Field label="Higher Rate" name="cgt_higherRate" defaultValue={current.capital_gains_tax.higherRate} />
                <Field label="BADR Rate" name="cgt_badrRate" defaultValue={current.capital_gains_tax.badrRate} />
                <Field label="Basic Rate Band Width (£)" name="cgt_basicRateBandWidth" defaultValue={current.capital_gains_tax.basicRateBandWidth} step="1" />
              </div>
            </div>

            <button type="submit"
              className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Save {activeYear} Rates
            </button>
          </form>
        )}
      </div>
    </div>
  );
}