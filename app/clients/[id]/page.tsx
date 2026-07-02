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
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase.from("company_officers").select("*").eq("client_id", id).order("is_active", { ascending: false }),
    supabase.from("company_pscs").select("*").eq("client_id", id).order("is_active", { ascending: false }),
    supabase.from("company_shareholdings").select("*").eq("client_id", id).order("created_at", { ascending: true }),
  ]);

  if (error || !client) notFound();

  const updateWithId = updateClientRecord.bind(null, id);
  const addShareholdingWithId = addShareholding.bind(null, id);

  const tabs = [
    { key: "details", label: "Details" },
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
              </div>
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
