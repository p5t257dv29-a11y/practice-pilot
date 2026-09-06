import { createClient } from "@supabase/supabase-js";
import { Fragment } from "react";
import { calculateNBV } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AssetRow = {
  asset: any;
  costStart: number;
  additionsAmt: number;
  disposalsAmt: number;
  costEnd: number;
  depStart: number;
  charge: number;
  eliminated: number;
  depEnd: number;
  nbvStart: number;
  nbvEnd: number;
  proceeds: number;
  profitLoss: number | null;
  disposedInPeriod: boolean;
};

type SubtotalRow = Omit<AssetRow, "asset" | "profitLoss" | "disposedInPeriod"> & { profitLoss: number };

function emptySubtotal(): SubtotalRow {
  return { costStart: 0, additionsAmt: 0, disposalsAmt: 0, costEnd: 0, depStart: 0, charge: 0, eliminated: 0, depEnd: 0, nbvStart: 0, nbvEnd: 0, proceeds: 0, profitLoss: 0 };
}

function addToSubtotal(t: SubtotalRow, r: AssetRow): SubtotalRow {
  return {
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
    proceeds: t.proceeds + r.proceeds,
    profitLoss: t.profitLoss + (r.profitLoss || 0),
  };
}

// Builds the full movement schedule for one asset over the period — every figure
// a statutory fixed asset note or working paper would need, derived purely from
// the asset's own dates and the register's depreciation settings.
function buildAssetRow(asset: any, pStart: Date, pEnd: Date): AssetRow {
  const acq = new Date(asset.acquisition_date);
  const disposedInPeriod = !!(asset.disposal_date && new Date(asset.disposal_date) >= pStart && new Date(asset.disposal_date) <= pEnd);
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

  const nbvStart = costStart - depStart;
  const nbvEnd = costEnd - depEnd;

  const proceeds = disposedInPeriod ? Number(asset.disposal_proceeds || 0) : 0;
  const nbvAtDisposal = disposedInPeriod ? cost - eliminated : 0;
  const profitLoss = disposedInPeriod ? proceeds - nbvAtDisposal : null;

  return { asset, costStart, additionsAmt, disposalsAmt, costEnd, depStart, charge, eliminated, depEnd, nbvStart, nbvEnd, proceeds, profitLoss, disposedInPeriod };
}

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
  let relevantAssets: any[] = [];

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

  const hasReport = !!clientId;
  let assetRows: AssetRow[] = [];
  let categoryGroups: { category: string; rows: AssetRow[]; subtotal: SubtotalRow }[] = [];
  let grandTotal: SubtotalRow = emptySubtotal();

  if (clientId) {
    const { data: assets } = await supabase
      .from("fixed_assets")
      .select("*")
      .eq("client_id", clientId)
      .order("acquisition_date", { ascending: true });

    const start = periodStart ? new Date(periodStart) : null;
    const end = periodEnd ? new Date(periodEnd) : null;

    if (start && end) {
      relevantAssets = (assets || []).filter((asset) => {
        const acq = new Date(asset.acquisition_date);
        const acquiredInPeriod = usingJob ? asset.job_id === jobId : (acq >= start && acq <= end);
        const acquiredBeforeStart = acq < start;
        const disposedInPeriod = asset.disposal_date && new Date(asset.disposal_date) >= start && new Date(asset.disposal_date) <= end;
        const heldThroughout = acquiredBeforeStart && (!asset.disposal_date || new Date(asset.disposal_date) > start);
        return acquiredInPeriod || disposedInPeriod || heldThroughout;
      });

      assetRows = relevantAssets.map((asset) => buildAssetRow(asset, start, end));

      const byCategory = new Map<string, AssetRow[]>();
      assetRows.forEach((r) => {
        const category = r.asset.category || "Uncategorised";
        const list = byCategory.get(category) || [];
        list.push(r);
        byCategory.set(category, list);
      });

      categoryGroups = Array.from(byCategory.entries())
        .map(([category, rows]) => ({
          category,
          rows,
          subtotal: rows.reduce((t, r) => addToSubtotal(t, r), emptySubtotal()),
        }))
        .sort((a, b) => a.category.localeCompare(b.category));

      grandTotal = assetRows.reduce((t, r) => addToSubtotal(t, r), emptySubtotal());
    } else {
      // No period set — still show a flat list of assets acquired against this job, without movement figures
      relevantAssets = usingJob ? (assets || []).filter((a) => a.job_id === jobId) : (assets || []);
    }
  }

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtSigned = (n: number) => n === 0 ? "—" : n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
  const methodLabel = (a: any) => `${a.depreciation_method === "Reducing Balance" ? "RB" : "SL"} ${Number(a.depreciation_rate_pct)}%`;

  const additionsCount = assetRows.filter((r) => r.additionsAmt > 0).length;
  const disposalsCount = assetRows.filter((r) => r.disposedInPeriod).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/fixed-assets" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Fixed Asset Register
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Fixed Asset Report</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Full cost and depreciation movement schedule for a client within a chosen period.
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
              This job has no period dates set, so the full movement schedule can't be calculated. Edit the job to add Period Start/End, or use manual selection below.
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
                  : "No period set — full movement schedule unavailable"}
              </p>
            </div>

            {/* Summary */}
            {periodStart && periodEnd && (
              <div className="mt-6 grid grid-cols-4 gap-4">
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">NBV Brought Forward</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(grandTotal.nbvStart)}</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Additions</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(grandTotal.additionsAmt)}</p>
                  <p className="text-xs text-slate-400 mt-1">{additionsCount} asset{additionsCount !== 1 ? "s" : ""}</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Disposal Proceeds</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(grandTotal.proceeds)}</p>
                  <p className="text-xs text-slate-400 mt-1">{disposalsCount} asset{disposalsCount !== 1 ? "s" : ""}</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">NBV Carried Forward</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{fmt(grandTotal.nbvEnd)}</p>
                </div>
              </div>
            )}

            {/* Detailed per-asset schedule, grouped by category with subtotals */}
            {periodStart && periodEnd && categoryGroups.length > 0 && (
              <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Detailed Asset Schedule</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Full cost and depreciation movement for every asset relevant to this period, grouped by category.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="pb-2 pr-3">Asset</th>
                        <th className="pb-2 pr-3">Pool</th>
                        <th className="pb-2 pr-3">Depn Type</th>
                        <th className="pb-2 pr-3 text-right">Cost B/F</th>
                        <th className="pb-2 pr-3 text-right">Additions</th>
                        <th className="pb-2 pr-3 text-right">Disposals</th>
                        <th className="pb-2 pr-3 text-right">Cost C/F</th>
                        <th className="pb-2 pr-3 text-right">Accum Depn B/F</th>
                        <th className="pb-2 pr-3 text-right">Depn Charge</th>
                        <th className="pb-2 pr-3 text-right">Depn Eliminated</th>
                        <th className="pb-2 pr-3 text-right">Accum Depn C/F</th>
                        <th className="pb-2 pr-3 text-right">NBV B/F</th>
                        <th className="pb-2 pr-3 text-right">NBV C/F</th>
                        <th className="pb-2 pr-3 text-right">Proceeds</th>
                        <th className="pb-2 text-right">Profit/(Loss)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {categoryGroups.map((group) => (
                        <Fragment key={group.category}>
                          <tr>
                            <td colSpan={15} className="pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              {group.category}
                            </td>
                          </tr>
                          {group.rows.map((r) => (
                            <tr key={r.asset.id} className="hover:bg-slate-50">
                              <td className="py-2 pr-3 font-medium text-slate-900">
                                {r.asset.description}
                                {r.asset.disposal_date && <span className="ml-1.5 text-xs text-red-500">(disposed)</span>}
                              </td>
                              <td className="py-2 pr-3 text-slate-500 text-xs">{r.asset.capital_allowance_pool}</td>
                              <td className="py-2 pr-3 text-slate-500 text-xs">{methodLabel(r.asset)}</td>
                              <td className="py-2 pr-3 text-right">{fmtSigned(r.costStart)}</td>
                              <td className="py-2 pr-3 text-right text-green-600">{r.additionsAmt > 0 ? fmt(r.additionsAmt) : "—"}</td>
                              <td className="py-2 pr-3 text-right text-red-600">{r.disposalsAmt > 0 ? `(${fmt(r.disposalsAmt)})` : "—"}</td>
                              <td className="py-2 pr-3 text-right font-medium">{fmtSigned(r.costEnd)}</td>
                              <td className="py-2 pr-3 text-right">{fmtSigned(r.depStart)}</td>
                              <td className="py-2 pr-3 text-right">{fmtSigned(r.charge)}</td>
                              <td className="py-2 pr-3 text-right text-red-600">{r.eliminated > 0 ? `(${fmt(r.eliminated)})` : "—"}</td>
                              <td className="py-2 pr-3 text-right font-medium">{fmtSigned(r.depEnd)}</td>
                              <td className="py-2 pr-3 text-right">{fmtSigned(r.nbvStart)}</td>
                              <td className="py-2 pr-3 text-right font-bold">{fmtSigned(r.nbvEnd)}</td>
                              <td className="py-2 pr-3 text-right">{r.disposedInPeriod ? fmt(r.proceeds) : "—"}</td>
                              <td className={`py-2 text-right font-medium ${r.profitLoss === null ? "" : r.profitLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {r.profitLoss === null ? "—" : r.profitLoss >= 0 ? fmt(r.profitLoss) : `(${fmt(Math.abs(r.profitLoss))})`}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-slate-100 font-semibold bg-slate-50/60">
                            <td className="py-2 pr-3" colSpan={3}>{group.category} — Subtotal</td>
                            <td className="py-2 pr-3 text-right">{fmtSigned(group.subtotal.costStart)}</td>
                            <td className="py-2 pr-3 text-right text-green-600">{group.subtotal.additionsAmt > 0 ? fmt(group.subtotal.additionsAmt) : "—"}</td>
                            <td className="py-2 pr-3 text-right text-red-600">{group.subtotal.disposalsAmt > 0 ? `(${fmt(group.subtotal.disposalsAmt)})` : "—"}</td>
                            <td className="py-2 pr-3 text-right">{fmtSigned(group.subtotal.costEnd)}</td>
                            <td className="py-2 pr-3 text-right">{fmtSigned(group.subtotal.depStart)}</td>
                            <td className="py-2 pr-3 text-right">{fmtSigned(group.subtotal.charge)}</td>
                            <td className="py-2 pr-3 text-right text-red-600">{group.subtotal.eliminated > 0 ? `(${fmt(group.subtotal.eliminated)})` : "—"}</td>
                            <td className="py-2 pr-3 text-right">{fmtSigned(group.subtotal.depEnd)}</td>
                            <td className="py-2 pr-3 text-right">{fmtSigned(group.subtotal.nbvStart)}</td>
                            <td className="py-2 pr-3 text-right">{fmtSigned(group.subtotal.nbvEnd)}</td>
                            <td className="py-2 pr-3 text-right">{group.subtotal.proceeds > 0 ? fmt(group.subtotal.proceeds) : "—"}</td>
                            <td className={`py-2 text-right ${group.subtotal.profitLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {group.subtotal.profitLoss === 0 ? "—" : group.subtotal.profitLoss >= 0 ? fmt(group.subtotal.profitLoss) : `(${fmt(Math.abs(group.subtotal.profitLoss))})`}
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                      <tr className="border-t-2 border-slate-300 font-bold">
                        <td className="py-2 pr-3" colSpan={3}>Grand Total</td>
                        <td className="py-2 pr-3 text-right">{fmtSigned(grandTotal.costStart)}</td>
                        <td className="py-2 pr-3 text-right text-green-600">{grandTotal.additionsAmt > 0 ? fmt(grandTotal.additionsAmt) : "—"}</td>
                        <td className="py-2 pr-3 text-right text-red-600">{grandTotal.disposalsAmt > 0 ? `(${fmt(grandTotal.disposalsAmt)})` : "—"}</td>
                        <td className="py-2 pr-3 text-right">{fmtSigned(grandTotal.costEnd)}</td>
                        <td className="py-2 pr-3 text-right">{fmtSigned(grandTotal.depStart)}</td>
                        <td className="py-2 pr-3 text-right">{fmtSigned(grandTotal.charge)}</td>
                        <td className="py-2 pr-3 text-right text-red-600">{grandTotal.eliminated > 0 ? `(${fmt(grandTotal.eliminated)})` : "—"}</td>
                        <td className="py-2 pr-3 text-right">{fmtSigned(grandTotal.depEnd)}</td>
                        <td className="py-2 pr-3 text-right">{fmtSigned(grandTotal.nbvStart)}</td>
                        <td className="py-2 pr-3 text-right">{fmtSigned(grandTotal.nbvEnd)}</td>
                        <td className="py-2 pr-3 text-right">{grandTotal.proceeds > 0 ? fmt(grandTotal.proceeds) : "—"}</td>
                        <td className={`py-2 text-right ${grandTotal.profitLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {grandTotal.profitLoss === 0 ? "—" : grandTotal.profitLoss >= 0 ? fmt(grandTotal.profitLoss) : `(${fmt(Math.abs(grandTotal.profitLoss))})`}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Fallback flat list when no period is set */}
            {(!periodStart || !periodEnd) && relevantAssets.length > 0 && (
              <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Assets ({relevantAssets.length})</h2>
                <p className="text-xs text-slate-400 mt-1">No period set, so cost/depreciation movement can't be calculated — showing current position only.</p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="pb-2">Description</th>
                        <th className="pb-2">Category</th>
                        <th className="pb-2">Pool</th>
                        <th className="pb-2">Depn Type</th>
                        <th className="pb-2">Acquired</th>
                        <th className="pb-2 text-right">Cost</th>
                        <th className="pb-2 text-right">Current NBV</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {relevantAssets.map((a) => {
                        const { nbv } = calculateNBV(a);
                        return (
                          <tr key={a.id}>
                            <td className="py-2 font-medium text-slate-900">{a.description}</td>
                            <td className="py-2 text-slate-600">{a.category || "—"}</td>
                            <td className="py-2 text-slate-600 text-xs">{a.capital_allowance_pool}</td>
                            <td className="py-2 text-slate-600 text-xs">{methodLabel(a)}</td>
                            <td className="py-2 text-slate-600">{new Date(a.acquisition_date).toLocaleDateString("en-GB")}</td>
                            <td className="py-2 text-right font-medium">{fmt(Number(a.cost))}</td>
                            <td className="py-2 text-right">{fmt(nbv)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}