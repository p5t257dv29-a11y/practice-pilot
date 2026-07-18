import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function deleteInvoice(id: string) {
  "use server";
  await supabase.from("invoices").delete().eq("id", id);
  revalidatePath("/invoices");
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q || "").trim().toLowerCase();

  const [{ data: invoices, error }, { data: clients }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, clients(client_name), jobs(job_name), quotes(quote_number)")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, client_name")
      .order("client_name", { ascending: true }),
  ]);

  const filteredInvoices = query
    ? (invoices || []).filter((invoice) => {
        const haystack = [
          invoice.invoice_number,
          invoice.clients?.client_name,
          invoice.jobs?.job_name,
          invoice.quotes?.quote_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
    : (invoices || []);

  const totalOutstanding = (invoices || [])
    .filter(i => i.status !== "Paid")
    .reduce((sum, i) => sum + Number(i.total || 0), 0);

  const totalPaid = (invoices || [])
    .filter(i => i.status === "Paid")
    .reduce((sum, i) => sum + Number(i.total || 0), 0);

  const overdue = (invoices || []).filter(i => 
    i.status !== "Paid" && i.due_date && new Date(i.due_date) < new Date()
  ).length;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage client invoices. Raise directly, or convert an accepted quote.
            </p>
          </div>
          <div className="flex gap-3">
            <a href="/invoices/new"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              + New Invoice
            </a>
            <a href="/quotes"
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              Convert Quote →
            </a>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 flex gap-8">
          <div>
            <p className="text-xs text-slate-500">Outstanding</p>
            <p className="text-2xl font-bold text-orange-600">£{totalOutstanding.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Paid (all time)</p>
            <p className="text-2xl font-bold text-green-600">£{totalPaid.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Overdue</p>
            <p className="text-2xl font-bold text-red-600">{overdue}</p>
          </div>
        </div>

        {/* Search */}
        <form method="get" className="mt-4 flex gap-2 max-w-md">
          <input
            name="q"
            defaultValue={q || ""}
            placeholder="Search by client, invoice number, job, or quote..."
            className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <button type="submit"
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
            Search
          </button>
          {q && (
            <a href="/invoices"
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center">
              Clear
            </a>
          )}
        </form>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load invoices: {error.message}
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {query ? `Search Results (${filteredInvoices.length})` : `All Invoices (${invoices?.length ?? 0})`}
          </h2>

          <div className="mt-4 space-y-3">
            {filteredInvoices.map((invoice) => (
              <div key={invoice.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                <a href={`/invoices/${invoice.id}`} className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">
                      {invoice.invoice_number}
                    </p>
                    {invoice.quotes?.quote_number && (
                      <span className="text-xs text-slate-400">
                        from {invoice.quotes.quote_number}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {invoice.clients?.client_name || "No client"}
                    {invoice.jobs?.job_name && ` · ${invoice.jobs.job_name}`}
                  </p>
                  {invoice.due_date && (
                    <p className={`text-xs mt-1 ${
                      invoice.status !== "Paid" && new Date(invoice.due_date) < new Date()
                        ? "text-red-500 font-semibold"
                        : "text-slate-400"
                    }`}>
                      Due: {new Date(invoice.due_date).toLocaleDateString("en-GB")}
                      {invoice.status !== "Paid" && new Date(invoice.due_date) < new Date() && " — OVERDUE"}
                    </p>
                  )}
                </a>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-bold text-slate-900">£{Number(invoice.total || 0).toFixed(2)}</p>
                    <p className="text-xs text-slate-400">inc. VAT</p>
                  </div>

                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    invoice.status === "Paid" ? "bg-green-100 text-green-700"
                    : invoice.status === "Sent" ? "bg-blue-100 text-blue-700"
                    : invoice.status === "Overdue" ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {invoice.status}
                  </span>

                  <form action={deleteInvoice.bind(null, invoice.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}

            {query && filteredInvoices.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-12">
                No invoices match "{q}".
              </p>
            )}

            {!query && invoices && invoices.length === 0 && (
              <div className="text-center py-12">
                <p className="text-slate-500 text-sm">No invoices yet.</p>
                <p className="text-slate-400 text-xs mt-1">
                  Raise one directly, or convert an accepted quote.
                </p>
                <a href="/invoices/new"
                  className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  + New Invoice
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
