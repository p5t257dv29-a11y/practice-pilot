import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getTaxRates } from "../tax/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============ CORE PAYROLL ENGINE ============

export const PAYROLL_RATES_DEFAULT = {
  ni: {
    primaryThreshold: 12570,
    upperEarningsLimit: 50270,
    secondaryThreshold: 9100,
    employeeRate: 0.08,
    employeeRateAboveUEL: 0.02,
    employerRate: 0.15,
    employerExemptCategories: ["H", "M"],
    zeroEmployeeCategories: ["C"],
  },
  studentLoan: {
    plan1Threshold: 26065,
    plan1Rate: 0.09,
    plan2Threshold: 28470,
    plan2Rate: 0.09,
    plan4Threshold: 32745,
    plan4Rate: 0.09,
    plan5Threshold: 25000,
    plan5Rate: 0.09,
    postgradThreshold: 21000,
    postgradRate: 0.06,
  },
  pension: {
    qualifyingEarningsLower: 6240,
    qualifyingEarningsUpper: 50270,
    minEmployeeRate: 0.05,
    minEmployerRate: 0.03,
  },
};

export async function getPayrollRates(taxYear: string) {
  const { data } = await supabase.from("tax_rates").select("payroll").eq("tax_year", taxYear).maybeSingle();
  return data?.payroll || PAYROLL_RATES_DEFAULT;
}

export function parseTaxCode(code: string) {
  const upper = code.trim().toUpperCase();

  if (upper === "NT") return { isNT: true, allowance: 0, flatRate: null as number | null };
  if (upper === "BR") return { isNT: false, allowance: 0, flatRate: 0.20 };
  if (upper === "D0") return { isNT: false, allowance: 0, flatRate: 0.40 };
  if (upper === "D1") return { isNT: false, allowance: 0, flatRate: 0.45 };

  if (upper.startsWith("K")) {
    const num = parseInt(upper.slice(1), 10) || 0;
    return { isNT: false, allowance: -(num * 10), flatRate: null };
  }

  const match = upper.match(/^(\d+)/);
  const num = match ? parseInt(match[1], 10) : 0;
  return { isNT: false, allowance: num * 10, flatRate: null };
}

export function calculatePAYE(input: {
  grossPay: number;
  taxCode: string;
  payFrequency: "Weekly" | "Monthly";
}, personalTaxRates: any) {
  const periodsPerYear = input.payFrequency === "Weekly" ? 52 : 12;
  const parsed = parseTaxCode(input.taxCode);

  if (parsed.isNT) {
    return { taxablePay: 0, tax: 0, breakdown: { basic: 0, higher: 0, additional: 0 } };
  }

  if (parsed.flatRate !== null) {
    const tax = input.grossPay * parsed.flatRate;
    return { taxablePay: input.grossPay, tax, breakdown: { basic: 0, higher: 0, additional: 0 } };
  }

  const periodAllowance = parsed.allowance / periodsPerYear;
  const taxablePay = Math.max(0, input.grossPay - periodAllowance);

  const basicLimitPeriod = personalTaxRates.basicRateLimit / periodsPerYear;
  const additionalThresholdPeriod = personalTaxRates.additionalRateThreshold / periodsPerYear;

  const basicBand = Math.min(taxablePay, basicLimitPeriod);
  const higherBand = Math.min(Math.max(0, taxablePay - basicLimitPeriod), additionalThresholdPeriod - basicLimitPeriod);
  const additionalBand = Math.max(0, taxablePay - additionalThresholdPeriod);

  const tax =
    basicBand * personalTaxRates.basicRate +
    higherBand * personalTaxRates.higherRate +
    additionalBand * personalTaxRates.additionalRate;

  return { taxablePay, tax, breakdown: { basic: basicBand, higher: higherBand, additional: additionalBand } };
}

export function calculateNI(input: {
  grossPay: number;
  niCategory: string;
  payFrequency: "Weekly" | "Monthly";
}, rates: any) {
  const periodsPerYear = input.payFrequency === "Weekly" ? 52 : 12;
  const ptPeriod = rates.ni.primaryThreshold / periodsPerYear;
  const uelPeriod = rates.ni.upperEarningsLimit / periodsPerYear;
  const stPeriod = rates.ni.secondaryThreshold / periodsPerYear;

  const isZeroEmployee = rates.ni.zeroEmployeeCategories.includes(input.niCategory);
  const isEmployerExempt = rates.ni.employerExemptCategories.includes(input.niCategory);

  let employeeNI = 0;
  if (!isZeroEmployee) {
    const mainBand = Math.max(0, Math.min(input.grossPay, uelPeriod) - ptPeriod);
    const upperBand = Math.max(0, input.grossPay - uelPeriod);
    employeeNI = Math.max(0, mainBand) * rates.ni.employeeRate + upperBand * rates.ni.employeeRateAboveUEL;
  }

  let employerNI = 0;
  if (!isEmployerExempt) {
    const employerBand = Math.max(0, input.grossPay - stPeriod);
    employerNI = employerBand * rates.ni.employerRate;
  } else {
    const employerBandAboveUEL = Math.max(0, input.grossPay - uelPeriod);
    employerNI = employerBandAboveUEL * rates.ni.employerRate;
  }

  return { employeeNI, employerNI };
}

export function calculateStudentLoan(input: {
  grossPay: number;
  plan: string | null;
  hasPostgrad: boolean;
  payFrequency: "Weekly" | "Monthly";
}, rates: any) {
  const periodsPerYear = input.payFrequency === "Weekly" ? 52 : 12;
  let studentLoan = 0;
  let postgradLoan = 0;

  const planKey: Record<string, { threshold: number; rate: number }> = {
    "Plan 1": { threshold: rates.studentLoan.plan1Threshold, rate: rates.studentLoan.plan1Rate },
    "Plan 2": { threshold: rates.studentLoan.plan2Threshold, rate: rates.studentLoan.plan2Rate },
    "Plan 4": { threshold: rates.studentLoan.plan4Threshold, rate: rates.studentLoan.plan4Rate },
    "Plan 5": { threshold: rates.studentLoan.plan5Threshold, rate: rates.studentLoan.plan5Rate },
  };

  if (input.plan && planKey[input.plan]) {
    const { threshold, rate } = planKey[input.plan];
    const periodThreshold = threshold / periodsPerYear;
    studentLoan = Math.max(0, input.grossPay - periodThreshold) * rate;
  }

  if (input.hasPostgrad) {
    const periodThreshold = rates.studentLoan.postgradThreshold / periodsPerYear;
    postgradLoan = Math.max(0, input.grossPay - periodThreshold) * rates.studentLoan.postgradRate;
  }

  return { studentLoan, postgradLoan };
}

export function calculatePension(input: {
  grossPay: number;
  optedOut: boolean;
  payFrequency: "Weekly" | "Monthly";
}, rates: any) {
  if (input.optedOut) return { employeePension: 0, employerPension: 0 };

  const periodsPerYear = input.payFrequency === "Weekly" ? 52 : 12;
  const lowerPeriod = rates.pension.qualifyingEarningsLower / periodsPerYear;
  const upperPeriod = rates.pension.qualifyingEarningsUpper / periodsPerYear;

  const qualifyingEarnings = Math.max(0, Math.min(input.grossPay, upperPeriod) - lowerPeriod);

  return {
    employeePension: qualifyingEarnings * rates.pension.minEmployeeRate,
    employerPension: qualifyingEarnings * rates.pension.minEmployerRate,
  };
}

export async function calculatePayRun(input: {
  grossPay: number;
  taxCode: string;
  niCategory: string;
  payFrequency: "Weekly" | "Monthly";
  studentLoanPlan: string | null;
  hasPostgrad: boolean;
  pensionOptedOut: boolean;
  taxYear: string;
}) {
  const [personalTaxRates, payrollRates] = await Promise.all([
    getTaxRates(input.taxYear),
    getPayrollRates(input.taxYear),
  ]);

  const paye = calculatePAYE({ grossPay: input.grossPay, taxCode: input.taxCode, payFrequency: input.payFrequency }, personalTaxRates);
  const ni = calculateNI({ grossPay: input.grossPay, niCategory: input.niCategory, payFrequency: input.payFrequency }, payrollRates);
  const loans = calculateStudentLoan({ grossPay: input.grossPay, plan: input.studentLoanPlan, hasPostgrad: input.hasPostgrad, payFrequency: input.payFrequency }, payrollRates);
  const pension = calculatePension({ grossPay: input.grossPay, optedOut: input.pensionOptedOut, payFrequency: input.payFrequency }, payrollRates);

  const totalDeductions = paye.tax + ni.employeeNI + loans.studentLoan + loans.postgradLoan + pension.employeePension;
  const netPay = input.grossPay - totalDeductions;

  return { paye, ni, loans, pension, totalDeductions, netPay };
}

export function taxYearDateRange(taxYear: string) {
  const startYear = parseInt(taxYear.split("/")[0], 10);
  return {
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  };
}

// ============ SERVER ACTIONS ============

async function addEmployee(clientId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const name = get("name");
  if (!name) return;

  await supabase.from("payroll_employees").insert({
    client_id: clientId,
    name,
    address: get("address") || null,
    date_of_birth: get("date_of_birth") || null,
    gender: get("gender") || null,
    ni_number: get("ni_number") || null,
    start_date: get("start_date") || null,
    tax_code: get("tax_code") || "1257L",
    ni_category: get("ni_category") || "A",
    pay_frequency: get("pay_frequency") || "Monthly",
    student_loan_plan: get("student_loan_plan") || null,
    postgrad_loan: formData.get("postgrad_loan") === "on",
    pension_opted_out: formData.get("pension_opted_out") === "on",
    starter_declaration: get("starter_declaration") || null,
    previous_employer_name: get("previous_employer_name") || null,
    previous_pay_to_date: parseFloat(get("previous_pay_to_date")) || 0,
    previous_tax_to_date: parseFloat(get("previous_tax_to_date")) || 0,
  });

  revalidatePath("/payroll");
}

async function deleteEmployee(id: string) {
  "use server";
  await supabase.from("payroll_employees").delete().eq("id", id);
  revalidatePath("/payroll");
}

async function markAsLeaver(employeeId: string, formData: FormData) {
  "use server";
  const leavingDate = String(formData.get("leaving_date") || "").trim();
  if (!leavingDate) return;

  await supabase.from("payroll_employees").update({ leaving_date: leavingDate, is_active: false }).eq("id", employeeId);
  revalidatePath("/payroll");
}

async function reactivateEmployee(employeeId: string) {
  "use server";
  await supabase.from("payroll_employees").update({ leaving_date: null, is_active: true }).eq("id", employeeId);
  revalidatePath("/payroll");
}

async function createPayRun(employeeId: string, clientId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const grossPay = parseFloat(get("gross_pay")) || 0;

  const { data: employee } = await supabase.from("payroll_employees").select("*").eq("id", employeeId).single();
  if (!employee) return;

  const result = await calculatePayRun({
    grossPay,
    taxCode: employee.tax_code,
    niCategory: employee.ni_category,
    payFrequency: employee.pay_frequency,
    studentLoanPlan: employee.student_loan_plan,
    hasPostgrad: employee.postgrad_loan,
    pensionOptedOut: employee.pension_opted_out,
    taxYear: "2026/27",
  });

  await supabase.from("payroll_runs").insert({
    employee_id: employeeId,
    client_id: clientId,
    pay_period_start: get("pay_period_start"),
    pay_period_end: get("pay_period_end"),
    payment_date: get("payment_date"),
    gross_pay: grossPay,
    tax_code_used: employee.tax_code,
    ni_category_used: employee.ni_category,
    tax_deducted: result.paye.tax,
    employee_ni: result.ni.employeeNI,
    employer_ni: result.ni.employerNI,
    student_loan_deducted: result.loans.studentLoan,
    postgrad_loan_deducted: result.loans.postgradLoan,
    employee_pension: result.pension.employeePension,
    employer_pension: result.pension.employerPension,
    net_pay: result.netPay,
    notes: get("notes"),
  });

  revalidatePath("/payroll");
}

async function deletePayRun(id: string) {
  "use server";
  await supabase.from("payroll_runs").delete().eq("id", id);
  revalidatePath("/payroll");
}

async function updatePayRun(runId: string, employeeId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const grossPay = parseFloat(get("gross_pay")) || 0;

  const { data: employee } = await supabase.from("payroll_employees").select("*").eq("id", employeeId).single();
  if (!employee) return;

  const result = await calculatePayRun({
    grossPay,
    taxCode: employee.tax_code,
    niCategory: employee.ni_category,
    payFrequency: employee.pay_frequency,
    studentLoanPlan: employee.student_loan_plan,
    hasPostgrad: employee.postgrad_loan,
    pensionOptedOut: employee.pension_opted_out,
    taxYear: "2026/27",
  });

  await supabase.from("payroll_runs").update({
    pay_period_start: get("pay_period_start"),
    pay_period_end: get("pay_period_end"),
    payment_date: get("payment_date"),
    gross_pay: grossPay,
    tax_code_used: employee.tax_code,
    ni_category_used: employee.ni_category,
    tax_deducted: result.paye.tax,
    employee_ni: result.ni.employeeNI,
    employer_ni: result.ni.employerNI,
    student_loan_deducted: result.loans.studentLoan,
    postgrad_loan_deducted: result.loans.postgradLoan,
    employee_pension: result.pension.employeePension,
    employer_pension: result.pension.employerPension,
    net_pay: result.netPay,
    notes: get("notes"),
  }).eq("id", runId);

  revalidatePath("/payroll");
}

async function linkEmployeeToClient(employeeId: string, formData: FormData) {
  "use server";
  const linkedClientId = String(formData.get("linked_client_id") || "").trim();
  if (!linkedClientId) return;

  await supabase.from("payroll_employees").update({ linked_client_id: linkedClientId }).eq("id", employeeId);
  revalidatePath("/payroll");
}

async function unlinkEmployee(employeeId: string) {
  "use server";
  await supabase.from("payroll_employees").update({ linked_client_id: null, synced_gross: 0, synced_tax: 0, synced_at: null }).eq("id", employeeId);
  revalidatePath("/payroll");
}

async function syncEmployeeToPersonalTax(employeeId: string, taxYear: string) {
  "use server";

  const { data: employee } = await supabase.from("payroll_employees").select("*").eq("id", employeeId).single();
  if (!employee?.linked_client_id) return;

  const { start, end } = taxYearDateRange(taxYear);
  const { data: runs } = await supabase
    .from("payroll_runs")
    .select("gross_pay, tax_deducted")
    .eq("employee_id", employeeId)
    .gte("payment_date", start)
    .lte("payment_date", end);

  const totalGross = (runs || []).reduce((sum, r) => sum + Number(r.gross_pay), 0);
  const totalTax = (runs || []).reduce((sum, r) => sum + Number(r.tax_deducted), 0);

  const deltaGross = totalGross - Number(employee.synced_gross || 0);
  const deltaTax = totalTax - Number(employee.synced_tax || 0);

  const { data: existingComp } = await supabase
    .from("tax_computations")
    .select("*")
    .eq("client_id", employee.linked_client_id)
    .eq("tax_year", taxYear)
    .maybeSingle();

  if (existingComp) {
    await supabase.from("tax_computations").update({
      employment_income: Number(existingComp.employment_income || 0) + deltaGross,
      tax_paid_at_source: Number(existingComp.tax_paid_at_source || 0) + deltaTax,
    }).eq("id", existingComp.id);
  } else {
    await supabase.from("tax_computations").insert({
      client_id: employee.linked_client_id,
      tax_year: taxYear,
      employment_income: totalGross,
      tax_paid_at_source: totalTax,
      self_employment_income: 0,
      rental_income: 0,
      pension_income: 0,
      interest_income: 0,
      dividend_income: 0,
    });
  }

  await supabase.from("payroll_employees").update({
    synced_gross: totalGross,
    synced_tax: totalTax,
    synced_at: new Date().toISOString(),
  }).eq("id", employeeId);

  revalidatePath("/payroll");
  revalidatePath(`/clients/${employee.linked_client_id}`);
  revalidatePath("/tax");
}

// ============ PAGE ============

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string; clientSearch?: string; runFor?: string; editRun?: string; linkEmployee?: string }>;
}) {
  const {
    browseClient: browseClientId,
    clientSearch,
    runFor: runForEmployeeId,
    editRun: editRunId,
    linkEmployee: linkEmployeeId,
  } = await searchParams;

  const [{ data: allClients }, { data: employees }, { data: runs }] = await Promise.all([
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    browseClientId
      ? supabase.from("payroll_employees").select("*, linked_client:linked_client_id(id, client_name)").eq("client_id", browseClientId).order("is_active", { ascending: false }).order("name", { ascending: true })
      : Promise.resolve({ data: [] }),
    browseClientId
      ? supabase.from("payroll_runs").select("*, payroll_employees(name)").eq("client_id", browseClientId).order("payment_date", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  // Client search — matches by name, doesn't require an exact/unique match.
  // If there's exactly one result the section below still shows a single
  // clickable card, keeping the flow consistent either way.
  const searchMatches = clientSearch
    ? (allClients || []).filter((c) => c.client_name.toLowerCase().includes(clientSearch.toLowerCase()))
    : [];

  const selectedClient = browseClientId ? (allClients || []).find((c) => c.id === browseClientId) : null;

  const addEmployeeWithId = addEmployee.bind(null, browseClientId || "");
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const activeEmployees = (employees || []).filter((e: any) => e.is_active);
  const formerEmployees = (employees || []).filter((e: any) => !e.is_active);

  const runningForEmployee = activeEmployees.find((e: any) => e.id === runForEmployeeId);
  const createPayRunWithIds = runningForEmployee
    ? createPayRun.bind(null, runningForEmployee.id, browseClientId || "")
    : null;

  const taxYearForSync = "2026/27";

  const EmployeeCard = ({ emp, showRunPay }: { emp: any; showRunPay: boolean }) => {
    const isLinking = linkEmployeeId === emp.id;
    const linkedClient = emp.linked_client;
    const isSynced = linkedClient && Number(emp.synced_gross) > 0 && emp.synced_at;

    return (
      <div className={`rounded-xl border p-4 ${emp.is_active ? "border-slate-100" : "border-slate-100 opacity-60"}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-slate-900">{emp.name}</p>
              {!emp.is_active && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  Left {emp.leaving_date ? new Date(emp.leaving_date).toLocaleDateString("en-GB") : ""}
                </span>
              )}
              {linkedClient && (
                <a href={`/clients/${linkedClient.id}`}
                  className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold hover:bg-green-200 transition-colors">
                  → {linkedClient.client_name}
                </a>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {emp.tax_code} · NI Category {emp.ni_category} · {emp.pay_frequency}
              {emp.student_loan_plan && ` · ${emp.student_loan_plan}`}
              {emp.postgrad_loan && " · Postgrad Loan"}
              {emp.pension_opted_out && " · Pension opted out"}
            </p>
            {linkedClient && (
              <p className={`text-xs mt-1 ${isSynced ? "text-green-600" : "text-amber-600"}`}>
                {isSynced ? `✓ Synced to Personal Tax (${fmt(Number(emp.synced_gross))} gross)` : "Not yet synced to Personal Tax"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {showRunPay && (
              <a href={`/payroll?browseClient=${browseClientId}&runFor=${emp.id}`}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors whitespace-nowrap">
                {runForEmployeeId === emp.id ? "Close" : "Run Pay →"}
              </a>
            )}
            <a href={`/payroll/p60/${emp.id}`}
              className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap">
              P60 →
            </a>
            {emp.leaving_date ? (
              <>
                <a href={`/payroll/p45/${emp.id}`}
                  className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap">
                  P45 →
                </a>
                <form action={reactivateEmployee.bind(null, emp.id)}>
                  <button className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors whitespace-nowrap">
                    Reactivate
                  </button>
                </form>
              </>
            ) : (
              <details className="inline-block relative">
                <summary className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap list-none inline">
                  Mark as Leaver
                </summary>
                <form action={markAsLeaver.bind(null, emp.id)} className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl p-3 shadow-lg z-10 flex gap-2 items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Leaving Date</label>
                    <input name="leaving_date" type="date" required className="rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors whitespace-nowrap">
                    Save
                  </button>
                </form>
              </details>
            )}
            {linkedClient ? (
              <>
                <form action={syncEmployeeToPersonalTax.bind(null, emp.id, taxYearForSync)}>
                  <button className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition-colors whitespace-nowrap">
                    Sync to Personal Tax →
                  </button>
                </form>
                <form action={unlinkEmployee.bind(null, emp.id)}>
                  <button className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                    Unlink
                  </button>
                </form>
              </>
            ) : (
              <a href={isLinking ? `/payroll?browseClient=${browseClientId}` : `/payroll?browseClient=${browseClientId}&linkEmployee=${emp.id}`}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors whitespace-nowrap">
                {isLinking ? "Close" : "Link to Client"}
              </a>
            )}
            <form action={deleteEmployee.bind(null, emp.id)}>
              <button className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                Delete
              </button>
            </form>
          </div>
        </div>

        {isLinking && !linkedClient && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <form action={linkEmployeeToClient.bind(null, emp.id)} className="flex gap-2 items-end">
              <div className="flex-1 max-w-sm">
                <label className="block text-xs font-medium text-slate-700 mb-1">Link to their Personal Tax client record</label>
                <select name="linked_client_id" required
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Select a client</option>
                  {(allClients || []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.client_name}</option>
                  ))}
                </select>
              </div>
              <button type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Link
              </button>
            </form>
            <p className="text-xs text-slate-400 mt-2">
              Once linked, "Sync to Personal Tax" will add this employee's total gross pay and tax deducted for {taxYearForSync} into their Personal Tax computation.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Payroll</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Calculates PAYE, National Insurance, student/postgraduate loan deductions, and pension auto-enrolment for each pay run.
            </p>
          </div>
          <a href="/payroll/p32"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            P32 Employer Payment Record →
          </a>
        </div>
      </div>

      <div className="p-8 space-y-6">

        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
          <p className="text-xs text-yellow-800">
            <strong>Working calculator, not an RTI filing tool.</strong> This computes each pay period independently (Week 1 / Month 1 basis) rather than tracking a full cumulative year-to-date position. Submitting payroll to HMRC (Full Payment Submission) still requires HMRC-recognised software such as Basic PAYE Tools — use the figures calculated here as your working papers, and verify NI category treatment, student loan plans, and pension rates against current GOV.UK guidance before relying on them for a real payslip.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
          <form method="get" className="mt-4 flex gap-2">
            <input
              list="client-options"
              name="clientSearch"
              defaultValue={clientSearch || selectedClient?.client_name || ""}
              placeholder="Start typing a client name..."
              className="flex-1 max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            />
            <datalist id="client-options">
              {(allClients || []).map((c) => (
                <option key={c.id} value={c.client_name} />
              ))}
            </datalist>
            <button type="submit"
              className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
              Search
            </button>
          </form>

          {clientSearch && !browseClientId && (
            <div className="mt-4 space-y-2">
              {searchMatches.length === 0 && (
                <p className="text-sm text-slate-500">No clients found matching "{clientSearch}".</p>
              )}
              {searchMatches.map((c) => (
                <a key={c.id} href={`/payroll?browseClient=${c.id}`}
                  className="block rounded-xl border border-slate-100 p-3 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors">
                  {c.client_name}
                </a>
              ))}
            </div>
          )}

          {selectedClient && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <span className="text-sm font-medium text-slate-700">Showing: {selectedClient.client_name}</span>
              <a href="/payroll" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
            </div>
          )}
        </div>

        {browseClientId && selectedClient && (
          <>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">New Pay Run</h2>
                {!runForEmployeeId && activeEmployees.length > 0 && (
                  <span className="text-xs text-slate-400">Pick an active employee below to begin</span>
                )}
              </div>

              {!runForEmployeeId ? (
                <div className="mt-4 space-y-2">
                  {activeEmployees.map((emp: any) => (
                    <a key={emp.id} href={`/payroll?browseClient=${browseClientId}&runFor=${emp.id}`}
                      className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                      <div>
                        <p className="font-semibold text-slate-900">{emp.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{emp.tax_code} · NI Category {emp.ni_category} · {emp.pay_frequency}</p>
                      </div>
                      <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Run Pay →</span>
                    </a>
                  ))}
                  {activeEmployees.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-6">No active employees to run pay for. Add one below.</p>
                  )}
                </div>
              ) : runningForEmployee && createPayRunWithIds ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 mb-4">
                    <span className="text-sm font-medium text-slate-700">
                      {runningForEmployee.name} · {runningForEmployee.tax_code} · NI Category {runningForEmployee.ni_category} · {runningForEmployee.pay_frequency}
                    </span>
                    <a href={`/payroll?browseClient=${browseClientId}`} className="text-xs font-semibold text-blue-600 hover:underline">Choose a different employee</a>
                  </div>
                  <form action={createPayRunWithIds} className="grid gap-4 md:grid-cols-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
                      <input name="pay_period_start" type="date" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
                      <input name="pay_period_end" type="date" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Payment Date *</label>
                      <input name="payment_date" type="date" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Gross Pay (£) *</label>
                      <input name="gross_pay" type="number" step="0.01" min="0" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div className="md:col-span-4">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                      <input name="notes" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>
                    <div className="md:col-span-4">
                      <button type="submit" className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                        Calculate & Save
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Employees ({activeEmployees.length})</h2>
              <div className="mt-4 space-y-2">
                {activeEmployees.map((emp: any) => <EmployeeCard key={emp.id} emp={emp} showRunPay={false} />)}
                {activeEmployees.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-6">No active employees on payroll for this client.</p>
                )}
              </div>

              <details className="mt-4">
                <summary className="text-sm font-semibold text-blue-600 cursor-pointer hover:underline">+ Add Employee (New Starter)</summary>
                <form action={addEmployeeWithId} className="mt-4 space-y-4 rounded-xl border border-slate-100 p-4">

                  <div>
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">Personal Details</p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
                        <input name="name" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Date of Birth</label>
                        <input name="date_of_birth" type="date" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Gender</label>
                        <select name="gender" defaultValue="" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                          <option value="">Not specified</option>
                          <option value="M">Male</option>
                          <option value="F">Female</option>
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                        <input name="address" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">NI Number</label>
                        <input name="ni_number" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">Employment Details</p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                        <input name="start_date" type="date" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Tax Code</label>
                        <input name="tax_code" defaultValue="1257L" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">NI Category</label>
                        <select name="ni_category" defaultValue="A" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                          <option value="A">A — Standard</option>
                          <option value="C">C — Over State Pension Age</option>
                          <option value="H">H — Apprentice under 25</option>
                          <option value="M">M — Under 21</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Pay Frequency</label>
                        <select name="pay_frequency" defaultValue="Monthly" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                          <option>Monthly</option>
                          <option>Weekly</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Student Loan Plan</label>
                        <select name="student_loan_plan" defaultValue="" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                          <option value="">None</option>
                          <option>Plan 1</option>
                          <option>Plan 2</option>
                          <option>Plan 4</option>
                          <option>Plan 5</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-end gap-4 mt-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input name="postgrad_loan" type="checkbox" className="w-4 h-4 rounded" />
                        <span className="text-sm font-medium text-slate-700">Postgraduate loan</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input name="pension_opted_out" type="checkbox" className="w-4 h-4 rounded" />
                        <span className="text-sm font-medium text-slate-700">Opted out of pension</span>
                      </label>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-1">New Starter Declaration</p>
                    <p className="text-xs text-slate-400 mb-2">
                      From the employee's P45, or the HMRC starter checklist if they don't have one. Determines whether previous pay/tax carries forward this tax year.
                    </p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Statement</label>
                        <select name="starter_declaration" defaultValue="" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                          <option value="">Select if applicable</option>
                          <option value="A">A — First job since 6 April</option>
                          <option value="B">B — Only job, but had another earlier this tax year</option>
                          <option value="C">C — Has another job or pension</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Previous Employer (from P45)</label>
                        <input name="previous_employer_name" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div />
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Previous Pay to Date (£)</label>
                        <input name="previous_pay_to_date" type="number" step="0.01" min="0" defaultValue="0" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Previous Tax to Date (£)</label>
                        <input name="previous_tax_to_date" type="number" step="0.01" min="0" defaultValue="0" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                    </div>
                  </div>

                  <button type="submit" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                    Add Employee
                  </button>
                </form>
              </details>
            </div>

            {formerEmployees.length > 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Former Employees ({formerEmployees.length})</h2>
                <p className="text-xs text-slate-400 mt-0.5">Kept for reference and end-of-year documents — not available to run pay for.</p>
                <div className="mt-4 space-y-2">
                  {formerEmployees.map((emp: any) => <EmployeeCard key={emp.id} emp={emp} showRunPay={false} />)}
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Pay Run History</h2>
              <div className="mt-4 space-y-2">
                {(runs || []).map((run: any) => {
                  const isEditing = editRunId === run.id;
                  return (
                  <div key={run.id} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {run.payroll_employees?.name} — {new Date(run.payment_date).toLocaleDateString("en-GB")}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {new Date(run.pay_period_start).toLocaleDateString("en-GB")} to {new Date(run.pay_period_end).toLocaleDateString("en-GB")}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-bold text-slate-900">{fmt(Number(run.net_pay))}</p>
                          <p className="text-xs text-slate-400">net pay (gross {fmt(Number(run.gross_pay))})</p>
                        </div>
                        <a href={isEditing ? `/payroll?browseClient=${browseClientId}` : `/payroll?browseClient=${browseClientId}&editRun=${run.id}`}
                          className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                          {isEditing ? "Close" : "Edit"}
                        </a>
                        <form action={deletePayRun.bind(null, run.id)}>
                          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2 text-xs border-t border-slate-100 pt-3">
                      <div><p className="text-slate-400">Tax</p><p className="font-semibold text-slate-700">{fmt(Number(run.tax_deducted))}</p></div>
                      <div><p className="text-slate-400">Employee NI</p><p className="font-semibold text-slate-700">{fmt(Number(run.employee_ni))}</p></div>
                      <div><p className="text-slate-400">Employer NI</p><p className="font-semibold text-slate-700">{fmt(Number(run.employer_ni))}</p></div>
                      {Number(run.student_loan_deducted) > 0 && (
                        <div><p className="text-slate-400">Student Loan</p><p className="font-semibold text-slate-700">{fmt(Number(run.student_loan_deducted))}</p></div>
                      )}
                      {Number(run.employee_pension) > 0 && (
                        <div><p className="text-slate-400">Employee Pension</p><p className="font-semibold text-slate-700">{fmt(Number(run.employee_pension))}</p></div>
                      )}
                      {Number(run.employer_pension) > 0 && (
                        <div><p className="text-slate-400">Employer Pension</p><p className="font-semibold text-slate-700">{fmt(Number(run.employer_pension))}</p></div>
                      )}
                    </div>

                    {isEditing && (
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <form action={updatePayRun.bind(null, run.id, run.employee_id)} className="grid gap-4 md:grid-cols-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Period Start</label>
                            <input name="pay_period_start" type="date" required defaultValue={run.pay_period_start}
                              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Period End</label>
                            <input name="pay_period_end" type="date" required defaultValue={run.pay_period_end}
                              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Payment Date</label>
                            <input name="payment_date" type="date" required defaultValue={run.payment_date}
                              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Gross Pay (£)</label>
                            <input name="gross_pay" type="number" step="0.01" min="0" required defaultValue={run.gross_pay}
                              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                          </div>
                          <div className="md:col-span-4">
                            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                            <input name="notes" defaultValue={run.notes || ""}
                              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                          </div>
                          <div className="md:col-span-4">
                            <button type="submit"
                              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                              Save & Recalculate
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                  );
                })}
                {(!runs || runs.length === 0) && (
                  <p className="text-sm text-slate-500 text-center py-6">No pay runs recorded yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
              <p className="text-xs text-blue-800">
                <strong>How the Personal Tax sync works:</strong> link an employee to their own Personal Tax client record, then click "Sync to Personal Tax" any time after running their pay. It totals every pay run for {taxYearForSync} and pushes the gross pay into Employment Income and the tax deducted into Tax Paid at Source on their Personal Tax computation for that year — creating one if it doesn't exist yet. Re-syncing after adding more pay runs only applies the difference, so it won't double-count or overwrite other income entered separately on their return.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}