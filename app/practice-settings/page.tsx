import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateSettings(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("practice_settings").update({
    firm_name: get("firm_name"),
    address: get("address"),
    company_number: get("company_number"),
    phone: get("phone"),
    email: get("email"),
    website: get("website"),
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  revalidatePath("/practice-settings");
}

export default async function PracticeSettingsPage() {
  const { data: settings } = await supabase
    .from("practice_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (!settings) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="rounded-2xl bg-red-100 p-4 text-sm text-red-700">
          No practice settings row found. Run the migration to create one.
        </div>
      </div>
    );
  }

  const updateWithId = updateSettings.bind(null, settings.id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Practice Details</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Your firm's name and address, used across accounts, reports, and client-facing documents.
        </p>
      </div>

      <div className="p-8 max-w-2xl">
        <form action={updateWithId} className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Firm Name *</label>
            <input name="firm_name" required defaultValue={settings.firm_name || ""}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <textarea name="address" rows={3} defaultValue={settings.address || ""}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Registered office / trading address" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Company Number</label>
            <input name="company_number" defaultValue={settings.company_number || ""}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input name="phone" defaultValue={settings.phone || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input name="email" type="email" defaultValue={settings.email || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Website</label>
            <input name="website" defaultValue={settings.website || ""}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>

          <button type="submit"
            className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            Save Changes
          </button>
        </form>
      </div>
    </div>
  );
}