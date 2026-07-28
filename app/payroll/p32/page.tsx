import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMPLOYMENT_ALLOWANCE_CAP = 10500;

// UK tax months run 6th-of-month to 5th-of-next-month, starting April.
// Date.UTC handles the year rollover automatically for months 10-12.
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

export default async function P32Page({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string }>;
}) {
  const { browseClient: browseClientId } = await searchParams;
  const taxYear = "2026/27";
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
  const toggleAllowanceWithId = toggleEmploymentAllowance.bind(null, browseClientId || "");

  const p32ByMonth = new Map((p32Records || []).map((r: any) => [r.tax_month, r]));

  // Process months in chronological order so the Employment Allowance cap
  // depletes correctly across the year, not per-month independently.
  let allowanceRemaining = employmentAllowanceClaimed ? EMPLOYMENT_ALLOWANCE_CAP : 0;

  const monthlyData = taxMonths.map((month) => {
    const monthRuns = (runs || []).filter((r: any) => {
      const d = new Date(r.payment_date);
      return d >= month.start && d <= month.end;
    });

    const totalTax = monthRuns.reduce((sum: number, r: any) => sum + Number(r.tax_deducted), 0);
    const totalEmployeeNI = monthRuns.reduce((sum: number, r: any) => sum + Number(r.employee_ni), 0);
    const grossEmployerNI = monthRuns.reduce((sum: number, r: any) => sum + Number(r.employer_ni), 0);

    const allowanceUsedThisMonth = Math.min(allowanceRemaining, grossEmployerNI);
    allowanceRemaining -= allowanceUsedThisMonth;
    const netEmployerNI = grossEmployerNI - allowanceUsedThisMonth;

    const totalDue = totalTax + totalEmployeeNI + netEmployerNI;
    const record = p32ByMonth.get(month.key);

    return {
      ...month,
      employeeCount: new Set(monthRuns.map((r: any) => r.employee_id)).size,
      totalTax,
      totalEmployeeNI,
      grossEmployerNI,
      allowanceUsedThisMonth,
      netEmployerNI,
      totalDue,
      record,
    };
  });

  const yearTotalDue = monthlyData.reduce((sum, m) => sum + m.totalDue, 0);
  const yearTotalPaid = monthlyData.filter((m) => m.record?.paid).reduce((sum, m) => sum + m.totalDue, 0);
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/payroll" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Payroll
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">P32 — Employer Payment Record</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Monthly total of PAYE tax and National Insurance due to HMRC across all employees, {taxYear}.
        </p>
      </div>

      <div className="p-8 space-y-6">

        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
          <p className="text-xs text-yellow-800">
            <strong>Working summary, not a submission.</strong> This totals figures already calculated in Payroll — it doesn't submit anything to HMRC. Statutory pay recovery (SMP, SPP, etc.) isn't tracked and would need adding manually if applicable. Confirm Employment Allowance eligibility against current GOV.UK rules before relying on the reduction shown here.
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

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
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