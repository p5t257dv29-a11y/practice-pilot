import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { computeBalanceSheet } from "../../accounts-production/[id]/frs105/page";
import { getCustomPLCategories, CREDIT_NORMAL, PL_CATEGORY_GROUPS } from "../../accounts-production/page";
import PrintButton from "../../print-button";

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

  const [{ data: lines }, customPL, { data: practiceSettings }] = await Promise.all([
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", tb.id),
    getCustomPLCategories(supabase),
    supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle(),
  ]);

  const firmName = practiceSettings?.firm_name || "Your Accountant";

  const result = await computeBalanceSheet(tb.client_id, tb.period_end, lines || [], customPL.groups);

  // Direct category totals — same pattern used on the internal draft accounts page —
  // so we can show individual balance sheet lines and an admin expense breakdown,
  // not just the rolled-up totals computeBalanceSheet gives us.
  const totals = new Map<string, number>();
  (lines || []).forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category)
      ? Number(l.credit) - Number(l.debit)
      : Number(l.debit) - Number(l.credit);
    totals.set(l.category, (totals.get(l.category) || 0) + net);
  });
  const get = (cat: string) => totals.get(cat) || 0;
  const groupOf = (cat: string) => PL_CATEGORY_GROUPS[cat] || customPL.groups[cat];

  const stock = get("Stock");
  const debtors = get("Trade Debtors");
  const prepayments = get("Prepayments and Accrued Income");
  const cash = get("Cash at Bank and in Hand");

  const adminExpenseLines: { category: string; value: number }[] = [];
  totals.forEach((value, cat) => {
    if (groupOf(cat) === "admin_expenses") {
      adminExpenseLines.push({ category: cat, value });
    }
  });
  adminExpenseLines.sort((a, b) => b.value - a.value);

  const approveWithToken = approveAccounts.bind(null, token);
  const queryWithToken = queryAccounts.bind(null, token);

  const isApproved = tb.approval_status === "Approved";
  const isQueried = tb.approval_status === "Queried";
  const isResponded = isApproved || isQueried;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtSigned = (n: number) => n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
  const periodStartFormatted = new Date(tb.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const periodEndFormatted = new Date(tb.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const standardLabel = tb.accounts_type === "FRS102" ? "FRS 102 Section 1A" : "FRS 105 Micro-Entity";

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">

      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-6 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{firmName}</h1>
            <p className="text-slate-400 text-sm mt-0.5 print:text-slate-500">Practice Management</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400 print:text-slate-500">Financial Statements</p>
            <p className="font-bold text-lg">Year Ended {periodEndFormatted}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        <div className="flex justify-end mb-4 print:hidden">
          <PrintButton />
        </div>

        {/* Status Banner */}
        {isApproved && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center print:hidden">
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
          <div className="mb-6 rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-center print:hidden">
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

        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none">

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

          {/* Profit & Loss */}
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Profit & Loss Account</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Turnover</span><span className="font-medium">{fmt(result.pl.turnover)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Cost of Sales</span><span className="font-medium">{fmtSigned(-result.pl.costOfSales)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Gross Profit</span><span>{fmt(result.pl.grossProfit)}</span></div>

              {adminExpenseLines.length > 0 ? (
                <div className="pt-1">
                  <div className="flex justify-between"><span className="text-slate-500">Administrative Expenses</span><span className="font-medium">{fmtSigned(-result.pl.adminExpenses)}</span></div>
                  <div className="pl-4 mt-1 space-y-1">
                    {adminExpenseLines.map((l) => (
                      <div key={l.category} className="flex justify-between text-xs text-slate-400">
                        <span>{l.category}</span>
                        <span>{fmtSigned(-l.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex justify-between"><span className="text-slate-500">Administrative Expenses</span><span className="font-medium">{fmtSigned(-result.pl.adminExpenses)}</span></div>
              )}

              <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Operating Profit</span><span>{fmt(result.pl.operatingProfit)}</span></div>

              {(result.pl.interestReceivable !== 0 || result.pl.interestPayable !== 0) && (
                <>
                  {result.pl.interestReceivable !== 0 && (
                    <div className="flex justify-between"><span className="text-slate-500">Interest Receivable</span><span className="font-medium">{fmt(result.pl.interestReceivable)}</span></div>
                  )}
                  {result.pl.interestPayable !== 0 && (
                    <div className="flex justify-between"><span className="text-slate-500">Interest Payable</span><span className="font-medium">{fmtSigned(-result.pl.interestPayable)}</span></div>
                  )}
                </>
              )}

              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Profit Before Taxation</span>
                <span>{fmt(result.pl.profitBeforeTax)}</span>
              </div>
            </div>
          </div>

          {/* Balance Sheet */}
          <div className="p-6 bg-slate-50 print:bg-white">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Balance Sheet</h2>
            <div className="space-y-2 text-sm">

              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-1">Fixed Assets</p>
              {result.intangibleAssetsNBV !== 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Intangible Assets</span><span className="font-medium">{fmt(result.intangibleAssetsNBV)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Tangible Assets</span><span className="font-medium">{fmt(result.fixedAssetsNBV)}</span></div>

              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Current Assets</p>
              {stock !== 0 && <div className="flex justify-between"><span className="text-slate-500">Stock</span><span className="font-medium">{fmt(stock)}</span></div>}
              {debtors !== 0 && <div className="flex justify-between"><span className="text-slate-500">Trade Debtors</span><span className="font-medium">{fmt(debtors)}</span></div>}
              {prepayments !== 0 && <div className="flex justify-between"><span className="text-slate-500">Prepayments</span><span className="font-medium">{fmt(prepayments)}</span></div>}
              {cash !== 0 && <div className="flex justify-between"><span className="text-slate-500">Cash at Bank and in Hand</span><span className="font-medium">{fmt(cash)}</span></div>}
              <div className="flex justify-between font-semibold"><span>Total Current Assets</span><span>{fmt(result.currentAssets)}</span></div>

              <div className="flex justify-between pt-1"><span className="text-slate-500">Creditors: due within one year</span><span className="font-medium">{fmtSigned(-result.creditors1yr)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2"><span>Net Current Assets</span><span>{fmt(result.netCurrentAssets)}</span></div>
              <div className="flex justify-between font-bold"><span>Total Assets Less Current Liabilities</span><span>{fmt(result.totalAssetsLessCurrentLiabilities)}</span></div>

              {result.creditorsAfter1yr !== 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Creditors: due after one year</span><span className="font-medium">{fmtSigned(-result.creditorsAfter1yr)}</span></div>
              )}

              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Net Assets</span>
                <span>{fmt(result.netAssets)}</span>
              </div>

              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Capital and Reserves</p>
              {result.shareCapital !== 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Called Up Share Capital</span><span className="font-medium">{fmt(result.shareCapital)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Profit and Loss Reserve</span><span className="font-medium">{fmt(result.plReserveCfwd)}</span></div>
              <div className="flex justify-between font-bold border-t border-slate-100 pt-2">
                <span>Shareholders' Funds</span>
                <span>{fmt(result.shareholdersFunds)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Approve / Query Buttons */}
        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:hidden">
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
          Prepared by {firmName} · Year ended {periodEndFormatted} · This is a summary for approval purposes and does not constitute a filed return.
        </p>

      </div>
    </div>
  );
}