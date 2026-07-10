import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateNBV } from "../../../fixed-assets/page";
import { calculateProfitAndLoss, CREDIT_NORMAL } from "../../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function FormattedAccountsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name), jobs(job_name)")
    .eq("id", id)
    .single();

  if (error || !tb) notFound();

  const { data: lines } = await supabase
    .from("trial_balance_lines")
    .select("*")
    .eq("trial_balance_id", id);

  // Sum each category to its natural positive balance
  const totals = new Map<string, number>();
  (lines || []).forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category)
      ? Number(l.credit) - Number(l.debit)
      : Number(l.debit) - Number(l.credit);
    totals.set(l.category, (totals.get(l.category) || 0) + net);
  });
  const get = (cat: string) => totals.get(cat) || 0;

  // Fixed Assets: prefer the Fixed Asset Register (via linked job) over the TB category,
  // since the register holds the detailed, depreciation-correct figure.
  let fixedAssetsNBV = get("Tangible Fixed Assets");
  let fixedAssetsFromRegister = false;
  if (tb.job_id) {
    const { data: assets } = await supabase
      .from("fixed_assets")
      .select("*")
      .eq("job_id", tb.job_id);
    if (assets && assets.length > 0) {
      fixedAssetsNBV = assets
        .filter((a) => !a.disposal_date)
        .reduce((s, a) => s + calculateNBV(a, new Date(tb.period_end)).nbv, 0);
      fixedAssetsFromRegister = true;
    }
  }

  // Corporation Tax: pull from the CT module if a computation exists for the same job
  let corporationTax = 0;
  let ctComputationId: string | null = null;
  if (tb.job_id) {
    const { data: ct } = await supabase
      .from("corporation_tax_computations")
      .select("id, accounting_profit, turnover")
      .eq("job_id", tb.job_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ct) {
      ctComputationId = ct.id;
      // Re-derive CT due would require importing the full calc chain; instead
      // link through and let that module be the source of truth for the figure.
    }
  }

  // --- Profit & Loss (shared calculation, also used by Corporation Tax auto-fill) ---
  const pl = calculateProfitAndLoss(lines || []);
  const { turnover, costOfSales, grossProfit, adminExpenses, operatingProfit, interestReceivable, interestPayable, profitBeforeTax } = pl;

  // --- Balance Sheet ---
  const stock = get("Stock");
  const debtors = get("Trade Debtors");
  const prepayments = get("Prepayments and Accrued Income");
  const cash = get("Cash at Bank and in Hand");
  const currentAssets = stock + debtors + prepayments + cash;

  const dla = get("Directors' Loan Account");
  const dlaIsAsset = dla > 0;

  const creditors1yr =
    get("Trade Creditors") + get("Accruals and Deferred Income") + get("VAT Liability") +
    get("PAYE/NI Liability") + get("Corporation Tax Liability") + get("Bank Loans - Due Within One Year") +
    (dlaIsAsset ? 0 : -dla);

  const netCurrentAssets = currentAssets + (dlaIsAsset ? dla : 0) - creditors1yr;
  const totalAssetsLessCurrentLiabilities = fixedAssetsNBV + netCurrentAssets;

  const creditorsAfter1yr = get("Bank Loans - Due After One Year");
  const netAssets = totalAssetsLessCurrentLiabilities - creditorsAfter1yr;

  const shareCapital = get("Called Up Share Capital");
  const plReserveBfwd = get("Profit and Loss Reserve");
  const plReserveCfwd = plReserveBfwd + profitBeforeTax; // pre-tax shown; CT reduces this if applicable
  const capitalAndReserves = shareCapital + plReserveCfwd;

  const isBalanced = Math.abs(netAssets - capitalAndReserves) < 1;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtSigned = (n: number) => n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);

  const Row = ({ label, value, bold, indent }: { label: string; value: number; bold?: boolean; indent?: boolean }) => (
    <div className={`flex justify-between py-1.5 ${bold ? "font-bold border-t border-slate-200 pt-2 mt-1" : "text-sm"} ${indent ? "pl-4" : ""}`}>
      <span className={bold ? "" : "text-slate-600"}>{label}</span>
      <span>{fmtSigned(value)}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <a href={`/accounts-production/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Trial Balance
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">
          {(tb.clients as any)?.client_name} — Draft Accounts
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Period {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
          {(tb.jobs as any)?.job_name && ` · Job: ${(tb.jobs as any).job_name}`}
        </p>
        <div className="mt-3 flex gap-3">
          {fixedAssetsFromRegister && (
            <a href={`/fixed-assets/report?job=${tb.job_id}`} className="text-xs font-semibold text-blue-600 hover:underline">
              View Fixed Asset Note →
            </a>
          )}
          {ctComputationId && (
            <a href={`/corporation-tax/${ctComputationId}`} className="text-xs font-semibold text-blue-600 hover:underline">
              View Corporation Tax Computation →
            </a>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8 space-y-6">

        {!isBalanced && (
          <div className="rounded-2xl bg-red-50 border border-red-100 p-4">
            <p className="text-sm font-bold text-red-700">⚠ Balance Sheet does not balance</p>
            <p className="text-xs text-red-600 mt-1">
              Net Assets ({fmt(netAssets)}) does not equal Capital &amp; Reserves ({fmt(capitalAndReserves)}). Check that all trial balance lines are mapped and the trial balance itself balances.
            </p>
          </div>
        )}

        {/* Profit & Loss */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Profit and Loss Account</h2>
          <Row label="Turnover" value={turnover} />
          <Row label="Cost of Sales" value={-costOfSales} />
          <Row label="Gross Profit" value={grossProfit} bold />
          <Row label="Administrative Expenses" value={-adminExpenses} />
          <Row label="Operating Profit" value={operatingProfit} bold />
          {(interestReceivable !== 0 || interestPayable !== 0) && (
            <>
              <Row label="Interest Receivable" value={interestReceivable} />
              <Row label="Interest Payable" value={-interestPayable} />
            </>
          )}
          <Row label="Profit Before Tax" value={profitBeforeTax} bold />
          <p className="text-xs text-slate-400 mt-2">
            {ctComputationId
              ? "Corporation Tax is calculated in the linked Corporation Tax computation — see link above for the figure to deduct."
              : "No linked Corporation Tax computation found for this job yet."}
          </p>
        </div>

        {/* Balance Sheet */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Balance Sheet</h2>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-2 mb-1">Fixed Assets</p>
          <Row label={fixedAssetsFromRegister ? "Tangible Fixed Assets (per Fixed Asset Register)" : "Tangible Fixed Assets"} value={fixedAssetsNBV} />

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Current Assets</p>
          <Row label="Stock" value={stock} indent />
          <Row label="Trade Debtors" value={debtors} indent />
          <Row label="Prepayments and Accrued Income" value={prepayments} indent />
          <Row label="Cash at Bank and in Hand" value={cash} indent />
          {dlaIsAsset && dla !== 0 && <Row label="Directors' Loan Account" value={dla} indent />}
          <Row label="Total Current Assets" value={currentAssets + (dlaIsAsset ? dla : 0)} />

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Creditors: Amounts Falling Due Within One Year</p>
          <Row label="Creditors due within one year" value={-creditors1yr} />

          <Row label="Net Current Assets" value={netCurrentAssets} bold />
          <Row label="Total Assets Less Current Liabilities" value={totalAssetsLessCurrentLiabilities} bold />

          {creditorsAfter1yr !== 0 && (
            <>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Creditors: Amounts Falling Due After More Than One Year</p>
              <Row label="Bank Loans" value={-creditorsAfter1yr} />
            </>
          )}

          <Row label="Net Assets" value={netAssets} bold />

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Capital and Reserves</p>
          <Row label="Called Up Share Capital" value={shareCapital} indent />
          <Row label="Profit and Loss Reserve" value={plReserveCfwd} indent />
          <Row label="Total Capital and Reserves" value={capitalAndReserves} bold />
        </div>

        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>Draft accounts for review — not a filable document.</strong> This is a working format based on FRS 105 (micro-entity) layout, generated from your mapped trial balance. It does not include full statutory notes, directors' report, or iXBRL tagging required for Companies House filing. The Profit and Loss Reserve shown is pre-Corporation Tax; deduct the CT liability from the linked computation to get the true closing reserve. Always review before issuing to a client or filing.
          </p>
        </div>
      </div>
    </div>
  );
}
