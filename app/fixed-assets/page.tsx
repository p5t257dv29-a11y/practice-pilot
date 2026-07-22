import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Net book value for accounts purposes — supports both straight-line and reducing balance.
// Pass asOfDate to calculate the position at a specific date (e.g. period start/end)
// rather than today; useful for building fixed asset movement notes.
// NOTE: imported by app/accounts-production/[id]/frs102/page.tsx and frs105/page.tsx
// via "../../../fixed-assets/page" — keep this exported from this file.
export function calculateNBV(asset: {
  cost: number;
  depreciation_rate_pct: number;
  depreciation_method: string;
  acquisition_date: string;
  disposal_date: string | null;
}, asOfDate?: Date) {
  const start = new Date(asset.acquisition_date);
  const disposal = asset.disposal_date ? new Date(asset.disposal_date) : null;
  const reference = asOfDate || new Date();
  // Depreciation stops at disposal, and never runs before the asset was acquired
  const end = disposal && disposal < reference ? disposal : reference;
  const yearsElapsed = Math.max(0, (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const rate = asset.depreciation_rate_pct / 100;

  let nbv: number;
  if (asset.depreciation_method === "Reducing Balance") {
    nbv = asset.cost * Math.pow(1 - rate, yearsElapsed);
  } else {
    // Straight Line
    nbv = asset.cost - Math.min(asset.cost, asset.cost * rate * yearsElapsed);
  }
  nbv = Math.max(0, nbv);
  const accumulatedDepreciation = asset.cost - nbv;
  return { accumulatedDepreciation, nbv };
}

export default async function FixedAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; browseClient?: string }>;
}) {
  const { mode, browseClient: browseClientId } = await searchParams;

  const [{ data: assets, error }, { data: clients }] = await Promise.all([
    supabase
      .from("fixed_assets")
      .select("*, clients(client_name)")
      .order("acquisition_date", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  const browseAssets = browseClientId
    ? (assets || []).filter((a) => a.client_id === browseClientId)
    : [];
  const browseActive = browseAssets.filter((a) => !a.disposal_date);
  const browseDisposed = browseAssets.filter((a) => a.disposal_date);
  const browseTotalCost = browseActive.reduce((sum, a) => sum + Number(a.cost), 0);
  const browseTotalNBV = browseActive.reduce((sum, a) => sum + calculateNBV(a).nbv, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Fixed Asset Register</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Track client assets, book depreciation, and capital allowance pool classification.
            </p>
          </div>
          <div className="flex gap-3">
            <a href="/fixed-assets/report"
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Asset Report →
            </a>
            <a href="/fixed-assets/capital-allowances"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Capital Allowances Summary →
            </a>
          </div>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load assets: {error.message}
          </div>
        )}

        {/* Entry choice: Browse existing vs Add New */}
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <a href="/fixed-assets?mode=browse"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "browse" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "browse" ? "text-white" : "text-slate-900"}`}>Browse Existing</p>
            <p className={`text-sm mt-1 ${mode === "browse" ? "text-slate-300" : "text-slate-500"}`}>Find a client's active or disposed assets</p>
          </a>
          <a href="/fixed-assets?mode=new"
            className={`rounded-2xl p-6 shadow-sm border transition-all ${
              mode === "new" ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
            }`}>
            <p className={`font-bold text-lg ${mode === "new" ? "text-white" : "text-slate-900"}`}>+ New Asset</p>
            <p className={`text-sm mt-1 ${mode === "new" ? "text-slate-300" : "text-slate-500"}`}>Log a new acquisition</p>
          </a>
        </div>

        {/* BROWSE MODE */}
        {mode === "browse" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Find Client</h2>
            <form method="get" className="mt-4 flex gap-2">
              <input type="hidden" name="mode" value="browse" />
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

            {browseClientId && (
              <div className="mt-6 space-y-6">

                {/* Stats for this client */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Active Assets</p>
                    <p className="text-xl font-bold text-slate-900 mt-1">{browseActive.length}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Total Cost</p>
                    <p className="text-xl font-bold text-slate-900 mt-1">£{browseTotalCost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Net Book Value</p>
                    <p className="text-xl font-bold text-slate-900 mt-1">£{browseTotalNBV.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>

                <a href={`/fixed-assets/add?client=${browseClientId}`}
                  className="inline-block rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  + Add Asset for This Client
                </a>

                {/* Active assets */}
                <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-2">Active Assets ({browseActive.length})</h3>
                  <div className="space-y-2">
                    {browseActive.map((asset) => {
                      const { nbv } = calculateNBV(asset);
                      return (
                        <div key={asset.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                          <div>
                            <p className="font-semibold text-slate-900">{asset.description}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {asset.category || "Uncategorised"} · {asset.capital_allowance_pool} · Acquired {new Date(asset.acquisition_date).toLocaleDateString("en-GB")}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <p className="font-bold text-slate-900">£{nbv.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            <a href={`/fixed-assets/dispose?client=${browseClientId}&asset=${asset.id}`}
                              className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                              Dispose
                            </a>
                            <a href={`/fixed-assets/register?client=${browseClientId}&edit=${asset.id}`}
                              className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                              Edit
                            </a>
                          </div>
                        </div>
                      );
                    })}
                    {browseActive.length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-6">No active assets for this client.</p>
                    )}
                  </div>
                </div>

                {/* Disposed assets */}
                {browseDisposed.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-2">Disposed Assets ({browseDisposed.length})</h3>
                    <div className="space-y-2">
                      {browseDisposed.map((asset) => (
                        <div key={asset.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 opacity-70">
                          <div>
                            <p className="font-semibold text-slate-900">{asset.description}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Disposed {new Date(asset.disposal_date!).toLocaleDateString("en-GB")}
                            </p>
                          </div>
                          <p className="text-sm font-medium text-slate-600">
                            Proceeds: £{Number(asset.disposal_proceeds || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW MODE */}
        {mode === "new" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 text-center py-12">
            <p className="text-lg font-bold text-slate-900">Ready to log a new asset</p>
            <p className="text-sm text-slate-500 mt-1">You'll pick the client on the next screen.</p>
            <a href="/fixed-assets/add"
              className="inline-block mt-4 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              + Add Asset →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
