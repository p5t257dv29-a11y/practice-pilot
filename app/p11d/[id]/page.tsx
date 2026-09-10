import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import {
  getCarBenefitPercentage, calculateCarBenefit, calculateVanBenefit, getP11dRates,
  type CarFuelType, type P11DRates,
} from "../page";
import SendP11DButton from "../send-p11d-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateComputation(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;
  const int = (key: string) => parseInt(get(key)) || 0;

  const { error: updateError } = await supabase.from("p11d_computations").update({
    employee_name: get("employee_name"),
    car_list_price: num("car_list_price"),
    car_benefit_percentage: num("car_benefit_percentage"),
    car_capital_contribution: num("car_capital_contribution"),
    car_available_days: int("car_available_days"),
    fuel_provided: formData.get("fuel_provided") === "on",
    fuel_benefit_multiplier: num("fuel_benefit_multiplier"),
    van_provided: formData.get("van_provided") === "on",
    van_is_zero_emission: formData.get("van_is_zero_emission") === "on",
    van_available_days: int("van_available_days"),
    van_employee_contribution: num("van_employee_contribution"),
    van_fuel_provided: formData.get("van_fuel_provided") === "on",
    medical_premium: num("medical_premium"),
    medical_employee_contribution: num("medical_employee_contribution"),
    loan_balance: num("loan_balance"),
    loan_interest_paid: num("loan_interest_paid"),
    official_rate_of_interest: num("official_rate_of_interest"),
    other_benefits_description: get("other_benefits_description") || null,
    other_benefits_amount: num("other_benefits_amount"),
    notes: get("notes") || null,
  }).eq("id", id);

  if (updateError) {
    throw new Error(`Failed to save P11D computation: ${updateError.message}`);
  }

  revalidatePath(`/p11d/${id}`);
}

// Applies the checker's calculated CO2-based percentage straight into the
// existing car_benefit_percentage field — no other part of the record or
// calculation changes, so this can never touch the total in an unexpected way.
async function applyCarPercentage(id: string, percentage: number) {
  "use server";
  await supabase.from("p11d_computations").update({ car_benefit_percentage: percentage }).eq("id", id);
  revalidatePath(`/p11d/${id}`);
}

async function applyFuelMultiplier(id: string, multiplier: number) {
  "use server";
  await supabase.from("p11d_computations").update({ fuel_benefit_multiplier: multiplier }).eq("id", id);
  revalidatePath(`/p11d/${id}`);
}

export default async function P11DDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fuel_type?: string; co2?: string; ev_range?: string }>;
}) {
  const { id } = await params;
  const { fuel_type, co2, ev_range } = await searchParams;

  const { data: comp, error } = await supabase
    .from("p11d_computations")
    .select("*, clients(client_name, email)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const client = comp.clients as any;
  const rates = await getP11dRates(comp.tax_year);

  // Live checker preview — recalculated from the query string on every
  // load, so adjusting the inputs updates the preview without needing to
  // save anything first.
  const checkerFuelType = (fuel_type as CarFuelType) || "Petrol";
  const checkerCo2 = parseFloat(co2 || "0") || 0;
  const checkerEvRange = parseFloat(ev_range || "0") || 0;
  const checkerPercentage = getCarBenefitPercentage(rates, checkerFuelType, checkerCo2, checkerEvRange);
  const showEvRangeInput = checkerCo2 > 0 && checkerCo2 <= 50;

  const { carBenefit, fuelBenefit, cappedContribution } = calculateCarBenefit(rates, {
    listPrice: Number(comp.car_list_price),
    capitalContribution: Number(comp.car_capital_contribution),
    percentage: Number(comp.car_benefit_percentage),
    availableDays: Number(comp.car_available_days),
    fuelProvided: comp.fuel_provided,
  });

  const { vanBenefit, vanFuelBenefit } = calculateVanBenefit(rates, {
    provided: comp.van_provided,
    isZeroEmission: comp.van_is_zero_emission,
    availableDays: Number(comp.van_available_days),
    employeeContribution: Number(comp.van_employee_contribution),
    fuelProvided: comp.van_fuel_provided,
  });

  const medicalBenefit = Math.max(0, Number(comp.medical_premium) - Number(comp.medical_employee_contribution));

  // Beneficial loans below the de minimis threshold at any point in the year are exempt entirely
  const loanBenefit = Number(comp.loan_balance) > rates.loanDeMinimis
    ? Math.max(0, (Number(comp.loan_balance) * (Number(comp.official_rate_of_interest) / 100)) - Number(comp.loan_interest_paid))
    : 0;

  const otherBenefits = Number(comp.other_benefits_amount);

  const totalBenefitsValue = carBenefit + fuelBenefit + vanBenefit + vanFuelBenefit + medicalBenefit + loanBenefit + otherBenefits;

  // Class 1A NIC is an employer cost, not deducted from the employee — shown
  // separately since it doesn't affect the employee's own tax position.
  const class1ANIC = totalBenefitsValue * rates.class1ANicRate;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const applyPercentageWithId = applyCarPercentage.bind(null, id, checkerPercentage);
  const applyMultiplierWithId = applyFuelMultiplier.bind(null, id, rates.defaultFuelMultiplier);

  const buildCheckerHref = (patch: Partial<{ fuel_type: string; co2: string; ev_range: string }>) => {
    const params = new URLSearchParams({
      fuel_type: patch.fuel_type ?? checkerFuelType,
      co2: patch.co2 ?? String(checkerCo2 || ""),
      ev_range: patch.ev_range ?? String(checkerEvRange || ""),
    });
    return `/p11d/${id}?${params.toString()}`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/p11d" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">← Back to P11D</a>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{comp.employee_name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{client?.client_name || "No client"} · {comp.tax_year}</p>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {/* Car & Van Benefit Checker */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-indigo-100">
            <h2 className="text-lg font-bold text-slate-900">Car Benefit Checker</h2>
            <p className="text-xs text-slate-400 mt-1">
              Work out the correct CO2-based percentage and current fuel benefit charge for {comp.tax_year} — no need to look these up separately.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <form method="get">
                <input type="hidden" name="co2" value={checkerCo2 || ""} />
                <input type="hidden" name="ev_range" value={checkerEvRange || ""} />
                <label className="block text-xs font-medium text-slate-700 mb-1">Fuel Type</label>
                <select name="fuel_type" defaultValue={checkerFuelType} onChange={undefined}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Petrol</option>
                  <option>Diesel (RDE2 compliant)</option>
                  <option>Diesel (not RDE2 compliant)</option>
                  <option>Hybrid</option>
                  <option>Electric</option>
                </select>
                <button type="submit" className="sr-only">Update</button>
              </form>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">CO2 Emissions (g/km)</label>
                <form method="get">
                  <input type="hidden" name="fuel_type" value={checkerFuelType} />
                  <input type="hidden" name="ev_range" value={checkerEvRange || ""} />
                  <input name="co2" type="number" step="1" min="0" defaultValue={checkerCo2 || ""}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="0 for pure electric" />
                  <button type="submit" className="mt-1.5 w-full rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                    Recalculate
                  </button>
                </form>
              </div>

              {showEvRangeInput && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Electric Range (miles)</label>
                  <form method="get">
                    <input type="hidden" name="fuel_type" value={checkerFuelType} />
                    <input type="hidden" name="co2" value={checkerCo2} />
                    <input name="ev_range" type="number" step="1" min="0" defaultValue={checkerEvRange || ""}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    <button type="submit" className="mt-1.5 w-full rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                      Recalculate
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div className="mt-4 rounded-xl bg-indigo-50 border border-indigo-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-indigo-600 font-semibold uppercase tracking-wide">Calculated Percentage</p>
                <p className="text-2xl font-bold text-indigo-900">{checkerPercentage}%</p>
              </div>
              <form action={applyPercentageWithId}>
                <button type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors">
                  Apply to Car Benefit %
                </button>
              </form>
            </div>

            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{comp.tax_year} Fuel Benefit Multiplier</p>
                <p className="text-lg font-bold text-slate-900">{fmt(rates.defaultFuelMultiplier)}</p>
              </div>
              <form action={applyMultiplierWithId}>
                <button type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Apply to Fuel Multiplier
                </button>
              </form>
            </div>

            <p className="text-xs text-amber-700 mt-3">
              Fuel benefit isn't reduced for low private mileage — providing any free fuel for private use triggers the full charge for the days the car was available.
            </p>
          </div>

          {/* Car & Fuel Benefit */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Car & Fuel Benefit</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">List price</span><span className="font-medium">{fmt(Number(comp.car_list_price))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Less: capital contribution (capped at {fmt(rates.carContributionCap)})</span><span className="font-medium">({fmt(cappedContribution)})</span></div>
              <div className="flex justify-between"><span className="text-slate-500">× Benefit percentage</span><span className="font-medium">{Number(comp.car_benefit_percentage)}%</span></div>
              <div className="flex justify-between"><span className="text-slate-500">× Days available / 365</span><span className="font-medium">{comp.car_available_days} / 365</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Car Benefit</span><span>{fmt(carBenefit)}</span></div>
              {comp.fuel_provided && (
                <div className="flex justify-between font-bold text-amber-700"><span>Fuel Benefit</span><span>{fmt(fuelBenefit)}</span></div>
              )}
            </div>
          </div>

          {/* Van & Van Fuel Benefit */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Van & Van Fuel Benefit</h2>
            <p className="text-xs text-slate-400 mt-1">Flat annual figure, not CO2-based — {fmt(rates.vanBenefitFlat)} for {comp.tax_year}, nil if zero-emission.</p>
            <div className="mt-4 space-y-2 text-sm">
              {comp.van_provided ? (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Flat van benefit ({comp.tax_year})</span><span className="font-medium">{comp.van_is_zero_emission ? "£0.00 (zero-emission)" : fmt(rates.vanBenefitFlat)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">× Days available / 365</span><span className="font-medium">{comp.van_available_days} / 365</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Less: employee contribution</span><span className="font-medium">({fmt(Number(comp.van_employee_contribution))})</span></div>
                  <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Van Benefit</span><span>{fmt(vanBenefit)}</span></div>
                  {comp.van_fuel_provided && !comp.van_is_zero_emission && (
                    <div className="flex justify-between font-bold text-amber-700"><span>Van Fuel Benefit</span><span>{fmt(vanFuelBenefit)}</span></div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400 text-center py-2">No van provided.</p>
              )}
            </div>
          </div>

          {/* Medical Benefit */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Private Medical Benefit</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Premium paid by employer</span><span className="font-medium">{fmt(Number(comp.medical_premium))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Less: employee contribution</span><span className="font-medium">({fmt(Number(comp.medical_employee_contribution))})</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Medical Benefit</span><span>{fmt(medicalBenefit)}</span></div>
            </div>
          </div>

          {/* Loan Benefit */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Beneficial Loan</h2>
            <p className="text-xs text-slate-400 mt-1">Exempt entirely if the balance never exceeded {fmt(rates.loanDeMinimis)} at any point in the year.</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Loan balance</span><span className="font-medium">{fmt(Number(comp.loan_balance))}</span></div>
              {Number(comp.loan_balance) > rates.loanDeMinimis ? (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">× Official rate of interest</span><span className="font-medium">{Number(comp.official_rate_of_interest)}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Less: interest actually paid</span><span className="font-medium">({fmt(Number(comp.loan_interest_paid))})</span></div>
                  <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Loan Benefit</span><span>{fmt(loanBenefit)}</span></div>
                </>
              ) : (
                <p className="text-sm text-green-700">Below the {fmt(rates.loanDeMinimis)} threshold — no benefit arises.</p>
              )}
            </div>
          </div>

          {/* Other Benefits */}
          {Number(comp.other_benefits_amount) > 0 && (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Other Benefits</h2>
              <div className="mt-4 flex justify-between text-sm font-bold">
                <span>{comp.other_benefits_description || "Other benefits"}</span>
                <span>{fmt(otherBenefits)}</span>
              </div>
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
            <h2 className="text-lg font-bold">Total Benefits Value</h2>
            <p className="mt-4 text-3xl font-bold">{fmt(totalBenefitsValue)}</p>
            <p className="text-xs text-slate-400 mt-1">Taxable via the employee's tax code (or payroll, once mandatory payrolling applies).</p>
            <div className="mt-4 pt-4 border-t border-slate-700">
              <div className="flex justify-between text-sm">
                <span className="text-slate-300">Employer Class 1A NIC ({(rates.class1ANicRate * 100).toFixed(0)}%)</span>
                <span className="font-bold">{fmt(class1ANIC)}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Employer-only cost, reported via P11D(b) — not deducted from the employee.</p>
            </div>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              Company cars, van benefits, and private medical are due to move to mandatory payrolling from 6 April 2027 (Phase 1) — check whether this client should be payrolling this benefit instead of filing a P11D for it.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Send to Client</h2>
            <div className="mt-4">
              <SendP11DButton
                computationId={id}
                defaultEmail={comp.client_email || client?.email || ""}
                computationToken={comp.token}
                status={comp.status}
                approvedAt={comp.approved_at}
                queriedAt={comp.queried_at}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Edit Computation</h2>
            <form action={updateComputation.bind(null, id)} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Employee Name</label>
                <input name="employee_name" defaultValue={comp.employee_name}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Car & Fuel</p>
                <div className="space-y-2">
                  <input name="car_list_price" type="number" step="0.01" min="0" defaultValue={comp.car_list_price} placeholder="List price (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="car_benefit_percentage" type="number" step="0.01" min="0" max="37" defaultValue={comp.car_benefit_percentage} placeholder="Benefit % (use checker above)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="car_capital_contribution" type="number" step="0.01" min="0" defaultValue={comp.car_capital_contribution} placeholder="Capital contribution (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="car_available_days" type="number" step="1" min="0" max="366" defaultValue={comp.car_available_days} placeholder="Days available"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="fuel_provided" type="checkbox" defaultChecked={comp.fuel_provided} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Fuel provided for private use</span>
                  </label>
                  <input name="fuel_benefit_multiplier" type="number" step="0.01" min="0" defaultValue={comp.fuel_benefit_multiplier} placeholder="Fuel multiplier (use checker above)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Van & Van Fuel</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="van_provided" type="checkbox" defaultChecked={comp.van_provided} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Van provided for private use</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="van_is_zero_emission" type="checkbox" defaultChecked={comp.van_is_zero_emission} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Zero-emission van</span>
                  </label>
                  <input name="van_available_days" type="number" step="1" min="0" max="366" defaultValue={comp.van_available_days} placeholder="Days available"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="van_employee_contribution" type="number" step="0.01" min="0" defaultValue={comp.van_employee_contribution} placeholder="Employee contribution (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input name="van_fuel_provided" type="checkbox" defaultChecked={comp.van_fuel_provided} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium text-slate-700">Van fuel provided for private use</span>
                  </label>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Private Medical</p>
                <div className="space-y-2">
                  <input name="medical_premium" type="number" step="0.01" min="0" defaultValue={comp.medical_premium} placeholder="Premium paid (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="medical_employee_contribution" type="number" step="0.01" min="0" defaultValue={comp.medical_employee_contribution} placeholder="Employee contribution (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Beneficial Loan</p>
                <div className="space-y-2">
                  <input name="loan_balance" type="number" step="0.01" min="0" defaultValue={comp.loan_balance} placeholder="Loan balance (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="loan_interest_paid" type="number" step="0.01" min="0" defaultValue={comp.loan_interest_paid} placeholder="Interest actually paid (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="official_rate_of_interest" type="number" step="0.01" min="0" defaultValue={comp.official_rate_of_interest} placeholder="Official rate of interest (%)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <p className="text-xs text-slate-400">HMRC hadn't announced the {comp.tax_year} official rate as of last check — verify current rate before finalising.</p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Other Benefits</p>
                <div className="space-y-2">
                  <input name="other_benefits_description" defaultValue={comp.other_benefits_description || ""} placeholder="Description"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  <input name="other_benefits_amount" type="number" step="0.01" min="0" defaultValue={comp.other_benefits_amount} placeholder="Amount (£)"
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={comp.notes || ""} rows={3}
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