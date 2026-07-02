import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function acceptQuote(token: string) {
  "use server";

  await supabase
    .from("quotes")
    .update({ status: "Accepted", accepted_at: new Date().toISOString() })
    .eq("token", token);

  revalidatePath(`/q/${token}`);
}

async function declineQuote(token: string) {
  "use server";

  await supabase
    .from("quotes")
    .update({ status: "Declined", declined_at: new Date().toISOString() })
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
    .select("*, clients(client_name), quote_lines(*)")
    .eq("token", token)
    .single();

  if (error || !quote) notFound();

  const acceptWithToken = acceptQuote.bind(null, token);
  const declineWithToken = declineQuote.bind(null, token);

  const isAccepted = quote.status === "Accepted";
  const isDeclined = quote.status === "Declined";
  const isResponded = isAccepted || isDeclined;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">E&P Accountancy Services</h1>
            <p className="text-slate-400 text-sm mt-0.5">Practice Management</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400">Quote</p>
            <p className="font-bold text-lg">{quote.quote_number}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        {/* Status Banner */}
        {isAccepted && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center">
            <p className="text-green-700 font-bold text-lg">✓ Quote Accepted</p>
            <p className="text-green-600 text-sm mt-1">
              Thank you! We'll be in touch shortly to get started.
            </p>
          </div>
        )}

        {isDeclined && (
          <div className="mb-6 rounded-2xl bg-red-50 border border-red-200 p-4 text-center">
            <p className="text-red-700 font-bold text-lg">Quote Declined</p>
            <p className="text-red-600 text-sm mt-1">
              Thank you for letting us know. Please get in touch if you have any questions.
            </p>
          </div>
        )}

        {/* Quote Details */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">

          {/* Client & Date Info */}
          <div className="p-6 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Prepared for</p>
                <p className="mt-1 font-bold text-slate-900 text-lg">
                  {quote.clients?.client_name || "Client"}
                </p>
              </div>
              <div className="text-right">
                <div className="space-y-1">
                  <div>
                    <p className="text-xs text-slate-500">Quote Date</p>
                    <p className="text-sm font-medium text-slate-900">
                      {quote.quote_date
                        ? new Date(quote.quote_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Valid Until</p>
                    <p className="text-sm font-medium text-slate-900">
                      {quote.valid_until
                        ? new Date(quote.valid_until).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="p-6">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">
                    Description
                  </th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">
                    Qty
                  </th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">
                    Price
                  </th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pb-3">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(quote.quote_lines || []).map((line: any) => (
                  <tr key={line.id}>
                    <td className="py-4 text-sm text-slate-900">{line.description}</td>
                    <td className="py-4 text-sm text-slate-600 text-right">{line.qty}</td>
                    <td className="py-4 text-sm text-slate-600 text-right">
                      £{Number(line.price).toFixed(2)}
                    </td>
                    <td className="py-4 text-sm font-medium text-slate-900 text-right">
                      £{Number(line.line_total).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-slate-100 p-6 bg-slate-50">
            <div className="max-w-xs ml-auto space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium text-slate-900">
                  £{Number(quote.subtotal || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">VAT</span>
                <span className="font-medium text-slate-900">
                  £{Number(quote.vat || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-slate-200 pt-2 mt-2">
                <span className="text-slate-900">Total</span>
                <span className="text-slate-900">
                  £{Number(quote.total || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {quote.notes && (
            <div className="border-t border-slate-100 p-6">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Notes</p>
              <p className="text-sm text-slate-600">{quote.notes}</p>
            </div>
          )}
        </div>

        {/* Accept / Decline Buttons */}
        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900 text-center">
              Would you like to proceed?
            </h2>
            <p className="text-sm text-slate-500 text-center mt-1">
              Please accept or decline this quote below.
            </p>

            <div className="mt-6 flex gap-4 justify-center">
              <form action={acceptWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-green-600 px-8 py-3 text-sm font-bold text-white hover:bg-green-700 transition-colors"
                >
                  ✓ Accept Quote
                </button>
              </form>

              <form action={declineWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-white border border-slate-200 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Decline
                </button>
              </form>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          This quote was prepared by E&P Accountancy Services · {quote.quote_number}
        </p>

      </div>
    </div>
  );
}
