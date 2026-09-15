import { createClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import { createPayRun } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Wraps the existing, already-working createPayRun rather than duplicating
// its calculation logic. If this employee already has an entry for this
// period (because we're reviewing/amending, not entering fresh), that row
// is removed first so createPayRun's insert recalculates everything
// cleanly from the resubmitted figures — never leaves a stale duplicate.
// Then explicitly advances to the next employee in the review sequence,
// or back to Pay Run History once the last one is done.
async function reviewPayRunStep(
  employeeId: string, clientId: string, batchId: string | null,
  periodStart: string, periodEnd: string,
  nextUrl: string,
  formData: FormData
) {
  "use server";

  await supabase.from("payroll_runs")
    .delete()
    .eq("employee_id", employeeId)
    .eq("pay_period_start", periodStart)
    .eq("pay_period_end", periodEnd);

  await createPayRun(employeeId, clientId, batchId, formData);

  redirect(nextUrl);
}

// Changes the pay period for the whole batch at once — updating the batch
// record itself and every employee's already-saved run within it, so the
// period never drifts out of sync between employees partway through review.
async function updateBatchPeriod(batchId: string, clientId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const newStart = get("edit_period_start");
  const newEnd = get("edit_period_end");
  const newPaymentDate = get("edit_payment_date");

  if (!newStart || !newEnd || !newPaymentDate) return;

  await supabase.from("payroll_batches").update({
    period_start: newStart,
    period_end: newEnd,
    payment_date: newPaymentDate,
  }).eq("id", batchId);

  await supabase.from("payroll_runs").update({
    pay_period_start: newStart,
    pay_period_end: newEnd,
    payment_date: newPaymentDate,
  }).eq("batch_id", batchId);

  redirect(`/payroll/run?browseClient=${clientId}&period_start=${newStart}&period_end=${newEnd}&payment_date=${newPaymentDate}`);
}

export default async function PayRunPage({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string; period_start?: string; period_end?: string; payment_date?: string; employee_index?: string }>;
}) {
  const { browseClient: clientId, period_start, period_end, payment_date, employee_index } = await searchParams;
  if (!clientId) notFound();

  const { data: client } = await supabase.from("clients").select("client_name").eq("id", clientId).single();
  const { data: employees } = await supabase.from("payroll_employees").select("*").eq("client_id", clientId).eq("is_active", true).order("name", { ascending: true });

  const periodStart = period_start || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const periodEnd = period_end || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split("T")[0];
  const paymentDate = payment_date || periodEnd;

  let { data: batch } = await supabase
    .from("payroll_batches")
    .select("*")
    .eq("client_id", clientId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!batch) {
    const { data: newBatch } = await supabase
      .from("payroll_batches")
      .insert({
        client_id: clientId,
        period_start: periodStart,
        period_end: periodEnd,
        payment_date: paymentDate,
        status: "draft",
      })
      .select()
      .single();
    batch = newBatch;
  }

  const { data: existingRuns } = await supabase
    .from("payroll_runs")
    .select("*")
    .in("employee_id", (employees || []).map((e) => e.id))
    .eq("pay_period_start", periodStart)
    .eq("pay_period_end", periodEnd);

  const runsByEmployee = new Map((existingRuns || []).map((r) => [r.employee_id, r]));

  // Every active employee, in a fixed order — this is the full review
  // sequence, not just whoever hasn't been entered yet.
  const orderedEmployees = employees || [];
  const currentIndex = Math.min(Math.max(0, parseInt(employee_index || "0", 10) || 0), orderedEmployees.length);
  const currentEmployee = orderedEmployees[currentIndex];
  const existingRun = currentEmployee ? runsByEmployee.get(currentEmployee.id) : null;
  const isLastEmployee = currentIndex === orderedEmployees.length - 1;

  const baseUrl = `/payroll/run?browseClient=${clientId}&period_start=${periodStart}&period_end=${periodEnd}&payment_date=${paymentDate}`;
  const nextUrl = isLastEmployee ? `/payroll/runs?browseClient=${clientId}` : `${baseUrl}&employee_index=${currentIndex + 1}`;

  const fmt = (n: number) => `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const val = (field: string, fallback = "0") => existingRun ? String(existingRun[field] ?? fallback) : fallback;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/payroll?browseClient=${clientId}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">← Back to Payroll</a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Pay Run</h1>
        <p className="text-sm text-slate-500 mt-0.5">{client?.client_name}</p>
      </div>

      <div className="p-8 max-w-3xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Pay Period</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {new Date(periodStart).toLocaleDateString("en-GB")} to {new Date(periodEnd).toLocaleDateString("en-GB")} · Paid {new Date(paymentDate).toLocaleDateString("en-GB")}
              </p>
            </div>
          </div>
          <details className="mt-3">
            <summary className="text-xs font-semibold text-blue-600 cursor-pointer">Edit period dates</summary>
            <form action={updateBatchPeriod.bind(null, batch?.id || "", clientId)} className="mt-3 grid gap-3 md:grid-cols-4 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Period Start</label>
                <input name="edit_period_start" type="date" defaultValue={periodStart} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Period End</label>
                <input name="edit_period_end" type="date" defaultValue={periodEnd} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Payment Date</label>
                <input name="edit_payment_date" type="date" defaultValue={paymentDate} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
              </div>
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Update Period
              </button>
            </form>
            <p className="text-xs text-slate-400 mt-2">Updates this batch and every employee already saved within it, so the period stays consistent throughout.</p>
          </details>
        </div>

        {currentEmployee ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{currentEmployee.name}</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {currentEmployee.tax_code} · NI Category {currentEmployee.ni_category} · {currentEmployee.pay_frequency}
                  {currentEmployee.pay_type === "Hourly" && ` · Hourly (£${Number(currentEmployee.hourly_rate).toFixed(2)}/hr)`}
                  {existingRun && " · Already entered — reviewing"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {currentIndex > 0 && (
                  <a href={`${baseUrl}&employee_index=${currentIndex - 1}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">← Previous</a>
                )}
                <p className="text-sm text-slate-400">Employee {currentIndex + 1} of {orderedEmployees.length}</p>
              </div>
            </div>

            <form action={reviewPayRunStep.bind(null, currentEmployee.id, clientId, batch?.id || null, periodStart, periodEnd, nextUrl)} className="mt-6 space-y-6">
              <input type="hidden" name="pay_period_start" value={periodStart} />
              <input type="hidden" name="pay_period_end" value={periodEnd} />
              <input type="hidden" name="payment_date" value={paymentDate} />
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Taxable Pay</p>
                <div className="grid gap-4 md:grid-cols-3">
                  {currentEmployee.pay_type === "Hourly" ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Hours Worked</label>
                        <input name="hours_worked" type="number" step="0.25" min="0" defaultValue={val("hours_worked")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                        <p className="text-xs text-slate-400 mt-1">At £{Number(currentEmployee.hourly_rate).toFixed(2)}/hour</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Overtime Hours</label>
                        <input name="overtime_hours" type="number" step="0.25" min="0" defaultValue={val("overtime_hours")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                        <p className="text-xs text-slate-400 mt-1">At £{Number(currentEmployee.overtime_rate).toFixed(2)}/hour</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Basic Pay (£)</label>
                        <input name="basic_pay" type="number" step="0.01" defaultValue={val("basic_pay")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Overtime (£)</label>
                        <input name="overtime" type="number" step="0.01" defaultValue={val("overtime")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Bonus (£)</label>
                    <input name="bonus" type="number" step="0.01" defaultValue={val("bonus")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Pay (£)</label>
                    <input name="holiday_pay" type="number" step="0.01" defaultValue={val("holiday_pay")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Sick Pay (£)</label>
                    <input name="sick_pay" type="number" step="0.01" defaultValue={val("sick_pay")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">SMP Weeks This Period</label>
                    <input name="smp_weeks_this_period" type="number" step="0.5" min="0" defaultValue={val("smp_weeks_this_period")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">SPP Weeks This Period</label>
                    <input name="spp_weeks_this_period" type="number" step="0.5" min="0" defaultValue={val("spp_weeks_this_period")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                    <p className="text-xs text-slate-400 mt-1">{Math.max(0, 2 - (currentEmployee.spp_weeks_paid || 0))} weeks remaining of 2-week allowance.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Payrolled Benefits (£)</label>
                    <input name="payrolled_benefits" type="number" step="0.01" defaultValue={val("payrolled_benefits")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Non-Taxable Items</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Expenses Reimbursed (£)</label>
                    <input name="expenses" type="number" step="0.01" defaultValue={val("expenses")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Other Deduction (£)</label>
                    <input name="other_deductions" type="number" step="0.01" defaultValue={val("other_deductions")} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
                  </div>
                </div>
              </div>

              <button type="submit" className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                {isLastEmployee ? "Save & Finish" : "Save & Next →"}
              </button>
            </form>
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 text-center py-12">
            <p className="text-slate-500 text-sm">No employees found for this client.</p>
          </div>
        )}
      </div>
    </div>
  );
}