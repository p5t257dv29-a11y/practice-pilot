import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import PrintButton from "../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: run, error } = await supabase
    .from("payroll_runs")
    .select("*, payroll_employees(*), clients!payroll_runs_client_id_fkey(client_name)")
    .eq("token", token)
    .single();

  if (error || !run) notFound();

  const [{ data: practiceSettings }, { data: ytdRuns }] = await Promise.all([
    supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle(),
    supabase
      .from("payroll_runs")
      .select("gross_pay, tax_deducted, employee_ni, employee_pension, student_loan_deducted, postgrad_loan_deducted")
      .eq("employee_id", run.employee_id)
      .lte("payment_date", run.payment_date),
  ]);

  const employee = run.payroll_employees as any;
  const client = run.clients as any;
  const firmName = practiceSettings?.firm_name || "Your Accountant";

  const ytd = {
    grossPay: (ytdRuns || []).reduce((sum, r) => sum + Number(r.gross_pay), 0),
    tax: (ytdRuns || []).reduce((sum, r) => sum + Number(r.tax_deducted), 0),
    employeeNI: (ytdRuns || []).reduce((sum, r) => sum + Number(r.employee_ni), 0),
    employeePension: (ytdRuns || []).reduce((sum, r) => sum + Number(r.employee_pension), 0),
    studentLoan: (ytdRuns || []).reduce((sum, r) => sum + Number(r.student_loan_deducted), 0),
  };

  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const Row = ({ label, value, isDeduction }: { label: string; value: number; isDeduction?: boolean }) => (
    value !== 0 ? (
      <div className="flex justify-between py-1.5 text-sm">
        <span className="text-slate-600">{label}</span>
        <span className={`font-mono ${isDeduction ? "text-red-600" : "text-slate-900"}`}>
          {isDeduction ? `−£${fmt(value)}` : `£${fmt(value)}`}
        </span>
      </div>
    ) : null
  );

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Payslip</h1>
            <p className="text-sm text-slate-500 mt-0.5">{employee?.name} · {new Date(run.payment_date).toLocaleDateString("en-GB")}</p>
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none">

          <div className="bg-slate-900 text-white px-6 py-5 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide print:text-slate-500">Payslip</p>
                <h2 className="text-lg font-bold mt-1">{client?.client_name || "Employer"}</h2>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 print:text-slate-500">Payment Date</p>
                <p className="font-bold">{new Date(run.payment_date).toLocaleDateString("en-GB")}</p>
              </div>
            </div>
          </div>

          <div className="p-6 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Employee</p>
                <p className="font-semibold text-slate-900 mt-1">{employee?.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">NI No: {employee?.ni_number || "Not on file"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Pay Period</p>
                <p className="font-semibold text-slate-900 mt-1">
                  {new Date(run.pay_period_start).toLocaleDateString("en-GB")} to {new Date(run.pay_period_end).toLocaleDateString("en-GB")}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Tax Code: {run.tax_code_used} · NI Category: {run.ni_category_used}</p>
              </div>
            </div>
          </div>

          <div className="p-6 border-b border-slate-100">
<p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">This Payment</p>
            <Row label="Basic Pay" value={Number(run.basic_pay || run.gross_pay)} />
            <Row label="Bonus" value={Number(run.bonus)} />
            <Row label="Overtime" value={Number(run.overtime)} />
            <Row label="Holiday Pay" value={Number(run.holiday_pay)} />
            <Row label="Sick Pay" value={Number(run.sick_pay)} />
            <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between text-sm font-medium">
              <span className="text-slate-700">Gross Pay</span>
              <span className="font-mono text-slate-900">£{fmt(Number(run.gross_pay))}</span>
            </div>
            <div className="border-t border-slate-100 mt-2 pt-2">
              <Row label="PAYE Tax" value={Number(run.tax_deducted)} isDeduction />
              <Row label="Employee National Insurance" value={Number(run.employee_ni)} isDeduction />
              <Row label={`Student Loan${employee?.student_loan_plan ? ` (${employee.student_loan_plan})` : ""}`} value={Number(run.student_loan_deducted)} isDeduction />
              <Row label="Postgraduate Loan" value={Number(run.postgrad_loan_deducted)} isDeduction />
<Row label="Pension Contribution" value={Number(run.employee_pension)} isDeduction />
              {Number(run.other_deductions) > 0 && (
                <Row label={run.other_deductions_description || "Other Deduction"} value={Number(run.other_deductions)} isDeduction />
              )}
              {Number(run.expenses) > 0 && (
                <Row label="Expenses Reimbursed" value={Number(run.expenses)} />
              )}
            </div>
            <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between font-bold text-base">
              <span>Net Pay</span>
              <span>£{fmt(Number(run.net_pay))}</span>
            </div>
          </div>

          <div className="p-6 bg-slate-50 print:bg-white">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Year to Date</p>
            <Row label="Gross Pay" value={ytd.grossPay} />
            <Row label="Tax Deducted" value={ytd.tax} isDeduction />
            <Row label="Employee NI" value={ytd.employeeNI} isDeduction />
            {ytd.studentLoan > 0 && <Row label="Student Loan" value={ytd.studentLoan} isDeduction />}
            {ytd.employeePension > 0 && <Row label="Pension Contributions" value={ytd.employeePension} isDeduction />}
          </div>

          {run.employer_ni > 0 || run.employer_pension > 0 ? (
            <div className="p-6 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Employer Contributions (not deducted from your pay)</p>
              <Row label="Employer National Insurance" value={Number(run.employer_ni)} />
              <Row label="Employer Pension Contribution" value={Number(run.employer_pension)} />
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            Working document, calculated on a Week 1/Month 1 basis. Prepared by {firmName}.
          </p>
        </div>
      </div>
    </div>
  );
}