import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { taxYearDateRange } from "../../page";
import PrintButton from "../../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function P45Page({
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

  if (error || !employee || !employee.leaving_date) notFound();

  const { start } = taxYearDateRange(taxYear);

  const [{ data: runs }, { data: practiceSettings }] = await Promise.all([
    supabase
      .from("payroll_runs")
      .select("*")
      .eq("employee_id", employeeId)
      .gte("payment_date", start)
      .lte("payment_date", employee.leaving_date)
      .order("payment_date", { ascending: true }),
    supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle(),
  ]);

  const client = employee.clients as any;
  const firmName = practiceSettings?.firm_name || "Your Accountant";

  const totals = {
    grossPay: (runs || []).reduce((sum, r: any) => sum + Number(r.gross_pay), 0),
    tax: (runs || []).reduce((sum, r: any) => sum + Number(r.tax_deducted), 0),
    studentLoan: (runs || []).reduce((sum, r: any) => sum + Number(r.student_loan_deducted), 0),
    postgradLoan: (runs || []).reduce((sum, r: any) => sum + Number(r.postgrad_loan_deducted), 0),
  };

  const previousPay = Number(employee.previous_pay_to_date || 0);
  const previousTax = Number(employee.previous_tax_to_date || 0);
  const totalPayToDate = totals.grossPay + previousPay;
  const totalTaxToDate = totals.tax + previousTax;

  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const Row = ({ number, label, value, bold }: { number: string; label: string; value: string; bold?: boolean }) => (
    <div className={`flex items-start justify-between py-2.5 border-b border-slate-100 gap-4 ${bold ? "font-bold" : ""}`}>
      <div className="flex items-start gap-3 flex-1">
        <span className="text-xs font-mono font-bold text-slate-400 mt-0.5 w-8 flex-shrink-0">{number}</span>
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      <span className="text-sm font-mono font-semibold text-slate-900 flex-shrink-0">{value}</span>
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
        <h1 className="text-2xl font-bold text-slate-900 mt-4">P45 — Details of Employee Leaving Work</h1>
        <p className="text-sm text-slate-500 mt-0.5">{employee.name} · Left {new Date(employee.leaving_date).toLocaleDateString("en-GB")}</p>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none">

          <div className="bg-slate-900 text-white px-6 py-5 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
            <p className="text-xs text-slate-400 uppercase tracking-wide print:text-slate-500">P45 — Part 1A</p>
            <h2 className="text-lg font-bold mt-1">Details of Employee Leaving Work</h2>
          </div>

          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Employer Details</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs">Employer Name</p>
                <p className="font-medium text-slate-900 mt-1">{client?.client_name || "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Company Number</p>
                <p className="font-medium text-slate-900 mt-1">{client?.company_number || "Not on file"}</p>
              </div>
            </div>
          </div>

          <div className="p-6 border-b border-slate-100">
            <Row number="1" label="Employee's National Insurance number" value={employee.ni_number || "Not on file"} />
            <Row number="2" label="Employee's name" value={employee.name} />
            <Row number="3" label="Leaving date" value={new Date(employee.leaving_date).toLocaleDateString("en-GB")} />
            <Row number="4" label="Tax code at leaving date" value={employee.tax_code} />
            <Row number="5" label="Student Loan deductions" value={totals.studentLoan > 0 ? "Yes" : "No"} />
            <Row number="6" label="Postgraduate Loan deductions" value={totals.postgradLoan > 0 ? "Yes" : "No"} />
          </div>

          <div className="p-6 bg-slate-50 print:bg-white">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Pay and Tax Details</p>
            <Row number="7" label="Total pay to date in this employment" value={`£${fmt(totals.grossPay)}`} />
            <Row number="8" label="Total tax deducted to date in this employment" value={`£${fmt(totals.tax)}`} />
            {(previousPay > 0 || previousTax > 0) && (
              <>
                <Row number="9" label="Total pay in previous employment(s) this tax year" value={`£${fmt(previousPay)}`} />
                <Row number="10" label="Total tax deducted in previous employment(s) this tax year" value={`£${fmt(previousTax)}`} />
              </>
            )}
            <Row number="—" label="Total pay to date, this tax year" value={`£${fmt(totalPayToDate)}`} bold />
            <Row number="—" label="Total tax deducted to date, this tax year" value={`£${fmt(totalTaxToDate)}`} bold />
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>Working paper, not an official P45.</strong> A genuine P45 must be generated using HMRC-recognised payroll software as part of the leaver's final Full Payment Submission, and given to the employee. Figures here are calculated from pay runs recorded on a Week 1/Month 1 basis rather than full cumulative tracking — verify against your actual FPS submissions before issuing.
          </p>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Prepared by {firmName} · Tax Year {taxYear}
        </p>
      </div>
    </div>
  );
}