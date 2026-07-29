import { createClient } from "@supabase/supabase-js";
import PrintButton from "../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function PayrollSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string; clientSearch?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const { browseClient: browseClientId, clientSearch, dateFrom, dateTo } = await searchParams;

  const { data: allClients } = await supabase.from("clients").select("id, client_name").order("client_name", { ascending: true });

  const searchMatches = clientSearch
    ? (allClients || []).filter((c) => c.client_name.toLowerCase().includes(clientSearch.toLowerCase()))
    : [];

  const selectedClient = browseClientId ? (allClients || []).find((c) => c.id === browseClientId) : null;

  // Default to the current tax year to date if no range is given, so the
  // report shows something useful the first time it's opened.
  const today = new Date();
  const taxYearStart = today.getMonth() < 3 || (today.getMonth() === 3 && today.getDate() < 6)
    ? `${today.getFullYear() - 1}-04-06`
    : `${today.getFullYear()}-04-06`;
  const effectiveFrom = dateFrom || taxYearStart;
  const effectiveTo = dateTo || today.toISOString().split("T")[0];

  let runs: any[] = [];
  if (browseClientId) {
    const { data } = await supabase
      .from("payroll_runs")
      .select("*, payroll_employees(name, ni_number, tax_code)")
      .eq("client_id", browseClientId)
      .gte("payment_date", effectiveFrom)
      .lte("payment_date", effectiveTo)
      .order("payment_date", { ascending: true });
    runs = data || [];
  }

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Group by employee for the summary table; each employee gets one row
  // totalling every pay run in the selected date range.
  const byEmployee = new Map<string, { name: string; niNumber: string; taxCode: string; runs: any[] }>();
  runs.forEach((r) => {
    const key = r.employee_id;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        name: r.payroll_employees?.name || "Unknown",
        niNumber: r.payroll_employees?.ni_number || "—",
        taxCode: r.payroll_employees?.tax_code || "—",
        runs: [],
      });
    }
    byEmployee.get(key)!.runs.push(r);
  });

  const employeeSummaries = Array.from(byEmployee.entries()).map(([employeeId, data]) => {
    const totals = data.runs.reduce((acc, r) => ({
      basicPay: acc.basicPay + Number(r.basic_pay || r.gross_pay),
      bonus: acc.bonus + Number(r.bonus || 0),
      overtime: acc.overtime + Number(r.overtime || 0),
      holidayPay: acc.holidayPay + Number(r.holiday_pay || 0),
      sickPay: acc.sickPay + Number(r.sick_pay || 0),
      gross: acc.gross + Number(r.gross_pay),
      tax: acc.tax + Number(r.tax_deducted),
      employeeNI: acc.employeeNI + Number(r.employee_ni),
      employerNI: acc.employerNI + Number(r.employer_ni),
      studentLoan: acc.studentLoan + Number(r.student_loan_deducted || 0) + Number(r.postgrad_loan_deducted || 0),
      employeePension: acc.employeePension + Number(r.employee_pension),
      employerPension: acc.employerPension + Number(r.employer_pension),
      expenses: acc.expenses + Number(r.expenses || 0),
      otherDeductions: acc.otherDeductions + Number(r.other_deductions || 0),
      net: acc.net + Number(r.net_pay),
    }), {
      basicPay: 0, bonus: 0, overtime: 0, holidayPay: 0, sickPay: 0, gross: 0, tax: 0,
      employeeNI: 0, employerNI: 0, studentLoan: 0, employeePension: 0, employerPension: 0,
      expenses: 0, otherDeductions: 0, net: 0,
    });
    return { employeeId, ...data, totals, payCount: data.runs.length };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const grandTotals = employeeSummaries.reduce((acc, e) => ({
    gross: acc.gross + e.totals.gross,
    tax: acc.tax + e.totals.tax,
    employeeNI: acc.employeeNI + e.totals.employeeNI,
    employerNI: acc.employerNI + e.totals.employerNI,
    studentLoan: acc.studentLoan + e.totals.studentLoan,
    employeePension: acc.employeePension + e.totals.employeePension,
    employerPension: acc.employerPension + e.totals.employerPension,
    expenses: acc.expenses + e.totals.expenses,
    otherDeductions: acc.otherDeductions + e.totals.otherDeductions,
    net: acc.net + e.totals.net,
  }), { gross: 0, tax: 0, employeeNI: 0, employerNI: 0, studentLoan: 0, employeePension: 0, employerPension: 0, expenses: 0, otherDeductions: 0, net: 0 });

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
<div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <div className="flex items-center justify-between">
          <div>
            <a href={browseClientId ? `/payroll?browseClient=${browseClientId}` : "/payroll"} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">← Back to Payroll</a>
            <h1 className="text-2xl font-bold text-slate-900 mt-4">Payroll Summary Report</h1>
            <p className="text-sm text-slate-500 mt-0.5">{selectedClient ? selectedClient.client_name : "Per-employee totals across a chosen date range."}</p>
          </div>
          {browseClientId && <PrintButton />}
        </div>
      </div>

      <div className="p-8 space-y-6">
        {!browseClientId && (
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:hidden">
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
              {(allClients || []).map((c) => <option key={c.id} value={c.client_name} />)}
            </datalist>
            <button type="submit" className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
              Search
            </button>
          </form>

          {clientSearch && !browseClientId && (
            <div className="mt-4 space-y-2">
              {searchMatches.length === 0 && <p className="text-sm text-slate-500">No clients found matching "{clientSearch}".</p>}
              {searchMatches.map((c) => (
                <a key={c.id} href={`/payroll/summary?browseClient=${c.id}`}
                  className="block rounded-xl border border-slate-100 p-3 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors">
                  {c.client_name}
                </a>
              ))}
            </div>
)}
        </div>
        )}

        {browseClientId && selectedClient && (
<>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:hidden">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-slate-700">Showing: {selectedClient.client_name}</span>
                <a href="/payroll/summary" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
              </div>
              <form method="get" className="flex gap-4 items-end">
                <input type="hidden" name="browseClient" value={browseClientId} />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">From</label>
                  <input name="dateFrom" type="date" defaultValue={effectiveFrom} className="rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">To</label>
                  <input name="dateTo" type="date" defaultValue={effectiveTo} className="rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <button type="submit" className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Update Report
                </button>
              </form>
            </div>

            <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">
                  {selectedClient.client_name} · {new Date(effectiveFrom).toLocaleDateString("en-GB")} to {new Date(effectiveTo).toLocaleDateString("en-GB")}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">{employeeSummaries.length} employee{employeeSummaries.length !== 1 ? "s" : ""} paid in this period</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3 text-right">Pay Runs</th>
                      <th className="px-4 py-3 text-right">Gross</th>
                      <th className="px-4 py-3 text-right">Tax</th>
                      <th className="px-4 py-3 text-right">Employee NI</th>
                      <th className="px-4 py-3 text-right">Employer NI</th>
                      <th className="px-4 py-3 text-right">Student Loan</th>
                      <th className="px-4 py-3 text-right">Pension (Ee)</th>
                      <th className="px-4 py-3 text-right">Pension (Er)</th>
                      <th className="px-4 py-3 text-right">Expenses</th>
                      <th className="px-4 py-3 text-right">Other Ded.</th>
                      <th className="px-4 py-3 text-right font-bold">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeSummaries.map((emp) => (
                      <tr key={emp.employeeId} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{emp.name}</p>
                          <p className="text-xs text-slate-400">{emp.taxCode} · {emp.niNumber}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">{emp.payCount}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(emp.totals.gross)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(emp.totals.tax)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(emp.totals.employeeNI)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(emp.totals.employerNI)}</td>
                        <td className="px-4 py-3 text-right font-mono">{emp.totals.studentLoan > 0 ? fmt(emp.totals.studentLoan) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{emp.totals.employeePension > 0 ? fmt(emp.totals.employeePension) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{emp.totals.employerPension > 0 ? fmt(emp.totals.employerPension) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{emp.totals.expenses > 0 ? fmt(emp.totals.expenses) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{emp.totals.otherDeductions > 0 ? fmt(emp.totals.otherDeductions) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">{fmt(emp.totals.net)}</td>
                      </tr>
                    ))}
                    {employeeSummaries.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-slate-500">No pay runs found in this date range.</td>
                      </tr>
                    )}
                  </tbody>
                  {employeeSummaries.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-900 text-white font-bold">
                        <td className="px-4 py-3">Total</td>
                        <td className="px-4 py-3 text-right">{runs.length}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(grandTotals.gross)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(grandTotals.tax)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(grandTotals.employeeNI)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(grandTotals.employerNI)}</td>
                        <td className="px-4 py-3 text-right font-mono">{grandTotals.studentLoan > 0 ? fmt(grandTotals.studentLoan) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{grandTotals.employeePension > 0 ? fmt(grandTotals.employeePension) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{grandTotals.employerPension > 0 ? fmt(grandTotals.employerPension) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{grandTotals.expenses > 0 ? fmt(grandTotals.expenses) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{grandTotals.otherDeductions > 0 ? fmt(grandTotals.otherDeductions) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(grandTotals.net)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {employeeSummaries.length > 0 && (
              <details className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:hidden">
                <summary className="text-sm font-semibold text-blue-600 cursor-pointer hover:underline">
                  Show individual pay run lines
                </summary>
                <div className="mt-4 space-y-6">
                  {employeeSummaries.map((emp) => (
                    <div key={emp.employeeId}>
                      <p className="text-sm font-bold text-slate-900 mb-2">{emp.name}</p>
                      <div className="space-y-1">
                        {emp.runs.map((run: any) => (
                          <div key={run.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                            <span className="text-slate-600">{new Date(run.payment_date).toLocaleDateString("en-GB")} · {new Date(run.pay_period_start).toLocaleDateString("en-GB")}–{new Date(run.pay_period_end).toLocaleDateString("en-GB")}</span>
                            <span className="font-mono text-slate-900">Gross {fmt(Number(run.gross_pay))} · Net {fmt(Number(run.net_pay))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}