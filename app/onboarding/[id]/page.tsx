import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateChecklist(id: string, formData: FormData) {
  "use server";

  await supabase.from("onboarding_requests").update({
    id_received: formData.get("id_received") === "on",
    prev_accounts_received: formData.get("prev_accounts_received") === "on",
    signed_engagement_received: formData.get("signed_engagement_received") === "on",
    clearance_received: formData.get("clearance_received") === "on",
    status: formData.get("status") as string,
    prev_accountant_name: String(formData.get("prev_accountant_name") || ""),
    prev_accountant_firm: String(formData.get("prev_accountant_firm") || ""),
    prev_accountant_email: String(formData.get("prev_accountant_email") || ""),
    prev_accountant_address: String(formData.get("prev_accountant_address") || ""),
    notes: String(formData.get("notes") || ""),
  }).eq("id", id);

  revalidatePath(`/onboarding/${id}`);
}

async function markClientFormSent(id: string) {
  "use server";

  await supabase.from("onboarding_requests").update({
    sent_at: new Date().toISOString(),
    status: "In Progress",
  }).eq("id", id);

  revalidatePath(`/onboarding/${id}`);
}

async function markClearanceSent(id: string) {
  "use server";

  await supabase.from("onboarding_requests").update({
    clearance_sent_at: new Date().toISOString(),
  }).eq("id", id);

  revalidatePath(`/onboarding/${id}`);
}

export default async function OnboardingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: request, error } = await supabase
    .from("onboarding_requests")
    .select("*, clients(client_name, company_number, address, email)")
    .eq("id", id)
    .single();

  if (error || !request) notFound();

  const updateChecklistWithId = updateChecklist.bind(null, id);
  const markClientFormSentWithId = markClientFormSent.bind(null, id);
  const markClearanceSentWithId = markClearanceSent.bind(null, id);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const clientFormUrl = `${baseUrl}/onboard/${request.token}`;

  const completedItems = [
    request.id_received,
    request.prev_accounts_received,
    request.signed_engagement_received,
    request.clearance_received,
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/onboarding" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Onboarding
        </a>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {request.clients?.client_name || "Unknown Client"}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">{request.client_email}</p>
          </div>

          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
            request.status === "Complete" ? "bg-green-100 text-green-700"
            : request.status === "In Progress" ? "bg-blue-100 text-blue-700"
            : "bg-slate-100 text-slate-600"
          }`}>
            {request.status}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Onboarding progress</span>
            <span>{completedItems}/4 items complete</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${(completedItems / 4) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        {/* Left - Main content */}
        <div className="lg:col-span-2 space-y-6">

          {/* Client Form Link */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Client Information Form</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Send this link to the client — they fill in all their details online.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-medium text-slate-500 mb-2">Client form link:</p>
              <p className="text-sm font-mono text-blue-600 break-all">{clientFormUrl}</p>
            </div>

            <div className="mt-4 flex gap-3">
              <a
                href={clientFormUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
              >
                Preview Form →
              </a>

              {!request.sent_at ? (
                <form action={markClientFormSentWithId}>
                  <button
                    type="submit"
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                  >
                    Mark as Sent
                  </button>
                </form>
              ) : (
                <span className="rounded-xl bg-green-50 px-4 py-2 text-sm font-semibold text-green-700">
                  ✓ Sent {new Date(request.sent_at).toLocaleDateString("en-GB")}
                </span>
              )}
            </div>

            {request.completed_at && (
              <div className="mt-3 rounded-xl bg-green-50 border border-green-100 p-3">
                <p className="text-sm font-semibold text-green-700">
                  ✓ Client completed the form on {new Date(request.completed_at).toLocaleDateString("en-GB")}
                </p>
              </div>
            )}
          </div>

          {/* Professional Clearance */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Professional Clearance Letter</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Request professional clearance from the previous accountant.
            </p>

            {request.prev_accountant_firm ? (
              <>
                <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm space-y-1">
                  <p><span className="font-medium">To:</span> {request.prev_accountant_name} — {request.prev_accountant_firm}</p>
                  {request.prev_accountant_email && (
                    <p><span className="font-medium">Email:</span> {request.prev_accountant_email}</p>
                  )}
                  {request.prev_accountant_address && (
                    <p><span className="font-medium">Address:</span> {request.prev_accountant_address}</p>
                  )}
                </div>

                {/* Letter preview */}
                <div className="mt-4 rounded-xl border border-slate-200 p-5 text-sm text-slate-700 leading-relaxed bg-white">
                  <p className="font-bold text-slate-900 mb-4">Professional Clearance Request</p>
                  <p>Dear {request.prev_accountant_name || "Sir/Madam"},</p>
                  <br />
                  <p>
                    We write to inform you that <strong>{request.clients?.client_name}</strong> has
                    appointed E&P Accountancy Services Limited as their accountants and tax advisers
                    with effect from the current date.
                  </p>
                  <br />
                  <p>
                    We would be grateful if you could confirm that there are no professional reasons
                    why we should not accept this appointment, and provide us with the following
                    information:
                  </p>
                  <br />
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Copies of the last three years' accounts and tax returns</li>
                    <li>Details of any outstanding matters with HMRC</li>
                    <li>Any other information relevant to the client's tax affairs</li>
                  </ul>
                  <br />
                  <p>
                    We would appreciate your response within 21 days. Please do not hesitate to
                    contact us if you require any further information.
                  </p>
                  <br />
                  <p>Yours faithfully,</p>
                  <br />
                  <p className="font-semibold">E&P Accountancy Services Limited</p>
                </div>

                <div className="mt-4 flex gap-3">
                  {!request.clearance_sent_at ? (
                    <form action={markClearanceSentWithId}>
                      <button
                        type="submit"
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
                      >
                        Mark Clearance Letter as Sent
                      </button>
                    </form>
                  ) : (
                    <span className="rounded-xl bg-green-50 px-4 py-2 text-sm font-semibold text-green-700">
                      ✓ Sent {new Date(request.clearance_sent_at).toLocaleDateString("en-GB")}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                No previous accountant details recorded. Add them in the details panel on the right.
              </div>
            )}
          </div>

          {/* Checklist */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Onboarding Checklist</h2>

            <form action={updateChecklistWithId} className="mt-4 space-y-3">

              <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  name="id_received"
                  defaultChecked={request.id_received}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">ID Received</p>
                  <p className="text-xs text-slate-500">Passport, driving licence or other photo ID</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  name="prev_accounts_received"
                  defaultChecked={request.prev_accounts_received}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Previous Accounts Received</p>
                  <p className="text-xs text-slate-500">Last 3 years accounts and tax returns</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  name="signed_engagement_received"
                  defaultChecked={request.signed_engagement_received}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Signed Engagement Letter Received</p>
                  <p className="text-xs text-slate-500">Signed letter of engagement from client</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  name="clearance_received"
                  defaultChecked={request.clearance_received}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Professional Clearance Received</p>
                  <p className="text-xs text-slate-500">Response from previous accountant</p>
                </div>
              </label>

              <div className="pt-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select name="status" defaultValue={request.status}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Pending</option>
                  <option>In Progress</option>
                  <option>Complete</option>
                </select>
              </div>

              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Checklist
              </button>
            </form>
          </div>
        </div>

        {/* Right - Details */}
        <div className="space-y-6">

          {/* Previous Accountant */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Previous Accountant</h2>

            <form action={updateChecklistWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Contact Name</label>
                <input name="prev_accountant_name" defaultValue={request.prev_accountant_name || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. John Smith" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Firm Name</label>
                <input name="prev_accountant_firm" defaultValue={request.prev_accountant_firm || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. Smith & Co" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input name="prev_accountant_email" type="email" defaultValue={request.prev_accountant_email || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="prev@accountant.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <textarea name="prev_accountant_address" defaultValue={request.prev_accountant_address || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Full address" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={request.notes || ""} rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              {/* Hidden checkboxes to preserve values when saving from this form */}
              <input type="hidden" name="status" value={request.status} />

              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Details
              </button>
            </form>
          </div>

          {/* Client Info */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Client Info</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-slate-500">Company:</span> <span className="font-medium">{request.clients?.client_name}</span></p>
              {request.clients?.company_number && (
                <p><span className="text-slate-500">Company No:</span> <span className="font-medium">{request.clients.company_number}</span></p>
              )}
              {request.clients?.email && (
                <p><span className="text-slate-500">Email:</span> <span className="font-medium">{request.clients.email}</span></p>
              )}
              {request.clients?.address && (
                <p><span className="text-slate-500">Address:</span> <span className="font-medium">{request.clients.address}</span></p>
              )}
            </div>
            <a href={`/clients/${request.client_id}`}
              className="mt-3 block text-xs text-blue-600 hover:underline">
              View full client record →
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
