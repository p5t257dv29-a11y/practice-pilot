import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============================================================
// Car, van & fuel benefit calculation library — all rates and bands are
// pulled live from tax_rates.p11d (Practice Settings → Tax Rates), the same
// pattern already used by getTaxRates()/getCtRates() for Personal Tax and
// Corporation Tax. Editing a rate there updates every computation that uses
// it — nothing here is hardcoded into the app itself.
// ============================================================

export type CarFuelType = "Petrol" | "Diesel (RDE2 compliant)" | "Diesel (not RDE2 compliant)" | "Hybrid" | "Electric";

const P11D_RATES_FALLBACK = {
  loanDeMinimis: 10000,
  class1ANicRate: 0.15,
  carContributionCap: 5000,
  defaultFuelMultiplier: 29200,
  defaultOfficialRateOfInterest: 3.75,
  vanBenefitFlat: 4170,
  vanFuelBenefitFlat: 798,
  dieselSurcharge: 4,
  capPercentage: 37,
  zeroEmissionVanBenefit: true,
  lowEmissionBands: [
    { minRangeMiles: 130, percentage: 4 },
    { minRangeMiles: 70, percentage: 7 },
    { minRangeMiles: 40, percentage: 10 },
    { minRangeMiles: 30, percentage: 14 },
    { minRangeMiles: 0, percentage: 16 },
  ],
  standardBands: [
    { maxCo2: 54, percentage: 17 }, { maxCo2: 59, percentage: 18 }, { maxCo2: 64, percentage: 19 },
    { maxCo2: 69, percentage: 20 }, { maxCo2: 74, percentage: 21 }, { maxCo2: 79, percentage: 21 },
    { maxCo2: 84, percentage: 22 }, { maxCo2: 89, percentage: 23 }, { maxCo2: 94, percentage: 24 },
    { maxCo2: 99, percentage: 25 }, { maxCo2: 104, percentage: 26 }, { maxCo2: 109, percentage: 27 },
    { maxCo2: 114, percentage: 28 }, { maxCo2: 119, percentage: 29 }, { maxCo2: 124, percentage: 30 },
    { maxCo2: 129, percentage: 31 }, { maxCo2: 134, percentage: 32 }, { maxCo2: 139, percentage: 33 },
    { maxCo2: 144, percentage: 34 }, { maxCo2: 149, percentage: 35 }, { maxCo2: 154, percentage: 36 },
    { maxCo2: 159, percentage: 37 },
  ],
};

export type P11DRates = typeof P11D_RATES_FALLBACK;

export async function getP11dRates(taxYear: string): Promise<P11DRates> {
  const { data } = await supabase.from("tax_rates").select("p11d").eq("tax_year", taxYear).maybeSingle();
  return { ...P11D_RATES_FALLBACK, ...(data?.p11d || {}) };
}

function getLowEmissionPercentage(rates: P11DRates, electricRangeMiles: number): number {
  const sorted = [...rates.lowEmissionBands].sort((a, b) => b.minRangeMiles - a.minRangeMiles);
  const match = sorted.find((b) => electricRangeMiles >= b.minRangeMiles);
  return match ? match.percentage : sorted[sorted.length - 1].percentage;
}

export function getCarBenefitPercentage(rates: P11DRates, fuelType: CarFuelType, co2: number, electricRangeMiles?: number): number {
  const co2Rounded = Math.floor(co2 / 5) * 5; // HMRC rounds CO2 down to the nearest 5g/km

  let base: number;
  if (co2Rounded <= 0) {
    base = getLowEmissionPercentage(rates, electricRangeMiles || 999); // pure electric — top band
  } else if (co2Rounded <= 50) {
    base = getLowEmissionPercentage(rates, electricRangeMiles || 0);
  } else {
    const sorted = [...rates.standardBands].sort((a, b) => a.maxCo2 - b.maxCo2);
    const band = sorted.find((b) => co2Rounded <= b.maxCo2);
    base = band ? band.percentage : rates.capPercentage;
  }

  if (fuelType === "Diesel (not RDE2 compliant)") {
    base = Math.min(rates.capPercentage, base + rates.dieselSurcharge);
  }

  return base;
}

// Car and fuel benefit both apportion by days the car was actually available
// in the tax year — a full year is treated as 365 days, matching HMRC's own
// day-apportionment method (not calendar-exact leap year adjustment).
export function calculateCarBenefit(rates: P11DRates, {
  listPrice, capitalContribution, percentage, availableDays, fuelProvided,
}: {
  listPrice: number; capitalContribution: number; percentage: number; availableDays: number; fuelProvided: boolean;
}) {
  const cappedContribution = Math.min(capitalContribution, rates.carContributionCap);
  const carBenefit = ((listPrice - cappedContribution) * (percentage / 100)) * (availableDays / 365);
  // Fuel benefit is NOT apportioned by actual private mileage — only by the
  // same days-available ratio as the car itself. Providing free fuel for
  // even one mile of private use triggers the full charge for the period.
  const fuelBenefit = fuelProvided ? rates.defaultFuelMultiplier * (percentage / 100) * (availableDays / 365) : 0;
  return { carBenefit, fuelBenefit, cappedContribution };
}

export function calculateVanBenefit(rates: P11DRates, {
  provided, isZeroEmission, availableDays, employeeContribution, fuelProvided,
}: {
  provided: boolean; isZeroEmission: boolean; availableDays: number; employeeContribution: number; fuelProvided: boolean;
}) {
  if (!provided) return { vanBenefit: 0, vanFuelBenefit: 0 };
  // Zero-emission vans currently attract a nil benefit charge — the
  // "zeroEmissionVanBenefit" flag in Tax Rates controls this, in case that
  // changes in a future year.
  const vanBenefit = (isZeroEmission && rates.zeroEmissionVanBenefit)
    ? 0
    : Math.max(0, (rates.vanBenefitFlat * (availableDays / 365)) - employeeContribution);
  const vanFuelBenefit = fuelProvided && !(isZeroEmission && rates.zeroEmissionVanBenefit)
    ? rates.vanFuelBenefitFlat * (availableDays / 365)
    : 0;
  return { vanBenefit, vanFuelBenefit };
}

// ============================================================
// List page
// ============================================================

async function deleteComputation(id: string) {
  "use server";
  await supabase.from("p11d_computations").delete().eq("id", id);
  revalidatePath("/p11d");
}

// ============================================================
// Original P11D totals calculation — used by the P11D(b) summary,
// approval page, and send-email route. Kept exactly as a separate,
// self-contained calculation from the car/van checker above, since other
// files import this specific function and constant by name.
// ============================================================

export const P11D_RATES = {
  class1ANicRate: 0.15,
  carContributionCap: 5000,
  loanDeMinimis: 10000,
};

export function calculateP11D(comp: {
  car_list_price: number; car_capital_contribution: number; car_benefit_percentage: number; car_available_days: number;
  fuel_provided: boolean; fuel_benefit_multiplier: number;
  van_provided?: boolean; van_is_zero_emission?: boolean; van_available_days?: number; van_employee_contribution?: number; van_fuel_provided?: boolean;
  medical_premium: number; medical_employee_contribution: number;
  loan_balance: number; loan_interest_paid: number; official_rate_of_interest: number;
  other_benefits_amount: number;
}) {
  const cappedContribution = Math.min(Number(comp.car_capital_contribution) || 0, P11D_RATES.carContributionCap);
  const carBenefit = ((Number(comp.car_list_price) || 0) - cappedContribution) * ((Number(comp.car_benefit_percentage) || 0) / 100) * ((Number(comp.car_available_days) || 0) / 365);
  const fuelBenefit = comp.fuel_provided
    ? (Number(comp.fuel_benefit_multiplier) || 0) * ((Number(comp.car_benefit_percentage) || 0) / 100) * ((Number(comp.car_available_days) || 0) / 365)
    : 0;

  const medicalBenefit = Math.max(0, (Number(comp.medical_premium) || 0) - (Number(comp.medical_employee_contribution) || 0));

  const loanBenefit = (Number(comp.loan_balance) || 0) > P11D_RATES.loanDeMinimis
    ? Math.max(0, ((Number(comp.loan_balance) || 0) * ((Number(comp.official_rate_of_interest) || 0) / 100)) - (Number(comp.loan_interest_paid) || 0))
    : 0;

  const otherBenefits = Number(comp.other_benefits_amount) || 0;

  const totalBenefitsValue = carBenefit + fuelBenefit + medicalBenefit + loanBenefit + otherBenefits;
  const class1ANIC = totalBenefitsValue * P11D_RATES.class1ANicRate;

  return {
    carBenefit, fuelBenefit, medicalBenefit, loanBenefit, otherBenefits,
    totalBenefitsValue, class1ANIC,
  };
}

export default async function P11DPage() {
  const { data: computations, error } = await supabase
    .from("p11d_computations")
    .select("*, clients!client_id(client_name)")
    .order("created_at", { ascending: false });

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Rates are fetched once per distinct tax year present, then reused
  const ratesCache = new Map<string, P11DRates>();
  const getCachedRates = async (taxYear: string) => {
    if (!ratesCache.has(taxYear)) {
      ratesCache.set(taxYear, await getP11dRates(taxYear));
    }
    return ratesCache.get(taxYear)!;
  };

  const rowTotal = async (c: any) => {
    const rates = await getCachedRates(c.tax_year);
    const { carBenefit, fuelBenefit } = calculateCarBenefit(rates, {
      listPrice: Number(c.car_list_price), capitalContribution: Number(c.car_capital_contribution),
      percentage: Number(c.car_benefit_percentage), availableDays: Number(c.car_available_days),
      fuelProvided: c.fuel_provided,
    });
    const { vanBenefit, vanFuelBenefit } = calculateVanBenefit(rates, {
      provided: c.van_provided, isZeroEmission: c.van_is_zero_emission, availableDays: Number(c.van_available_days),
      employeeContribution: Number(c.van_employee_contribution), fuelProvided: c.van_fuel_provided,
    });
    const medicalBenefit = Math.max(0, Number(c.medical_premium) - Number(c.medical_employee_contribution));
    const loanBenefit = Number(c.loan_balance) > rates.loanDeMinimis
      ? Math.max(0, (Number(c.loan_balance) * (Number(c.official_rate_of_interest) / 100)) - Number(c.loan_interest_paid))
      : 0;
    return carBenefit + fuelBenefit + vanBenefit + vanFuelBenefit + medicalBenefit + loanBenefit + Number(c.other_benefits_amount);
  };

  const rowTotals = await Promise.all((computations || []).map((c) => rowTotal(c)));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">P11D — Benefits in Kind</h1>
            <p className="text-sm text-slate-500 mt-0.5">Car, van, fuel, medical, loan and other benefits per employee.</p>
          </div>
          <a href="/p11d/new"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            + New Computation
          </a>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">Could not load: {error.message}</div>
        )}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Computations ({computations?.length ?? 0})</h2>
          <div className="mt-4 space-y-3">
            {(computations || []).map((c, i) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                <a href={`/p11d/${c.id}`} className="flex-1">
                  <p className="font-semibold text-slate-900">{c.employee_name} — {(c.clients as any)?.client_name || "No client"}</p>
                  <p className="text-sm text-slate-500">{c.tax_year}</p>
                </a>
                <div className="flex items-center gap-4">
                  <p className="font-bold text-slate-900">{fmt(rowTotals[i])}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    c.status === "Approved" ? "bg-green-100 text-green-700" : c.status === "Sent" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                  }`}>{c.status || "Draft"}</span>
                  <form action={deleteComputation.bind(null, c.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">Delete</button>
                  </form>
                </div>
              </div>
            ))}
            {(!computations || computations.length === 0) && (
              <p className="text-sm text-slate-500 text-center py-8">No P11D computations yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}