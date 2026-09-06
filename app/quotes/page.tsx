import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper function to format GBP currency with thousands commas
const formatCurrency = (amount: number | string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "£0.00";

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const STATUS_OPTIONS = ["Draft", "Sent", "Accepted", "Declined", "Expired"];

// Works out the next annual anchor date for a recurring quote — the day the
// following year's draft should exist by. For companies, this follows the
// month/day of the client's year_end (never mutated, just read fresh each
// time so it works indefinitely without manual upkeep). For everyone else
// (sole traders, individuals, payroll), it follows the fixed UK tax year
// boundary of 6 April. Returns the first such date strictly after `fromDate`.
export function getNextAnchorDate(entityType: string | null, clientYearEnd: string | null, fromDate: Date): Date {
  const isCompany = entityType === "Limited Company";

  let month: number;
  let day: number;
  if (isCompany && clientYearEnd) {
    const yearEnd = new Date(clientYearEnd);
    month = yearEnd.getMonth();
    day = yearEnd.getDate();
  } else {
    // UK tax year ends 5 April, new year starts 6 April
    month = 3; // April (0-indexed)
    day = 5;
  }

  let candidate = new Date(fromDate.getFullYear(), month, day);
  while (candidate <= fromDate) {
    candidate = new Date(candidate.getFullYear() + 1, month, day);
  }
  return candidate;
}

// Checks every accepted, recurring quote for whether its next-year draft is due
// yet (i.e. we're now past the day after its anchor date), and if so, creates
// that draft — copying the quote's lines and its linked engagement letter,
// ready for staff to review and adjust before sending as a combined renewal.
// Runs on every Quotes page load; since it only ever acts on genuinely new
// anniversaries, repeated runs are harmless.
async function spawnDueRecurringQuotes() {
  const { data: recurringQuotes } = await supabase
    .from("quotes")
    .select("*, clients(entity_type, year_end)")
    .eq("is_recurring", true)
    .eq("status", "Accepted");

  if (!recurringQuotes || recurringQuotes.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const quote of recurringQuotes) {
    // Skip if a child has already been spawned from this quote
    const { data: existingChild } = await supabase
      .from("quotes")
      .select("id")
      .eq("recurrence_parent_id", quote.id)
      .maybeSingle();
    if (existingChild) continue;

    const client = quote.clients as any;
    const anchorDate = getNextAnchorDate(client?.entity_type || null, client?.year_end || null, new Date(quote.quote_date || quote.created_at));

    // The draft should exist from the day after the anchor date onward
    const dueDate = new Date(anchorDate);
    dueDate.setDate(dueDate.getDate() + 1);
    if (today < dueDate) continue;

    // Copy the quote itself
    const { data: allQuotes } = await supabase.from("quotes").select("quote_number");
    let highest = 4;
    for (const q of allQuotes || []) {
      const match = q.quote_number?.match(/Q-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (match[1].length <= 4 && num > highest) highest = num;
      }
    }
    const newQuoteNumber = `Q-${String(highest + 1).padStart(4, "0")}`;

    const { data: newQuote, error: newQuoteError } = await supabase
      .from("quotes")
      .insert({
        quote_number: newQuoteNumber,
        client_id: quote.client_id,
        quote_date: dueDate.toISOString().split("T")[0],
        valid_until: null,
        status: "Draft",
        notes: quote.notes,
        subtotal: quote.subtotal,
        vat: quote.vat,
        total: quote.total,
        is_recurring: true,
        recurrence_parent_id: quote.id,
      })
      .select()
      .single();

    if (newQuoteError || !newQuote) {
      console.error("Could not spawn recurring quote:", newQuoteError?.message);
      continue;
    }

    // Copy the quote lines
    const { data: lines } = await supabase.from("quote_lines").select("*").eq("quote_id", quote.id);
    if (lines && lines.length > 0) {
      await supabase.from("quote_lines").insert(
        lines.map((l) => ({
          quote_id: newQuote.id,
          service_id: l.service_id,
          description: l.description,
          qty: l.qty,
          price: l.price,
          vat_rate: l.vat_rate,
          line_total: l.line_total,
        }))
      );
    }

    // Copy the linked engagement letter, if one exists, as a fresh draft
    const { data: existingLetter } = await supabase
      .from("engagement_letters")
      .select("*")
      .eq("quote_id", quote.id)
      .maybeSingle();

    if (existingLetter) {
      await supabase.from("engagement_letters").insert({
        client_id: existingLetter.client_id,
        quote_id: newQuote.id,
        client_email: existingLetter.client_email,
        status: "Draft",
        services_description: existingLetter.services_description,
        fee_description: existingLetter.fee_description,
        start_date: dueDate.toISOString().split("T")[0],
        partner_name: existingLetter.partner_name,
        custom_terms: existingLetter.custom_terms,
        notes: "Auto-generated renewal draft — review services and fee before sending.",
      });
    }
  }
}

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

  await spawnDueRecurringQuotes();

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
  const pending = (quotes || []).filter(
    (q) => (q.status || "Draft") === "Draft" || q.status === "Sent"
  ).length;

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
          <a
            href="/quotes/new"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            + New Quote
          </a>
        </div>

        {/* Stats */}
        <div className="mt-4 flex gap-8">
          <div>
            <p className="text-xs text-slate-500">Total Quoted</p>
            <p className="text-2xl font-bold text-slate-900">
              {formatCurrency(totalQuoted)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Accepted Value</p>
            <p className="text-2xl font-bold text-green-600">
              {formatCurrency(acceptedValue)}
            </p>
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
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          >
            Search
          </button>
          {isFiltered && (
            <a
              href="/quotes"
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center"
            >
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
            {isFiltered
              ? `Search Results (${filteredQuotes.length})`
              : `All Quotes (${quotes?.length ?? 0})`}
          </h2>
          <div className="mt-4 space-y-3">
            {filteredQuotes.map((quote) => (
              <div
                key={quote.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors"
              >
                <Link href={`/quotes/${quote.id}`} className="flex-1">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-sm font-bold text-blue-600">
                      📋
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">
                          {quote.quote_number} — {quote.clients?.client_name || "No client"}
                        </p>
                        {quote.is_recurring && (
                          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-600">
                            Recurring
                          </span>
                        )}
                        {quote.recurrence_parent_id && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                            Renewal
                          </span>
                        )}
                      </div>
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
                      {formatCurrency(quote.total || 0)}
                    </p>
                    <p className="text-xs text-slate-400">inc. VAT</p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      quote.status === "Accepted"
                        ? "bg-green-100 text-green-700"
                        : quote.status === "Sent"
                        ? "bg-blue-100 text-blue-700"
                        : quote.status === "Declined"
                        ? "bg-red-100 text-red-700"
                        : quote.status === "Expired"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
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
                <a
                  href="/quotes/new"
                  className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
                >
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