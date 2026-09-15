import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function finalizeBatch(batchId: string, clientId: string) {
  "use server";
  await supabase.from("payroll_batches").update({
    status: "finalized",
    finalized_at: new Date().toISOString(),
  }).eq("id", batchId);
  revalidatePath(`/payroll/runs?browseClient=${clientId}`);
}

// Reopening a Finalized batch back to Draft — payslips/P32 shouldn't be
// treated as final if a correction is needed. The underlying pay run
// figures are always editable regardless of batch status; this only
// changes the label and whether Finalize is offered again.
async function reopenBatch(batchId: string, clientId: string) {
  "use server";
  await supabase.from("payroll_batches").update({
    status: "draft",
    finalized_at: null,
  }).eq("id", batchId);
  revalidatePath(`/payroll/runs?browseClient=${clientId}`);
}

export default async function PayrollRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ browseClient?: string }>;
}) {
  const { browseClient: clientId } = await searchParams;

  const { data: client } = clientId
    ? await supabase.from("clients").select("id, client_name").eq("id", clientId).maybeSingle()
    : { data: null };

  const { data: batches } = clientId
    ? await supabase
        .from("payroll_batches")
        .select("*")
        .eq("client_id", clientId)
        .order("period_end", { ascending: false })
    : { data: [] };

  const { data: allRuns } = clientId
    ? await supabase
        .from("payroll_runs")
        .select("*, payroll_employees(name)")
        .eq("client_id", clientId)
    : { data: [] };

  const fmt = (n: number) => `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");

  const batchGroups = (batches || []).map((batch) => {
    const runs = (allRuns || []).filter(
      (r) => r.batch_id === batch.id ||
        // Older runs created before batches existed won't have a batch_id —
        // fall back to matching on period so nothing already entered is lost
        (!r.batch_id && r.pay_period_start === batch.period_start && r.pay_period_end === batch.period_end)
    );
    return {
      batch,
      runs,
      totalGross: runs.reduce((s, r) => s + Number(r.gross_pay) + Number(r.smp || 0) + Number(r.spp || 0), 0),
      totalNet: runs.reduce((s, r) => s + Number(r.net_pay), 0),
    };
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/payroll?browseClient=${clientId}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">← Back to Payroll</a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Pay Run History</h1>
        <p className="text-sm text-slate-500 mt-0.5">{client?.client_name}</p>
      </div>

      <div className="p-8 max-w-4xl">
        {!clientId ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 text-center py-12">
            <p className="text-sm text-slate-500">No client selected — go back to Payroll and choose a client first.</p>
          </div>
        ) : batchGroups.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 text-center py-12">
            <p className="text-sm text-slate-500">No pay runs recorded yet for {client?.client_name}.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {batchGroups.map(({ batch, runs, totalGross, totalNet }) => (
              <div key={batch.id} className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-4 flex items-center justify-between bg-slate-50 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900">
                        {fmtDate(batch.period_start)} to {fmtDate(batch.period_end)}
                      </p>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        batch.status === "finalized" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {batch.status === "finalized" ? "Finalized" : "Draft"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Paid {fmtDate(batch.payment_date)} · {runs.length} employee{runs.length !== 1 ? "s" : ""}
                      {batch.finalized_at && ` · Finalized ${fmtDate(batch.finalized_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-bold text-slate-900">{fmt(totalNet)} net</p>
                      <p className="text-xs text-slate-400">{fmt(totalGross)} gross</p>
                    </div>
                    {batch.status === "draft" ? (
                      <>
                        <a href={`/payroll/run?browseClient=${clientId}&period_start=${batch.period_start}&period_end=${batch.period_end}&payment_date=${batch.payment_date}`}
                          className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap">
                          Continue →
                        </a>
                        <form action={finalizeBatch.bind(null, batch.id, clientId)}>
                          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors whitespace-nowrap">
                            Finalize
                          </button>
                        </form>
                      </>
                    ) : (
                      <form action={reopenBatch.bind(null, batch.id, clientId)}>
                        <button type="submit" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap">
                          Reopen
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-slate-50">
                  {runs.map((r: any) => (
                    <div key={r.id} className="p-3 px-4 flex items-center justify-between text-sm">
                      <span className="text-slate-700">{(r.payroll_employees as any)?.name || "Unknown employee"}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">
                          Gross {fmt(Number(r.gross_pay) + Number(r.smp || 0) + Number(r.spp || 0))} · Net {fmt(r.net_pay)}
                        </span>
                        <a href={`/payroll/runs/${r.id}/edit`}
                          className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap">
                          Edit →
                        </a>
                      </div>
                    </div>
                  ))}
                  {runs.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">No employees entered yet — continue this pay run to add them.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}