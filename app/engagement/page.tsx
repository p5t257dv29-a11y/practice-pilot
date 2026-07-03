import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createEngagementLetter(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { error } = await supabase.from("engagement_letters").insert({
    client_id: get("client_id"),
    client_email: get("client_email"),
    services_description: get("services_description"),
    fee_description: get("fee_description"),
    start_date: get("start_date") || null,
    partner_name: get("partner_name") || "E&P Accountancy Services Limited",
    custom_terms: get("custom_terms"),
    status: "Draft",
  });

  if (error) {
    console.error("Could not create engagement letter:", error.message);
    return;
  }

  revalidatePath("/engagement");
}

async function deleteEngagementLetter(id: string) {
  "use server";

  await supabase.from("engagement_letters").delete().eq("id", id);
  revalidatePath("/engagement");
}

export default async function EngagementPage() {
  const [{ data: letters, error }, { data: clients }] = await Promise.all([
    supabase
      .from("engagement_letters")
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
          <h1 className="text-2xl font-bold text-slate-900">Engagement Letters</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Create and send letters of engagement for digital signing.
          </p>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load engagement letters: {error.message}
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-3">

          {/* New Letter Form */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 sticky top-8">
              <h2 className="text-lg font-bold text-slate-900">New Engagement Letter</h2>
              <p className="text-sm text-slate-500 mt-0.5">Generate a letter for digital signing.</p>

              <form action={createEngagementLetter} className="mt-6 space-y-4">

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

          {/* Letters List */}
          <div className="lg:col-span-2 space-y-4">

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 text-center">
                <p className="text-2xl font-bold text-slate-900">
                  {letters?.filter(l => l.status === "Draft").length ?? 0}
                </p>
                <p className="text-xs text-slate-500 mt-1">Draft</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 text-center">
                <p className="text-2xl font-bold text-blue-600">
                  {letters?.filter(l => l.status === "Sent").length ?? 0}
                </p>
                <p className="text-xs text-slate-500 mt-1">Sent</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {letters?.filter(l => l.status === "Signed").length ?? 0}
                </p>
                <p className="text-xs text-slate-500 mt-1">Signed</p>
              </div>
            </div>

            {/* List */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                All Letters ({letters?.length ?? 0})
              </h2>

              <div className="mt-4 space-y-3">
                {(letters || []).map((letter) => (
                  <div key={letter.id} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <a href={`/engagement/${letter.id}`}
                            className="font-semibold text-slate-900 hover:text-blue-600 transition-colors">
                            {letter.clients?.client_name || "Unknown Client"}
                          </a>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            letter.status === "Signed" ? "bg-green-100 text-green-700"
                            : letter.status === "Sent" ? "bg-blue-100 text-blue-700"
                            : "bg-slate-100 text-slate-600"
                          }`}>
                            {letter.status}
                          </span>
                        </div>

                        <p className="text-sm text-slate-500 mt-0.5">{letter.client_email}</p>

                        <div className="mt-1 flex gap-4 text-xs text-slate-400">
                          {letter.start_date && (
                            <span>Start: {new Date(letter.start_date).toLocaleDateString("en-GB")}</span>
                          )}
                          {letter.sent_at && (
                            <span>Sent: {new Date(letter.sent_at).toLocaleDateString("en-GB")}</span>
                          )}
                          {letter.signed_at && (
                            <span className="text-green-600">✓ Signed: {new Date(letter.signed_at).toLocaleDateString("en-GB")}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 ml-4">
                        <a href={`/engagement/${letter.id}`}
                          className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                          Manage
                        </a>
                        <form action={deleteEngagementLetter.bind(null, letter.id)}>
                          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                ))}

                {letters && letters.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No engagement letters yet. Create your first one above.
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
