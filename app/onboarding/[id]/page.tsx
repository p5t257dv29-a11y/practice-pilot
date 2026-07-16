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

  const letterDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

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
              Comprehensive handover request sent to the previous accountant.
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
                <div className="mt-4 rounded-xl border border-slate-200 p-5 text-sm text-slate-700 leading-relaxed bg-white max-h-[600px] overflow-y-auto">
                  <p className="text-xs text-slate-400 mb-4">{letterDate}</p>

                  <p className="font-bold text-slate-900 mb-4">
                    Professional Clearance and Handover Request — {request.clients?.client_name}
                  </p>

                  <p>Dear {request.prev_accountant_name || "Sir/Madam"},</p>
                  <br />
                  <p>
                    We write to inform you that <strong>{request.clients?.client_name}</strong> (&quot;the
                    Company/Client&quot;) has appointed E&amp;P Accountancy Services Limited as accountants and
                    tax advisers with effect from the current date. We understand that your firm has acted
                    as accountants and/or tax advisers to the Client up to this point.
                  </p>
                  <br />
                  <p>
                    In accordance with our professional body&apos;s ethical guidance, we would be grateful if
                    you could confirm in writing that there are no professional or other reasons why we
                    should not accept this appointment. We enclose/attach a copy of the Client&apos;s letter of
                    authority confirming that you are released from your duty of confidentiality for the
                    purposes of responding to this letter.
                  </p>
                  <br />
                  <p>
                    Once clearance is confirmed, and subject to any lien you may hold over the records
                    pending settlement of outstanding fees (please let us know if this applies, and the
                    amount outstanding), we would be grateful for the following information and
                    documentation to enable an orderly handover:
                  </p>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">1. Outstanding fees and lien</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Confirmation of any fees owed by the Client and whether these remain outstanding.</li>
                    <li>Confirmation of whether you intend to exercise a lien over any of the Client&apos;s books, records, or documents pending payment.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">2. Accounts and corporation tax</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Copies of the last three years&apos; filed statutory accounts (or since incorporation/appointment if shorter).</li>
                    <li>Copies of the last three years&apos; corporation tax computations, CT600 returns, and HMRC iXBRL-tagged accounts as filed.</li>
                    <li>Working papers, trial balances, and journals supporting the most recently filed accounts and tax computations.</li>
                    <li>Fixed asset register / capital allowances pools and computations, including any qualifying expenditure not yet claimed.</li>
                    <li>Details of any losses carried forward and their originating periods.</li>
                    <li>Details of any deferred tax balances and their calculation basis.</li>
                    <li>Directors&apos; loan account / DLA balances and movements, including any S455 tax paid or reclaimable.</li>
                    <li>Dividend vouchers and board minutes for dividends declared in the current and prior accounting periods.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">3. VAT</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>VAT registration certificate and VAT registration number.</li>
                    <li>Copies of VAT returns for the last three years, together with supporting workings.</li>
                    <li>Details of the VAT scheme used (standard, flat rate, cash accounting, annual accounting, etc.).</li>
                    <li>Confirmation of Making Tax Digital (MTD) compliance status, including software/bridging solution used and digital links in place.</li>
                    <li>Details of any partial exemption method, capital goods scheme items, or EC/overseas transactions.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">4. Payroll, CIS and pensions</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Payroll records for the current and prior tax year, including RTI submission history (FPS/EPS).</li>
                    <li>HMRC payroll (PAYE) reference and Accounts Office reference.</li>
                    <li>Copies of the most recent P60s, and any P11Ds/P11D(b) submitted, for all employees and directors.</li>
                    <li>Auto-enrolment pension details: provider, staging/duties start date, contribution rates, and next re-enrolment date.</li>
                    <li>If the Client engages subcontractors: CIS scheme details, contractor/subcontractor status, and CIS return history.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">5. HMRC references and agent authorisation</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Unique Taxpayer Reference (UTR) — corporate and, where relevant, personal.</li>
                    <li>VAT registration number, PAYE reference, and Accounts Office reference (if not already provided above).</li>
                    <li>Confirmation that you will remove/deauthorise your firm as agent on HMRC&apos;s systems (Government Gateway / Agent Services Account) once we are authorised, or confirmation of the taxes/services for which you currently hold authorisation.</li>
                    <li>Details of any HMRC online services enrolments relevant to the Client that we should be aware of.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">6. HMRC enquiries, disputes and correspondence</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Details of any current or recent HMRC enquiries, compliance checks, or disputes, including correspondence reference numbers.</li>
                    <li>Copies of any outstanding or unresolved correspondence with HMRC or Companies House.</li>
                    <li>Details of any time-to-pay arrangements, penalties, or interest currently outstanding.</li>
                    <li>Confirmation of any elections, claims, or disclaimers made on the Client&apos;s behalf that remain in effect (e.g. capital allowances disclaimers, R&amp;D claims, group relief elections).</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">7. Companies House and statutory records</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Companies House authentication code (or confirmation that this has been reset/is held by the Client).</li>
                    <li>Copies of statutory registers (members, directors, PSC, share allotments/transfers) if maintained by your firm.</li>
                    <li>Confirmation of the date of the last confirmation statement filed and any outstanding filings.</li>
                    <li>Details of any charges registered against the Company.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">8. Bookkeeping and software access</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Name of bookkeeping/accounting software used and confirmation of how administrator access will be transferred — we would ask that this be actioned via the software provider&apos;s own organisation-transfer process rather than by sharing login credentials directly.</li>
                    <li>Export or access to the full transaction history and chart of accounts, where the subscription will not be transferred.</li>
                    <li>Details of any linked apps, bank feeds, or add-ons in use.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">9. Anti-money laundering and client due diligence</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Confirmation of the identification and verification documents held on file, so that we can assess whether further due diligence is required.</li>
                  </ul>

                  <p className="font-semibold text-slate-900 mt-4 mb-1 underline">10. Related parties and other engagements</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Details of any related entities, group companies, or connected persons for which your firm also acts, where relevant to the Client&apos;s tax affairs.</li>
                    <li>Confirmation of any other services provided to the Client and the status of those engagements.</li>
                    <li>Any other information you consider relevant to the proper conduct of the Client&apos;s tax and accounting affairs going forward.</li>
                  </ul>

                  <br />
                  <p>
                    We would be grateful for your professional clearance response and the above
                    information within 21 days of the date of this letter. If any of the above will take
                    longer to compile, please let us know so that we can agree a reasonable timetable.
                  </p>
                  <br />
                  <p>
                    Please do not hesitate to contact us if you require any further information, or if
                    you would find it helpful to discuss the handover directly.
                  </p>
                  <br />
                  <p>Yours faithfully,</p>
                  <br />
                  <p className="font-semibold">E&amp;P Accountancy Services Limited</p>
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
