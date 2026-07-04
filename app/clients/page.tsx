import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import ClientsPageClient from "./clients-page-client";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createClientRecord(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  // Generate client reference based on name
  const clientName = get("client_name");
  const entityType = get("entity_type");

  let prefix = "CL";
  if (clientName) {
    const words = clientName.trim().split(" ").filter(w =>
      !["Mr", "Mrs", "Ms", "Miss", "Dr", "Ltd", "Limited", "LLP"].includes(w)
    );
    if (entityType === "Sole Trader" || entityType === "Partnership") {
      prefix = words.slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
    } else {
      prefix = clientName.replace(/[^a-zA-Z]/g, "").substring(0, 2).toUpperCase();
    }
  }

  const { data: existingClients } = await supabase
    .from("clients")
    .select("client_ref")
    .like("client_ref", `${prefix}%`)
    .not("client_ref", "is", null)
    .order("client_ref", { ascending: false })
    .limit(1);

  let nextRef = `${prefix}001`;
  if (existingClients && existingClients.length > 0 && existingClients[0]?.client_ref) {
    const lastNum = parseInt(existingClients[0].client_ref.replace(prefix, "")) || 0;
    nextRef = `${prefix}${String(lastNum + 1).padStart(3, "0")}`;
  }

  const { data: newClient, error } = await supabase.from("clients").insert({
    client_ref: nextRef,
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
    company_status: get("company_status") || null,
    incorporation_date: get("incorporation_date") || null,
    accounts_next_due: get("accounts_next_due") || null,
    accounts_last_made_up: get("accounts_last_made_up") || null,
    confirmation_statement_next_due: get("confirmation_statement_next_due") || null,
    confirmation_statement_last_made_up: get("confirmation_statement_last_made_up") || null,
    sic_codes: get("sic_codes") ? get("sic_codes").split(",") : null,
  }).select().single();

  if (error || !newClient) {
    console.error("Could not create client:", error?.message);
    return;
  }

  // Save officers
  const officersJson = get("officers_json");
  if (officersJson) {
    try {
      const officers = JSON.parse(officersJson);
      if (officers.length > 0) {
        await supabase.from("company_officers").insert(
          officers.map((o: any) => ({ ...o, client_id: newClient.id }))
        );
      }
    } catch (e) {
      console.error("Could not save officers:", e);
    }
  }

  // Save PSCs
  const pscsJson = get("pscs_json");
  if (pscsJson) {
    try {
      const pscs = JSON.parse(pscsJson);
      if (pscs.length > 0) {
        await supabase.from("company_pscs").insert(
          pscs.map((p: any) => ({ ...p, client_id: newClient.id }))
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
    <ClientsPageClient
      clients={clients || []}
      error={error?.message}
      createAction={createClientRecord}
      deleteAction={deleteClientRecord}
    />
  );
}
