import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { computeBalanceSheet } from "../../accounts-production/[id]/frs105/page";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function approveAccounts(token: string) {
  "use server";
  await supabase
    .from("trial_balances")
    .update({ approval_status: "Approved", approved_at: new Date().toISOString() })
    .eq("approval_token", token);
  revalidatePath(`/a/${token}`);
}

async function queryAccounts(token: string) {
  "use server";
  await supabase
    .from("trial_balances")
    .update({ approval_status: "Queried", queried_at: new Date().toISOString() })
    .eq("approval_token", token);
  revalidatePath(`/a/${token}`);
}

export default async function PublicAccountsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name)")
    .eq("approval_token", token)
    .single();

  if (error || !tb) notFound();

  const [{ data: lines }] = await Promise.all([
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", tb.id),
  ]);

  const result = await computeBalanceSheet(tb.client_id, tb.job_id, tb.period_end, lines || []);

  const approveWithToken = approveAccounts.bind(null, token);
  const queryWithToken = queryAccounts.bind(null, token);

  const isApproved = tb.approval_status === "Approved";
  const isQueried = tb.approval_status === "Queried";
  const isResponded = isApproved || isQueried;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const periodStartFormatted = new Date(tb.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const periodEndFormatted = new Date(tb.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const standardLabel = tb.accounts_type === "FRS102" ? "FRS 102 Section 1A" : "FRS 105 Micro-Entity";

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
            <p className="text-sm text-slate-400">Financial Statements</p>
            <p className="font-bold text-lg">Year Ended {periodEndFormatted}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        {/* Status Banner */}
        {isApproved && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center">
            <p className="text-green-700 font-bold text-lg">✓ Accounts Approved</p>
            <p className="text-green-600 text-sm mt-1">
              Thank you! We'll proceed to finalise and file your accounts.
            </p>
            {tb.approved_at && (
              <p className="text-green-500 text-xs mt-2">
                Approved on {new Date(tb.approved_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at {new Date(tb.approved_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}

        {isQueried && (
          <div className="mb-6 rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-center">
            <p className="text-yellow-700 font-bold text-lg">Query Raised</p>
            <p className="text-yellow-600 text-sm mt-1">
              Thanks for letting us know. We'll be in touch to go through it with you.
            </p>
            {tb.queried_at && (
              <p className="text-yellow-500 text-xs mt-2">
                Raised on {new Date(tb.queried_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at {new Date(tb.queried_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">

          {/* Client Info */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Prepared for</p>
            <p className="mt-1 font-bold text-slate-900 text-lg">
              {tb.clients?.client_name || "Client"}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Period: {periodStartFormatted} to {periodEndFormatted} · {standardLabel} accounts
            </p>
          </div>

          {/* P&L Summary */}
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Profit & Loss Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Turnover</span><span className="font-medium">{fmt(result.pl.turnover)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Gross Profit</span><span className="font-medium">{fmt(result.pl.grossProfit)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Profit Before Taxation</span>
                <span>{fmt(result.pl.profitBeforeTax)}</span>
              </div>
            </div>
          </div>

          {/* Balance Sheet Summary */}
          <div className="p-6 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Balance Sheet Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Fixed Assets</span><span className="font-medium">{fmt(result.fixedAssetsNBV)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Net Current Assets</span><span className="font-medium">{fmt(result.netCurrentAssets)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Net Assets</span>
                <span>{fmt(result.netAssets)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Shareholders' Funds</span>
                <span>{fmt(result.shareholdersFunds)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Approve / Query Buttons */}
        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900 text-center">
              Do these figures look correct?
            </h2>
            <p className="text-sm text-slate-500 text-center mt-1">
              Please approve below, or raise a query if anything needs checking.
            </p>

            <div className="mt-6 flex gap-4 justify-center">
              <form action={approveWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-green-600 px-8 py-3 text-sm font-bold text-white hover:bg-green-700 transition-colors"
                >
                  ✓ Approve
                </button>
              </form>

              <form action={queryWithToken}>
                <button
                  type="submit"
                  className="rounded-xl bg-white border border-slate-200 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  I Have a Question
                </button>
              </form>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          Prepared by E&P Accountancy Services · Year ended {periodEndFormatted} · This is a summary for approval purposes and does not constitute a filed return.
        </p>

      </div>
    </div>
  );
}
