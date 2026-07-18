import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
  revalidatePath("/fixed-assets/register");
  redirect(`/fixed-assets/register${client_id ? `?client=${client_id}` : ""}`);
}

export default async function AddAssetPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: clientFilter } = await searchParams;

  const [{ data: clients }, { data: jobs }] = await Promise.all([
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("jobs").select("id, job_name, client_id, clients(client_name)").order("job_name", { ascending: true }),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/fixed-assets" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Fixed Assets
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Add Asset</h1>
        <p className="text-sm text-slate-500 mt-0.5">Log a new fixed asset acquisition.</p>
      </div>

      <div className="p-8 max-w-4xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <form action={createAsset} className="grid gap-4 md:grid-cols-3">
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
      </div>
    </div>
  );
}
