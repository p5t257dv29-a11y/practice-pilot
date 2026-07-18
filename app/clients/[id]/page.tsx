import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculateNBV } from "../../fixed-assets/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const POOL_OPTIONS = [
  "Main Pool - AIA Eligible",
  "Special Rate Pool - AIA Eligible",
  "Main Pool - Car (not AIA eligible)",
  "Special Rate Pool - Car (not AIA eligible)",
  "Zero Emission Car (100% FYA)",
];

const CATEGORY_OPTIONS = [
  "Plant & Machinery",
  "Computer Equipment",
  "Motor Vehicles",
  "Fixtures & Fittings",
  "Integral Features",
  "Office Equipment",
  "Other",
];

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

async function updateAmlRecord(id: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("clients").update({
    aml_risk_rating: get("aml_risk_rating") || null,
    aml_id_verified: formData.get("aml_id_verified") === "on",
    aml_id_verification_method: get("aml_id_verification_method") || null,
    aml_id_verified_date: get("aml_id_verified_date") || null,
    aml_pep_status: formData.get("aml_pep_status") === "on",
    aml_source_of_funds: get("aml_source_of_funds") || null,
    aml_next_review_due: get("aml_next_review_due") || null,
    aml_notes: get("aml_notes") || null,
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

async function uploadIdDocument(clientId: string, formData: FormData) {
  "use server";
  const file = formData.get("document") as File | null;
  const documentType = String(formData.get("document_type") || "").trim();
  if (!file || file.size === 0) return;

  const storagePath = `${clientId}/${Date.now()}-${file.name}`;
  const fileBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("client-id-documents")
    .upload(storagePath, fileBuffer, { contentType: file.type });

  if (uploadError) {
    console.error("Could not upload ID document:", uploadError.message);
    return;
  }

  await supabase.from("client_id_documents").insert({
    client_id: clientId,
    document_type: documentType || null,
    file_name: file.name,
    storage_path: storagePath,
    file_size: file.size,
  });

  revalidatePath(`/clients/${clientId}`);
}

async function deleteIdDocument(clientId: string, docId: string, storagePath: string) {
  "use server";
  await supabase.storage.from("client-id-documents").remove([storagePath]);
  await supabase.from("client_id_documents").delete().eq("id", docId);
  revalidatePath(`/clients/${clientId}`);
}

// Fixed assets — client is fixed via the bound clientId, never a form field,
// since this action only ever runs from within that client's own page.
async function addAssetForClient(clientId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const description = get("description");
  if (!description) return;

  await supabase.from("fixed_assets").insert({
    client_id: clientId,
    job_id: get("job_id") || null,
    description,
    category: get("category") || null,
    capital_allowance_pool: get("capital_allowance_pool") || "Main Pool - AIA Eligible",
    acquisition_date: get("acquisition_date"),
    cost: parseFloat(get("cost")) || 0,
    depreciation_rate_pct: parseFloat(get("depreciation_rate_pct")) || 20,
    depreciation_method: get("depreciation_method") || "Straight Line",
    notes: get("notes") || null,
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/fixed-assets");
  revalidatePath("/fixed-assets/register");
}

// Only ever touches disposal_date / disposal_proceeds — same narrow pattern as
// the standalone Dispose Asset page, so this can't blank out other asset fields.
async function disposeAssetForClient(clientId: string, assetId: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("fixed_assets").update({
    disposal_date: get("disposal_date") || null,
    disposal_proceeds: get("disposal_proceeds") ? parseFloat(get("disposal_proceeds")) : null,
  }).eq("id", assetId);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/fixed-assets");
  revalidatePath("/fixed-assets/register");
  revalidatePath("/fixed-assets/dispose");
}

async function clearDisposalForClient(clientId: string, assetId: string) {
  "use server";
  await supabase.from("fixed_assets").update({
    disposal_date: null,
    disposal_proceeds: null,
  }).eq("id", assetId);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/fixed-assets");
  revalidatePath("/fixed-assets/register");
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; dispose?: string }>;
}) {
  const { id } = await params;
  const { tab = "overview", dispose: disposeAssetId } = await searchParams;

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
    { data: idDocuments },
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
    supabase.from("client_id_documents").select("*").eq("client_id", id).order("uploaded_at", { ascending: false }),
  ]);

  if (error || !client) notFound();

  const updateWithId = updateClientRecord.bind(null, id);
  const updateAmlWithId = updateAmlRecord.bind(null, id);
  const addShareholdingWithId = addShareholding.bind(null, id);
  const uploadIdDocumentWithId = uploadIdDocument.bind(null, id);
  const deleteIdDocumentWithId = deleteIdDocument.bind(null, id);
  const addAssetWithId = addAssetForClient.bind(null, id);
  const clearDisposalWithId = clearDisposalForClient.bind(null, id);

  const activeJobs = (jobs || []).filter((j) => j.status !== "Completed" && j.status !== "Cancelled");
  const historicalJobs = (jobs || []).filter((j) => j.status === "Completed" || j.status === "Cancelled");

  // Bucket is private, so each document needs a short-lived signed URL to download
  const idDocumentsWithUrls = await Promise.all(
    (idDocuments || []).map(async (doc) => {
      const { data: signed } = await supabase.storage
        .from("client-id-documents")
        .createSignedUrl(doc.storage_path, 300);
      return { ...doc, url: signed?.signedUrl || null };
    })
  );

  const fmtFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // AML status check — flags if ID hasn't been verified, no risk rating set, or a review is overdue
  const amlReviewOverdue = client.aml_next_review_due && new Date(client.aml_next_review_due) < new Date();
  const amlNeedsAttention = !client.aml_id_verified || !client.aml_risk_rating || amlReviewOverdue;

  // Fixed assets for this client
  const activeAssets = (fixedAssets || []).filter((a) => !a.disposal_date);
  const disposedAssets = (fixedAssets || []).filter((a) => a.disposal_date);
  const assetsTotalCost = activeAssets.reduce((sum, a) => sum + Number(a.cost), 0);
  const assetsTotalNBV = activeAssets.reduce((sum, a) => sum + calculateNBV(a).nbv, 0);

  // Overview tab summary figures
  const outstandingInvoices = (invoices || []).filter((i) => i.status !== "Paid");
  const outstandingInvoiceTotal = outstandingInvoices.reduce((sum, i) => sum + Number(i.total || 0), 0);
  const pendingQuotes = (quotes || []).filter((q) => q.status === "Sent");
  const allTaxComputations = [
    ...(taxComputations || []).map((t) => ({
      key: `tax-${t.id}`,
      label: `Personal Tax ${t.tax_year}`,
      status: t.status || "Draft",
      href: `/tax/${t.id}`,
      created_at: t.created_at,
    })),
    ...(ctComputations || []).map((c) => ({
      key: `ct-${c.id}`,
      label: `Corporation Tax — ${new Date(c.period_start).toLocaleDateString("en-GB")} to ${new Date(c.period_end).toLocaleDateString("en-GB")}`,
      status: "",
      href: `/corporation-tax/${c.id}`,
      created_at: c.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const latestEngagement = (engagementLetters || [])[0];

  const nextDeadlines = [
    client.accounts_next_due && { label: "Accounts", date: client.accounts_next_due },
    client.confirmation_statement_next_due && { label: "Confirmation Statement", date: client.confirmation_statement_next_due },
  ].filter(Boolean) as { label: string; date: string }[];
  nextDeadlines.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "details", label: "Details" },
    { key: "aml", label: "AML" },
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

          <div className="flex items-center gap-2">
            {amlNeedsAttention && (
              <span className="rounded-full px-4 py-2 text-sm font-semibold bg-red-100 text-red-700">
                ⚠ AML review needed
              </span>
            )}
            <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
              client.onboarding_status === "Active Client" ? "bg-green-100 text-green-700"
              : client.onboarding_status === "Prospect" ? "bg-blue-100 text-blue-700"
              : client.onboarding_status === "Onboarding" ? "bg-yellow-100 text-yellow-700"
              : "bg-slate-100 text-slate-600"
            }`}>
              {client.onboarding_status || "Unknown"}
            </span>
          </div>
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

      </div>

      <div className="p-8 flex gap-6">

        {/* Vertical tab rail */}
        <nav className="w-56 flex-shrink-0 space-y-1">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`/clients/${id}?tab=${t.key}`}
              className={`block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-slate-900 text-white"
                  : t.key === "aml" && amlNeedsAttention
                  ? "text-red-600 hover:bg-red-50 font-semibold"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.key === "aml" && amlNeedsAttention ? "⚠ AML" : t.label}
            </a>
          ))}
        </nav>

        <div className="flex-1 min-w-0">

        {/* OVERVIEW TAB */}
        {tab === "overview" && (
          <div className="space-y-6">

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Active Jobs</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{activeJobs.length}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Fixed Assets NBV</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">£{assetsTotalNBV.toFixed(2)}</p>
              </div>
              <div className={`rounded-2xl p-4 shadow-sm ${outstandingInvoiceTotal > 0 ? "bg-orange-50 border border-orange-100" : "bg-white border border-slate-100"}`}>
                <p className={`text-xs uppercase tracking-wide ${outstandingInvoiceTotal > 0 ? "text-orange-600" : "text-slate-500"}`}>Outstanding Invoices</p>
                <p className={`text-2xl font-bold mt-1 ${outstandingInvoiceTotal > 0 ? "text-orange-700" : "text-slate-900"}`}>£{outstandingInvoiceTotal.toFixed(2)}</p>
              </div>
              <div className={`rounded-2xl p-4 shadow-sm ${amlNeedsAttention ? "bg-red-50 border border-red-100" : "bg-white border border-slate-100"}`}>
                <p className={`text-xs uppercase tracking-wide ${amlNeedsAttention ? "text-red-600" : "text-slate-500"}`}>AML Status</p>
                <p className={`text-lg font-bold mt-1 ${amlNeedsAttention ? "text-red-700" : "text-green-600"}`}>
                  {amlNeedsAttention ? "Needs attention" : "Up to date"}
                </p>
              </div>
            </div>

            {/* Deadlines */}
            {nextDeadlines.length > 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Upcoming Deadlines</h2>
                <div className="mt-4 flex gap-6">
                  {nextDeadlines.map((d) => (
                    <div key={d.label}>
                      <p className="text-xs text-slate-500">{d.label}</p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5">
                        {new Date(d.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">

              {/* Active jobs */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900">Active Jobs</h2>
                  <a href={`/clients/${id}?tab=jobs`} className="text-xs font-semibold text-blue-600 hover:underline">View all →</a>
                </div>
                <div className="mt-4 space-y-2">
                  {activeJobs.slice(0, 5).map((job) => (
                    <a key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 hover:bg-slate-50 transition-colors">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{job.job_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {job.job_type || "No type"}{job.due_date && ` · Due ${new Date(job.due_date).toLocaleDateString("en-GB")}`}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        job.status === "Active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {job.status || "Draft"}
                      </span>
                    </a>
                  ))}
                  {activeJobs.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-6">No active jobs.</p>
                  )}
                </div>
              </div>

              {/* Recent tax computations */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900">Recent Tax Activity</h2>
                  <a href={`/clients/${id}?tab=tax`} className="text-xs font-semibold text-blue-600 hover:underline">View all →</a>
                </div>
                <div className="mt-4 space-y-2">
                  {allTaxComputations.slice(0, 5).map((c) => (
                    <a key={c.key} href={c.href} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 hover:bg-slate-50 transition-colors">
                      <p className="text-sm font-semibold text-slate-900">{c.label}</p>
                      {c.status && (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          c.status === "Approved" ? "bg-green-100 text-green-700"
                          : c.status === "Sent" ? "bg-blue-100 text-blue-700"
                          : c.status === "Queried" ? "bg-yellow-100 text-yellow-700"
                          : "bg-slate-100 text-slate-600"
                        }`}>
                          {c.status}
                        </span>
                      )}
                    </a>
                  ))}
                  {allTaxComputations.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-6">No tax computations yet.</p>
                  )}
                </div>
              </div>

              {/* Quotes & invoices */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900">Billing</h2>
                  <a href={`/clients/${id}?tab=invoices`} className="text-xs font-semibold text-blue-600 hover:underline">View all →</a>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Pending quotes</span>
                    <span className="font-semibold text-slate-900">{pendingQuotes.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Outstanding invoices</span>
                    <span className="font-semibold text-slate-900">{outstandingInvoices.length} · £{outstandingInvoiceTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Engagement & fixed assets snapshot */}
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Engagement & Assets</h2>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Engagement letter</span>
                    <span className="font-semibold text-slate-900">{latestEngagement ? (latestEngagement.status || "Draft") : "None on file"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Active fixed assets</span>
                    <span className="font-semibold text-slate-900">{activeAssets.length} · £{assetsTotalCost.toFixed(2)} cost</span>
                  </div>
                </div>
                <a href={`/clients/${id}?tab=assets`} className="mt-3 block text-xs font-semibold text-blue-600 hover:underline">
                  Manage fixed assets →
                </a>
              </div>
            </div>
          </div>
        )}

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

            {/* Tax Deadline Settings */}
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

        {/* AML TAB */}
        {tab === "aml" && (
          <div className="space-y-6">
            <form action={updateAmlWithId} className={`rounded-2xl bg-white p-6 shadow-sm border ${amlNeedsAttention ? "border-red-200" : "border-slate-100"}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">AML / Client Due Diligence</h2>
                {amlNeedsAttention && (
                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                    Needs attention
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">
                Internal AML compliance record for this client — not part of any client-facing document.
              </p>

              {!client.aml_id_verified && (
                <div className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                  <p className="text-xs font-semibold text-red-700">⚠ Client ID has not been marked as verified.</p>
                </div>
              )}
              {!client.aml_risk_rating && (
                <div className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                  <p className="text-xs font-semibold text-red-700">⚠ No risk rating has been set for this client.</p>
                </div>
              )}
              {amlReviewOverdue && (
                <div className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                  <p className="text-xs font-semibold text-red-700">
                    ⚠ AML review was due {new Date(client.aml_next_review_due).toLocaleDateString("en-GB")} and is now overdue.
                  </p>
                </div>
              )}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Risk Rating</label>
                  <select name="aml_risk_rating" defaultValue={client.aml_risk_rating || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Not yet assessed</option>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Next Review Due</label>
                  <input name="aml_next_review_due" type="date" defaultValue={client.aml_next_review_due || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div className="flex items-center gap-3 md:col-span-2">
                  <input
                    type="checkbox"
                    id="aml_id_verified"
                    name="aml_id_verified"
                    defaultChecked={client.aml_id_verified || false}
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  <label htmlFor="aml_id_verified" className="text-sm font-medium text-slate-700">
                    Client identity has been verified
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Verification Method</label>
                  <input name="aml_id_verification_method" defaultValue={client.aml_id_verification_method || ""} placeholder="e.g. Passport + utility bill, digital ID check" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date Verified</label>
                  <input name="aml_id_verified_date" type="date" defaultValue={client.aml_id_verified_date || ""} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div className="flex items-center gap-3 md:col-span-2">
                  <input
                    type="checkbox"
                    id="aml_pep_status"
                    name="aml_pep_status"
                    defaultChecked={client.aml_pep_status || false}
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  <label htmlFor="aml_pep_status" className="text-sm font-medium text-slate-700">
                    Client (or a connected person) is a Politically Exposed Person
                  </label>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Source of Funds / Wealth</label>
                  <textarea name="aml_source_of_funds" defaultValue={client.aml_source_of_funds || ""} rows={2} placeholder="Only needed for higher-risk clients" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">AML Notes</label>
                  <textarea name="aml_notes" defaultValue={client.aml_notes || ""} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
              </div>

              <button type="submit" className="mt-4 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save AML Details
              </button>
            </form>

            {/* ID Documents — own form, kept separate since file uploads need their own action/encoding */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">ID Documents</h2>
              <p className="text-sm text-slate-500 mt-0.5">Scanned or photographed identity documents held for this client.</p>

              <div className="mt-4 space-y-2">
                {idDocumentsWithUrls.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg flex-shrink-0">🪪</span>
                      <div className="min-w-0">
                        {doc.url ? (
                          <a href={doc.url} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-600 hover:underline truncate block">
                            {doc.file_name}
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-slate-900 truncate block">{doc.file_name}</span>
                        )}
                        <p className="text-xs text-slate-400">
                          {doc.document_type && `${doc.document_type} · `}
                          {fmtFileSize(doc.file_size)} · {new Date(doc.uploaded_at).toLocaleDateString("en-GB")}
                        </p>
                      </div>
                    </div>
                    <form action={deleteIdDocumentWithId.bind(null, doc.id, doc.storage_path)}>
                      <button className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors flex-shrink-0">
                        Delete
                      </button>
                    </form>
                  </div>
                ))}
                {idDocumentsWithUrls.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-3">No ID documents uploaded yet.</p>
                )}
              </div>

              <form action={uploadIdDocumentWithId} className="mt-4 flex flex-wrap gap-2 items-end border-t border-slate-100 pt-4">
                <div className="w-48">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Document Type</label>
                  <select name="document_type" className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select type</option>
                    <option>Passport</option>
                    <option>Driving Licence</option>
                    <option>Utility Bill</option>
                    <option>Bank Statement</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Upload File</label>
                  <input name="document" type="file" required
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <button type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Upload
                </button>
              </form>
            </div>
          </div>
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

        {/* FIXED ASSETS TAB — now fully actionable, scoped to this client */}
        {tab === "assets" && (
          <div className="space-y-6">

            {/* Summary + links to cross-client views */}
            <div className="flex items-center justify-between">
              <div className="grid grid-cols-3 gap-4 flex-1 mr-4">
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Active Assets</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{activeAssets.length}</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Cost</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">£{assetsTotalCost.toFixed(2)}</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Net Book Value</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">£{assetsTotalNBV.toFixed(2)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                <a href={`/fixed-assets/report?client=${id}`}
                  className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-center">
                  Asset Report →
                </a>
                <a href={`/fixed-assets/capital-allowances?client=${id}`}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors text-center">
                  Capital Allowances →
                </a>
              </div>
            </div>

            {/* Add Asset */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Add Asset</h2>
              <form action={addAssetWithId} className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                  <input name="description" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="e.g. Ford Transit Van" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select name="category"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Job (optional)</label>
                  <select name="job_id"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">No linked job</option>
                    {(jobs || []).map((j) => (
                      <option key={j.id} value={j.id}>{j.job_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Capital Allowance Pool</label>
                  <select name="capital_allowance_pool"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    {POOL_OPTIONS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Acquisition Date *</label>
                  <input name="acquisition_date" type="date" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cost (£) *</label>
                  <input name="cost" type="number" step="0.01" min="0" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Rate (% p.a.)</label>
                  <input name="depreciation_rate_pct" type="number" step="0.01" min="0" defaultValue="20"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Method</label>
                  <select name="depreciation_method" defaultValue="Straight Line"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option>Straight Line</option>
                    <option>Reducing Balance</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <input name="notes"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>
                <div className="md:col-span-3">
                  <button type="submit"
                    className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                    Add Asset
                  </button>
                </div>
              </form>
            </div>

            {/* Active assets, with dispose + link out to full edit */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Active Assets ({activeAssets.length})</h2>
              <div className="mt-4 space-y-2">
                {activeAssets.map((asset) => {
                  const { nbv } = calculateNBV(asset);
                  const isDisposing = disposeAssetId === asset.id;
                  const disposeActionWithId = disposeAssetForClient.bind(null, id, asset.id);

                  return (
                    <div key={asset.id} className="rounded-xl border border-slate-100">
                      <div className="flex items-center justify-between p-4">
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{asset.description}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {asset.category || "Uncategorised"} · {asset.capital_allowance_pool}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Acquired {new Date(asset.acquisition_date).toLocaleDateString("en-GB")} · {asset.depreciation_method || "Straight Line"} @ {asset.depreciation_rate_pct}%
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="font-bold text-slate-900">£{nbv.toFixed(2)}</p>
                            <p className="text-xs text-slate-400">NBV (cost £{Number(asset.cost).toFixed(2)})</p>
                          </div>
                          <a
                            href={isDisposing ? `/clients/${id}?tab=assets` : `/clients/${id}?tab=assets&dispose=${asset.id}`}
                            className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
                          >
                            {isDisposing ? "Close" : "Dispose"}
                          </a>
                          <a
                            href={`/fixed-assets/register?client=${id}&edit=${asset.id}`}
                            className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
                          >
                            Edit
                          </a>
                        </div>
                      </div>

                      {isDisposing && (
                        <div className="border-t border-slate-100 p-4 bg-slate-50">
                          <form action={disposeActionWithId} className="flex flex-wrap gap-4 items-end">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Disposal Date *</label>
                              <input name="disposal_date" type="date" required
                                className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Disposal Proceeds (£)</label>
                              <input name="disposal_proceeds" type="number" step="0.01" min="0"
                                className="rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
                            </div>
                            <button type="submit"
                              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                              Confirm Disposal
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })}
                {activeAssets.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-8">No active assets yet. Add one above.</p>
                )}
              </div>
            </div>

            {/* Disposed assets */}
            {disposedAssets.length > 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">Disposed Assets ({disposedAssets.length})</h2>
                <div className="mt-4 space-y-2">
                  {disposedAssets.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4 opacity-70">
                      <div>
                        <p className="font-semibold text-slate-900">{asset.description}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Disposed {new Date(asset.disposal_date!).toLocaleDateString("en-GB")} · Proceeds £{Number(asset.disposal_proceeds || 0).toFixed(2)}
                        </p>
                      </div>
                      <form action={clearDisposalWithId.bind(null, asset.id)}>
                        <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                          Undo
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
    </div>
  );
}
