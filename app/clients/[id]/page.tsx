import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateClientRecord(id: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("clients").update({
    client_name: get("client_name"),
    entity_type: get("entity_type"),
    company_number: get("company_number"),
    year_end: get("year_end") || null,
    address: get("address"),
    primary_contact: get("primary_contact"),
    secondary_contact: get("secondary_contact"),
    email: get("email"),
    phone: get("phone"),
    hmrc_utr: get("hmrc_utr"),
    corporation_tax_reference: get("corporation_tax_reference"),
    vat_number: get("vat_number"),
    paye_reference: get("paye_reference"),
    accounts_office_reference: get("accounts_office_reference"),
    payroll_contact: get("payroll_contact"),
    industry: get("industry"),
    bookkeeping_software: get("bookkeeping_software"),
    bank_name: get("bank_name"),
    sort_code: get("sort_code"),
    bank_account_number: get("bank_account_number"),
    onboarding_status: get("onboarding_status"),
    authentication_notes: get("authentication_notes"),
    notes: get("notes"),
    requires_self_assessment: formData.get("requires_self_assessment") === "on",
    vat_stagger_group: get("vat_stagger_group") || null,
    assigned_staff: get("assigned_staff") || null,
  }).eq("id", id);

  revalidatePath(`/clients/${id}`);
}

async function addShareholding(clientId: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("company_shareholdings").insert({
    client_id: clientId,
    shareholder_name: get("shareholder_name"),
    share_class: get("share_class"),
    num_shares: parseFloat(get("num_shares")) || 0,
    percentage: parseFloat(get("percentage")) || 0,
    currency: get("currency") || "GBP",
  });

  revalidatePath(`/clients/${clientId}`);
}

async function deleteShareholding(clientId: string, id: string) {
  "use server";

  await supabase.from("company_shareholdings").delete().eq("id", id);
  revalidatePath(`/clients/${clientId}`);
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "details" } = await searchParams;

  const [
    { data: client, error },
    { data: officers },
    { data: pscs },
    { data: shareholdings },
    { data: staff },
    { data: jobs },
    { data: quotes },
    { data: invoices },
    { data: engagementLetters },
    { data: taxComputations },
    { data: ctComputations },
    { data: fixedAssets },
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase.from("company_officers").select("*").eq("client_id", id).order("is_active", { ascending: false }),
    supabase.from("company_pscs").select("*").eq("client_id", id).order("is_active", { ascending: false }),
    supabase.from("company_shareholdings").select("*").eq("client_id", id).order("created_at", { ascending: true }),
    supabase.from("staff").select("id, name").eq("is_active", true).order("name", { ascending: true }),
    supabase.from("jobs").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("quotes").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("invoices").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("engagement_letters").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("tax_computations").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("corporation_tax_computations").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("fixed_assets").select("*").eq("client_id", id).order("acquisition_date", { ascending: false }),
  ]);

  if (error || !client) notFound();

  const updateWithId = updateClientRecord.bind(null, id);
  const addShareholdingWithId = addShareholding.bind(null, id);

  const activeJobs = (jobs || []).filter((j) => j.status !== "Completed" && j.status !== "Cancelled");
  const historicalJobs = (jobs || []).filter((j) => j.status === "Completed" || j.status === "Cancelled");

  const tabs = [
    { key: "details", label: "Details" },
    { key: "jobs", label: `Jobs (${jobs?.length ?? 0})` },
    { key: "quotes", label: `Quotes (${quotes?.length ?? 0})` },
    { key: "invoices", label: `Invoices (${invoices?.length ?? 0})` },
    { key: "engagement", label: `Engagement (${engagementLetters?.length ?? 0})` },
    { key: "tax", label: `Tax (${(taxComputations?.length ?? 0) + (ctComputations?.length ?? 0)})` },
    { key: "assets", label: `Fixed Assets (${fixedAssets?.length ?? 0})` },
    { key: "directors", label: `Directors (${officers?.filter(o => o.is_active).length ?? 0})` },
    { key: "pscs", label: `PSCs (${pscs?.filter(p => p.is_active).length ?? 0})` },
    { key: "shareholdings", label: `Shareholdings (${shareholdings?.length ?? 0})` },
  ];

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/clients" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Clients
        </a>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{client.client_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {client.client_ref && (
                <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 mr-2">
                  {client.client_ref}
                </span>
              )}
              {client.entity_type || "No entity type"} · {client.company_number || "No company number"}
              {client.company_status && (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                  client.company_status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                }`}>
                  {client.company_status}
                </span>
              )}
            </p>
          </div>

          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
            client.onboarding_status === "Active Client" ? "bg-green-100 text-green-700"
            : client.onboarding_status === "Prospect" ? "bg-blue-100 text-blue-700"
            : client.onboarding_status === "Onboarding" ? "bg-yellow-100 text-yellow-700"
            : "bg-slate-100 text-slate-600"
          }`}>
            {client.onboarding_status || "Unknown"}
          </span>
        </div>

        {/* Filing deadlines bar */}
        {(client.accounts_next_due || client.confirmation_statement_next_due) && (
          <div className="mt-4 flex gap-6 text-sm">
            {client.accounts_next_due && (
              <div>
                <span className="text-slate-500">Accounts due: </span>
                <span className="font-semibold text-slate-900">
                  {new Date(client.accounts_next_due).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            )}
            {client.confirmation_statement_next_due && (
              <div>
                <span className="text-slate-500">Confirmation statement due: </span>
                <span className="font-semibold text-slate-900">
                  {new Date(client.confirmation_statement_next_due).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 flex gap-1">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`/clients/${id}?tab=${t.key}`}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </a>
          ))}
        </div>
      </div>

      <div className="p-8">

        {/* DETAILS TAB */}
        {tab === "details" && (
          <form action={updateWithId} className="space-y-6">

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Basic Information</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Client Name *</label>
                  <input name="client_name" defaultValue={client.client_name || ""} required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
                  <select name="entity_type" defaultValue={client.entity_type || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select entity type</option>
                    <option>Limited Company</option>
                    <option>Sole Trader</option>
                    <option>Partnership</option>
                    <option>LLP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Company Number</label>
                  <input name="company_number" defaultValue={client.company_number || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Year End</label>
                  <input name="year_end" type="date" defaultValue={client.year_end || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Registered Address</label>
                  <textarea name="address" defaultValue={client.address || ""} rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
                  <input name="industry" defaultValue={client.industry || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bookkeeping Software</label>
                  <input name="bookkeeping_software" defaultValue={client.bookkeeping_software || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Onboarding Status</label>
                  <select name="onboarding_status" defaultValue={client.onboarding_status || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option>Prospect</option>
                    <option>Onboarding</option>
                    <option>Active Client</option>
                    <option>Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Account Manager</label>
                  <select name="assigned_staff" defaultValue={client.assigned_staff || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Unassigned</option>
                    {(staff || []).map((member) => (
                      <option key={member.id} value={member.name}>{member.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Tax Deadline Settings — NEW SECTION */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Tax Deadline Settings</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Controls which recurring deadlines appear for this client (useful for sole traders, partnerships, and other non-Companies-House entities).
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="flex items-center gap-3 md:col-span-2">
                  <input
                    type="checkbox"
                    id="requires_self_assessment"
                    name="requires_self_assessment"
                    defaultChecked={client.requires_self_assessment || false}
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  <label htmlFor="requires_self_assessment" className="text-sm font-medium text-slate-700">
                    Requires Self Assessment (shows next 31 January deadline)
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VAT Quarter Group</label>
                  <select name="vat_stagger_group" defaultValue={client.vat_stagger_group || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Not VAT registered / not applicable</option>
                    <option value="Jan/Apr/Jul/Oct">Jan / Apr / Jul / Oct</option>
                    <option value="Feb/May/Aug/Nov">Feb / May / Aug / Nov</option>
                    <option value="Mar/Jun/Sep/Dec">Mar / Jun / Sep / Dec</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Payroll reminders show automatically whenever a PAYE Reference is set below (monthly, due 22nd).
              </p>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Contact Information</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Primary Contact</label>
                  <input name="primary_contact" defaultValue={client.primary_contact || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Secondary Contact</label>
                  <input name="secondary_contact" defaultValue={client.secondary_contact || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input name="email" type="email" defaultValue={client.email || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                  <input name="phone" defaultValue={client.phone || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payroll Contact</label>
                  <input name="payroll_contact" defaultValue={client.payroll_contact || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">HMRC & Tax References</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">HMRC UTR</label>
                  <input name="hmrc_utr" defaultValue={client.hmrc_utr || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Corporation Tax Reference</label>
                  <input name="corporation_tax_reference" defaultValue={client.corporation_tax_reference || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VAT Number</label>
                  <input name="vat_number" defaultValue={client.vat_number || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">PAYE Reference</label>
                  <input name="paye_reference" defaultValue={client.paye_reference || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Accounts Office Reference</label>
                  <input name="accounts_office_reference" defaultValue={client.accounts_office_reference || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Banking Details</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label>
                  <input name="bank_name" defaultValue={client.bank_name || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sort Code</label>
                  <input name="sort_code" defaultValue={client.sort_code || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Account Number</label>
                  <input name="bank_account_number" defaultValue={client.bank_account_number || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Notes</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Authentication Notes</label>
                  <textarea name="authentication_notes" defaultValue={client.authentication_notes || ""} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Gateway credentials, security questions, etc." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">General Notes</label>
                  <textarea name="notes" defaultValue={client.notes || ""} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>
            </div>

            <button type="submit" className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Save Changes
            </button>
          </form>
        )}

        {/* JOBS TAB */}
        {tab === "jobs" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Active Jobs ({activeJobs.length})</h2>
                <a href="/jobs"
                  className="text-xs font-semibold text-blue-600 hover:underline">
                  View all jobs →
                </a>
              </div>
              <div className="mt-4 space-y-2">
                {activeJobs.map((job) => (
                  <a key={job.id} href={`/jobs/${job.id}`}
                    className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{job.job_name}</p>
                        {job.is_recurring && (
                          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600 font-medium">
                            ↻ {job.recurrence_frequency}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5">
                        {job.job_type || "No type"}
                        {job.due_date && ` · Due ${new Date(job.due_date).toLocaleDateString("en-GB")}`}
                        {job.assigned_to && ` · ${job.assigned_to}`}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      job.status === "Active" ? "bg-green-100 text-green-700"
                      : job.status === "On Hold" ? "bg-yellow-100 text-yellow-700"
                      : "bg-slate-100 text-slate-600"
                    }`}>
                      {job.status || "Draft"}
                    </span>
                  </a>
                ))}
                {activeJobs.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-6">No active jobs for this client.</p>
                )}
              </div>
            </div>

            {historicalJobs.length > 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Historical Jobs ({historicalJobs.length})</h2>
                <div className="mt-4 space-y-2">
                  {historicalJobs.map((job) => (
                    <a key={job.id} href={`/jobs/${job.id}`}
                      className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors opacity-70">
                      <div>
                        <p className="font-semibold text-slate-900">{job.job_name}</p>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {job.job_type || "No type"}
                          {job.due_date && ` · Due ${new Date(job.due_date).toLocaleDateString("en-GB")}`}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        job.status === "Completed" ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"
                      }`}>
                        {job.status}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* QUOTES TAB */}
        {tab === "quotes" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Quotes ({quotes?.length ?? 0})</h2>
              <a href="/quotes" className="text-xs font-semibold text-blue-600 hover:underline">View all quotes →</a>
            </div>
            <div className="mt-4 space-y-2">
              {(quotes || []).map((quote) => (
                <a key={quote.id} href={`/quotes/${quote.id}`}
                  className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="font-semibold text-slate-900">{quote.quote_number}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {quote.quote_date ? new Date(quote.quote_date).toLocaleDateString("en-GB") : "No date"}
                      {quote.valid_until && ` · Valid until ${new Date(quote.valid_until).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-bold text-slate-900">£{Number(quote.total || 0).toFixed(2)}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      quote.status === "Accepted" ? "bg-green-100 text-green-700"
                      : quote.status === "Sent" ? "bg-blue-100 text-blue-700"
                      : quote.status === "Declined" ? "bg-red-100 text-red-700"
                      : "bg-slate-100 text-slate-600"
                    }`}>
                      {quote.status || "Draft"}
                    </span>
                  </div>
                </a>
              ))}
              {(!quotes || quotes.length === 0) && (
                <p className="text-sm text-slate-500 text-center py-6">No quotes for this client yet.</p>
              )}
            </div>
          </div>
        )}

        {/* INVOICES TAB */}
        {tab === "invoices" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Invoices ({invoices?.length ?? 0})</h2>
              <a href="/invoices" className="text-xs font-semibold text-blue-600 hover:underline">View all invoices →</a>
            </div>
            <div className="mt-4 space-y-2">
              {(invoices || []).map((invoice) => (
                <a key={invoice.id} href="/invoices"
                  className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="font-semibold text-slate-900">{invoice.invoice_number || invoice.number || "Invoice"}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString("en-GB") : "No date"}
                      {invoice.due_date && ` · Due ${new Date(invoice.due_date).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-bold text-slate-900">£{Number(invoice.total || 0).toFixed(2)}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      invoice.status === "Paid" ? "bg-green-100 text-green-700"
                      : invoice.status === "Sent" ? "bg-blue-100 text-blue-700"
                      : invoice.status === "Overdue" ? "bg-red-100 text-red-700"
                      : "bg-slate-100 text-slate-600"
                    }`}>
                      {invoice.status || "Draft"}
                    </span>
                  </div>
                </a>
              ))}
              {(!invoices || invoices.length === 0) && (
                <p className="text-sm text-slate-500 text-center py-6">No invoices for this client yet.</p>
              )}
            </div>
          </div>
        )}

        {/* ENGAGEMENT TAB */}
        {tab === "engagement" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Engagement Letters ({engagementLetters?.length ?? 0})</h2>
              <a href="/engagement" className="text-xs font-semibold text-blue-600 hover:underline">View all engagement letters →</a>
            </div>
            <div className="mt-4 space-y-2">
              {(engagementLetters || []).map((letter) => (
                <a key={letter.id} href="/engagement"
                  className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {letter.start_date ? new Date(letter.start_date).toLocaleDateString("en-GB") : "Engagement Letter"}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">
                      {letter.services_description ? letter.services_description.split("\n")[0] : "No services listed"}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    letter.status === "Signed" ? "bg-green-100 text-green-700"
                    : letter.status === "Sent" ? "bg-blue-100 text-blue-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {letter.status || "Draft"}
                  </span>
                </a>
              ))}
              {(!engagementLetters || engagementLetters.length === 0) && (
                <p className="text-sm text-slate-500 text-center py-6">No engagement letters for this client yet.</p>
              )}
            </div>
          </div>
        )}

        {/* TAX TAB — personal + corporation tax computations */}
        {tab === "tax" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Personal Tax Computations ({taxComputations?.length ?? 0})</h2>
                <a href="/tax" className="text-xs font-semibold text-blue-600 hover:underline">View all →</a>
              </div>
              <div className="mt-4 space-y-2">
                {(taxComputations || []).map((comp) => (
                  <a key={comp.id} href={`/tax/${comp.id}`}
                    className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                    <p className="font-semibold text-slate-900">Tax Year {comp.tax_year}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      comp.status === "Approved" ? "bg-green-100 text-green-700"
                      : comp.status === "Sent" ? "bg-blue-100 text-blue-700"
                      : comp.status === "Queried" ? "bg-yellow-100 text-yellow-700"
                      : "bg-slate-100 text-slate-600"
                    }`}>
                      {comp.status || "Draft"}
                    </span>
                  </a>
                ))}
                {(!taxComputations || taxComputations.length === 0) && (
                  <p className="text-sm text-slate-500 text-center py-6">No personal tax computations yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Corporation Tax Computations ({ctComputations?.length ?? 0})</h2>
                <a href="/corporation-tax" className="text-xs font-semibold text-blue-600 hover:underline">View all →</a>
              </div>
              <div className="mt-4 space-y-2">
                {(ctComputations || []).map((comp) => (
                  <a key={comp.id} href={`/corporation-tax/${comp.id}`}
                    className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                    <p className="font-semibold text-slate-900">
                      {new Date(comp.period_start).toLocaleDateString("en-GB")} to {new Date(comp.period_end).toLocaleDateString("en-GB")}
                    </p>
                    <p className="text-sm text-slate-500">£{Number(comp.accounting_profit || 0).toFixed(2)} profit</p>
                  </a>
                ))}
                {(!ctComputations || ctComputations.length === 0) && (
                  <p className="text-sm text-slate-500 text-center py-6">No corporation tax computations yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* FIXED ASSETS TAB */}
        {tab === "assets" && (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Fixed Assets ({fixedAssets?.length ?? 0})</h2>
              <a href="/fixed-assets" className="text-xs font-semibold text-blue-600 hover:underline">View register →</a>
            </div>
            <div className="mt-4 space-y-2">
              {(fixedAssets || []).map((asset) => (
                <div key={asset.id} className={`flex items-center justify-between rounded-xl border border-slate-100 p-4 ${asset.disposal_date ? "opacity-60" : ""}`}>
                  <div>
                    <p className="font-semibold text-slate-900">{asset.description}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {asset.category || "Uncategorised"} · Acquired {new Date(asset.acquisition_date).toLocaleDateString("en-GB")}
                      {asset.disposal_date && ` · Disposed ${new Date(asset.disposal_date).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <p className="font-bold text-slate-900">£{Number(asset.cost).toFixed(2)}</p>
                </div>
              ))}
              {(!fixedAssets || fixedAssets.length === 0) && (
                <p className="text-sm text-slate-500 text-center py-6">No fixed assets for this client yet.</p>
              )}
            </div>
          </div>
        )}

        {/* DIRECTORS TAB */}
        {tab === "directors" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Directors & Officers</h2>
              <p className="text-sm text-slate-500 mt-0.5">Pulled from Companies House at time of onboarding.</p>

              <div className="mt-6 space-y-4">
                {(officers || []).map((officer) => (
                  <div key={officer.id} className={`rounded-xl border p-4 ${officer.is_active ? "border-slate-100" : "border-slate-100 opacity-50"}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{officer.name}</p>
                          {!officer.is_active && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Resigned</span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 capitalize mt-0.5">{officer.role?.replace(/-/g, " ")}</p>
                        {officer.appointed_on && (
                          <p className="text-xs text-slate-400 mt-1">
                            Appointed: {new Date(officer.appointed_on).toLocaleDateString("en-GB")}
                            {officer.resigned_on && ` · Resigned: ${new Date(officer.resigned_on).toLocaleDateString("en-GB")}`}
                          </p>
                        )}
                        {officer.nationality && (
                          <p className="text-xs text-slate-400">
                            {officer.nationality} · {officer.country_of_residence}
                          </p>
                        )}
                        {officer.date_of_birth_year && (
                          <p className="text-xs text-slate-400">
                            DOB: {officer.date_of_birth_month}/{officer.date_of_birth_year}
                          </p>
                        )}
                        {officer.address && (
                          <p className="text-xs text-slate-400 mt-1">{officer.address}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {(!officers || officers.length === 0) && (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No directors on record. Add this client via Companies House lookup to auto-populate.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PSCs TAB */}
        {tab === "pscs" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Persons with Significant Control</h2>
              <p className="text-sm text-slate-500 mt-0.5">Pulled from Companies House at time of onboarding.</p>

              <div className="mt-6 space-y-4">
                {(pscs || []).map((psc) => (
                  <div key={psc.id} className={`rounded-xl border p-4 ${psc.is_active ? "border-slate-100" : "border-slate-100 opacity-50"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-slate-900">{psc.name}</p>
                      {!psc.is_active && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Ceased</span>
                      )}
                    </div>
                    {psc.nationality && (
                      <p className="text-xs text-slate-400">{psc.nationality} · {psc.country_of_residence}</p>
                    )}
                    {psc.date_of_birth_year && (
                      <p className="text-xs text-slate-400">DOB: {psc.date_of_birth_month}/{psc.date_of_birth_year}</p>
                    )}
                    {psc.natures_of_control?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {psc.natures_of_control.map((control: string, i: number) => (
                          <span key={i} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600 capitalize">
                            {control.replace(/-/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                    {psc.notified_on && (
                      <p className="text-xs text-slate-400 mt-1">
                        Notified: {new Date(psc.notified_on).toLocaleDateString("en-GB")}
                        {psc.ceased_on && ` · Ceased: ${new Date(psc.ceased_on).toLocaleDateString("en-GB")}`}
                      </p>
                    )}
                    {psc.address && (
                      <p className="text-xs text-slate-400 mt-1">{psc.address}</p>
                    )}
                  </div>
                ))}

                {(!pscs || pscs.length === 0) && (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No PSCs on record. Add this client via Companies House lookup to auto-populate.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SHAREHOLDINGS TAB */}
        {tab === "shareholdings" && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Shareholdings</h2>

                <div className="mt-4 space-y-3">
                  {(shareholdings || []).map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                      <div>
                        <p className="font-semibold text-slate-900">{s.shareholder_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {s.share_class} · {s.num_shares?.toLocaleString()} shares · {s.percentage}%
                        </p>
                      </div>
                      <form action={deleteShareholding.bind(null, id, s.id)}>
                        <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                          Delete
                        </button>
                      </form>
                    </div>
                  ))}

                  {(!shareholdings || shareholdings.length === 0) && (
                    <p className="text-sm text-slate-500 text-center py-6">No shareholdings recorded yet.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Add shareholding form */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 h-fit">
              <h2 className="text-lg font-bold text-slate-900">Add Shareholding</h2>
              <form action={addShareholdingWithId} className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Shareholder Name *</label>
                  <input name="shareholder_name" required className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Full name or company" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Share Class</label>
                  <input name="share_class" defaultValue="Ordinary" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. Ordinary" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Number of Shares</label>
                  <input name="num_shares" type="number" min="0" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. 100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Percentage %</label>
                  <input name="percentage" type="number" min="0" max="100" step="0.01" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. 50" />
                </div>
                <button type="submit" className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Add Shareholding
                </button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
