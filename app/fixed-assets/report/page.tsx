import { createClient } from "@supabase/supabase-js";
import { calculateNBV } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function FixedAssetReportPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; client?: string; period_start?: string; period_end?: string }>;
}) {
  const { job: jobId, client: manualClientId, period_start: manualPeriodStart, period_end: manualPeriodEnd } = await searchParams;

  const [{ data: clients }, { data: jobs }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, job_name, client_id, period_start, period_end, clients(client_name)")
      .order("job_name", { ascending: true }),
  ]);

  let clientName = "";
  let clientId: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let usingJob = false;
  let selectedJobName = "";
  let additions: any[] = [];
  let disposals: any[] = [];
  let stillHeld: any[] = [];

  if (jobId) {
    const job = (jobs || []).find((j) => j.id === jobId);
    if (job) {
      usingJob = true;
      selectedJobName = job.job_name;
      clientId = job.client_id;
      clientName = (job.clients as any)?.client_name || "";
      periodStart = job.period_start;
      periodEnd = job.period_end;
    }
  } else if (manualClientId && manualPeriodStart && manualPeriodEnd) {
    clientId = manualClientId;
    periodStart = manualPeriodStart;
    periodEnd = manualPeriodEnd;
    const { data: client } = await supabase
      .from("clients")
      .select("client_name")
      .eq("id", clientId)
      .single();
    clientName = client?.client_name || "";
  }

  if (clientId) {
    const { data: assets } = await supabase
      .from("fixed_assets")
      .select("*")
      .eq("client_id", clientId)
      .order("acquisition_date", { ascending: true });

    const start = periodStart ? new Date(periodStart) : null;
    const end = periodEnd ? new Date(periodEnd) : null;

    (assets || []).forEach((asset) => {
      const acq = new Date(asset.acquisition_date);
      // When linked to a job, additions are assets tied to that job (no date needed).
      // Otherwise, match by acquisition date within the period.
      const acquiredInPeriod = usingJob
        ? asset.job_id === jobId
        : !!(start && end && acq >= start && acq <= end);

      if (acquiredInPeriod) {
        additions.push(asset);
      }

      if (!start || !end) return; // disposals/held need a date range

      if (asset.disposal_date) {
        const disp = new Date(asset.disposal_date);
        if (disp >= start && disp <= end) {
          disposals.push(asset);
        }
      } else if (!acquiredInPeriod && acq < start) {
        // Held throughout the period (acquired before, not disposed within it)
        stillHeld.push(asset);
      } else if (acquiredInPeriod) {
        // Acquired and still held — also show in "held at period end"
        stillHeld.push(asset);
      }
    });
  }

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const totalAdditionsCost = additions.reduce((s, a) => s + Number(a.cost), 0);
  const totalDisposalProceeds = disposals.reduce((s, a) => s + Number(a.disposal_proceeds || 0), 0);
  const totalHeldNBV = stillHeld.reduce((s, a) => s + calculateNBV(a).nbv, 0);
  const hasReport = !!clientId;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/fixed-assets" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Fixed Asset Register
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Fixed Asset Report</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Additions and disposals for a client within a chosen period.
        </p>
      </div>

      <div className="p-8">
        {/* Primary: select by Job */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Select by Job</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Period is taken automatically from the job's own dates — no manual entry needed.
          </p>
          <form method="get" className="mt-4 flex gap-2 items-end">
            <div className="flex-1 max-w-md">
              <label className="block text-sm font-medium text-slate-700 mb-1">Job</label>
              <select name="job" required defaultValue={jobId || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a job</option>
                {(jobs || []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {(j.clients as any)?.client_name} — {j.job_name}
                    {j.period_start && j.period_end && ` (${new Date(j.period_start).toLocaleDateString("en-GB")} – ${new Date(j.period_end).toLocaleDateString("en-GB")})`}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit"
              className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Generate Report
            </button>
          </form>
          {usingJob && !periodStart && (
            <p className="mt-3 text-xs text-yellow-700 bg-yellow-50 border border-yellow-100 rounded-lg p-2">
              This job has no period dates set, so disposals and held-asset figures can't be calculated. Edit the job to add Period Start/End, or use manual selection below.
            </p>
          )}
        </div>

        {/* Fallback: manual client + date range, for assets not linked to a job */}
        <details className="mt-4 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <summary className="text-sm font-semibold text-slate-600 cursor-pointer">
            Or select by client and date range manually →
          </summary>
          <form method="get" className="mt-4 grid gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select name="client" required defaultValue={manualClientId || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
              <input name="period_start" type="date" required defaultValue={manualPeriodStart || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
              <input name="period_end" type="date" required defaultValue={manualPeriodEnd || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div className="flex items-end">
              <button type="submit"
                className="w-full rounded-xl bg-slate-100 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Generate Report
              </button>
            </div>
          </form>
        </details>

        {hasReport && (
          <>
            <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">{clientName}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {usingJob && `Job: ${selectedJobName} · `}
                {periodStart && periodEnd
                  ? `Period: ${new Date(periodStart).toLocaleDateString("en-GB")} to ${new Date(periodEnd).toLocaleDateString("en-GB")}`
                  : "No period set — disposals and held-asset figures unavailable"}
              </p>
            </div>

            {/* Summary */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Additions</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(totalAdditionsCost)}</p>
                <p className="text-xs text-slate-400 mt-1">{additions.length} asset{additions.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Disposal Proceeds</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(totalDisposalProceeds)}</p>
                <p className="text-xs text-slate-400 mt-1">{disposals.length} asset{disposals.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">NBV Still Held</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(totalHeldNBV)}</p>
                <p className="text-xs text-slate-400 mt-1">{stillHeld.length} asset{stillHeld.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Additions */}
            <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Additions ({additions.length})</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="pb-2">Description</th>
                      <th className="pb-2">Category</th>
                      <th className="pb-2">Pool</th>
                      <th className="pb-2">Acquired</th>
                      <th className="pb-2 text-right">Cost</th>
                      <th className="pb-2 text-right">Current NBV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {additions.map((a) => {
                      const { nbv } = calculateNBV(a);
                      return (
                        <tr key={a.id}>
                          <td className="py-2 font-medium text-slate-900">{a.description}</td>
                          <td className="py-2 text-slate-600">{a.category || "—"}</td>
                          <td className="py-2 text-slate-600">{a.capital_allowance_pool}</td>
                          <td className="py-2 text-slate-600">{new Date(a.acquisition_date).toLocaleDateString("en-GB")}</td>
                          <td className="py-2 text-right font-medium">{fmt(Number(a.cost))}</td>
                          <td className="py-2 text-right">{fmt(nbv)}</td>
                        </tr>
                      );
                    })}
                    {additions.length === 0 && (
                      <tr><td colSpan={6} className="py-6 text-center text-slate-400">No additions in this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Disposals */}
            <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Disposals ({disposals.length})</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="pb-2">Description</th>
                      <th className="pb-2">Disposed</th>
                      <th className="pb-2 text-right">Original Cost</th>
                      <th className="pb-2 text-right">NBV at Disposal</th>
                      <th className="pb-2 text-right">Proceeds</th>
                      <th className="pb-2 text-right">Profit / (Loss)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {disposals.map((a) => {
                      const { nbv } = calculateNBV(a);
                      const proceeds = Number(a.disposal_proceeds || 0);
                      const profitLoss = proceeds - nbv;
                      return (
                        <tr key={a.id}>
                          <td className="py-2 font-medium text-slate-900">{a.description}</td>
                          <td className="py-2 text-slate-600">{new Date(a.disposal_date).toLocaleDateString("en-GB")}</td>
                          <td className="py-2 text-right">{fmt(Number(a.cost))}</td>
                          <td className="py-2 text-right">{fmt(nbv)}</td>
                          <td className="py-2 text-right font-medium">{fmt(proceeds)}</td>
                          <td className={`py-2 text-right font-medium ${profitLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {profitLoss >= 0 ? fmt(profitLoss) : `(${fmt(Math.abs(profitLoss))})`}
                          </td>
                        </tr>
                      );
                    })}
                    {disposals.length === 0 && (
                      <tr><td colSpan={6} className="py-6 text-center text-slate-400">No disposals in this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Still Held */}
            <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Assets Held at Period End ({stillHeld.length})</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="pb-2">Description</th>
                      <th className="pb-2">Acquired</th>
                      <th className="pb-2 text-right">Cost</th>
                      <th className="pb-2 text-right">Current NBV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {stillHeld.map((a) => {
                      const { nbv } = calculateNBV(a);
                      return (
                        <tr key={a.id}>
                          <td className="py-2 font-medium text-slate-900">{a.description}</td>
                          <td className="py-2 text-slate-600">{new Date(a.acquisition_date).toLocaleDateString("en-GB")}</td>
                          <td className="py-2 text-right">{fmt(Number(a.cost))}</td>
                          <td className="py-2 text-right font-medium">{fmt(nbv)}</td>
                        </tr>
                      );
                    })}
                    {stillHeld.length === 0 && (
                      <tr><td colSpan={4} className="py-6 text-center text-slate-400">No assets held at period end.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
