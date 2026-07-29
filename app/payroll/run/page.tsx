import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPayRun, deletePayRun, updatePayRun } from "../page";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function startBatch(clientId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  const { data: batch } = await supabase.from("payroll_batches").insert({
    client_id: clientId,
    period_start: get("period_start"),
    period_end: get("period_end"),
    payment_date: get("payment_date"),
    status: "draft",
  }).select().single();

  redirect(`/payroll/run?browseClient=${clientId}&batchId=${batch?.id}`);
}

async function addToRunAndAdvance(employeeId: string, clientId: string, batchId: string, formData: FormData) {
  "use server";
  await createPayRun(employeeId, clientId, batchId, formData);
  redirect(`/payroll/run?browseClient=${clientId}&batchId=${batchId}`);
}

async function finalizeBatch(batchId: string, clientId: string) {
  "use server";
  await supabase.from("payroll_batches").update({ status: "finalized", finalized_at: new Date().toISOString() }).eq("id", batchId);
  revalidatePath("/payroll/run");
  revalidatePath("/payroll/runs");
  redirect(`/payroll/runs?browseClient=${clientId}`);
}

async function saveEditAndAdvance(runId: string, employeeId: string, clientId: string, batchIdVal: string, nextRunId: string | null, formData: FormData) {
  "use server";
  await updatePayRun(runId, employeeId, formData);
  if (nextRunId) {
    redirect(`/payroll/run?browseClient=${clientId}&batchId=${batchIdVal}&editRun=${nextRunId}`);
  } else {
    redirect(`/payroll/runs?browseClient=${clientId}`);
  }
}

async function deleteBatch(batchId: string) {
"use server";
  await supabase.from("payroll_batches").delete().eq("id", batchId);
  revalidatePath("/payroll/run");
}

export default async function NewPayRunPage({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string; batchId?: string; editRun?: string }>;
}) {
  const { browseClient: browseClientId, batchId, editRun: editRunId } = await searchParams;
  if (!browseClientId) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 max-w-lg mx-auto text-center">
          <p className="text-sm text-slate-500">No client selected.</p>
          <a href="/payroll" className="text-sm font-semibold text-blue-600 hover:underline mt-2 inline-block">← Back to Payroll</a>
        </div>
      </div>
    );
  }

  const [{ data: client }, { data: draftBatch }] = await Promise.all([
    supabase.from("clients").select("id, client_name").eq("id", browseClientId).single(),
    !batchId
      ? supabase.from("payroll_batches").select("*").eq("client_id", browseClientId).eq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const activeBatchId = batchId || draftBatch?.id;

  const { data: batch } = activeBatchId
    ? await supabase.from("payroll_batches").select("*").eq("id", activeBatchId).single()
    : { data: null };

  const { data: activeEmployees } = await supabase
    .from("payroll_employees")
    .select("*")
    .eq("client_id", browseClientId)
    .eq("is_active", true)
    .order("name", { ascending: true });

const { data: batchRuns } = activeBatchId
    ? await supabase.from("payroll_runs").select("*, payroll_employees(*)").eq("batch_id", activeBatchId).order("created_at", { ascending: true })
    : { data: [] };

  const editingRun = editRunId ? (batchRuns || []).find((r: any) => r.id === editRunId) : null;
  const editingIndex = editingRun ? (batchRuns || []).findIndex((r: any) => r.id === editRunId) : -1;
  const nextRunToEdit = editingIndex >= 0 && editingIndex < (batchRuns || []).length - 1 ? batchRuns![editingIndex + 1] : null;
  const paidEmployeeIds = new Set((batchRuns || []).map((r: any) => r.employee_id));
  const nextEmployee = (activeEmployees || []).find((e: any) => !paidEmployeeIds.has(e.id));
  const remainingCount = (activeEmployees || []).filter((e: any) => !paidEmployeeIds.has(e.id)).length;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totals = (batchRuns || []).reduce((acc: any, r: any) => ({
    gross: acc.gross + Number(r.gross_pay),
    tax: acc.tax + Number(r.tax_deducted),
    employeeNI: acc.employeeNI + Number(r.employee_ni),
    employerNI: acc.employerNI + Number(r.employer_ni),
    net: acc.net + Number(r.net_pay),
  }), { gross: 0, tax: 0, employeeNI: 0, employerNI: 0, net: 0 });

  const startBatchWithClient = startBatch.bind(null, browseClientId);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/payroll?browseClient=${browseClientId}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Payroll
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">New Pay Run</h1>
        <p className="text-sm text-slate-500 mt-0.5">{client?.client_name}</p>
      </div>

      <div className="p-8">
        {!batch ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 max-w-2xl">
            <h2 className="text-lg font-bold text-slate-900">Set Pay Period</h2>
            <p className="text-sm text-slate-500 mt-0.5">These dates apply to everyone paid in this run.</p>
            <form action={startBatchWithClient} className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
                <input name="period_start" type="date" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
                <input name="period_end" type="date" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payment Date *</label>
                <input name="payment_date" type="date" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div className="md:col-span-3">
                <button type="submit" className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Start Pay Run
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">

              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Pay Period</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {new Date(batch.period_start).toLocaleDateString("en-GB")} to {new Date(batch.period_end).toLocaleDateString("en-GB")} · Paid {new Date(batch.payment_date).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <form action={deleteBatch.bind(null, batch.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Cancel Pay Run
                    </button>
                  </form>
                </div>
              </div>

{editingRun ? (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900">Reviewing: {editingRun.payroll_employees?.name}</h2>
                    <span className="text-xs text-slate-400">{editingIndex + 1} of {(batchRuns || []).length}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {editingRun.tax_code_used} · NI Category {editingRun.ni_category_used}
                  </p>

                  <form action={saveEditAndAdvance.bind(null, editingRun.id, editingRun.employee_id, browseClientId, batch.id, nextRunToEdit?.id || null)} className="mt-6 space-y-5">
                    <div>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">Taxable Pay</p>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Basic Pay (£)</label>
                          <input name="basic_pay" type="number" step="0.01" min="0" defaultValue={editingRun.basic_pay || editingRun.gross_pay} required
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Bonus (£)</label>
                          <input name="bonus" type="number" step="0.01" min="0" defaultValue={editingRun.bonus || 0}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Overtime (£)</label>
                          <input name="overtime" type="number" step="0.01" min="0" defaultValue={editingRun.overtime || 0}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Pay (£)</label>
                          <input name="holiday_pay" type="number" step="0.01" min="0" defaultValue={editingRun.holiday_pay || 0}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Sick Pay (£)</label>
                          <input name="sick_pay" type="number" step="0.01" min="0" defaultValue={editingRun.sick_pay || 0}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">Non-Taxable Items</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Expenses Reimbursed (£)</label>
                          <input name="expenses" type="number" step="0.01" min="0" defaultValue={editingRun.expenses || 0}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Other Deduction (£)</label>
                          <input name="other_deductions" type="number" step="0.01" min="0" defaultValue={editingRun.other_deductions || 0}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-slate-700 mb-1">Deduction Description</label>
                          <input name="other_deductions_description" defaultValue={editingRun.other_deductions_description || ""}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                      <input name="notes" defaultValue={editingRun.notes || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>

                    <div className="flex gap-3">
                      <button type="submit" className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                        Save & {nextRunToEdit ? `Next: ${nextRunToEdit.payroll_employees?.name} →` : "Finish Review"}
                      </button>
                      <a href={`/payroll/runs?browseClient=${browseClientId}`}
                        className="rounded-xl bg-white border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                        Exit Review
                      </a>
                    </div>
                  </form>
                </div>
              ) : nextEmployee ? (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900">{nextEmployee.name}</h2>
                    <span className="text-xs text-slate-400">{remainingCount} of {(activeEmployees || []).length} remaining</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {nextEmployee.tax_code} · NI Category {nextEmployee.ni_category} · {nextEmployee.pay_frequency}
                  </p>

                  <form action={addToRunAndAdvance.bind(null, nextEmployee.id, browseClientId, batch.id)} className="mt-6 space-y-5">
                    <input type="hidden" name="pay_period_start" value={batch.period_start} />
                    <input type="hidden" name="pay_period_end" value={batch.period_end} />
                    <input type="hidden" name="payment_date" value={batch.payment_date} />

                    <div>
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">Taxable Pay</p>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Basic Pay (£)</label>
                          <input name="basic_pay" type="number" step="0.01" min="0" defaultValue="0" required
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Bonus (£)</label>
                          <input name="bonus" type="number" step="0.01" min="0" defaultValue="0"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Overtime (£)</label>
                          <input name="overtime" type="number" step="0.01" min="0" defaultValue="0"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Pay (£)</label>
                          <input name="holiday_pay" type="number" step="0.01" min="0" defaultValue="0"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
<div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Sick Pay (£)</label>
                          <input name="sick_pay" type="number" step="0.01" min="0" defaultValue="0"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
<div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">SMP Weeks This Period</label>
                          <input name="smp_weeks_this_period" type="number" step="0.5" min="0" defaultValue="0"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            placeholder="0 unless on maternity leave" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Payrolled Benefits This Period (£)</label>
                          <input name="payrolled_benefits" type="number" step="0.01" min="0" defaultValue={nextEmployee.annual_payrolled_benefits ? (Number(nextEmployee.annual_payrolled_benefits) / (nextEmployee.pay_frequency === "Weekly" ? 52 : 12)).toFixed(2) : "0"}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            placeholder="From 2027: taxed here instead of P11D" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">These are all combined and taxed together — this is what PAYE, NI, and pension are calculated on. SMP is calculated automatically from the employee's Average Weekly Earnings and weeks already paid.</p>
                    </div>
                    <div className="border-t border-slate-100 pt-4">
                      <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">Non-Taxable Items</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Expenses Reimbursed (£)</label>
                          <input name="expenses" type="number" step="0.01" min="0" defaultValue="0"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            placeholder="e.g. mileage, receipts" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Other Deduction (£)</label>
                          <input name="other_deductions" type="number" step="0.01" min="0" defaultValue="0"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            placeholder="e.g. court order, advance repayment" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-slate-700 mb-1">Deduction Description</label>
                          <input name="other_deductions_description"
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            placeholder="Only needed if there's a deduction above" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">Expenses and other deductions apply directly to net pay — they're not taxed and don't affect NI or pension.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                      <input name="notes" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                    </div>

                    <button type="submit" className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                      Save & {remainingCount > 1 ? "Next Employee →" : "Finish"}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="rounded-2xl bg-green-50 border border-green-100 p-6 text-center">
                  <p className="font-bold text-green-800">All active employees have been added to this pay run.</p>
                  <p className="text-sm text-green-700 mt-1">Review the totals on the right, then finalize when ready.</p>
                </div>
              )}

              {(batchRuns || []).length > 0 && (
                <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                  <h2 className="text-lg font-bold text-slate-900">Completed So Far ({(batchRuns || []).length})</h2>
                  <div className="mt-4 space-y-2">
                    {(batchRuns || []).map((run: any) => (
                      <div key={run.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                        <div>
                          <p className="font-semibold text-slate-900 text-sm">{run.payroll_employees?.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Gross {fmt(Number(run.gross_pay))} · Tax {fmt(Number(run.tax_deducted))} · NI {fmt(Number(run.employee_ni))} · Net {fmt(Number(run.net_pay))}
                          </p>
                        </div>
                        <form action={deletePayRun.bind(null, run.id)}>
                          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            Remove
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-2xl bg-slate-900 p-6 shadow-sm text-white sticky top-6">
                <h2 className="text-lg font-bold">Pay Run Totals</h2>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-300">Gross Pay</span><span>{fmt(totals.gross)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-300">PAYE Tax</span><span>{fmt(totals.tax)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-300">Employee NI</span><span>{fmt(totals.employeeNI)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-300">Employer NI</span><span>{fmt(totals.employerNI)}</span></div>
                  <div className="border-t border-slate-700 pt-2 flex justify-between font-bold text-base">
                    <span>Total Net Pay</span>
                    <span>{fmt(totals.net)}</span>
                  </div>
                </div>

                {(batchRuns || []).length > 0 && (
                  <form action={finalizeBatch.bind(null, batch.id, browseClientId)} className="mt-6">
                    <button type="submit" className="w-full rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 hover:bg-slate-100 transition-colors">
                      Finalize Pay Run
                    </button>
                  </form>
                )}
              </div>

              <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
                <p className="text-xs text-yellow-800">
                  Finalizing marks this pay run as complete. Payslips can be viewed and emailed from "View Pay Runs" once finalized.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}