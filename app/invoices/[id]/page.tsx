import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateInvoice(id: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();

  await supabase.from("invoices").update({
    status: get("status"),
    invoice_date: get("invoice_date") || null,
    due_date: get("due_date") || null,
    notes: get("notes"),
    paid_at: get("status") === "Paid" ? new Date().toISOString() : null,
  }).eq("id", id);

  revalidatePath(`/invoices/${id}`);
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [{ data: invoice, error }, { data: lines }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, clients(client_name, address, email), jobs(job_name), quotes(quote_number)")
      .eq("id", id)
      .single(),
    supabase
      .from("invoice_lines")
      .select("*, jobs(job_name)")
      .eq("invoice_id", id),
  ]);

  if (error || !invoice) notFound();

  const updateWithId = updateInvoice.bind(null, id);

  const isOverdue = invoice.status !== "Paid" && invoice.due_date && new Date(invoice.due_date) < new Date();

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/invoices" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Invoices
        </a>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{invoice.invoice_number}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {invoice.clients?.client_name || "No client"}
              {invoice.jobs?.job_name && ` · ${invoice.jobs.job_name}`}
              {invoice.quotes?.quote_number && ` · from ${invoice.quotes.quote_number}`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isOverdue && (
              <span className="rounded-full bg-red-100 text-red-700 px-4 py-2 text-sm font-semibold">
                Overdue
              </span>
            )}
            <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
              invoice.status === "Paid" ? "bg-green-100 text-green-700"
              : invoice.status === "Sent" ? "bg-blue-100 text-blue-700"
              : "bg-slate-100 text-slate-600"
            }`}>
              {invoice.status}
            </span>
          </div>
        </div>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">

        {/* Left - Invoice preview */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-100">

            {/* Invoice header */}
            <div className="flex items-start justify-between mb-8">
              <div>
                <p className="text-xl font-bold text-slate-900">E&P Accountancy Services Limited</p>
                <p className="text-sm text-slate-500 mt-1">Invoice</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900">{invoice.invoice_number}</p>
                <p className="text-sm text-slate-500 mt-1">
                  Date: {invoice.invoice_date
                    ? new Date(invoice.invoice_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                </p>
                {invoice.due_date && (
                  <p className={`text-sm mt-0.5 ${isOverdue ? "text-red-600 font-semibold" : "text-slate-500"}`}>
                    Due: {new Date(invoice.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>

            {/* Bill to */}
            <div className="mb-8">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Bill To</p>
              <p className="font-semibold text-slate-900">{invoice.clients?.client_name}</p>
              {invoice.clients?.address && (
                <p className="text-sm text-slate-500 mt-0.5">{invoice.clients.address}</p>
              )}
              {invoice.clients?.email && (
                <p className="text-sm text-slate-500">{invoice.clients.email}</p>
              )}
            </div>

            {/* Line items */}
            <table className="w-full mb-8">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">Description</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">Qty</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">Price</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(lines || []).map((line) => (
                  <tr key={line.id}>
                    <td className="py-4 text-sm text-slate-900">
                      {line.description}
                      {(line.jobs as any)?.job_name && (
                        <span className="block mt-0.5 text-xs font-medium text-blue-600">
                          {(line.jobs as any).job_name}
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-sm text-slate-600 text-right align-top">{line.qty}</td>
                    <td className="py-4 text-sm text-slate-600 text-right align-top">£{Number(line.price).toFixed(2)}</td>
                    <td className="py-4 text-sm font-medium text-slate-900 text-right align-top">£{Number(line.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="border-t border-slate-200 pt-4">
              <div className="max-w-xs ml-auto space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="font-medium">£{Number(invoice.subtotal || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">VAT</span>
                  <span className="font-medium">£{Number(invoice.vat || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-base font-bold border-t border-slate-200 pt-2">
                  <span>Total</span>
                  <span>£{Number(invoice.total || 0).toFixed(2)}</span>
                </div>
                {invoice.status === "Paid" && invoice.paid_at && (
                  <div className="rounded-xl bg-green-50 border border-green-100 p-3 mt-3">
                    <p className="text-sm font-semibold text-green-700">
                      ✓ Paid on {new Date(invoice.paid_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {invoice.notes && (
              <div className="mt-6 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Notes</p>
                <p className="text-sm text-slate-600">{invoice.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right - Actions */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Invoice Details</h2>

            <form action={updateWithId} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select name="status" defaultValue={invoice.status || "Draft"}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option>Draft</option>
                  <option>Sent</option>
                  <option>Paid</option>
                  <option>Overdue</option>
                  <option>Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date</label>
                <input name="invoice_date" type="date" defaultValue={invoice.invoice_date || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                <input name="due_date" type="date" defaultValue={invoice.due_date || ""}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" defaultValue={invoice.notes || ""} rows={3}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>

              <button type="submit"
                className="w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Changes
              </button>
            </form>
          </div>

          {/* Quick actions */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Quick Actions</h2>
            <div className="mt-4 space-y-2">
              <form action={updateWithId}>
                <input type="hidden" name="status" value="Paid" />
                <input type="hidden" name="invoice_date" value={invoice.invoice_date || ""} />
                <input type="hidden" name="due_date" value={invoice.due_date || ""} />
                <input type="hidden" name="notes" value={invoice.notes || ""} />
                <button type="submit"
                  className="w-full rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors">
                  ✓ Mark as Paid
                </button>
              </form>
              <form action={updateWithId}>
                <input type="hidden" name="status" value="Sent" />
                <input type="hidden" name="invoice_date" value={invoice.invoice_date || ""} />
                <input type="hidden" name="due_date" value={invoice.due_date || ""} />
                <input type="hidden" name="notes" value={invoice.notes || ""} />
                <button type="submit"
                  className="w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                  📧 Mark as Sent
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
