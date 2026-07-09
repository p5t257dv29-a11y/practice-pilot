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
  searchParams: Promise<{ client?: string; period_start?: string; period_end?: string }>;
}) {
  const { client: clientId, period_start, period_end } = await searchParams;

  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name")
    .order("client_name", { ascending: true });

  let clientName = "";
  let additions: any[] = [];
  let disposals: any[] = [];
  let stillHeld: any[] = [];

  if (clientId && period_start && period_end) {
    const { data: client } = await supabase
      .from("clients")
      .select("client_name")
      .eq("id", clientId)
      .single();
    clientName = client?.client_name || "";

    const { data: assets } = await supabase
      .from("fixed_assets")
      .select("*")
      .eq("client_id", clientId)
      .order("acquisition_date", { ascending: true });

    const start = new Date(period_start);
    const end = new Date(period_end);

    (assets || []).forEach((asset) => {
      const acq = new Date(asset.acquisition_date);
      const acquiredInPeriod = acq >= start && acq <= end;

      if (acquiredInPeriod) {
        additions.push(asset);
      }

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
        {/* Selection form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Select Client & Period</h2>
          <form method="get" className="mt-4 grid gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select name="client" required defaultValue={clientId || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period Start *</label>
              <input name="period_start" type="date" required defaultValue={period_start || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Period End *</label>
              <input name="period_end" type="date" required defaultValue={period_end || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div className="flex items-end">
              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Generate Report
              </button>
            </div>
          </form>
        </div>

        {clientId && period_start && period_end && (
          <>
            <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">{clientName}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Period: {new Date(period_start).toLocaleDateString("en-GB")} to {new Date(period_end).toLocaleDateString("en-GB")}
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
