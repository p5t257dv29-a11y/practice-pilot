import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createOnboardingRequest(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { data: newRequest, error } = await supabase
    .from("onboarding_requests")
    .insert({
      client_id: get("client_id"),
      client_email: get("client_email"),
      prev_accountant_name: get("prev_accountant_name"),
      prev_accountant_firm: get("prev_accountant_firm"),
      prev_accountant_email: get("prev_accountant_email"),
      prev_accountant_address: get("prev_accountant_address"),
      notes: get("notes"),
      status: "Pending",
    })
    .select()
    .single();

  if (error || !newRequest) {
    console.error("Could not create onboarding request:", error?.message);
    return;
  }

  revalidatePath("/onboarding");
  redirect(`/onboarding/${newRequest.id}`);
}

export default async function NewOnboardingPage() {
  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name, email")
    .order("client_name", { ascending: true });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/onboarding" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Onboarding
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">New Onboarding Request</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Creates a client form link and tracks clearance.
        </p>
      </div>

      <div className="p-8 max-w-2xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <form action={createOnboardingRequest} className="space-y-4">

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

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                Previous Accountant Details
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contact Name</label>
                  <input name="prev_accountant_name"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="e.g. John Smith" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Firm Name</label>
                  <input name="prev_accountant_firm"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="e.g. Smith & Co" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input name="prev_accountant_email" type="email"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="prev@accountant.com" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                  <textarea name="prev_accountant_address" rows={2}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Full address" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea name="notes" rows={2}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Any notes" />
            </div>

            <button type="submit"
              className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Create Onboarding Request
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
