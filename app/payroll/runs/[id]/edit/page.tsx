import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updatePayRun(runId: string, clientId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const num = (key: string) => parseFloat(get(key)) || 0;

  const { error } = await supabase.from("payroll_runs").update({
    basic_pay: num("basic_pay"),
    bonus: num("bonus"),
    overtime: num("overtime"),
    holiday_pay: num("holiday_pay"),
    sick_pay: num("sick_pay"),
    smp: num("smp"),
    smp_weeks_this_period: num("smp_weeks_this_period"),
    spp: num("spp"),
    spp_weeks_this_period: num("spp_weeks_this_period"),
    payrolled_benefits: num("payrolled_benefits"),
    benefits_class1a_nic: num("benefits_class1a_nic"),
    expenses: num("expenses"),
    other_deductions: num("other_deductions"),
    other_deductions_description: get("other_deductions_description") || null,
    tax_deducted: num("tax_deducted"),
    employee_ni: num("employee_ni"),
    employer_ni: num("employer_ni"),
    student_loan_deducted: num("student_loan_deducted"),
    postgrad_loan_deducted: num("postgrad_loan_deducted"),
    employee_pension: num("employee_pension"),
    employer_pension: num("employer_pension"),
    net_pay: num("net_pay"),
    notes: get("notes") || null,
  }).eq("id", runId);

  if (error) {
    throw new Error(`Failed to update pay run: ${error.message}`);
  }

  revalidatePath(`/payroll/runs?browseClient=${clientId}`);
  redirect(`/payroll/runs?browseClient=${clientId}`);
}

async function deletePayRun(runId: string, clientId: string) {
  "use server";
  await supabase.from("payroll_runs").delete().eq("id", runId);
  revalidatePath(`/payroll/runs?browseClient=${clientId}`);
  redirect(`/payroll/runs?browseClient=${clientId}`);
}

export default async function EditPayRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: run, error } = await supabase
    .from("payroll_runs")
    .select("*, payroll_employees(name)")
    .eq("id", id)
    .single();

  if (error || !run) notFound();

  const employeeName = (run.payroll_employees as any)?.name || "Unknown employee";
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const updateWithId = updatePayRun.bind(null, id, run.client_id);
  const deleteWithId = deletePayRun.bind(null, id, run.client_id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/payroll/runs?browseClient=${run.client_id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Pay Run History
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Edit Pay Run</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {employeeName} · {fmtDate(run.pay_period_start)} to {fmtDate(run.pay_period_end)}
        </p>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4">
            Figures here are corrected directly, not recalculated automatically — check that any change you make to one figure (e.g. Basic Pay) is also reflected in the figures that depend on it (Tax, NI, Net Pay), since they won't update on their own.
          </p>

          <form action={updateWithId} className="space-y-6">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Taxable Pay</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Basic Pay (£)</label>
                  <input name="basic_pay" type="number" step="0.01" defaultValue={Number(run.basic_pay).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bonus (£)</label>
                  <input name="bonus" type="number" step="0.01" defaultValue={Number(run.bonus).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Overtime (£)</label>
                  <input name="overtime" type="number" step="0.01" defaultValue={Number(run.overtime).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Holiday Pay (£)</label>
                  <input name="holiday_pay" type="number" step="0.01" defaultValue={Number(run.holiday_pay).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Sick Pay (£)</label>
                  <input name="sick_pay" type="number" step="0.01" defaultValue={Number(run.sick_pay).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Statutory Pay</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SMP (£)</label>
                  <input name="smp" type="number" step="0.01" defaultValue={Number(run.smp || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SMP Weeks This Period</label>
                  <input name="smp_weeks_this_period" type="number" step="0.5" defaultValue={run.smp_weeks_this_period || 0} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SPP (£)</label>
                  <input name="spp" type="number" step="0.01" defaultValue={Number(run.spp || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SPP Weeks This Period</label>
                  <input name="spp_weeks_this_period" type="number" step="0.5" defaultValue={run.spp_weeks_this_period || 0} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Payrolled Benefits</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Payrolled Benefits (£)</label>
                  <input name="payrolled_benefits" type="number" step="0.01" defaultValue={Number(run.payrolled_benefits || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Class 1A NIC on Benefits (£)</label>
                  <input name="benefits_class1a_nic" type="number" step="0.01" defaultValue={Number(run.benefits_class1a_nic || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Deductions</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tax Deducted (£)</label>
                  <input name="tax_deducted" type="number" step="0.01" defaultValue={Number(run.tax_deducted || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Employee NI (£)</label>
                  <input name="employee_ni" type="number" step="0.01" defaultValue={Number(run.employee_ni || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Employer NI (£)</label>
                  <input name="employer_ni" type="number" step="0.01" defaultValue={Number(run.employer_ni || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Student Loan (£)</label>
                  <input name="student_loan_deducted" type="number" step="0.01" defaultValue={Number(run.student_loan_deducted || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Postgrad Loan (£)</label>
                  <input name="postgrad_loan_deducted" type="number" step="0.01" defaultValue={Number(run.postgrad_loan_deducted || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Employee Pension (£)</label>
                  <input name="employee_pension" type="number" step="0.01" defaultValue={Number(run.employee_pension || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Employer Pension (£)</label>
                  <input name="employer_pension" type="number" step="0.01" defaultValue={Number(run.employer_pension || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Non-Taxable Items</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Expenses Reimbursed (£)</label>
                  <input name="expenses" type="number" step="0.01" defaultValue={Number(run.expenses || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Other Deduction (£)</label>
                  <input name="other_deductions" type="number" step="0.01" defaultValue={Number(run.other_deductions || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">Deduction Description</label>
                <input name="other_deductions_description" defaultValue={run.other_deductions_description || ""} placeholder="Only needed if there's a deduction above" className="w-full rounded-xl border border-slate-200 p-2.5 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Net Pay (£)</label>
              <input name="net_pay" type="number" step="0.01" defaultValue={Number(run.net_pay || 0).toFixed(2)} className="w-full rounded-xl border border-slate-200 p-3 text-sm font-bold" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea name="notes" defaultValue={run.notes || ""} rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm" />
            </div>

            <button type="submit" className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Save Changes
            </button>
          </form>

          <form action={deleteWithId} className="mt-3">
            <button type="submit" className="w-full rounded-xl bg-red-50 px-6 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 transition-colors">
              Delete This Pay Run
            </button>
          </form>
        </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl bg-slate-900 p-6 shadow-sm text-white">
            <h2 className="text-lg font-bold">This Pay Run</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-300">Gross Pay</span><span>{fmt(Number(run.gross_pay || 0) + Number(run.smp || 0) + Number(run.spp || 0))}</span></div>
              <div className="flex justify-between"><span className="text-slate-300">PAYE Tax</span><span>{fmt(Number(run.tax_deducted || 0))}</span></div>
              <div className="flex justify-between"><span className="text-slate-300">Employee NI</span><span>{fmt(Number(run.employee_ni || 0))}</span></div>
              <div className="flex justify-between"><span className="text-slate-300">Employer NI</span><span>{fmt(Number(run.employer_ni || 0))}</span></div>
              <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between font-bold text-base">
                <span>Net Pay</span>
                <span>{fmt(Number(run.net_pay || 0))}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
            <p className="text-xs text-yellow-800">
              Figures here are corrected directly, not recalculated automatically — check that any change to one figure is also reflected in whatever depends on it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}