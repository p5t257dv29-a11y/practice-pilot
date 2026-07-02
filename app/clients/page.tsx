import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import NewClientForm from "./new-client-form";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createClientRecord(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { data: client, error } = await supabase.from("clients").insert({
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
    // Companies House extra fields
    company_status: get("company_status") || null,
    incorporation_date: get("incorporation_date") || null,
    accounts_next_due: get("accounts_next_due") || null,
    accounts_last_made_up: get("accounts_last_made_up") || null,
    confirmation_statement_next_due: get("confirmation_statement_next_due") || null,
    confirmation_statement_last_made_up: get("confirmation_statement_last_made_up") || null,
    sic_codes: get("sic_codes") ? get("sic_codes").split(",") : null,
  }).select().single();

  if (error || !client) {
    console.error("Could not create client:", error?.message);
    return;
  }

  // Save officers if present
  const officersJson = get("officers_json");
  if (officersJson) {
    try {
      const officers = JSON.parse(officersJson);
      if (officers.length > 0) {
        await supabase.from("company_officers").insert(
          officers.map((o: any) => ({ ...o, client_id: client.id }))
        );
      }
    } catch (e) {
      console.error("Could not save officers:", e);
    }
  }

  // Save PSCs if present
  const pscsJson = get("pscs_json");
  if (pscsJson) {
    try {
      const pscs = JSON.parse(pscsJson);
      if (pscs.length > 0) {
        await supabase.from("company_pscs").insert(
          pscs.map((p: any) => ({ ...p, client_id: client.id }))
        );
      }
    } catch (e) {
      console.error("Could not save PSCs:", e);
    }
  }

  revalidatePath("/clients");
}

async function deleteClientRecord(id: string) {
  "use server";

  await supabase.from("clients").delete().eq("id", id);
  revalidatePath("/clients");
}

export default async function ClientsPage() {
  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .order("client_name", { ascending: true });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Manage your accountancy practice clients.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load clients: {error.message}
          </div>
        )}

        {/* Add Client Form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">Add New Client</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter a company number to auto-fill details from Companies House including directors and PSCs.
          </p>
          <NewClientForm action={createClientRecord} />
        </div>

        {/* Clients List */}
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">
            All Clients ({clients?.length ?? 0})
          </h2>

          <div className="mt-4 space-y-3">
            {(clients || []).map((client) => (
              <div key={client.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                <a href={`/clients/${client.id}`} className="flex-1 hover:opacity-70 transition-opacity">
                  <p className="font-semibold text-slate-900">{client.client_name}</p>
                  <p className="text-sm text-slate-500">
                    {client.entity_type || "No entity type"} · {client.email || "No email"}
                  </p>
                  {client.accounts_next_due && (
                    <p className="text-xs text-orange-600 mt-0.5">
                      Accounts due: {new Date(client.accounts_next_due).toLocaleDateString("en-GB")}
                    </p>
                  )}
                </a>

                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    client.onboarding_status === "Active Client" ? "bg-green-100 text-green-700"
                    : client.onboarding_status === "Prospect" ? "bg-blue-100 text-blue-700"
                    : client.onboarding_status === "Onboarding" ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {client.onboarding_status || "Unknown"}
                  </span>

                  <form action={deleteClientRecord.bind(null, client.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}

            {clients && clients.length === 0 && (
              <p className="text-sm text-slate-500">No clients yet. Add your first client above.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
