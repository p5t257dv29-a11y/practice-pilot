import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STATUS_OPTIONS = ["Draft", "Sent", "Accepted", "Declined", "Expired"];

async function deleteQuote(id: string) {
  "use server";

  await supabase.from("quotes").delete().eq("id", id);
  revalidatePath("/quotes");
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status: statusFilter } = await searchParams;
  const query = (q || "").trim().toLowerCase();

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

  const filteredQuotes = (quotes || []).filter((quote) => {
    if (statusFilter && (quote.status || "Draft") !== statusFilter) return false;
    if (query) {
      const haystack = [quote.quote_number, quote.clients?.client_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const isFiltered = Boolean(query || statusFilter);

  const totalQuoted = (quotes || []).reduce((sum, q) => sum + Number(q.total || 0), 0);
  const acceptedValue = (quotes || [])
    .filter((q) => q.status === "Accepted")
    .reduce((sum, q) => sum + Number(q.total || 0), 0);
  const pending = (quotes || []).filter((q) => (q.status || "Draft") === "Draft" || q.status === "Sent").length;

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
          <a href="/quotes/new"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            + New Quote
          </a>
        </div>


        {/* Stats */}
        <div className="mt-4 flex gap-8">
          <div>
            <p className="text-xs text-slate-500">Total Quoted</p>
            <p className="text-2xl font-bold text-slate-900">£{totalQuoted.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Accepted Value</p>
            <p className="text-2xl font-bold text-green-600">£{acceptedValue.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Pending</p>
            <p className="text-2xl font-bold text-orange-600">{pending}</p>
          </div>
        </div>

        {/* Search + status filter */}
        <form method="get" className="mt-4 flex gap-2 max-w-2xl">
          <input
            name="q"
            defaultValue={q || ""}
            placeholder="Search by client or quote number..."
            className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <select
            name="status"
            defaultValue={statusFilter || ""}
            className="rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button type="submit"
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
            Search
          </button>
          {isFiltered && (
            <a href="/quotes"
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center">
              Clear
            </a>
          )}
        </form>
      </div>

      <div className="p-8">

        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load quotes: {error.message}
          </div>
        )}

        {/* Quotes List */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {isFiltered ? `Search Results (${filteredQuotes.length})` : `All Quotes (${quotes?.length ?? 0})`}
          </h2>
          <div className="mt-4 space-y-3">
            {filteredQuotes.map((quote) => (
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

            {isFiltered && filteredQuotes.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">
                No quotes match your search.
              </p>
            )}

            {!isFiltered && quotes && quotes.length === 0 && (
              <div className="text-center py-12">
                <p className="text-slate-500 text-sm">No quotes yet.</p>
                <a href="/quotes/new"
                  className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  + New Quote
                </a>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
