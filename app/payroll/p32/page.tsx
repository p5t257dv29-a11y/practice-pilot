import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMPLOYMENT_ALLOWANCE_CAP = 10500;

function getTaxMonths(taxYear: string) {
  const startYear = parseInt(taxYear.split("/")[0], 10);
  const months = [];
  for (let i = 0; i < 12; i++) {
    const start = new Date(Date.UTC(startYear, 3 + i, 6));
    const end = new Date(Date.UTC(startYear, 3 + i + 1, 5));
    months.push({
      index: i + 1,
      start,
      end,
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    });
  }
  return months;
}

async function toggleEmploymentAllowance(clientId: string, formData: FormData) {
  "use server";
  const claimed = formData.get("employment_allowance_claimed") === "on";

  await supabase.from("payroll_client_settings").upsert({
    client_id: clientId,
    employment_allowance_claimed: claimed,
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });

  revalidatePath("/payroll/p32");
}

async function updateSmpRecovery(clientId: string, formData: FormData) {
  "use server";
  const rate = String(formData.get("smp_recovery_rate") || "1.03");

  await supabase.from("payroll_client_settings").upsert({
    client_id: clientId,
    smp_recovery_rate: parseFloat(rate),
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });

  revalidatePath("/payroll/p32");
}

async function markP32Paid(clientId: string, taxMonth: string, formData: FormData) {
  "use server";
  const paid = formData.get("paid") === "on";
  const paidDate = String(formData.get("paid_date") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  await supabase.from("p32_records").upsert({
    client_id: clientId,
    tax_month: taxMonth,
    paid,
    paid_date: paidDate || null,
    notes: notes || null,
  }, { onConflict: "client_id,tax_month" });

  revalidatePath("/payroll/p32");
}

function getDefaultTaxYear() {
  const today = new Date();
  const startYear = (today.getMonth() < 3 || (today.getMonth() === 3 && today.getDate() < 6))
    ? today.getFullYear() - 1
    : today.getFullYear();
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

function getTaxYearOptions(centerYear: string) {
  const startYear = parseInt(centerYear.split("/")[0], 10);
  return [startYear - 1, startYear, startYear + 1].map((y) => `${y}/${String(y + 1).slice(-2)}`);
}

export default async function P32Page({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string; fromMonth?: string; toMonth?: string; taxYear?: string }>;
}) {
  const { browseClient: browseClientId, fromMonth, toMonth, taxYear: taxYearParam } = await searchParams;
  const taxYear = taxYearParam || getDefaultTaxYear();
  const taxYearOptions = getTaxYearOptions(getDefaultTaxYear());
  const taxMonths = getTaxMonths(taxYear);
  const [{ data: clients }, { data: settings }, { data: runs }, { data: p32Records }] = await Promise.all([
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    browseClientId
      ? supabase.from("payroll_client_settings").select("*").eq("client_id", browseClientId).maybeSingle()
      : Promise.resolve({ data: null }),
    browseClientId
      ? supabase.from("payroll_runs").select("*").eq("client_id", browseClientId).order("payment_date", { ascending: true })
      : Promise.resolve({ data: [] }),
    browseClientId
      ? supabase.from("p32_records").select("*").eq("client_id", browseClientId)
      : Promise.resolve({ data: [] }),
  ]);

  const employmentAllowanceClaimed = settings?.employment_allowance_claimed || false;
  const smpRecoveryRate = settings?.smp_recovery_rate ?? 1.03;
  const toggleAllowanceWithId = toggleEmploymentAllowance.bind(null, browseClientId || "");
  const updateSmpWithId = updateSmpRecovery.bind(null, browseClientId || "");

  const p32ByMonth = new Map((p32Records || []).map((r: any) => [r.tax_month, r]));

  let allowanceRemaining = employmentAllowanceClaimed ? EMPLOYMENT_ALLOWANCE_CAP : 0;

  const monthlyData = taxMonths.map((month) => {
    const monthRuns = (runs || []).filter((r: any) => {
      const d = new Date(r.payment_date);
      return d >= month.start && d <= month.end;
    });

    const totalTax = monthRuns.reduce((sum: number, r: any) => sum + Number(r.tax_deducted), 0);
    const totalEmployeeNI = monthRuns.reduce((sum: number, r: any) => sum + Number(r.employee_ni), 0);
    const grossEmployerNI = monthRuns.reduce((sum: number, r: any) => sum + Number(r.employer_ni), 0);
    const totalStudentLoan = monthRuns.reduce((sum: number, r: any) => sum + Number(r.student_loan_deducted || 0) + Number(r.postgrad_loan_deducted || 0), 0);
    const totalSMP = monthRuns.reduce((sum: number, r: any) => sum + Number(r.smp || 0), 0);
    const smpRecovered = totalSMP * smpRecoveryRate;

    const allowanceUsedThisMonth = Math.min(allowanceRemaining, grossEmployerNI);
    allowanceRemaining -= allowanceUsedThisMonth;
    const netEmployerNI = grossEmployerNI - allowanceUsedThisMonth;

    const totalDue = totalTax + totalEmployeeNI + netEmployerNI + totalStudentLoan - smpRecovered;
    const record = p32ByMonth.get(month.key);

    return {
      ...month,
      employeeCount: new Set(monthRuns.map((r: any) => r.employee_id)).size,
      totalTax,
      totalEmployeeNI,
      grossEmployerNI,
      allowanceUsedThisMonth,
      netEmployerNI,
      totalStudentLoan,
      totalSMP,
      smpRecovered,
      totalDue,
      record,
    };
  });

  const yearTotalDue = monthlyData.reduce((sum, m) => sum + m.totalDue, 0);
  const yearTotalPaid = monthlyData.filter((m) => m.record?.paid).reduce((sum, m) => sum + m.totalDue, 0);
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Combined range view — select any from/to month to see one merged P32
  const fromIdx = fromMonth ? parseInt(fromMonth, 10) : null;
  const toIdx = toMonth ? parseInt(toMonth, 10) : null;
  const rangeSelected = fromIdx && toIdx && fromIdx <= toIdx;
  const rangeMonths = rangeSelected ? monthlyData.filter((m) => m.index >= fromIdx! && m.index <= toIdx!) : [];
  const rangeTotals = rangeMonths.reduce((acc, m) => ({
    tax: acc.tax + m.totalTax,
    employeeNI: acc.employeeNI + m.totalEmployeeNI,
    grossEmployerNI: acc.grossEmployerNI + m.grossEmployerNI,
    allowanceUsed: acc.allowanceUsed + m.allowanceUsedThisMonth,
    netEmployerNI: acc.netEmployerNI + m.netEmployerNI,
    studentLoan: acc.studentLoan + m.totalStudentLoan,
    smpPaid: acc.smpPaid + m.totalSMP,
    smpRecovered: acc.smpRecovered + m.smpRecovered,
    due: acc.due + m.totalDue,
  }), { tax: 0, employeeNI: 0, grossEmployerNI: 0, allowanceUsed: 0, netEmployerNI: 0, studentLoan: 0, smpPaid: 0, smpRecovered: 0, due: 0 });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
<a href={browseClientId ? `/payroll?browseClient=${browseClientId}` : "/payroll"} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Payroll
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">P32 — Employer Payment Record</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {browseClientId ? `Tax year ${taxYear}` : `Monthly total of PAYE tax, National Insurance, student loan deductions, and SMP recovery due to/from HMRC, ${taxYear}.`}
        </p>
      </div>

      <div className="p-8 space-y-6">
        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
          <p className="text-xs text-yellow-800">
            <strong>Working summary, not a submission.</strong> This totals figures already calculated in Payroll — it doesn't submit anything to HMRC. Confirm Employment Allowance eligibility and your Small Employers' Relief status (103% vs 92% SMP recovery) against current GOV.UK rules before relying on the figures shown here.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
          <form method="get" className="mt-4 flex gap-2">
            <select name="browseClient" defaultValue={browseClientId || ""}
              className="flex-1 max-w-md rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
              <option value="">Select a client</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.client_name}</option>
              ))}
            </select>
            <button type="submit"
              className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
              Show
            </button>
          </form>
        </div>

        {browseClientId && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Total Due, {taxYear}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(yearTotalDue)}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Marked Paid</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{fmt(yearTotalPaid)}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Outstanding</p>
                <p className="text-2xl font-bold text-orange-600 mt-1">{fmt(yearTotalDue - yearTotalPaid)}</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
              <form action={toggleAllowanceWithId} className="flex items-center gap-3">
                <input type="checkbox" id="ea" name="employment_allowance_claimed" defaultChecked={employmentAllowanceClaimed}
                  className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400" />
                <label htmlFor="ea" className="text-sm font-medium text-slate-700">
                  Employment Allowance claimed (up to £{EMPLOYMENT_ALLOWANCE_CAP.toLocaleString("en-GB")}/year against employer NI)
                </label>
                <button type="submit" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                  Save
                </button>
              </form>

              <form action={updateSmpWithId} className="flex items-center gap-4 border-t border-slate-100 pt-4">
                <span className="text-sm font-medium text-slate-700">SMP recovery rate:</span>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="smp_recovery_rate" value="1.03" defaultChecked={smpRecoveryRate === 1.03} className="w-4 h-4" />
                  103% (Small Employer's Relief)
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="smp_recovery_rate" value="0.92" defaultChecked={smpRecoveryRate === 0.92} className="w-4 h-4" />
                  92% (standard)
                </label>
                <button type="submit" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                  Save
                </button>
              </form>
            </div>

<div className="flex gap-2">
              {taxYearOptions.map((y) => (
                <a key={y} href={`/payroll/p32?browseClient=${browseClientId}&taxYear=${y}`}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    taxYear === y ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}>
                  {y}
                </a>
              ))}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Generate P32 for a Month or Range</h2>
              <form method="get" className="mt-4 flex gap-3 items-end">
                <input type="hidden" name="browseClient" value={browseClientId} />
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">From Month</label>
                  <select name="fromMonth" defaultValue={fromMonth || ""}
                    className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select</option>
                    {taxMonths.map((m) => <option key={m.index} value={m.index}>Month {m.index} — {m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">To Month</label>
                  <select name="toMonth" defaultValue={toMonth || ""}
                    className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select</option>
                    {taxMonths.map((m) => <option key={m.index} value={m.index}>Month {m.index} — {m.label}</option>)}
                  </select>
                </div>
                <button type="submit" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Generate
                </button>
              </form>

              {rangeSelected && (
                <div className="mt-6 rounded-2xl bg-slate-900 p-6 text-white">
                  <h3 className="text-lg font-bold">
                    P32 — {taxMonths[fromIdx! - 1]?.label}{fromIdx !== toIdx ? ` to ${taxMonths[toIdx! - 1]?.label}` : ""}
                  </h3>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-300">PAYE Tax</span><span className="font-mono">{fmt(rangeTotals.tax)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-300">Employee NI</span><span className="font-mono">{fmt(rangeTotals.employeeNI)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-300">Employer NI (gross)</span><span className="font-mono">{fmt(rangeTotals.grossEmployerNI)}</span></div>
                    {rangeTotals.allowanceUsed > 0 && (
                      <div className="flex justify-between text-green-400"><span>Less: Employment Allowance</span><span className="font-mono">−{fmt(rangeTotals.allowanceUsed)}</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-slate-300">Employer NI (net)</span><span className="font-mono">{fmt(rangeTotals.netEmployerNI)}</span></div>
                    {rangeTotals.studentLoan > 0 && (
                      <div className="flex justify-between"><span className="text-slate-300">Student Loan Deductions</span><span className="font-mono">{fmt(rangeTotals.studentLoan)}</span></div>
                    )}
                    {rangeTotals.smpPaid > 0 && (
                      <>
                        <div className="flex justify-between"><span className="text-slate-300">SMP Paid</span><span className="font-mono">{fmt(rangeTotals.smpPaid)}</span></div>
                        <div className="flex justify-between text-green-400"><span>Less: SMP Recovered ({(smpRecoveryRate * 100).toFixed(0)}%)</span><span className="font-mono">−{fmt(rangeTotals.smpRecovered)}</span></div>
                      </>
                    )}
                    <div className="border-t border-slate-700 pt-2 flex justify-between font-bold text-base">
                      <span>P32 Liability Due to HMRC</span>
                      <span className="font-mono">{fmt(rangeTotals.due)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {monthlyData.map((m) => (
                <div key={m.key} className={`rounded-2xl bg-white p-5 shadow-sm border ${m.record?.paid ? "border-green-100" : "border-slate-100"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-900">Month {m.index} — {m.label}</p>
                      <p className="text-xs text-slate-400">
                        {m.start.toLocaleDateString("en-GB")} to {m.end.toLocaleDateString("en-GB")} · {m.employeeCount} employee{m.employeeCount !== 1 ? "s" : ""} paid
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-slate-900">{fmt(m.totalDue)}</p>
                      {m.record?.paid && <p className="text-xs text-green-600 font-semibold">✓ Paid{m.record.paid_date ? ` ${new Date(m.record.paid_date).toLocaleDateString("en-GB")}` : ""}</p>}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs border-t border-slate-100 pt-3">
                    <div><p className="text-slate-400">PAYE Tax</p><p className="font-semibold text-slate-700">{fmt(m.totalTax)}</p></div>
                    <div><p className="text-slate-400">Employee NI</p><p className="font-semibold text-slate-700">{fmt(m.totalEmployeeNI)}</p></div>
                    <div>
                      <p className="text-slate-400">Employer NI</p>
                      <p className="font-semibold text-slate-700">
                        {fmt(m.netEmployerNI)}
                        {m.allowanceUsedThisMonth > 0 && (
                          <span className="text-green-600 font-normal"> (−{fmt(m.allowanceUsedThisMonth)} EA)</span>
                        )}
                      </p>
                    </div>
                    {m.totalStudentLoan > 0 && (
                      <div><p className="text-slate-400">Student Loan</p><p className="font-semibold text-slate-700">{fmt(m.totalStudentLoan)}</p></div>
                    )}
                    {m.totalSMP > 0 && (
                      <>
                        <div><p className="text-slate-400">SMP Paid</p><p className="font-semibold text-slate-700">{fmt(m.totalSMP)}</p></div>
                        <div><p className="text-slate-400">SMP Recovered</p><p className="font-semibold text-green-600">−{fmt(m.smpRecovered)}</p></div>
                      </>
                    )}
                    <div><p className="text-slate-400">Total Due</p><p className="font-bold text-slate-900">{fmt(m.totalDue)}</p></div>
                  </div>

                  <details className="mt-3">
                    <summary className="text-xs font-semibold text-blue-600 cursor-pointer hover:underline">
                      {m.record?.paid ? "Update payment record" : "Mark as paid"}
                    </summary>
                    <form action={markP32Paid.bind(null, browseClientId, m.key)} className="mt-3 flex flex-wrap gap-3 items-end">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" name="paid" defaultChecked={m.record?.paid || false} className="w-4 h-4 rounded" />
                        <span className="text-xs font-medium text-slate-700">Paid</span>
                      </label>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Date Paid</label>
                        <input name="paid_date" type="date" defaultValue={m.record?.paid_date || ""}
                          className="rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                        <input name="notes" defaultValue={m.record?.notes || ""}
                          className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400" />
                      </div>
                      <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                        Save
                      </button>
                    </form>
                  </details>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}