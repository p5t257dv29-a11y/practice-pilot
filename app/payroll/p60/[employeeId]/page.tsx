import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { taxYearDateRange } from "../../page";
import PrintButton from "../../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function P60Page({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ taxYear?: string }>;
}) {
  const { employeeId } = await params;
  const { taxYear = "2026/27" } = await searchParams;

const { data: employee, error } = await supabase
    .from("payroll_employees")
    .select("*, clients!payroll_employees_client_id_fkey(client_name, company_number, address)")
    .eq("id", employeeId)
    .single();
if (error || !employee) {
    console.error("P60 lookup failed:", { employeeId, error });
    notFound();
  }
  const { start, end } = taxYearDateRange(taxYear);

  const [{ data: runs }, { data: practiceSettings }] = await Promise.all([
    supabase
      .from("payroll_runs")
      .select("*")
      .eq("employee_id", employeeId)
      .gte("payment_date", start)
      .lte("payment_date", end)
      .order("payment_date", { ascending: true }),
    supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle(),
  ]);

  const client = employee.clients as any;
  const firmName = practiceSettings?.firm_name || "Your Accountant";

  const inThisEmployment = {
    grossPay: (runs || []).reduce((sum, r: any) => sum + Number(r.gross_pay), 0),
    tax: (runs || []).reduce((sum, r: any) => sum + Number(r.tax_deducted), 0),
    employeeNI: (runs || []).reduce((sum, r: any) => sum + Number(r.employee_ni), 0),
    employerNI: (runs || []).reduce((sum, r: any) => sum + Number(r.employer_ni), 0),
    studentLoan: (runs || []).reduce((sum, r: any) => sum + Number(r.student_loan_deducted), 0),
    postgradLoan: (runs || []).reduce((sum, r: any) => sum + Number(r.postgrad_loan_deducted), 0),
    employeePension: (runs || []).reduce((sum, r: any) => sum + Number(r.employee_pension), 0),
  };

  const previousPay = Number(employee.previous_pay_to_date || 0);
  const previousTax = Number(employee.previous_tax_to_date || 0);
  const hasPreviousEmployment = previousPay > 0 || previousTax > 0;

  const totalForYear = {
    grossPay: inThisEmployment.grossPay + previousPay,
    tax: inThisEmployment.tax + previousTax,
  };

  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <div className={`flex justify-between py-2 border-b border-slate-100 ${bold ? "font-bold" : ""}`}>
      <span className="text-slate-600">{label}</span>
      <span className="font-mono text-slate-900">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <div className="flex items-center justify-between">
          <a href="/payroll" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to Payroll
          </a>
          <PrintButton />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">P60 — End of Year Certificate</h1>
        <p className="text-sm text-slate-500 mt-0.5">{employee.name} · Tax Year {taxYear}</p>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none">

          <div className="bg-slate-900 text-white px-6 py-5 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
            <p className="text-xs text-slate-400 uppercase tracking-wide print:text-slate-500">P60 End of Year Certificate</p>
            <h2 className="text-lg font-bold mt-1">Tax Year to 5 April {taxYear.split("/")[0].slice(0, 2)}{taxYear.split("/")[1]}</h2>
          </div>

          <div className="p-6 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Employee</p>
                <p className="font-semibold text-slate-900 mt-1">{employee.name}</p>
                {employee.address && <p className="text-slate-600 text-xs mt-0.5 whitespace-pre-line">{employee.address}</p>}
                {employee.date_of_birth && (
                  <p className="text-slate-500 text-xs mt-1">DOB: {new Date(employee.date_of_birth).toLocaleDateString("en-GB")}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">National Insurance Number</p>
                <p className="font-semibold text-slate-900 mt-1 font-mono">{employee.ni_number || "Not on file"}</p>
                <p className="text-xs text-slate-400 uppercase tracking-wide mt-3">NI Category Letter</p>
                <p className="font-semibold text-slate-900 mt-1">{employee.ni_category}</p>
              </div>
            </div>
          </div>

          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Employer Details</p>
            <p className="font-semibold text-slate-900">{client?.client_name || "—"}</p>
            {client?.company_number && <p className="text-xs text-slate-500">PAYE Reference: (see client record) · Company No. {client.company_number}</p>}
          </div>

          {hasPreviousEmployment && (
            <div className="p-6 border-b border-slate-100 bg-slate-50 print:bg-white">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Previous Employment{employee.previous_employer_name ? ` — ${employee.previous_employer_name}` : ""}
              </p>
              <Row label="Pay" value={`£${fmt(previousPay)}`} />
              <Row label="Tax deducted" value={`£${fmt(previousTax)}`} />
            </div>
          )}

          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              This Employment — {client?.client_name || "Employer"}
            </p>
            <Row label="Total pay in this employment" value={`£${fmt(inThisEmployment.grossPay)}`} />
            <Row label="Total tax deducted in this employment" value={`£${fmt(inThisEmployment.tax)}`} />
            <Row label="Employee National Insurance contributions" value={`£${fmt(inThisEmployment.employeeNI)}`} />
            <Row label="Employer National Insurance contributions" value={`£${fmt(inThisEmployment.employerNI)}`} />
            {inThisEmployment.studentLoan > 0 && (
              <Row label={`Student Loan deductions${employee.student_loan_plan ? ` (${employee.student_loan_plan})` : ""}`} value={`£${fmt(inThisEmployment.studentLoan)}`} />
            )}
            {inThisEmployment.postgradLoan > 0 && (
              <Row label="Postgraduate Loan deductions" value={`£${fmt(inThisEmployment.postgradLoan)}`} />
            )}
            {inThisEmployment.employeePension > 0 && (
              <Row label="Employee pension contributions" value={`£${fmt(inThisEmployment.employeePension)}`} />
            )}
          </div>

          <div className="p-6 bg-slate-50 print:bg-white">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Total for Year</p>
            <Row label="Total pay" value={`£${fmt(totalForYear.grossPay)}`} bold />
            <Row label="Total tax deducted" value={`£${fmt(totalForYear.tax)}`} bold />
            <p className="text-xs text-slate-400 mt-3">Final tax code: {employee.tax_code}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>Working paper, not an official P60.</strong> A genuine P60 must be issued using HMRC-recognised payroll software or HMRC's own tools, and must be given to every employee still employed on 5 April by 31 May. Figures here are calculated from pay runs recorded in this system on a Week 1/Month 1 basis rather than full cumulative tracking — verify against your actual FPS submissions before issuing.
          </p>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Prepared by {firmName} · Tax Year {taxYear}
        </p>
      </div>
    </div>
  );
}