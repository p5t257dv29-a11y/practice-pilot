import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getTaxRates } from "../../tax/page";
import { getP11dRates } from "../../p11d/page";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============================================================
// Shared payroll calculation library
// ============================================================

const STATUTORY_PAY_FALLBACK = {
  smpWeeklyRate: 187.18,
  smpHigherRateWeeks: 6,
  smpEarningsPercentage: 0.9,
  sppWeeklyRate: 187.18,
  sppMaxWeeks: 2,
};

export async function getStatutoryPayRates(taxYear: string) {
  const { data } = await supabase.from("tax_rates").select("statutory_pay").eq("tax_year", taxYear).maybeSingle();
  return { ...STATUTORY_PAY_FALLBACK, ...(data?.statutory_pay || {}) };
}

const PAY_PERIODS_PER_YEAR: Record<string, number> = {
  Weekly: 52,
  Fortnightly: 26,
  "Four-weekly": 13,
  Monthly: 12,
  Quarterly: 4,
  Annually: 1,
};

export function getPeriodsPerYear(payFrequency: string): number {
  return PAY_PERIODS_PER_YEAR[payFrequency] || 12;
}

// Converts a "2026/27" style tax year string into its actual UK tax year
// date range (6 April to 5 April the following year).
export function taxYearDateRange(taxYear: string): { start: string; end: string } {
  const startYear = parseInt(taxYear.split("/")[0], 10);
  return {
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  };
}

// SMP: 90% of Average Weekly Earnings for the first 6 weeks, then the lower
// of the flat statutory rate or 90% of AWE for the remaining weeks (up to 39
// weeks total) — weeksAlreadyPaid tracks how many of those 39 weeks have
// already been used in prior pay runs, so the 6-week higher-rate cutover
// lands in the right place even if paid across several periods.
export function calculateSMPForPeriod(rates: Awaited<ReturnType<typeof getStatutoryPayRates>>, {
  averageWeeklyEarnings, weeksThisPeriod, weeksAlreadyPaid,
}: { averageWeeklyEarnings: number; weeksThisPeriod: number; weeksAlreadyPaid: number }): number {
  if (weeksThisPeriod <= 0 || averageWeeklyEarnings <= 0) return 0;
  let total = 0;
  for (let i = 0; i < weeksThisPeriod; i++) {
    const weekNumber = weeksAlreadyPaid + i; // 0-indexed
    if (weekNumber < rates.smpHigherRateWeeks) {
      total += averageWeeklyEarnings * rates.smpEarningsPercentage;
    } else {
      total += Math.min(rates.smpWeeklyRate, averageWeeklyEarnings * rates.smpEarningsPercentage);
    }
  }
  return total;
}

// SPP: always the lower of the flat statutory rate or 90% of AWE — no
// higher-rate weeks, and capped at a maximum of 2 weeks total per event.
export function calculateSPPForPeriod(rates: Awaited<ReturnType<typeof getStatutoryPayRates>>, {
  averageWeeklyEarnings, weeksThisPeriod, weeksAlreadyPaid,
}: { averageWeeklyEarnings: number; weeksThisPeriod: number; weeksAlreadyPaid: number }): number {
  if (weeksThisPeriod <= 0 || averageWeeklyEarnings <= 0) return 0;
  const remainingAllowance = Math.max(0, rates.sppMaxWeeks - weeksAlreadyPaid);
  const payableWeeks = Math.min(weeksThisPeriod, remainingAllowance);
  return payableWeeks * Math.min(rates.sppWeeklyRate, averageWeeklyEarnings * 0.9);
}

// Student loan deduction for one pay period — reuses the exact same plan
// thresholds and rates already built for Personal Tax (via getTaxRates),
// so payroll and Self Assessment can never drift out of sync with each
// other. The annual threshold is simply divided by the number of pay
// periods in the year; HMRC's real per-period tables round slightly
// differently period to period, so treat this as a close approximation
// rather than an exact match to HMRC's published tables.
export async function calculateStudentLoanDeduction(taxYear: string, {
  grossPayThisPeriod, payFrequency, studentLoanPlan, hasPostgradLoan,
}: { grossPayThisPeriod: number; payFrequency: string; studentLoanPlan: string | null; hasPostgradLoan: boolean }) {
  const rates = await getTaxRates(taxYear);
  const periods = getPeriodsPerYear(payFrequency);

  const thresholds: Record<string, number> = {
    Plan1: rates.studentLoanPlan1Threshold,
    Plan2: rates.studentLoanPlan2Threshold,
    Plan4: rates.studentLoanPlan4Threshold,
    Plan5: rates.studentLoanPlan5Threshold,
  };

  let studentLoanDeducted = 0;
  if (studentLoanPlan && thresholds[studentLoanPlan] !== undefined) {
    const periodThreshold = thresholds[studentLoanPlan] / periods;
    studentLoanDeducted = Math.max(0, grossPayThisPeriod - periodThreshold) * rates.studentLoanRate;
  }

  let postgradLoanDeducted = 0;
  if (hasPostgradLoan) {
    const periodThreshold = rates.studentLoanPostgradThreshold / periods;
    postgradLoanDeducted = Math.max(0, grossPayThisPeriod - periodThreshold) * rates.studentLoanPostgradRate;
  }

  return { studentLoanDeducted, postgradLoanDeducted };
}

// Payrolled benefits for this period — the employee's annual benefit value
// (set from the P11D Car/Van Benefit Checker's "Apply to Payrolled Benefits"
// action) divided evenly across the pay periods remaining once the benefit
// actually started being payrolled. This is added to TAXABLE pay for PAYE
// and Class 1A NIC purposes, but is never part of NET pay — it's a notional
// value, not real cash paid to the employee, so it only ever reduces net
// pay via the extra tax it generates, never adds to gross cash pay.
export function calculatePayrolledBenefitsForPeriod({
  annualPayrolledBenefits, payrolledBenefitsStartDate, payFrequency, periodStart,
}: { annualPayrolledBenefits: number; payrolledBenefitsStartDate: string | null; payFrequency: string; periodStart: string }) {
  if (!annualPayrolledBenefits || annualPayrolledBenefits <= 0) return 0;
  if (payrolledBenefitsStartDate && new Date(periodStart) < new Date(payrolledBenefitsStartDate)) return 0;
  return annualPayrolledBenefits / getPeriodsPerYear(payFrequency);
}

// Employer-only Class 1A NIC on this period's payrolled benefit value —
// never deducted from the employee, shown alongside Employer NI as an
// employer cost.
export async function calculateClass1ANicOnBenefits(taxYear: string, payrolledBenefitsThisPeriod: number) {
  const p11dRates = await getP11dRates(taxYear);
  return payrolledBenefitsThisPeriod * p11dRates.class1ANicRate;
}

async function syncEmployeeToPersonalTax(employeeId: string, formData: FormData) {
  "use server";
  const linkedClientId = String(formData.get("linked_client_id") || "");
  if (!linkedClientId) return;

  const { data: employee } = await supabase.from("payroll_employees").select("*").eq("id", employeeId).single();
  if (!employee) return;

  const { data: runs } = await supabase
    .from("payroll_runs")
    .select("gross_pay, tax_deducted")
    .eq("employee_id", employeeId);

  const totalGross = (runs || []).reduce((s, r) => s + Number(r.gross_pay), 0);
  const totalTax = (runs || []).reduce((s, r) => s + Number(r.tax_deducted), 0);

  await supabase.from("payroll_employees").update({
    linked_client_id: linkedClientId,
    synced_gross: totalGross,
    synced_tax: totalTax,
    synced_at: new Date().toISOString(),
  }).eq("id", employeeId);

  revalidatePath("/payroll");
}

async function updateEmployee(employeeId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => (get(key) ? parseFloat(get(key)) : null);

  await supabase.from("payroll_employees").update({
    name: get("name"),
    email: get("email") || null,
    ni_number: get("ni_number") || null,
    tax_code: get("tax_code"),
    ni_category: get("ni_category"),
    pay_frequency: get("pay_frequency"),
    student_loan_plan: get("student_loan_plan") || null,
    postgrad_loan: formData.get("postgrad_loan") === "on",
    pension_opted_out: formData.get("pension_opted_out") === "on",
    employee_pension_rate: num("employee_pension_rate"),
    employer_pension_rate: num("employer_pension_rate"),
    pension_scheme_name: get("pension_scheme_name") || null,
    average_weekly_earnings: num("average_weekly_earnings"),
    smp_start_date: get("smp_start_date") || null,
    spp_start_date: get("spp_start_date") || null,
    annual_payrolled_benefits: num("annual_payrolled_benefits"),
    payrolled_benefits_start_date: get("payrolled_benefits_start_date") || null,
  }).eq("id", employeeId);

  revalidatePath("/payroll");
}

async function markAsLeaver(employeeId: string, formData: FormData) {
  "use server";
  const leavingDate = String(formData.get("leaving_date") || "");
  await supabase.from("payroll_employees").update({ leaving_date: leavingDate || null, is_active: false }).eq("id", employeeId);
  revalidatePath("/payroll");
}

async function unlinkEmployee(employeeId: string) {
  "use server";
  await supabase.from("payroll_employees").update({ linked_client_id: null, synced_gross: null, synced_tax: null, synced_at: null }).eq("id", employeeId);
  revalidatePath("/payroll");
}

async function deleteEmployee(employeeId: string) {
  "use server";
  await supabase.from("payroll_employees").delete().eq("id", employeeId);
  revalidatePath("/payroll");
}

async function addEmployee(clientId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  const { data: newEmployee } = await supabase.from("payroll_employees").insert({
    client_id: clientId,
    name: get("name"),
    email: get("email") || null,
    ni_number: get("ni_number") || null,
    tax_code: get("tax_code") || "1257L",
    ni_category: get("ni_category") || "A",
    pay_frequency: get("pay_frequency") || "Monthly",
    student_loan_plan: get("student_loan_plan") || null,
    start_date: get("start_date") || null,
    is_active: true,
  }).select().single();

  if (newEmployee) revalidatePath("/payroll");
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; expanded?: string }>;
}) {
  const { client: clientQuery, expanded } = await searchParams;

  let matchedClient: any = null;
  if (clientQuery) {
    const { data } = await supabase
      .from("clients")
      .select("id, client_name")
      .ilike("client_name", `%${clientQuery}%`)
      .limit(1)
      .maybeSingle();
    matchedClient = data;
  }

  const { data: employees } = matchedClient
    ? await supabase.from("payroll_employees").select("*").eq("client_id", matchedClient.id).eq("is_active", true).order("name", { ascending: true })
    : { data: [] };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Payroll</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage employees and run payroll for a client.</p>
      </div>

      <div className="p-8 max-w-4xl space-y-6">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
          <form method="get" className="mt-4 flex gap-2">
            <input name="client" defaultValue={clientQuery || ""} placeholder="Client name"
              className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            <button type="submit" className="rounded-xl bg-slate-100 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
              Search
            </button>
          </form>
          {matchedClient && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <p className="text-sm text-slate-700">Showing: <span className="font-bold">{matchedClient.client_name}</span></p>
              <a href="/payroll" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
            </div>
          )}
        </div>

        {matchedClient && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Employees ({employees?.length ?? 0})</h2>
              <a href={`/payroll/run?client=${matchedClient.id}`}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Run Payroll →
              </a>
            </div>

            <div className="mt-4 space-y-3">
              {(employees || []).map((emp) => {
                const isExpanded = expanded === emp.id;
                const nameParts = emp.name.split(" ");
                const reversedName = nameParts.length > 1 ? `${nameParts[nameParts.length - 1]}, ${nameParts.slice(0, -1).join(" ")}` : emp.name;

                return (
                  <div key={emp.id} className="rounded-xl border border-slate-100 overflow-hidden">
                    <div className="p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{emp.name}</p>
                          <span className="text-xs text-green-600">→ {reversedName}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {emp.tax_code} · NI Category {emp.ni_category} · {emp.pay_frequency}
                          {emp.email && ` · ${emp.email}`}
                        </p>
                        {!emp.linked_client_id ? (
                          <p className="text-xs text-orange-600 mt-0.5">Not yet synced to Personal Tax</p>
                        ) : (
                          <p className="text-xs text-green-600 mt-0.5">Synced to Personal Tax {emp.synced_at && new Date(emp.synced_at).toLocaleDateString("en-GB")}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={isExpanded ? `/payroll?client=${clientQuery}` : `/payroll?client=${clientQuery}&expanded=${emp.id}`}
                          className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                          {isExpanded ? "Close" : "Edit"}
                        </a>
                        <a href={`/p60?employee=${emp.id}`} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                          P60 →
                        </a>
                        {!emp.leaving_date && (
                          <form action={markAsLeaver.bind(null, emp.id)} className="inline-flex items-center gap-1">
                            <input type="date" name="leaving_date" className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                            <button type="submit" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                              Mark as Leaver
                            </button>
                          </form>
                        )}
                        {!emp.linked_client_id ? (
                          <form action={syncEmployeeToPersonalTax.bind(null, emp.id)} className="inline-flex items-center gap-1">
                            <input type="hidden" name="linked_client_id" value={matchedClient.id} />
                            <button type="submit" className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition-colors">
                              Sync to Personal Tax →
                            </button>
                          </form>
                        ) : (
                          <form action={unlinkEmployee.bind(null, emp.id)}>
                            <button className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors">Unlink</button>
                          </form>
                        )}
                        <form action={deleteEmployee.bind(null, emp.id)}>
                          <button className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">Delete</button>
                        </form>
                      </div>
                    </div>

                    {isExpanded && (
                      <form action={updateEmployee.bind(null, emp.id)} className="p-4 border-t border-slate-100 bg-slate-50/50 grid gap-4 md:grid-cols-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
                          <input name="name" defaultValue={emp.name} required className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                          <input name="email" defaultValue={emp.email || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">NI Number</label>
                          <input name="ni_number" defaultValue={emp.ni_number || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Tax Code</label>
                          <input name="tax_code" defaultValue={emp.tax_code} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">NI Category</label>
                          <select name="ni_category" defaultValue={emp.ni_category} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white">
                            <option value="A">A — Standard</option>
                            <option value="B">B — Married women's reduced rate</option>
                            <option value="C">C — Over State Pension age</option>
                            <option value="H">H — Apprentice under 25</option>
                            <option value="M">M — Under 21</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Pay Frequency</label>
                          <select name="pay_frequency" defaultValue={emp.pay_frequency} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white">
                            <option>Weekly</option>
                            <option>Fortnightly</option>
                            <option>Four-weekly</option>
                            <option>Monthly</option>
                            <option>Quarterly</option>
                            <option>Annually</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Student Loan Plan</label>
                          <select name="student_loan_plan" defaultValue={emp.student_loan_plan || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white">
                            <option value="">None</option>
                            <option value="Plan1">Plan 1</option>
                            <option value="Plan2">Plan 2</option>
                            <option value="Plan4">Plan 4 — Scotland</option>
                            <option value="Plan5">Plan 5</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Pension Scheme Name</label>
                          <input name="pension_scheme_name" defaultValue={emp.pension_scheme_name || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Employee Rate (%, blank = statutory 5%)</label>
                          <input name="employee_pension_rate" type="number" step="0.01" defaultValue={emp.employee_pension_rate ?? ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Employer Rate (%, blank = statutory 3%)</label>
                          <input name="employer_pension_rate" type="number" step="0.01" defaultValue={emp.employer_pension_rate ?? ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Average Weekly Earnings (£, for SMP/SPP)</label>
                          <input name="average_weekly_earnings" type="number" step="0.01" defaultValue={emp.average_weekly_earnings ?? ""} placeholder="Only needed if on leave" className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">SMP Start Date</label>
                          <input name="smp_start_date" type="date" defaultValue={emp.smp_start_date || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">SPP Start Date</label>
                          <input name="spp_start_date" type="date" defaultValue={emp.spp_start_date || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                          <p className="text-xs text-slate-400 mt-1">Paternity leave — max 2 weeks total per event.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Annual Payrolled Benefits (£, from 2027)</label>
                          <input name="annual_payrolled_benefits" type="number" step="0.01" defaultValue={emp.annual_payrolled_benefits ?? ""} placeholder="Total taxable benefit value for the year" className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                          <p className="text-xs text-slate-400 mt-1">Set from the P11D Car/Van Benefit Checker, or entered directly.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Benefit Start Date</label>
                          <input name="payrolled_benefits_start_date" type="date" defaultValue={emp.payrolled_benefits_start_date || ""} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                        </div>

                        <div className="md:col-span-3 flex items-center gap-6">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input name="postgrad_loan" type="checkbox" defaultChecked={emp.postgrad_loan} className="w-4 h-4 rounded" />
                            <span className="text-sm text-slate-700">Postgraduate loan</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input name="pension_opted_out" type="checkbox" defaultChecked={emp.pension_opted_out} className="w-4 h-4 rounded" />
                            <span className="text-sm text-slate-700">Opted out of pension</span>
                          </label>
                        </div>

                        <div className="md:col-span-3">
                          <button type="submit" className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                            Save Changes
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
              {(!employees || employees.length === 0) && (
                <p className="text-sm text-slate-500 text-center py-6">No employees for this client yet.</p>
              )}
            </div>

            <details className="mt-4">
              <summary className="text-sm font-semibold text-blue-600 cursor-pointer">+ Add Employee (New Starter)</summary>
              <form action={addEmployee.bind(null, matchedClient.id)} className="mt-4 grid gap-3 md:grid-cols-3">
                <input name="name" required placeholder="Full name *" className="rounded-xl border border-slate-200 p-2.5 text-sm" />
                <input name="email" placeholder="Email" className="rounded-xl border border-slate-200 p-2.5 text-sm" />
                <input name="ni_number" placeholder="NI Number" className="rounded-xl border border-slate-200 p-2.5 text-sm" />
                <input name="tax_code" placeholder="Tax code (default 1257L)" className="rounded-xl border border-slate-200 p-2.5 text-sm" />
                <input name="start_date" type="date" className="rounded-xl border border-slate-200 p-2.5 text-sm" />
                <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Add Employee
                </button>
              </form>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}