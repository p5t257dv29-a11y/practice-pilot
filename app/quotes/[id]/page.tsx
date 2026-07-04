import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import SendQuoteButton from "./send-quote-button";
import ConvertToInvoiceButton from "./convert-to-invoice";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateQuote(id: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("quotes").update({
    status: get("status"),
    quote_date: get("quote_date") || null,
    valid_until: get("valid_until") || null,
    notes: get("notes"),
  }).eq("id", id);

  revalidatePath(`/quotes/${id}`);
}

async function addLineItem(quoteId: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  const qty = parseFloat(get("qty")) || 1;
  const price = parseFloat(get("price")) || 0;
  const vatRate = parseFloat(get("vat_rate")) || 20;
  const lineTotal = qty * price;

  await supabase.from("quote_lines").insert({
    quote_id: quoteId,
    service_id: get("service_id") || null,
    description: get("description"),
    qty,
    price,
    vat_rate: vatRate,
    line_total: lineTotal,
  });

  const { data: lines } = await supabase
    .from("quote_lines")
    .select("*")
    .eq("quote_id", quoteId);

  if (lines) {
    const subtotal = lines.reduce((sum, l) => sum + Number(l.line_total), 0);
    const vat = lines.reduce(
      (sum, l) => sum + (Number(l.line_total) * Number(l.vat_rate)) / 100,
      0
    );
    const total = subtotal + vat;
    await supabase.from("quotes").update({ subtotal, vat, total }).eq("id", quoteId);
  }

  revalidatePath(`/quotes/${quoteId}`);
}

async function deleteLineItem(quoteId: string, lineId: string) {
  "use server";

  await supabase.from("quote_lines").delete().eq("id", lineId);

  const { data: lines } = await supabase
    .from("quote_lines")
    .select("*")
    .eq("quote_id", quoteId);

  const subtotal = (lines || []).reduce((sum, l) => sum + Number(l.line_total), 0);
  const vat = (lines || []).reduce(
    (sum, l) => sum + (Number(l.line_total) * Number(l.vat_rate)) / 100,
    0
  );
  const total = subtotal + vat;

  await supabase.from("quotes").update({ subtotal, vat, total }).eq("id", quoteId);
  revalidatePath(`/quotes/${quoteId}`);
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [
    { data: quote, error },
    { data: lines },
    { data: services },
    { data: jobs },
  ] = await Promise.all([
    supabase.from("quotes").select("*, clients(client_name, email)").eq("id", id).single(),
    supabase.from("quote_lines").select("*, services(service_name)").eq("quote_id", id).order("created_at", { ascending: true }),
    supabase.from("services").select("*").eq("is_active", true).order("service_name", { ascending: true }),
    supabase.from("jobs").select("id, job_name").order("job_name", { ascending: true }),
  ]);

  if (error || !quote) notFound();

  const updateWithId = updateQuote.bind(null, id);
  const addLineWithId = addLineItem.bind(null, id);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/quotes" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Quotes
        </a>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{quote.quote_number}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {quote.clients?.client_name || "No client"}
            </p>
          </div>

          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
            quote.status === "Accepted" ? "bg-green-100 text-green-700"
            : quote.status === "Sent" ? "bg-blue-100 text-blue-700"
            : quote.status === "Declined" ? "bg-red-100 text-red-700"
            : quote.status === "Expired" ? "bg-orange-100 text-orange-700"
            : "bg-slate-100 text-slate-600"
          }`}>
            {quote.status || "Draft"}
          </span>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        {/* Left - Line Items */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Line Items</h2>

            <div className="mt-4 space-y-2">
              {(lines || []).map((line) => (
                <div key={line.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">{line.description}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Qty: {line.qty} × £{Number(line.price).toFixed(2)} · VAT: {line.vat_rate}%
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-bold text-slate-900">£{Number(line.line_total).toFixed(2)}</p>
                    <form action={deleteLineItem.bind(null, id, line.id)}>
                      <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              ))}

              {lines && lines.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No line items yet. Add services below.
                </p>
              )}
            </div>

            {/* Add line item */}
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Add Line Item</h3>
              <form action={addLineWithId} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Service (optional)</label>
                  <select name="service_id" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select a service or enter manually</option>
                    {(services || []).map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.service_name} — £{Number(service.default_price).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                  <input name="description" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="e.g. Preparation of Year End Accounts" />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Qty</label>
                    <input name="qty" type="number" defaultValue="1" step="0.01" min="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Price (£)</label>
                    <input name="price" type="number" defaultValue="0" step="0.01" min="0"
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">VAT %</label>
                    <select name="vat_rate" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                      <option value="20">20%</option>
                      <option value="5">5%</option>
                      <option value="0">0%</option>
                    </select>
                  </div>
                </div>

                <button type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                  + Add Line Item
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Right - Totals & Settings */}
        <div className="space-y-6">

          {/* Totals */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Quote Total</h2>
            <div className="mt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium text-slate-900">£{Number(quote.subtotal || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">VAT</span>
                <span className="font-medium text-slate-900">£{Number(quote.vat || 0).toFixed(2)}</span>
              </div>
              <div className="border-t border-slate-100 pt-3 flex justify-between">
                <span className="font-bold text-slate-900">Total</span>
                <span className="font-bold text-slate-900 text-lg">£{Number(quote.total || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Convert to Invoice */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Convert to Invoice</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Create an invoice from this quote.
            </p>
            <div className="mt-4">
              <ConvertToInvoiceButton
                quoteId={id}
                clientId={quote.client_id}
                subtotal={Number(quote.subtotal || 0)}
                vat={Number(quote.vat || 0)}
                total={Number(quote.total || 0)}
                status={quote.status}
                jobs={jobs || []}
              />
            </div>
          </div>

          {/* Send to Client */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Send to Client</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Send this quote by email for digital approval.
            </p>
            <div className="mt-4">
              <SendQuoteButton
                quoteId={id}
                defaultEmail={quote.clients?.email || ""}
                quoteToken={quote.token}
              />
            </div>
          </div>

          {/* Quote Details */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Quote Details</h2>
            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select name="status" defaultValue={quote.status || "Draft"}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Draft</option>
                  <option>Sent</option>
                  <option>Accepted</option>
                  <option>Declined</option>
                  <option>Expired</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quote Date</label>
                <input name="quote_date" type="date" defaultValue={quote.quote_date || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Valid Until</label>
                <input name="valid_until" type="date" defaultValue={quote.valid_until || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={quote.notes || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Changes
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
