import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formatGBP = (amount: number | string | null | undefined) => {
  const num = typeof amount === "string" ? parseFloat(amount) : Number(amount ?? 0);
  if (isNaN(num)) return "£0.00";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

async function acceptQuote(token: string, formData: FormData) {
  "use server";

  const acceptedBy = String(formData.get("accepted_by") || "").trim();

  const updatePayload: Record<string, any> = {
    status: "Accepted",
    accepted_at: new Date().toISOString(),
  };

  if (acceptedBy) {
    updatePayload.accepted_by = acceptedBy;
  }

  const { error } = await supabase
    .from("quotes")
    .update(updatePayload)
    .eq("token", token);

  // Fallback if the `accepted_by` column hasn't been added to `quotes` yet
  if (error && acceptedBy) {
    await supabase
      .from("quotes")
      .update({
        status: "Accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("token", token);
  }

  revalidatePath(`/q/${token}`);
}

async function declineQuote(token: string) {
  "use server";

  await supabase
    .from("quotes")
    .update({
      status: "Declined",
      declined_at: new Date().toISOString(),
    })
    .eq("token", token);

  revalidatePath(`/q/${token}`);
}

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, clients(client_name, email), quote_lines(*)")
    .eq("token", token)
    .single();

  if (error || !quote) notFound();

  const { data: engagementLetter } = await supabase
    .from("engagement_letters")
    .select("services_description, fee_description, custom_terms, partner_name, status")
    .eq("quote_id", quote.id)
    .maybeSingle();

  const acceptWithToken = acceptQuote.bind(null, token);
  const declineWithToken = declineQuote.bind(null, token);

  const isAccepted = quote.status === "Accepted";
  const isDeclined = quote.status === "Declined";
  const isResponded = isAccepted || isDeclined;
  const lines: any[] = quote.quote_lines || [];

  return (
    <div className="min-h-screen bg-slate-100/80 text-slate-900">
      {/* Top Practice Bar */}
      <header className="bg-slate-950 text-white border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-sm tracking-wide">
              E&amp;P
            </div>
            <div>
              <p className="text-base font-bold tracking-tight">E&amp;P Accountancy Services</p>
              <p className="text-xs text-slate-400">Client Proposal &amp; Scope of Services</p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              Proposal {quote.quote_number}
            </span>
            {quote.valid_until && (
              <p className="text-xs text-slate-400 mt-1">
                Valid until {formatDate(quote.valid_until)}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Status Banner */}
        {isAccepted && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-emerald-900 font-bold text-base">
                Proposal Accepted — Thank You
              </p>
              <p className="text-emerald-700 text-sm mt-0.5">
                We have recorded your acceptance and will be in touch shortly to kick things off.
              </p>
            </div>
            <span className="self-start sm:self-center rounded-full bg-emerald-600 px-3.5 py-1 text-xs font-semibold text-white">
              Accepted
            </span>
          </div>
        )}

        {isDeclined && (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-rose-900 font-bold text-base">Proposal Declined</p>
              <p className="text-rose-700 text-sm mt-0.5">
                Thank you for letting us know. Please reach out if you would like to adjust the scope or fee.
              </p>
            </div>
            <span className="self-start sm:self-center rounded-full bg-rose-600 px-3.5 py-1 text-xs font-semibold text-white">
              Declined
            </span>
          </div>
        )}

        {/* Executive Overview Card */}
        <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-6 sm:p-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 pb-6 border-b border-slate-100">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                Prepared Exclusively For
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
                {quote.clients?.client_name || "Valued Client"}
              </h1>
              <p className="text-sm text-slate-500 mt-2 max-w-xl">
                Review your proposed services, investment summary, and engagement terms below before confirming how you would like to proceed.
              </p>
            </div>

            <div className="rounded-2xl bg-slate-50 border border-slate-200/70 p-4 min-w-[210px]">
              <p className="text-xs font-medium text-slate-500">Total Investment (inc. VAT)</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {formatGBP(quote.total)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Issued {formatDate(quote.quote_date)}
              </p>
            </div>
          </div>

          {/* Key Metadata Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 text-sm">
            <div>
              <p className="text-xs text-slate-400">Reference</p>
              <p className="font-semibold text-slate-800 mt-0.5">{quote.quote_number}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Proposal Date</p>
              <p className="font-semibold text-slate-800 mt-0.5">{formatDate(quote.quote_date)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Valid Until</p>
              <p className="font-semibold text-slate-800 mt-0.5">{formatDate(quote.valid_until)}</p>
            </div>
          </div>

          {quote.notes && (
            <div className="mt-6 rounded-xl bg-slate-50 border border-slate-200/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Proposal Notes
              </p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{quote.notes}</p>
            </div>
          )}
        </section>

        {/* Scope of Services & Pricing */}
        <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-6 sm:px-8 py-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Scope of Services</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Itemised breakdown of work included in this proposal.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400">
              {lines.length} {lines.length === 1 ? "item" : "items"}
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {lines.map((line) => (
              <div
                key={line.id}
                className="px-6 sm:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/60 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{line.description}</p>
                    {line.include_in_renewal === false && (
                      <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                        One-off item
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Qty {line.qty} × {formatGBP(line.price)}
                    {line.vat_rate !== undefined && line.vat_rate !== null ? ` · ${line.vat_rate}% VAT` : ""}
                  </p>
                </div>

                <div className="sm:text-right">
                  <p className="text-sm font-bold text-slate-900">{formatGBP(line.line_total)}</p>
                  <p className="text-[11px] text-slate-400">excl. VAT</p>
                </div>
              </div>
            ))}

            {lines.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-slate-500">
                No line items have been added to this proposal yet.
              </div>
            )}
          </div>

          {/* Investment Summary Footer */}
          <div className="bg-slate-50 border-t border-slate-200/70 px-6 sm:px-8 py-6">
            <div className="max-w-sm ml-auto space-y-2.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-medium text-slate-900">{formatGBP(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>VAT</span>
                <span className="font-medium text-slate-900">{formatGBP(quote.vat)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-slate-900 pt-3 border-t border-slate-200">
                <span>Total</span>
                <span>{formatGBP(quote.total)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Linked Engagement Summary (if present) */}
        {engagementLetter && (engagementLetter.services_description || engagementLetter.custom_terms) && (
          <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-6 sm:p-8 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Engagement Summary &amp; Terms</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Key terms linked to this proposal
                {engagementLetter.partner_name ? ` · Partner: ${engagementLetter.partner_name}` : ""}.
              </p>
            </div>

            {engagementLetter.services_description && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Agreed Services
                </p>
                <p className="text-sm text-slate-700 whitespace-pre-line">
                  {engagementLetter.services_description}
                </p>
              </div>
            )}

            {engagementLetter.custom_terms && (
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Terms &amp; Conditions
                </p>
                <p className="text-sm text-slate-600 whitespace-pre-line">
                  {engagementLetter.custom_terms}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Acceptance & Sign-off Card */}
        {!isResponded && (
          <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-6 sm:p-8">
            <div className="max-w-xl mx-auto">
              <h2 className="text-xl font-bold text-slate-900 text-center">
                Ready to get started?
              </h2>
              <p className="text-sm text-slate-500 text-center mt-1">
                Accept this proposal to confirm the scope and fees above, or let us know if you would like to decline.
              </p>

              <form action={acceptWithToken} className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="accepted_by"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                  >
                    Your Name (for acceptance record)
                  </label>
                  <input
                    id="accepted_by"
                    name="accepted_by"
                    type="text"
                    placeholder="e.g. Jane Smith"
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    I confirm that I have reviewed the scope of services and investment total above and authorise E&amp;P Accountancy Services to proceed.
                  </span>
                </label>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  Accept Proposal
                </button>
              </form>

              <form action={declineWithToken} className="mt-3 text-center">
                <button
                  type="submit"
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Decline Proposal
                </button>
              </form>
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-slate-400 pt-2 pb-6">
          Prepared by E&amp;P Accountancy Services · {quote.quote_number}
        </footer>
      </main>
    </div>
  );
}