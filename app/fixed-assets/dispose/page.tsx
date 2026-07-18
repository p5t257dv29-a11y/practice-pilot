import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { calculateNBV } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Only ever touches disposal_date / disposal_proceeds — deliberately not reusing
// the full updateAsset action, so this form can't accidentally blank out cost,
// description, category etc. by only rendering the two disposal fields.
async function disposeAsset(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("fixed_assets").update({
    disposal_date: get("disposal_date") || null,
    disposal_proceeds: get("disposal_proceeds") ? parseFloat(get("disposal_proceeds")) : null,
  }).eq("id", id);

  revalidatePath("/fixed-assets/dispose");
  revalidatePath("/fixed-assets/register");
  revalidatePath("/fixed-assets");
}

async function clearDisposal(id: string) {
  "use server";
  await supabase.from("fixed_assets").update({
    disposal_date: null,
    disposal_proceeds: null,
  }).eq("id", id);

  revalidatePath("/fixed-assets/dispose");
  revalidatePath("/fixed-assets/register");
  revalidatePath("/fixed-assets");
}

export default async function DisposeAssetPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; asset?: string }>;
}) {
  const { client: clientFilter, asset: selectedAssetId } = await searchParams;

  const [{ data: assets }, { data: clients }] = await Promise.all([
    supabase
      .from("fixed_assets")
      .select("*, clients(client_name)")
      .order("description", { ascending: true }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  const filtered = clientFilter
    ? (assets || []).filter((a) => a.client_id === clientFilter)
    : (assets || []);

  const activeAssets = filtered.filter((a) => !a.disposal_date);
  const recentlyDisposed = filtered.filter((a) => a.disposal_date).slice(0, 5);

  const qs = clientFilter ? `?client=${clientFilter}` : "";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/fixed-assets" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Fixed Assets
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Dispose Asset</h1>
        <p className="text-sm text-slate-500 mt-0.5">Select an active asset to record its disposal.</p>

        <div className="mt-4">
          <form method="get" className="flex gap-2">
            <select name="client" defaultValue={clientFilter || ""}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
              <option value="">All clients</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.client_name}</option>
              ))}
            </select>
            <button type="submit"
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
              Filter
            </button>
          </form>
        </div>
      </div>

      <div className="p-8 max-w-3xl space-y-6">

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Active Assets ({activeAssets.length})</h2>
          <div className="mt-4 space-y-2">
            {activeAssets.map((asset) => {
              const { nbv } = calculateNBV(asset);
              const isSelected = selectedAssetId === asset.id;

              return (
                <div key={asset.id} className="rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-semibold text-slate-900">{asset.description}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {asset.clients?.client_name || "No client"} · NBV £{nbv.toFixed(2)} · Acquired {new Date(asset.acquisition_date).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                    <a
                      href={isSelected ? `/fixed-assets/dispose${qs}` : `/fixed-assets/dispose${qs}${qs ? "&" : "?"}asset=${asset.id}`}
                      className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors flex-shrink-0"
                    >
                      {isSelected ? "Close" : "Dispose"}
                    </a>
                  </div>

                  {isSelected && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50">
                      <form action={disposeAsset.bind(null, asset.id)} className="flex flex-wrap gap-4 items-end">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Disposal Date *</label>
                          <input name="disposal_date" type="date" required
                            className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Disposal Proceeds (£)</label>
                          <input name="disposal_proceeds" type="number" step="0.01" min="0"
                            className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
                        </div>
                        <button type="submit"
                          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                          Confirm Disposal
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
            {activeAssets.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No active assets to dispose.</p>
            )}
          </div>
        </div>

        {recentlyDisposed.length > 0 && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Recently Disposed</h2>
            <div className="mt-4 space-y-2">
              {recentlyDisposed.map((asset) => (
                <div key={asset.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 opacity-70">
                  <div>
                    <p className="font-semibold text-slate-900">{asset.description}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {asset.clients?.client_name || "No client"} · Disposed {new Date(asset.disposal_date!).toLocaleDateString("en-GB")} · Proceeds £{Number(asset.disposal_proceeds || 0).toFixed(2)}
                    </p>
                  </div>
                  <form action={clearDisposal.bind(null, asset.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Undo
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
