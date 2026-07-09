import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

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

// Net book value for accounts purposes — supports both straight-line and reducing balance
export function calculateNBV(asset: {
  cost: number;
  depreciation_rate_pct: number;
  depreciation_method: string;
  acquisition_date: string;
  disposal_date: string | null;
}) {
  const start = new Date(asset.acquisition_date);
  const end = asset.disposal_date ? new Date(asset.disposal_date) : new Date();
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

async function createAsset(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const client_id = get("client_id");
  const description = get("description");
  if (!client_id || !description) return;

  await supabase.from("fixed_assets").insert({
    client_id,
    job_id: get("job_id") || null,
    description,
    category: get("category") || null,
    capital_allowance_pool: get("capital_allowance_pool") || "Main Pool - AIA Eligible",
    acquisition_date: get("acquisition_date"),
    cost: parseFloat(get("cost")) || 0,
    depreciation_rate_pct: parseFloat(get("depreciation_rate_pct")) || 20,
    depreciation_method: get("depreciation_method") || "Straight Line",
    notes: get("notes") || null,
  });

  revalidatePath("/fixed-assets");
}

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

  revalidatePath("/fixed-assets");
}

async function deleteAsset(id: string) {
  "use server";
  await supabase.from("fixed_assets").delete().eq("id", id);
  revalidatePath("/fixed-assets");
}

export default async function FixedAssetsPage({
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
  const totalCost = activeAssets.reduce((sum, a) => sum + Number(a.cost), 0);
  const totalNBV = activeAssets.reduce((sum, a) => sum + calculateNBV(a).nbv, 0);

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

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Active Assets</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{activeAssets.length}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Total Cost</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">£{totalCost.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Net Book Value</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">£{totalNBV.toFixed(2)}</p>
          </div>
        </div>

        {/* Add Asset Form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Add Asset</h2>
          <form action={createAsset} className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select name="client_id" required defaultValue={clientFilter || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
              <input name="description" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. Ford Transit Van" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select name="category"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Job (optional)</label>
              <select name="job_id"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">No linked job</option>
                {(jobs || []).map((j) => (
                  <option key={j.id} value={j.id}>{(j.clients as any)?.client_name} — {j.job_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Capital Allowance Pool</label>
              <select name="capital_allowance_pool"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                {POOL_OPTIONS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Acquisition Date *</label>
              <input name="acquisition_date" type="date" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cost (£) *</label>
              <input name="cost" type="number" step="0.01" min="0" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Accounts Depreciation Rate (% p.a.)</label>
              <input name="depreciation_rate_pct" type="number" step="0.01" min="0" defaultValue="20"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Method</label>
              <select name="depreciation_method" defaultValue="Straight Line"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option>Straight Line</option>
                <option>Reducing Balance</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <input name="notes"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div className="md:col-span-3">
              <button type="submit"
                className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Add Asset
              </button>
            </div>
          </form>
        </div>

        {/* Active Assets */}
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Active Assets ({activeAssets.length})</h2>
          <div className="mt-4 space-y-2">
            {activeAssets.map((asset) => {
              const { nbv, accumulatedDepreciation } = calculateNBV(asset);
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
                      <a href={isEditing ? "/fixed-assets" : `/fixed-assets?edit=${asset.id}`}
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
              <p className="text-sm text-slate-500 text-center py-8">No active assets yet. Add your first one above.</p>
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
