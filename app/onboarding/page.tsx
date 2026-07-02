import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createOnboardingRequest(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { error } = await supabase.from("onboarding_requests").insert({
    client_id: get("client_id"),
    client_email: get("client_email"),
    prev_accountant_name: get("prev_accountant_name"),
    prev_accountant_firm: get("prev_accountant_firm"),
    prev_accountant_email: get("prev_accountant_email"),
    prev_accountant_address: get("prev_accountant_address"),
    notes: get("notes"),
    status: "Pending",
  });

  if (error) {
    console.error("Could not create onboarding request:", error.message);
    return;
  }

  revalidatePath("/onboarding");
}

async function deleteOnboardingRequest(id: string) {
  "use server";

  await supabase.from("onboarding_requests").delete().eq("id", id);
  revalidatePath("/onboarding");
}

export default async function OnboardingPage() {
  const [{ data: requests, error }, { data: clients }] = await Promise.all([
    supabase
      .from("onboarding_requests")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name, email")
      .order("client_name", { ascending: true }),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Onboarding</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage new client onboarding and professional clearance requests.
          </p>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load onboarding requests: {error.message}
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-3">

          {/* New Request Form */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 sticky top-8">
              <h2 className="text-lg font-bold text-slate-900">New Onboarding Request</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Creates a client form link and tracks clearance.
              </p>

              <form action={createOnboardingRequest} className="mt-6 space-y-4">

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

          {/* Requests List */}
          <div className="lg:col-span-2 space-y-4">

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 text-center">
                <p className="text-2xl font-bold text-slate-900">
                  {requests?.filter(r => r.status === "Pending").length ?? 0}
                </p>
                <p className="text-xs text-slate-500 mt-1">Pending</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 text-center">
                <p className="text-2xl font-bold text-blue-600">
                  {requests?.filter(r => r.status === "In Progress").length ?? 0}
                </p>
                <p className="text-xs text-slate-500 mt-1">In Progress</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {requests?.filter(r => r.status === "Complete").length ?? 0}
                </p>
                <p className="text-xs text-slate-500 mt-1">Complete</p>
              </div>
            </div>

            {/* List */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                All Requests ({requests?.length ?? 0})
              </h2>

              <div className="mt-4 space-y-3">
                {(requests || []).map((request) => (
                  <div key={request.id}
                    className="rounded-xl border border-slate-100 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <a href={`/onboarding/${request.id}`}
                            className="font-semibold text-slate-900 hover:text-blue-600 transition-colors">
                            {request.clients?.client_name || "Unknown Client"}
                          </a>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            request.status === "Complete" ? "bg-green-100 text-green-700"
                            : request.status === "In Progress" ? "bg-blue-100 text-blue-700"
                            : "bg-slate-100 text-slate-600"
                          }`}>
                            {request.status}
                          </span>
                        </div>

                        <p className="text-sm text-slate-500 mt-0.5">
                          {request.client_email || "No email"}
                        </p>

                        <div className="mt-2 flex gap-4 text-xs text-slate-400">
                          <span>
                            📋 Client form: {request.completed_at
                              ? <span className="text-green-600 font-medium">Completed</span>
                              : request.sent_at
                              ? <span className="text-blue-600 font-medium">Sent</span>
                              : <span>Not sent</span>}
                          </span>
                          <span>
                            📨 Clearance: {request.clearance_received
                              ? <span className="text-green-600 font-medium">Received</span>
                              : request.clearance_sent_at
                              ? <span className="text-blue-600 font-medium">Sent</span>
                              : <span>Not sent</span>}
                          </span>
                        </div>

                        {/* Checklist indicators */}
                        <div className="mt-2 flex gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${request.id_received ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                            ID {request.id_received ? "✓" : "○"}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${request.prev_accounts_received ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                            Prev Accounts {request.prev_accounts_received ? "✓" : "○"}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${request.signed_engagement_received ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                            Engagement Letter {request.signed_engagement_received ? "✓" : "○"}
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-2 ml-4">
                        <a href={`/onboarding/${request.id}`}
                          className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                          Manage
                        </a>
                        <form action={deleteOnboardingRequest.bind(null, request.id)}>
                          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                ))}

                {requests && requests.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No onboarding requests yet. Create your first one above.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
