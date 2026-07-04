import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createQuote(formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const { data: allQuotes } = await supabase
    .from("quotes")
    .select("quote_number");

  let highest = 4; // sequence starts at Q-0005
  for (const q of allQuotes || []) {
    const match = q.quote_number?.match(/Q-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (match[1].length <= 4 && num > highest) {
        highest = num;
      }
    }
  }
  const quoteNumber = `Q-${String(highest + 1).padStart(4, "0")}`;
  const clientId = get("client_id");

  const { data: newQuote, error } = await supabase
    .from("quotes")
    .insert({
      quote_number: quoteNumber,
      client_id: clientId,
      quote_date: get("quote_date") || null,
      valid_until: get("valid_until") || null,
      status: get("status") || "Draft",
      notes: get("notes"),
      subtotal: 0,
      vat: 0,
      total: 0,
    })
    .select()
    .single();

  if (error) {
    console.error("Could not create quote:", error.message);
    return;
  }

  const { data: client } = await supabase
    .from("clients")
    .select("email")
    .eq("id", clientId)
    .single();

  const { error: elError } = await supabase.from("engagement_letters").insert({
    client_id: clientId,
    quote_id: newQuote.id,
    client_email: client?.email || null,
    status: "Draft",
    services_description: null,
    fee_description: null,
  });

  if (elError) {
    console.error("Could not create linked engagement letter:", elError.message, elError);
  } else {
    console.log("✅ Engagement letter created successfully, linked to quote:", newQuote.id, "client:", clientId);
  }

  revalidatePath("/quotes");
  revalidatePath("/engagement");
}

async function deleteQuote(id: string) {
  "use server";

  await supabase.from("quotes").delete().eq("id", id);
  revalidatePath("/quotes");
}

export default async function QuotesPage() {
  const [{ data: quotes, error }, { data: clients }] = await Promise.all([
    supabase
      .from("quotes")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Quotes</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Create and manage client quotes and proposals.
            </p>
          </div>
        </div>
      </div>

      <div className="p-8">

        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load quotes: {error.message}
          </div>
        )}

        {/* New Quote Form */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">New Quote</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Create a quote then add line items on the quote detail page.
          </p>

          <form action={createQuote} className="mt-6">
            <div className="grid gap-4 md:grid-cols-2">

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Client *
                </label>
                <select
                  name="client_id"
                  required
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <option value="">Select a client</option>
                  {(clients || []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.client_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Status
                </label>
                <select
                  name="status"
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <option>Draft</option>
                  <option>Sent</option>
                  <option>Accepted</option>
                  <option>Declined</option>
                  <option>Expired</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Quote Date
                </label>
                <input
                  name="quote_date"
                  type="date"
                  defaultValue={today}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Valid Until
                </label>
                <input
                  name="valid_until"
                  type="date"
                  defaultValue={thirtyDays}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Notes
                </label>
                <textarea
                  name="notes"
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Any notes to include on the quote"
                />
              </div>

            </div>

            <button
              type="submit"
              className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              Create Quote
            </button>
          </form>
        </div>

        {/* Quotes List */}
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            All Quotes ({quotes?.length ?? 0})
          </h2>
<div className="mt-4 space-y-3">
            {(quotes || []).map((quote) => (
  <div
                key={quote.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors"
              >
                <Link
                  href={`/quotes/${quote.id}`}
                  className="flex-1"
>
<div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-sm font-bold text-blue-600">
                      📋
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">
                        {quote.quote_number} — {quote.clients?.client_name || "No client"}
                      </p>
                      <p className="text-sm text-slate-500">
                        {quote.quote_date
                          ? new Date(quote.quote_date).toLocaleDateString("en-GB")
                          : "No date"}{" "}
                        · Valid until:{" "}
                        {quote.valid_until
                          ? new Date(quote.valid_until).toLocaleDateString("en-GB")
                          : "No expiry"}
                      </p>
                    </div>
                  </div>
                </Link>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-bold text-slate-900">
                      £{Number(quote.total || 0).toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-400">inc. VAT</p>
                  </div>

                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    quote.status === "Accepted"
                      ? "bg-green-100 text-green-700"
                      : quote.status === "Sent"
                      ? "bg-blue-100 text-blue-700"
                      : quote.status === "Declined"
                      ? "bg-red-100 text-red-700"
                      : quote.status === "Expired"
                      ? "bg-orange-100 text-orange-700"
                      : "bg-slate-100 text-slate-600"
                  }`}>
                    {quote.status || "Draft"}
                  </span>

                  <form action={deleteQuote.bind(null, quote.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}

            {quotes && quotes.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">
                No quotes yet. Create your first quote above.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}