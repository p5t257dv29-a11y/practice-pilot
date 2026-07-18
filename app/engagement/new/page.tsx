import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createEngagementLetter(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { data: newLetter, error } = await supabase
    .from("engagement_letters")
    .insert({
      client_id: get("client_id"),
      client_email: get("client_email"),
      services_description: get("services_description"),
      fee_description: get("fee_description"),
      start_date: get("start_date") || null,
      partner_name: get("partner_name") || "E&P Accountancy Services Limited",
      custom_terms: get("custom_terms"),
      status: "Draft",
    })
    .select()
    .single();

  if (error || !newLetter) {
    console.error("Could not create engagement letter:", error?.message);
    return;
  }

  revalidatePath("/engagement");
  redirect(`/engagement/${newLetter.id}`);
}

export default async function NewEngagementLetterPage() {
  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name, email")
    .order("client_name", { ascending: true });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/engagement" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Engagement Letters
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">New Engagement Letter</h1>
        <p className="text-sm text-slate-500 mt-0.5">Generate a letter for digital signing.</p>
      </div>

      <div className="p-8 max-w-2xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <form action={createEngagementLetter} className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select name="client_id" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Select a client</option>
                {(clients || []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.client_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client Email *</label>
              <input name="client_email" type="email" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="client@example.com" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
              <input name="start_date" type="date"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Services to be Provided *</label>
              <textarea name="services_description" required rows={4}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. Preparation of annual accounts, Corporation Tax Return, VAT Returns (quarterly), Payroll (monthly)" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fee Description *</label>
              <textarea name="fee_description" required rows={3}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. Annual fee of £1,200 + VAT payable monthly by direct debit of £100 + VAT" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Partner/Signatory Name</label>
              <input name="partner_name" defaultValue="E&P Accountancy Services Limited"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Additional Terms (optional)</label>
              <textarea name="custom_terms" rows={3}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Any additional terms specific to this client" />
            </div>

            <button type="submit"
              className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Create Engagement Letter
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
