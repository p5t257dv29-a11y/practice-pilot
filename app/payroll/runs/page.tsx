import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import EmailPayslipButton from "../../email-payslip-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function deletePayRunLine(id: string) {
  "use server";
  await supabase.from("payroll_runs").delete().eq("id", id);
  revalidatePath("/payroll/runs");
}

import { taxYearDateRange } from "../page";

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

export default async function PayRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string; editRun?: string; taxYear?: string }>;
}) {
  const { browseClient: browseClientId, editRun: editRunId, taxYear: taxYearParam } = await searchParams;
  const taxYear = taxYearParam || getDefaultTaxYear();
  const taxYearOptions = getTaxYearOptions(getDefaultTaxYear());
  const { start: taxYearStart, end: taxYearEnd } = taxYearDateRange(taxYear);
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

const [{ data: client }, { data: batches }] = await Promise.all([
    supabase.from("clients").select("id, client_name").eq("id", browseClientId).single(),
    supabase.from("payroll_batches").select("*").eq("client_id", browseClientId)
      .gte("payment_date", taxYearStart).lte("payment_date", taxYearEnd)
      .order("payment_date", { ascending: false }),
  ]);

  const { data: allRuns } = await supabase
    .from("payroll_runs")
    .select("*, payroll_employees(name, email)")
    .eq("client_id", browseClientId)
    .gte("payment_date", taxYearStart).lte("payment_date", taxYearEnd)
    .order("payment_date", { ascending: false });
  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const runsByBatch = new Map<string, any[]>();
  const unbatchedRuns: any[] = [];
  (allRuns || []).forEach((run: any) => {
    if (run.batch_id) {
      if (!runsByBatch.has(run.batch_id)) runsByBatch.set(run.batch_id, []);
      runsByBatch.get(run.batch_id)!.push(run);
    } else {
      unbatchedRuns.push(run);
    }
  });

  const draftBatches = (batches || []).filter((b) => b.status === "draft");
  const finalizedBatches = (batches || []).filter((b) => b.status === "finalized");

  const BatchCard = ({ batch, isDraft }: { batch: any; isDraft: boolean }) => {
    const runs = runsByBatch.get(batch.id) || [];
    const totals = runs.reduce((acc, r) => ({
      gross: acc.gross + Number(r.gross_pay),
      net: acc.net + Number(r.net_pay),
    }), { gross: 0, net: 0 });

    return (
      <div className={`rounded-2xl bg-white p-6 shadow-sm border ${isDraft ? "border-amber-200" : "border-slate-100"}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-slate-900">
                {new Date(batch.period_start).toLocaleDateString("en-GB")} – {new Date(batch.period_end).toLocaleDateString("en-GB")}
              </p>
              {isDraft && (
                <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-semibold">Draft</span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Paid {new Date(batch.payment_date).toLocaleDateString("en-GB")} · {runs.length} employee{runs.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold text-slate-900">{fmt(totals.net)}</p>
            <p className="text-xs text-slate-400">total net (gross {fmt(totals.gross)})</p>
          </div>
        </div>

{isDraft ? (
          <a href={`/payroll/run?browseClient=${browseClientId}&batchId=${batch.id}`}
            className="inline-block mt-3 text-xs font-semibold text-blue-600 hover:underline">
            Continue building this pay run →
          </a>
        ) : runs.length > 0 ? (
          <a href={`/payroll/run?browseClient=${browseClientId}&batchId=${batch.id}&editRun=${runs[0].id}`}
            className="inline-block mt-3 text-xs font-semibold text-blue-600 hover:underline">
            Review & Correct this pay run →
          </a>
        ) : null}{!isDraft && runs.filter((r: any) => r.payroll_employees?.email).length > 0 && (
          <details className="mt-3">
            <summary className="text-xs font-semibold text-blue-600 cursor-pointer hover:underline">
              Email All Payslips ({runs.filter((r: any) => r.payroll_employees?.email).length})
            </summary>
            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
              <p className="text-xs text-slate-500">
                Click each button in turn — every email opens in your mail app ready to send, one at a time.
              </p>
              {runs.filter((r: any) => r.payroll_employees?.email).map((run: any) => (
                <div key={run.id} className="flex items-center justify-between bg-white rounded-lg border border-slate-100 px-3 py-2">
                  <span className="text-sm text-slate-700">{run.payroll_employees.name}</span>
                  <EmailPayslipButton
                    email={run.payroll_employees.email}
                    employeeName={run.payroll_employees.name}
                    token={run.token}
                    paymentDate={run.payment_date}
                    periodStart={run.pay_period_start}
                    periodEnd={run.pay_period_end}
                  />
                </div>
              ))}
              {runs.some((r: any) => !r.payroll_employees?.email) && (
                <p className="text-xs text-amber-600 mt-2">
                  {runs.filter((r: any) => !r.payroll_employees?.email).length} employee(s) have no email on file and are excluded — add one via their Edit button on the main Payroll page.
                </p>
              )}
            </div>
          </details>
        )}
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          {runs.map((run: any) => (
            <div key={run.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{run.payroll_employees?.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Gross {fmt(Number(run.gross_pay))} · Net {fmt(Number(run.net_pay))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a href={`/payslip/${run.token}`} target="_blank" rel="noopener noreferrer"
                  className="rounded-lg bg-white border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                  Payslip →
                </a>
                {run.payroll_employees?.email && (
                  <EmailPayslipButton
                    email={run.payroll_employees.email}
                    employeeName={run.payroll_employees.name}
                    token={run.token}
                    paymentDate={run.payment_date}
                    periodStart={run.pay_period_start}
                    periodEnd={run.pay_period_end}
                  />
                )}
                {isDraft && (
                  <form action={deletePayRunLine.bind(null, run.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <a href={`/payroll?browseClient=${browseClientId}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
              ← Back to Payroll
            </a>
<h1 className="text-2xl font-bold text-slate-900 mt-4">Pay Runs</h1>
            <p className="text-sm text-slate-500 mt-0.5">{client?.client_name}</p>
          </div>
          <a href={`/payroll/run?browseClient=${browseClientId}`}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            + New Pay Run
          </a>
        </div>
        <div className="mt-4 flex gap-2">
          {taxYearOptions.map((y) => (
            <a key={y} href={`/payroll/runs?browseClient=${browseClientId}&taxYear=${y}`}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                taxYear === y ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}>
              {y}
            </a>
          ))}
        </div>
      </div>
      <div className="p-8 space-y-6">
        {draftBatches.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">In Progress</p>
            <div className="space-y-4">
              {draftBatches.map((batch) => <BatchCard key={batch.id} batch={batch} isDraft={true} />)}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">History</p>
          <div className="space-y-4">
            {finalizedBatches.map((batch) => <BatchCard key={batch.id} batch={batch} isDraft={false} />)}
            {finalizedBatches.length === 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 text-center">
                <p className="text-sm text-slate-500">No finalized pay runs yet.</p>
              </div>
            )}
          </div>
        </div>

        {unbatchedRuns.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Older Pay Runs (before batching)</p>
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-2">
              {unbatchedRuns.map((run: any) => (
                <div key={run.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">
                      {run.payroll_employees?.name} — {new Date(run.payment_date).toLocaleDateString("en-GB")}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Gross {fmt(Number(run.gross_pay))} · Net {fmt(Number(run.net_pay))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={`/payslip/${run.token}`} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg bg-white border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                      Payslip →
                    </a>
                    {run.payroll_employees?.email && (
                      <EmailPayslipButton
                        email={run.payroll_employees.email}
                        employeeName={run.payroll_employees.name}
                        token={run.token}
                        paymentDate={run.payment_date}
                        periodStart={run.pay_period_start}
                        periodEnd={run.pay_period_end}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}