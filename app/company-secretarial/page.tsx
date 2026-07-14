import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import CompanySecretarialForm from "../company-secretarial-form";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Maps each event type to the Companies House form it corresponds to, for reference.
export const CS_EVENT_TYPES: Record<string, { form: string | null; note?: string }> = {
  "Director Appointed": { form: "AP01", note: "AP02 instead if appointing a corporate director" },
  "Director Resigned": { form: "TM01" },
  "Director Details Changed": { form: "CH01" },
  "Registered Office Changed": { form: "AD01" },
  "Shares Allotted": { form: "SH01" },
  "Shares Transferred": { form: null, note: "No CH form required — update the statutory register; reflected at next Confirmation Statement" },
  "PSC Appointed or Changed": { form: "PSC01 / PSC04", note: "Exact form depends on the nature of the change" },
  "Confirmation Statement Filed": { form: "CS01" },
  "Company Name Changed": { form: "NM01" },
  "Other": { form: null },
};

async function createEvent(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  const client_id = get("client_id");
  const event_type = get("event_type");
  const event_date = get("event_date");
  if (!client_id || !event_type || !event_date) return;

  const officer_id = get("officer_id") || null;
  let director_name = get("director_name") || null;

  // If an existing officer was picked (e.g. for a resignation), use their real
  // name and mark the officer record itself inactive — closes the loop rather
  // than just logging text that drifts from the real record.
  if (officer_id) {
    const { data: officer } = await supabase.from("company_officers").select("name").eq("id", officer_id).single();
    if (officer) director_name = officer.name;

    if (event_type === "Director Resigned") {
      await supabase.from("company_officers").update({ is_active: false, resigned_on: event_date }).eq("id", officer_id);
    }
  }

  const shareholder_name = get("shareholder_name") || null;
  const transferred_from = get("transferred_from") || null;
  const share_class = get("share_class") || null;
  const number_of_shares = get("number_of_shares") ? parseFloat(get("number_of_shares")) : null;
  const price_per_share = get("price_per_share") ? parseFloat(get("price_per_share")) : null;

  // Build a readable summary from structured fields when the person hasn't typed
  // their own details, so the register reads well without relying on free text.
  let details = get("details");
  if (!details) {
    if (director_name) {
      details = event_type === "Director Appointed" ? `${director_name} appointed as director`
        : event_type === "Director Resigned" ? `${director_name} resigned as director`
        : `${director_name}'s director details changed`;
    } else if (number_of_shares && shareholder_name) {
      const shareText = `${number_of_shares.toLocaleString("en-GB")} ${share_class || "Ordinary"} share${number_of_shares === 1 ? "" : "s"}`;
      const priceText = price_per_share ? ` at £${price_per_share} each` : "";
      details = transferred_from
        ? `${shareText} transferred from ${transferred_from} to ${shareholder_name}${priceText}`
        : `${shareText} allotted to ${shareholder_name}${priceText}`;
    }
  }

  await supabase.from("company_secretarial_events").insert({
    client_id,
    event_type,
    event_date,
    details,
    companies_house_form: CS_EVENT_TYPES[event_type]?.form || null,
    filed: formData.get("filed") === "on",
    filed_date: get("filed_date") || null,
    director_name,
    shareholder_name,
    transferred_from,
    share_class,
    number_of_shares,
    price_per_share,
  });

  // Registered office changes update the client's address directly, since we're
  // confident that field exists and is used throughout the accounts pages.
  if (event_type === "Registered Office Changed" && get("new_address")) {
    await supabase.from("clients").update({ address: get("new_address") }).eq("id", client_id);
  }

  revalidatePath("/company-secretarial");
  revalidatePath(`/clients/${client_id}`);
}

async function toggleFiled(id: string, current: boolean) {
  "use server";
  await supabase.from("company_secretarial_events").update({
    filed: !current,
    filed_date: !current ? new Date().toISOString().split("T")[0] : null,
  }).eq("id", id);
  revalidatePath("/company-secretarial");
}

async function deleteEvent(id: string) {
  "use server";
  await supabase.from("company_secretarial_events").delete().eq("id", id);
  revalidatePath("/company-secretarial");
}

export default async function CompanySecretarialPage() {
  const [{ data: events, error }, { data: clients }, { data: officers }, { data: shareholdings }] = await Promise.all([
    supabase
      .from("company_secretarial_events")
      .select("*, clients(client_name)")
      .order("event_date", { ascending: false }),
    supabase.from("clients").select("id, client_name").order("client_name", { ascending: true }),
    supabase.from("company_officers").select("id, client_id, name").eq("is_active", true).order("name", { ascending: true }),
    supabase.from("company_shareholdings").select("id, client_id, shareholder_name").order("shareholder_name", { ascending: true }),
  ]);

  const unfiledCount = (events || []).filter((e) => e.companies_house_form && !e.filed).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Company Secretarial</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Log statutory events — director changes, registered office, share allotments — mapped to the correct Companies House form.
        </p>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load events: {error.message}
          </div>
        )}

        {unfiledCount > 0 && (
          <div className="mb-6 rounded-2xl bg-orange-50 border border-orange-100 p-4">
            <p className="text-sm font-bold text-orange-700">
              ⚠ {unfiledCount} event{unfiledCount !== 1 ? "s" : ""} requiring a Companies House filing {unfiledCount !== 1 ? "haven't" : "hasn't"} been marked as filed
            </p>
          </div>
        )}

        {/* New Event Form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Log an Event</h2>
          <p className="text-sm text-slate-500 mt-0.5">Records a statutory change and, where applicable, the Companies House form it requires.</p>

          <CompanySecretarialForm
            clients={clients || []}
            officers={officers || []}
            shareholdings={shareholdings || []}
            eventTypes={Object.keys(CS_EVENT_TYPES)}
            createAction={createEvent}
          />
        </div>

        {/* Event Register */}
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Event Register ({(events || []).length})</h2>
          <div className="mt-4 space-y-3">
            {(events || []).map((event) => (
              <div key={event.id} className={`rounded-xl border p-4 ${event.companies_house_form && !event.filed ? "border-orange-200 bg-orange-50" : "border-slate-100"}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{event.event_type}</p>
                      <span className="text-xs text-slate-400">· {(event.clients as any)?.client_name || "No client"}</span>
                      {event.companies_house_form && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-mono text-blue-600 font-medium">
                          {event.companies_house_form}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{event.details}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(event.event_date).toLocaleDateString("en-GB")}
                      {event.filed && event.filed_date && ` · Filed ${new Date(event.filed_date).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {event.companies_house_form && (
                      <form action={toggleFiled.bind(null, event.id, event.filed)}>
                        <button className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                          event.filed ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                        }`}>
                          {event.filed ? "✓ Filed" : "Mark as Filed"}
                        </button>
                      </form>
                    )}
                    <form action={deleteEvent.bind(null, event.id)}>
                      <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
            {(events || []).length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No events logged yet. Record your first one above.</p>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4">
          <p className="text-xs text-yellow-800">
            <strong>Record-keeping only — does not file anything.</strong> This logs the event and shows which Companies House form it requires, but doesn't submit to Companies House directly. Registered office changes update the client's address here automatically; director and shareholding changes are recorded here but do not currently sync to the Directors/PSCs/Shareholdings tabs on the client record — update those separately for now.
          </p>
        </div>
      </div>
    </div>
  );
}
