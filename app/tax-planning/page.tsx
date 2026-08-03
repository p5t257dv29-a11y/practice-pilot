import { createClient } from "@supabase/supabase-js";
import { calculateTax, TAX_RATES, getTaxRates } from "../tax/page";
import { calculateCorporationTax, CT_RATES, getCtRates } from "../corporation-tax/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Employer's NI has no Employment Allowance applied here — a single-director company
// with no other employees generally cannot claim it, which is the common case this
// tool is aimed at. If the practice has clients who can claim it, treat these figures
// as a slightly conservative (higher) estimate of the salary route's NI cost.
const NI_RATES: Record<string, any> = {
  "2026/27": {
    lowerEarningsLimit: 6500,
    employeePrimaryThreshold: 12570,
    employeeUpperEarningsLimit: 50270,
    employeeMainRate: 0.08,
    employeeUpperRate: 0.02,
    employerSecondaryThreshold: 9100,
    employerRate: 0.138,
  },
};

// Fetches live NI rates from the tax_rates table (editable via Practice Settings →
// Tax Rates), falling back to the hardcoded defaults above if no row exists yet.
async function getNiRates(taxYear: string) {
  const { data } = await supabase
    .from("tax_rates")
    .select("national_insurance")
    .eq("tax_year", taxYear)
    .maybeSingle();
  return data?.national_insurance || NI_RATES[taxYear] || NI_RATES["2026/27"];
}
function calculateNI(annualSalary: number, rates: any) {
  const employeeBand1 = Math.max(
    0,
    Math.min(annualSalary, rates.employeeUpperEarningsLimit) - rates.employeePrimaryThreshold
  );
  const employeeBand2 = Math.max(0, annualSalary - rates.employeeUpperEarningsLimit);
  const employeeNI = employeeBand1 * rates.employeeMainRate + employeeBand2 * rates.employeeUpperRate;

  const employerBand = Math.max(0, annualSalary - rates.employerSecondaryThreshold);
  const employerNI = employerBand * rates.employerRate;

  return { employeeNI, employerNI };
}

function fmt(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function TaxPlanningPage({
  searchParams,
}: {
searchParams: Promise<{ clientId?: string; profit?: string; taxYear?: string; pension?: string }>;}) {
const { clientId, profit, taxYear, pension } = await searchParams;
  const selectedTaxYear = taxYear || "2026/27";
  const companyProfit = parseFloat(profit || "0") || 0;
  const pensionContribution = Math.min(parseFloat(pension || "0") || 0, companyProfit);
  const remunerationPot = companyProfit - pensionContribution;
  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name")
    .order("client_name");

  let defaultProfit = 0;
  if (clientId) {
    const { data: latestCt } = await supabase
      .from("corporation_tax_computations")
      .select("accounting_profit")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    defaultProfit = latestCt?.accounting_profit || 0;
  }

const taxRates = await getTaxRates(selectedTaxYear);
  const ctRates = await getCtRates(selectedTaxYear);
  const niRates = await getNiRates(selectedTaxYear);
const splits = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];

// Given a target "remuneration budget" (the slice of company profit this split allocates
  // to pay + employer NI combined), solve for the salary figure where salary + employer's NI
  // on that salary exactly equals the budget — so every split draws from the same total pot
  // rather than letting employer NI be paid "on top" of an already-full allocation.
  function solveSalaryForBudget(budget: number, rates: any): number {
    if (budget <= 0) return 0;
    // Below the secondary threshold, employer NI is £0, so salary = budget directly.
    const belowThreshold = Math.min(budget, rates.employerSecondaryThreshold);
    if (budget <= rates.employerSecondaryThreshold) return budget;
    // Above the threshold, each extra £1 of salary costs the employer £(1 + employerRate).
    const remainingBudget = budget - rates.employerSecondaryThreshold;
    const extraSalary = remainingBudget / (1 + rates.employerRate);
    return rates.employerSecondaryThreshold + extraSalary;
  }

const scenarios = remunerationPot > 0
    ? splits.map((splitPct) => {
        const remunerationBudget = (remunerationPot * splitPct) / 100;        const salary = solveSalaryForBudget(remunerationBudget, niRates);
        const { employeeNI, employerNI } = calculateNI(salary, niRates);
        const taxableProfit = Math.max(0, companyProfit - salary - employerNI);
        const ct = calculateCorporationTax(
          {
            taxableProfit,
            periodStart: "2026-04-06",
            periodEnd: "2027-04-05",
            associatedCompanies: 0,
            taxYear: selectedTaxYear,
          },
          ctRates
        );

        const dividend = Math.max(0, taxableProfit - ct.corporationTax);

        const taxResult = calculateTax(
          {
            employmentIncome: salary,
            selfEmploymentIncome: 0,
            rentalIncome: 0,
            pensionIncome: 0,
            interestIncome: 0,
            dividendIncome: dividend,
            taxYear: selectedTaxYear,
          },
          taxRates
        );

        const totalTaxAndNI = employerNI + ct.corporationTax + employeeNI + taxResult.totalIncomeTax;
        const netToDirector = salary + dividend - employeeNI - taxResult.totalIncomeTax;

        return {
          splitPct,
          salary,
          dividend,
          employerNI,
          employeeNI,
          corporationTax: ct.corporationTax,
          incomeTax: taxResult.totalIncomeTax,
          totalTaxAndNI,
          netToDirector,
        };
      })
    : [];

const bestScenario = scenarios.length
    ? scenarios.reduce((best, s) => (s.netToDirector > best.netToDirector ? s : best))
    : null;

  const allDividendScenario = scenarios.find((s) => s.splitPct === 0);
  const savingVsAllDividends =
    bestScenario && allDividendScenario ? bestScenario.netToDirector - allDividendScenario.netToDirector : 0;

  const belowNIThreshold = bestScenario && bestScenario.salary < niRates.lowerEarningsLimit;

  // Sole trader comparison: the same company profit, taxed as self-employment income directly
  // (no Corporation Tax, no NI on dividends — but Class 4 NI applies, and Class 2 NI is a small
  // flat weekly amount, ignored here as it's minor and often voluntary at low profits).
  const soleTraderResult = companyProfit > 0
    ? calculateTax(
        {
          employmentIncome: 0,
          selfEmploymentIncome: companyProfit,
          rentalIncome: 0,
          pensionIncome: 0,
          interestIncome: 0,
          dividendIncome: 0,
          taxYear: selectedTaxYear,
        },
        taxRates
      )
    : null;

  const soleTraderNet = soleTraderResult ? companyProfit - soleTraderResult.totalLiability : 0;
  const incorporationBetterBy = bestScenario ? bestScenario.netToDirector - soleTraderNet : 0;

  return (    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Tax Planning — Salary vs Dividends</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Compare the tax and NI cost of extracting company profit as salary vs dividends. Standalone by
          default — optionally select a client to prefill their latest company profit figure.
        </p>
      </div>

      <div className="p-8 max-w-4xl space-y-6">
        <form method="get" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Client (optional)</label>
            <select
              name="clientId"
              defaultValue={clientId || ""}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            >
              <option value="">Standalone — no client</option>
{(clients || []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.client_name}
                </option>
              ))}            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Company profit available for extraction (before salary and Corporation Tax)
            </label>
            <input
              name="profit"
              type="number"
              step="0.01"
              defaultValue={profit || (defaultProfit || "")}
              placeholder="e.g. 100000"
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          
<div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Employer pension contribution (optional — comes off the top before salary/dividends,
              reduces Corporation Tax, no NI or Income Tax applies)
            </label>
            <input
              name="pension"
              type="number"
              step="0.01"
              defaultValue={pension || ""}
              placeholder="e.g. 10000"
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tax Year</label>
            <select
              name="taxYear"
              defaultValue={selectedTaxYear}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            >
              {Object.keys(TAX_RATES).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            Run Comparison
          </button>
        </form>

{pensionContribution > 0 && (
          <div className="rounded-2xl bg-blue-50 p-6 border border-blue-100">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Pension Contribution</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-slate-500">Contribution</p>
                <p className="font-semibold text-slate-900">{fmt(pensionContribution)}</p>
              </div>
              <div>
                <p className="text-slate-500">Corporation Tax saved</p>
                <p className="font-semibold text-green-700">
                  ~{fmt(pensionContribution * (ctRates.mainRate || 0.25))}
                </p>
              </div>
              <div>
                <p className="text-slate-500">NI / Income Tax on this amount</p>
                <p className="font-semibold text-slate-900">£0.00</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              This goes into the director's pension, not their bank account — it isn't taxed going in
              or reflected in "Net to Director" below, and can't be accessed until pension rules allow.
              The remaining {fmt(remunerationPot)} is what's compared as salary vs dividends below.
              Contributions are subject to the Annual Allowance (currently £60,000 for most people,
              tapered for very high earners) — this tool doesn't check that limit, so confirm it
              separately for the specific client.
            </p>
          </div>
        )}

{bestScenario && (
          <div className="flex justify-end print:hidden">
            <a
              href={`/api/tax-planning-pdf?clientId=${clientId || ""}&profit=${companyProfit}&taxYear=${selectedTaxYear}&pension=${pensionContribution}`}
              className="inline-block rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              ↓ Download PDF
            </a>
          </div>
        )}

        {bestScenario && (
          <div className="rounded-2xl bg-slate-900 p-6 text-white print:bg-white print:text-slate-900 print:border print:border-slate-300">
            <h2 className="text-lg font-bold mb-2">Recommendation</h2>            <p className="text-sm leading-relaxed">
              The most tax-efficient split tested is a <strong>{fmt(bestScenario.salary)} salary</strong> with{" "}
              <strong>{fmt(bestScenario.dividend)} in dividends</strong>, leaving{" "}
              <strong>{fmt(bestScenario.netToDirector)}</strong> net to the director.
              {savingVsAllDividends > 0 && (
                <>
                  {" "}That's <strong>{fmt(savingVsAllDividends)} more</strong> than taking everything as
                  dividends alone.
                </>
              )}
            </p>
            {belowNIThreshold && (
              <p className="text-sm leading-relaxed mt-3 text-amber-300 print:text-amber-700">
                ⚠ This salary is below the Lower Earnings Limit ({fmt(niRates.lowerEarningsLimit)}), so it
                may not count as a qualifying year for State Pension purposes. A slightly higher salary
                (even if less "optimal" on paper) is often worth it to protect the director's NI record —
                worth raising in conversation rather than defaulting to the purely tax-optimal figure.
              </p>
            )}
          </div>
        )}

        {scenarios.length > 0 && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 overflow-x-auto print:shadow-none print:border-slate-300">
            <h2 className="text-lg font-bold text-slate-900 mb-4">
              Comparison — {fmt(remunerationPot)} available for salary/dividends
              {pensionContribution > 0 && ` (after ${fmt(pensionContribution)} pension contribution)`}
            </h2>
            <table className="w-full text-base">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-3 pr-6">Salary %</th>
                  <th className="py-3 pr-6">Salary</th>
                  <th className="py-3 pr-6">Dividend</th>
                  <th className="py-3 pr-6">Employer NI</th>
                  <th className="py-3 pr-6">Corp. Tax</th>
                  <th className="py-3 pr-6">Employee NI</th>
                  <th className="py-3 pr-6">Income Tax</th>
                  <th className="py-3 pr-6">Total Tax+NI</th>
                  <th className="py-3 pr-6">Net to Director</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr
                    key={s.splitPct}
                    className={`border-b border-slate-100 ${
                      bestScenario && s.splitPct === bestScenario.splitPct
                        ? "bg-green-50 print:bg-slate-100"
                        : ""
                    }`}
                  >
                    <td className="py-3 pr-6 font-medium">
                      {s.splitPct}%{bestScenario && s.splitPct === bestScenario.splitPct ? " ✓" : ""}
                    </td>
                    <td className="py-3 pr-6">{fmt(s.salary)}</td>
                    <td className="py-3 pr-6">{fmt(s.dividend)}</td>
                    <td className="py-3 pr-6 text-red-600 print:text-slate-700">{fmt(s.employerNI)}</td>
                    <td className="py-3 pr-6 text-red-600 print:text-slate-700">{fmt(s.corporationTax)}</td>
                    <td className="py-3 pr-6 text-red-600 print:text-slate-700">{fmt(s.employeeNI)}</td>
                    <td className="py-3 pr-6 text-red-600 print:text-slate-700">{fmt(s.incomeTax)}</td>
                    <td className="py-3 pr-6 font-semibold text-red-700 print:text-slate-900">
                      {fmt(s.totalTaxAndNI)}
                    </td>
                    <td className="py-3 pr-6 font-bold text-green-700 print:text-slate-900">
                      {fmt(s.netToDirector)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-4">
              Assumes salary is set as a percentage of the total profit figure, for comparison purposes only —
              real planning conversations should use round, practical salary figures. Employer's NI assumes no
              Employment Allowance (typical for a single-director company with no other employees). This is a
              planning estimate, not a substitute for a full computation.
            </p>
          </div>
        )}

        {soleTraderResult && bestScenario && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:shadow-none print:border-slate-300">
            <h2 className="text-lg font-bold text-slate-900 mb-4">
              Incorporation vs Sole Trader — {fmt(companyProfit)} profit
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-100 p-4">
                <p className="text-sm font-semibold text-slate-700 mb-3">Sole Trader</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Income Tax</span>
                    <span>{fmt(soleTraderResult.totalIncomeTax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Class 4 NI</span>
                    <span>{fmt(soleTraderResult.class4NI)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-slate-100 pt-2">
                    <span>Net to Owner</span>
                    <span>{fmt(soleTraderNet)}</span>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 p-4 bg-green-50">
                <p className="text-sm font-semibold text-slate-700 mb-3">
                  Limited Company (optimal salary/dividend split)
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Salary + Employer NI</span>
                    <span>{fmt(bestScenario.salary + bestScenario.employerNI)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Corporation Tax</span>
                    <span>{fmt(bestScenario.corporationTax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Employee NI + Income Tax</span>
                    <span>{fmt(bestScenario.employeeNI + bestScenario.incomeTax)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-slate-100 pt-2">
                    <span>Net to Director</span>
                    <span>{fmt(bestScenario.netToDirector)}</span>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-sm mt-4 font-medium text-slate-900">
              {incorporationBetterBy > 0
                ? `Incorporating is worth ${fmt(incorporationBetterBy)} more per year at this profit level, based on the optimal extraction split above.`
                : `Staying a sole trader is worth ${fmt(-incorporationBetterBy)} more per year at this profit level — incorporation's tax saving doesn't outweigh the extra cost and complexity here.`}
            </p>
            <p className="text-xs text-slate-400 mt-3">
              This compares tax and NI only. It doesn't account for incorporation and ongoing filing costs,
              limited liability protection, the administrative burden of running a company, or the loss of
              simplicity — all genuine factors in this decision beyond the numbers.
            </p>
          </div>
        )}
      </div>
    </div>
  );}