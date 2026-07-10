import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { PL_CATEGORIES, BS_CATEGORIES } from "../accounts-production/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function addAccount(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const nominal_code = get("nominal_code");
  const account_name = get("account_name");
  const category = get("category");
  if (!nominal_code || !account_name || !category) return;

  await supabase.from("chart_of_accounts").insert({ nominal_code, account_name, category });
  revalidatePath("/chart-of-accounts");
}

async function updateAccount(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("chart_of_accounts").update({
    nominal_code: get("nominal_code"),
    account_name: get("account_name"),
    category: get("category"),
  }).eq("id", id);

  revalidatePath("/chart-of-accounts");
}

async function deleteAccount(id: string) {
  "use server";
  await supabase.from("chart_of_accounts").delete().eq("id", id);
  revalidatePath("/chart-of-accounts");
}

export default async function ChartOfAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;

  const { data: accounts, error } = await supabase
    .from("chart_of_accounts")
    .select("*")
    .order("nominal_code", { ascending: true });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Chart of Accounts</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Your practice-wide standard nominal codes. When uploading a trial balance, codes here auto-map to a category — you'll only need to map anything that isn't already listed.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load chart of accounts: {error.message}
          </div>
        )}

        {/* Add form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Add Nominal Code</h2>
          <form action={addAccount} className="mt-4 grid gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Code *</label>
              <input name="nominal_code" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. 7100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Account Name *</label>
              <input name="account_name" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. Rent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
              <select name="category" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select category...</option>
                <optgroup label="Profit & Loss">
                  {PL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
                <optgroup label="Balance Sheet">
                  {BS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="flex items-end">
              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Add
              </button>
            </div>
          </form>
        </div>

        {/* List */}
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Nominal Codes ({accounts?.length ?? 0})</h2>
          <div className="mt-4 space-y-1">
            {(accounts || []).map((acc) => {
              const isEditing = edit === acc.id;
              return (
                <div key={acc.id} className="rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-4 flex-1">
                      <span className="font-mono text-sm text-slate-500 w-16">{acc.nominal_code}</span>
                      <span className="text-sm font-medium text-slate-900 flex-1">{acc.account_name}</span>
                      <span className="text-xs text-slate-500">{acc.category}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={isEditing ? "/chart-of-accounts" : `/chart-of-accounts?edit=${acc.id}`}
                        className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                        {isEditing ? "Close" : "Edit"}
                      </a>
                      <form action={deleteAccount.bind(null, acc.id)}>
                        <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="border-t border-slate-100 p-3 bg-slate-50">
                      <form action={updateAccount.bind(null, acc.id)} className="grid gap-3 md:grid-cols-4">
                        <input name="nominal_code" defaultValue={acc.nominal_code}
                          className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white" />
                        <input name="account_name" defaultValue={acc.account_name}
                          className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white" />
                        <select name="category" defaultValue={acc.category}
                          className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white">
                          <optgroup label="Profit & Loss">
                            {PL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </optgroup>
                          <optgroup label="Balance Sheet">
                            {BS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </optgroup>
                        </select>
                        <button type="submit"
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                          Save
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
            {(!accounts || accounts.length === 0) && (
              <p className="text-sm text-slate-500 text-center py-8">No nominal codes yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
