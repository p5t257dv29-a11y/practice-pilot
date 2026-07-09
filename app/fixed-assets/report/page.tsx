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

  // Cost / depreciation movement note, grouped by category — mirrors the standard
  // UK statutory accounts fixed asset schedule. Only calculable with a period set.
  type CategoryRow = {
    category: string;
    costStart: number; additionsAmt: number; disposalsAmt: number; costEnd: number;
    depStart: number; charge: number; eliminated: number; depEnd: number;
    nbvStart: number; nbvEnd: number;
  };
  const categoryRows: CategoryRow[] = [];

  if (periodStart && periodEnd) {
    const pStart = new Date(periodStart);
    const pEnd = new Date(periodEnd);

    // Unique set of assets relevant to this period (dedupe across additions/disposals/stillHeld)
    const relevantAssets = new Map<string, any>();
    [...additions, ...disposals, ...stillHeld].forEach((a) => relevantAssets.set(a.id, a));

    const byCategory = new Map<string, CategoryRow>();

    relevantAssets.forEach((asset) => {
      const category = asset.category || "Uncategorised";
      if (!byCategory.has(category)) {
        byCategory.set(category, {
          category, costStart: 0, additionsAmt: 0, disposalsAmt: 0, costEnd: 0,
          depStart: 0, charge: 0, eliminated: 0, depEnd: 0, nbvStart: 0, nbvEnd: 0,
        });
      }
      const row = byCategory.get(category)!;
      const acq = new Date(asset.acquisition_date);
      const disposedInPeriod = asset.disposal_date && new Date(asset.disposal_date) >= pStart && new Date(asset.disposal_date) <= pEnd;
      const acquiredBeforeStart = acq < pStart;
      const acquiredInPeriod = acq >= pStart && acq <= pEnd;
      const cost = Number(asset.cost);

      const costStart = acquiredBeforeStart ? cost : 0;
      const additionsAmt = acquiredInPeriod ? cost : 0;
      const disposalsAmt = disposedInPeriod ? cost : 0;
      const costEnd = costStart + additionsAmt - disposalsAmt;

      const depStart = acquiredBeforeStart ? calculateNBV(asset, pStart).accumulatedDepreciation : 0;
      const depEndCalcDate = disposedInPeriod ? new Date(asset.disposal_date) : pEnd;
      const depEndRaw = (acquiredBeforeStart || acquiredInPeriod) ? calculateNBV(asset, depEndCalcDate).accumulatedDepreciation : 0;
      const eliminated = disposedInPeriod ? depEndRaw : 0;
      const charge = depEndRaw - depStart;
      const depEnd = disposedInPeriod ? 0 : depEndRaw;

      row.costStart += costStart;
      row.additionsAmt += additionsAmt;
      row.disposalsAmt += disposalsAmt;
      row.costEnd += costEnd;
      row.depStart += depStart;
      row.charge += charge;
      row.eliminated += eliminated;
      row.depEnd += depEnd;
      row.nbvStart += costStart - depStart;
      row.nbvEnd += costEnd - depEnd;
    });

    categoryRows.push(...Array.from(byCategory.values()).sort((a, b) => a.category.localeCompare(b.category)));
  }

  const totals: CategoryRow = categoryRows.reduce((t, r) => ({
    category: "Total",
    costStart: t.costStart + r.costStart,
    additionsAmt: t.additionsAmt + r.additionsAmt,
    disposalsAmt: t.disposalsAmt + r.disposalsAmt,
    costEnd: t.costEnd + r.costEnd,
    depStart: t.depStart + r.depStart,
    charge: t.charge + r.charge,
    eliminated: t.eliminated + r.eliminated,
    depEnd: t.depEnd + r.depEnd,
    nbvStart: t.nbvStart + r.nbvStart,
    nbvEnd: t.nbvEnd + r.nbvEnd,
  }), { category: "Total", costStart: 0, additionsAmt: 0, disposalsAmt: 0, costEnd: 0, depStart: 0, charge: 0, eliminated: 0, depEnd: 0, nbvStart: 0, nbvEnd: 0 });

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

            {/* Cost & Depreciation Movement Note */}
            {periodStart && periodEnd && categoryRows.length > 0 && (
              <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Fixed Asset Movement Note</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Cost and depreciation movements by category, in the standard statutory accounts format.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="pb-2">Category</th>
                        <th className="pb-2 text-right">Cost b/fwd</th>
                        <th className="pb-2 text-right">Additions</th>
                        <th className="pb-2 text-right">Disposals</th>
                        <th className="pb-2 text-right">Cost c/fwd</th>
                        <th className="pb-2 text-right">Dep. b/fwd</th>
                        <th className="pb-2 text-right">Charge</th>
                        <th className="pb-2 text-right">Eliminated</th>
                        <th className="pb-2 text-right">Dep. c/fwd</th>
                        <th className="pb-2 text-right">NBV c/fwd</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {categoryRows.map((r) => (
                        <tr key={r.category}>
                          <td className="py-2 font-medium text-slate-900">{r.category}</td>
                          <td className="py-2 text-right">{fmt(r.costStart)}</td>
                          <td className="py-2 text-right text-green-600">{r.additionsAmt > 0 ? fmt(r.additionsAmt) : "—"}</td>
                          <td className="py-2 text-right text-red-600">{r.disposalsAmt > 0 ? `(${fmt(r.disposalsAmt)})` : "—"}</td>
                          <td className="py-2 text-right font-medium">{fmt(r.costEnd)}</td>
                          <td className="py-2 text-right">{fmt(r.depStart)}</td>
                          <td className="py-2 text-right">{fmt(r.charge)}</td>
                          <td className="py-2 text-right text-red-600">{r.eliminated > 0 ? `(${fmt(r.eliminated)})` : "—"}</td>
                          <td className="py-2 text-right font-medium">{fmt(r.depEnd)}</td>
                          <td className="py-2 text-right font-bold">{fmt(r.nbvEnd)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-200 font-bold">
                        <td className="py-2">{totals.category}</td>
                        <td className="py-2 text-right">{fmt(totals.costStart)}</td>
                        <td className="py-2 text-right text-green-600">{fmt(totals.additionsAmt)}</td>
                        <td className="py-2 text-right text-red-600">{totals.disposalsAmt > 0 ? `(${fmt(totals.disposalsAmt)})` : "—"}</td>
                        <td className="py-2 text-right">{fmt(totals.costEnd)}</td>
                        <td className="py-2 text-right">{fmt(totals.depStart)}</td>
                        <td className="py-2 text-right">{fmt(totals.charge)}</td>
                        <td className="py-2 text-right text-red-600">{totals.eliminated > 0 ? `(${fmt(totals.eliminated)})` : "—"}</td>
                        <td className="py-2 text-right">{fmt(totals.depEnd)}</td>
                        <td className="py-2 text-right">{fmt(totals.nbvEnd)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                  NBV brought forward: {fmt(totals.nbvStart)} · Depreciation charge for the period: {fmt(totals.charge)}
                </p>
              </div>
            )}

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
