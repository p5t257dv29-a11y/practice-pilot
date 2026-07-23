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

  if (!s  if (!s  if (!s  if (!s  if  <  if (!s  if (!s  if (!s  if (!s  if  <  if (!s  i    if (!s  if (!s  if (!s  if (!s  if  <  if (!s  if  t  if (!s  if (!s  if (!s  if (!s  if  <  ifs r  if (!s  if (!s  if (!s  if (!s  if  one  if (!s  if (!s  if (!s  if 
                                        eS                                     etur  (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white bo      <div className="bg-white bo      <div className="bg-white bo   ont-bold text-slate-900">Practice Details</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Your f          Your f          Your f    account          Your f     t-fa          Your f        <          Your f          Yv           Your f          Your f         a          YoeWithId}          Your f          Your f  -6 shadow          Your f          Your f          Your f   div>
            <label className="block text-sm            <label className=b-            <*</l                  <input name="firm            <label className="block text-sm            <label className=b-            <*</l                  <input name="firm            <label className="block text-sm            <label className=b-            <*</l                  <input name="firm        k text-sm font-medium text-slate-700 mb-1">Address</label>
            <textarea name="address" rows={3} defaultValue={settings.address || ""}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                                             / trading address"                                             / trading address"                                             / trading address"                                             / trading address"                                             / trading address"                                             xt-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
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
              className="w-full rounded-xl border border-slate-2           -sm foc              className="w-full rounded-xl border bo>
              c>


             c>
ssName="w-full rounded-xl border border-slate-2           -sm foc         xtssName="w-full rounded-xl border border-slate-2           -sm foc">
            Save Changes
          </button>
        </form>
      </div>
    </div>
  );
}
