import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { calculateNBV } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const POOL_OPTIONS = [
  "Main Pool - AIA Eligible",
  "Special Rate Pool - AIA Eligible",
  "Main Pool - Car (not AIA eligible)",
  "Special Rate Pool - Car (not AIA eligible)",
  "Zero Emission Car (100% FYA)",
];

const CATEGORY_OPTIONS = [
  "Plant & Machinery",
  "Computer Equipment",
  "Motor Vehicles",
  "Fixtures & Fittings",
  "Integral Features",
  "Office Equipment",
  "Other",
];

async function updateAsset(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("fixed_assets").update({
    description: get("description"),
    job_id: get("job_id") || null,
    category: get("category") || null,
    capital_allowance_pool: get("capital_allowance_pool"),
    acquisition_date: get("acquisition_date"),
    cost: parseFloat(get("cost")) || 0,
    depreciation_rate_pct: parseFloat(get("depreciation_rate_pct")) || 20,
    depreciation_method: get("depreciation_method") || "Straight Line",
    disposal_date: get("disposal_date") || null,
    disposal_proceeds: get("disposal_proceeds") ? parseFloat(get("disposal_proceeds")) : null,
    notes: get("notes") || null,
  }).eq("id", id);

  revalidatePath("/fixed-assets/register");
  revalidatePath("/fixed-assets");
}

async function deleteAsset(id: string) {
  "use server";
  await supabase.from("fixed_assets").delete().eq("id", id);
  revalidatePath("/fixed-assets/register");
  revalidatePath("/fixed-assets");
}

export default async function FixedAssetsRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; edit?: string }>;
}) {
  const { client: clientFilter, edit } = await searchParams;

  const [{ data: assets, error }, { data: clients }, { data: jobs }] = await Promise.all([
    supabase
      .from("fixed_assets")
      .select("*, clients(client_name), jobs(job_name)")
      .order("acquisition_date", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, job_name, client_id, clients(client_name)")
      .order("job_name", { ascending: true }),
  ]);

  const filteredAssets = clientFilter
    ? (assets || []).filter((a) => a.client_id === clientFilter)
    : (assets || []);

  const activeAssets = filteredAssets.filter((a) => !a.disposal_date);
  const disposedAssets = filteredAssets.filter((a) => a.disposal_date);

  const qs = clientFilter ? `?client=${clientFilter}` : "";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/fixed-assets" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Fixed Assets
        </a>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Asset Register</h1>
            <p className="text-sm text-slate-500 mt-0.5">Full list of active and disposed assets.</p>
          </div>
          <a href={`/fixed-assets/add${qs}`}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            + Add Asset
          </a>
        </div>

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

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load assets: {error.message}
          </div>
        )}

        {/* Active Assets */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Active Assets ({activeAssets.length})</h2>
          <div className="mt-4 space-y-2">
            {activeAssets.map((asset) => {
              const { nbv } = calculateNBV(asset);
              const isEditing = edit === asset.id;

              return (
                <div key={asset.id} className="rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between p-4">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">{asset.description}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {asset.clients?.client_name || "No client"} · {asset.category || "Uncategorised"} · {asset.capital_allowance_pool}
                        {asset.jobs?.job_name && ` · Job: ${asset.jobs.job_name}`}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Acquired {new Date(asset.acquisition_date).toLocaleDateString("en-GB")} · {asset.depreciation_method || "Straight Line"} @ {asset.depreciation_rate_pct}%
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-bold text-slate-900">£{nbv.toFixed(2)}</p>
                        <p className="text-xs text-slate-400">NBV (cost £{Number(asset.cost).toFixed(2)})</p>
                      </div>
                      <a href={isEditing ? `/fixed-assets/register${qs}` : `/fixed-assets/register${qs}${qs ? "&" : "?"}edit=${asset.id}`}
                        className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                        {isEditing ? "Close" : "Edit"}
                      </a>
                      <form action={deleteAsset.bind(null, asset.id)}>
                        <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50">
                      <form action={updateAsset.bind(null, asset.id)} className="grid gap-4 md:grid-cols-3">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                          <input name="description" required defaultValue={asset.description}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                          <select name="category" defaultValue={asset.category || ""}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white">
                            {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Job (optional)</label>
                          <select name="job_id" defaultValue={asset.job_id || ""}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white">
                            <option value="">No linked job</option>
                            {(jobs || []).map((j) => (
                              <option key={j.id} value={j.id}>{(j.clients as any)?.client_name} — {j.job_name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Capital Allowance Pool</label>
                          <select name="capital_allowance_pool" defaultValue={asset.capital_allowance_pool}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white">
                            {POOL_OPTIONS.map((p) => <option key={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Acquisition Date</label>
                          <input name="acquisition_date" type="date" defaultValue={asset.acquisition_date}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Cost (£)</label>
                          <input name="cost" type="number" step="0.01" min="0" defaultValue={asset.cost}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Rate (%)</label>
                          <input name="depreciation_rate_pct" type="number" step="0.01" min="0" defaultValue={asset.depreciation_rate_pct}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Method</label>
                          <select name="depreciation_method" defaultValue={asset.depreciation_method || "Straight Line"}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white">
                            <option>Straight Line</option>
                            <option>Reducing Balance</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Disposal Date</label>
                          <input name="disposal_date" type="date" defaultValue={asset.disposal_date || ""}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Disposal Proceeds (£)</label>
                          <input name="disposal_proceeds" type="number" step="0.01" min="0" defaultValue={asset.disposal_proceeds || ""}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white" />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                          <input name="notes" defaultValue={asset.notes || ""}
                            className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white" />
                        </div>
                        <div className="md:col-span-3">
                          <button type="submit"
                            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                            Save Changes
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}

            {activeAssets.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No active assets yet.</p>
            )}
          </div>
        </div>

        {/* Disposed Assets */}
        {disposedAssets.length > 0 && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Disposed Assets ({disposedAssets.length})</h2>
            <div className="mt-4 space-y-2">
              {disposedAssets.map((asset) => (
                <div key={asset.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 opacity-60">
                  <div>
                    <p className="font-semibold text-slate-900">{asset.description}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {asset.clients?.client_name || "No client"} · Disposed {new Date(asset.disposal_date!).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-slate-600">
                    Proceeds: £{Number(asset.disposal_proceeds || 0).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
