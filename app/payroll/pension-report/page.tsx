import { createClient } from "@supabase/supabase-js";
import PrintButton from "../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function PensionReportPage({
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
      .select("*, payroll_employees(name, ni_number, pension_scheme_name, employee_pension_rate, employer_pension_rate, pension_opted_out)")
      .eq("client_id", browseClientId)
      .gte("payment_date", effectiveFrom)
      .lte("payment_date", effectiveTo)
      .order("payment_date", { ascending: true });
    runs = data || [];
  }

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const byEmployee = new Map<string, any>();
  runs.forEach((r) => {
    const key = r.employee_id;
    const emp = r.payroll_employees;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        name: emp?.name || "Unknown",
        niNumber: emp?.ni_number || "—",
        schemeName: emp?.pension_scheme_name || "Not on file",
        employeeRate: emp?.employee_pension_rate != null ? emp.employee_pension_rate : 0.05,
        employerRate: emp?.employer_pension_rate != null ? emp.employer_pension_rate : 0.03,
        optedOut: emp?.pension_opted_out || false,
        pensionableEarnings: 0,
        employeeContribution: 0,
        employerContribution: 0,
      });
    }
    const entry = byEmployee.get(key);
    entry.pensionableEarnings += Number(r.gross_pay);
    entry.employeeContribution += Number(r.employee_pension);
    entry.employerContribution += Number(r.employer_pension);
  });

  const rows = Array.from(byEmployee.values())
    .filter((e) => !e.optedOut && (e.employeeContribution > 0 || e.employerContribution > 0))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totals = rows.reduce((acc, r) => ({
    pensionable: acc.pensionable + r.pensionableEarnings,
    employee: acc.employee + r.employeeContribution,
    employer: acc.employer + r.employerContribution,
  }), { pensionable: 0, employee: 0, employer: 0 });

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <div className="flex items-center justify-between">
          <div>
            <a href="/payroll" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">← Back to Payroll</a>
            <h1 className="text-2xl font-bold text-slate-900 mt-4">Pension Contributions Report</h1>
            <p className="text-sm text-slate-500 mt-0.5">For upload to your pension provider / The Pensions Regulator.</p>
          </div>
          {browseClientId && <PrintButton />}
        </div>
      </div>

      <div className="p-8 space-y-6">
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
                <a key={c.id} href={`/payroll/pension-report?browseClient=${c.id}`}
                  className="block rounded-xl border border-slate-100 p-3 text-sm font-medium text-slate-900 hover:bg-slate-50 transition-colors">
                  {c.client_name}
                </a>
              ))}
            </div>
          )}
        </div>

        {browseClientId && selectedClient && (
          <>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:hidden">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-slate-700">Showing: {selectedClient.client_name}</span>
                <a href="/payroll/pension-report" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
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
                <p className="text-xs text-slate-400 mt-0.5">{rows.length} employee{rows.length !== 1 ? "s" : ""} contributing to a pension in this period</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">NI Number</th>
                      <th className="px-4 py-3">Scheme</th>
                      <th className="px-4 py-3 text-right">Rate (Ee/Er)</th>
                      <th className="px-4 py-3 text-right">Pensionable Earnings</th>
                      <th className="px-4 py-3 text-right">Employee Contribution</th>
                      <th className="px-4 py-3 text-right">Employer Contribution</th>
                      <th className="px-4 py-3 text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                        <td className="px-4 py-3 text-slate-500">{r.niNumber}</td>
                        <td className="px-4 py-3 text-slate-500">{r.schemeName}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-500">{(r.employeeRate * 100).toFixed(1)}% / {(r.employerRate * 100).toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(r.pensionableEarnings)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(r.employeeContribution)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(r.employerContribution)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">{fmt(r.employeeContribution + r.employerContribution)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No pension contributions found in this date range.</td></tr>
                    )}
                  </tbody>
                  {rows.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-900 text-white font-bold">
                        <td className="px-4 py-3" colSpan={4}>Total</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(totals.pensionable)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(totals.employee)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(totals.employer)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(totals.employee + totals.employer)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
              <p className="text-xs text-yellow-800">
                This report summarizes contributions calculated in this system for upload/reference alongside your pension provider's own portal. It does not submit anything automatically — most providers (NEST, The People's Pension, etc.) require their own file format or portal upload.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}