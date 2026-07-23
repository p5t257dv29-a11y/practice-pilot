import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateNBV } from "../../../fixed-assets/page";
import { calculateProfitAndLoss, CREDIT_NORMAL, PL_CATEGORY_GROUPS, getCustomPLCategories, type PLGroup } from "../../page";

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

  const customPL = await getCustomPLCategories(supabase);
  const groupOf = (cat: string) => PL_CATEGORY_GROUPS[cat] || customPL.groups[cat];

  const totals = new Map<string, number>();
  const linesByCategory = new Map<string, any[]>();
  (lines || []).forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category)
      ? Number(l.credit) - Number(l.debit)
      : Number(l.debit) - Number(l.credit);
    totals.set(l.category, (totals.get(l.category) || 0) + net);
    const arr = linesByCategory.get(l.category) || [];
    arr.push(l);
    linesByCategory.set(l.category, arr);
  });
  const get = (cat: string) => totals.get(cat) || 0;

  const adminExpenseLines: { category: string; value: number }[] = [];
  totals.forEach((value, cat) => {
    if (groupOf(cat) === "admin_expenses") {
      adminExpenseLines.push({ category: cat, value });
    }
  });
  adminExpenseLines.sort((a, b) => b.value - a.value);

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
    }
  }

  const pl = calculateProfitAndLoss(lines || [], customPL.groups);
  const { turnover, costOfSales, grossProfit, adminExpenses, operatingProfit, interestReceivable, interestPayable, profitBeforeTax, depreciation } = pl;
  const profitBeforeDepreciationAndTax = profitBeforeTax + depreciation;

  const stock = get("Stock");
  const debtors = get("Trade Debtors");
  const prepayments = get("Prepayments and Accrued Income");
  const cash = get("Cash at Bank and in Hand");
  const currentAssets = stock + debtors + prepayments + cash;

  const dla = get("Directors' Loan Account");
  const dlaIsAsset = dla > 0;

  const creditor1yrCategories = [
    "Trade Creditors", "Accruals and Deferred Income", "VAT Liability",
    "PAYE/NI Liability", "Corporation Tax Liability", "Bank Loans - Due Within One Year",
  ];
  const creditors1yr =
    creditor1yrCategories.reduce((s, c) => s + get(c), 0) + (dlaIsAsset ? 0 : -dla);

  const netCurrentAssets = currentAssets + (dlaIsAsset ? dla : 0) - creditors1yr;
  const totalAssetsLessCurrentLiabilities = fixedAssetsNBV + netCurrentAssets;

  const creditorsAfter1yr = get("Bank Loans - Due After One Year");
  const netAssets = totalAssetsLessCurrentLiabilities - creditorsAfter1yr;

  const shareCapital = get("Called Up Share Capital");
  const plReserveBfwd = get("Profit and Loss Reserve");
  const plReserveCfwd = plReserveBfwd + profitBeforeTax;
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

  // Deepest level: the actual trial balance lines under one category —
  // each links straight into the trial balance page's inline edit for that line.
  const LineDetail = ({ category }: { category: string }) => {
    const catLines = linesByCategory.get(category) || [];
    if (catLines.length === 0) return null;
    return (
      <div className="pl-6 pr-1 pb-2 space-y-1 border-l-2 border-slate-100 ml-1.5 mt-1">
        {catLines.map((l) => {
          const lineNet = CREDIT_NORMAL.has(category)
            ? Number(l.credit) - Number(l.debit)
            : Number(l.debit) - Number(l.credit);
          return (
            <div key={l.id} className="flex justify-between text-xs">
              <a href={`/accounts-production/${id}?line_edit=${l.id}`} className="text-slate-500 hover:text-blue-600 hover:underline">
                {l.nominal_code && <span className="font-mono mr-1">{l.nominal_code}</span>}
                {l.description}
              </a>
              <span className="text-slate-600">{fmtSigned(lineNet)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // A category row: expands to show its underlying trial balance lines if there's
  // more than one, otherwise renders as a plain non-expandable row.
const CategoryRow = ({ label, category, value, indent }: { label: string; category: string; value: number; indent?: boolean }) => {
    const catLines = linesByCategory.get(category) || [];
    if (catLines.length === 0) {
      return <Row label={label} value={value} indent={indent} />;
    }
  return (
      <details className="group">
        <summary className={`flex justify-between py-1.5 text-sm cursor-pointer list-none ${indent ? "pl-4" : ""}`}>
          <span className="text-slate-600 flex items-center gap-1.5">
            <span className="text-slate-400 text-xs group-open:rotate-90 transition-transform">▶</span>
            {label}
          </span>
          <span>{fmtSigned(value)}</span>
        </summary>
        <LineDetail category={category} />
      </details>
    );
  };

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
          <CategoryRow label="Turnover" category="Turnover" value={turnover} />
          <CategoryRow label="Cost of Sales" category="Cost of Sales" value={-costOfSales} />
          <Row label="Gross Profit" value={grossProfit} bold />

          {adminExpenseLines.length > 0 ? (
            <details className="group">
              <summary className="flex justify-between py-1.5 text-sm cursor-pointer list-none">
                <span className="text-slate-600 flex items-center gap-1.5">
                  <span className="text-slate-400 text-xs group-open:rotate-90 transition-transform">▶</span>
                  Administrative Expenses
                </span>
                <span>{fmtSigned(-adminExpenses)}</span>
              </summary>
              <div className="pl-6 pr-1 pb-2 space-y-1 border-l-2 border-slate-100 ml-1.5 mt-1">
                {adminExpenseLines.map((l) => (
                  <CategoryRow key={l.category} label={l.category} category={l.category} value={-l.value} />
                ))}
              </div>
            </details>
          ) : (
            <Row label="Administrative Expenses" value={-adminExpenses} />
          )}

          <Row label="Operating Profit" value={operatingProfit} bold />
          {(interestReceivable !== 0 || interestPayable !== 0) && (
            <>
              <CategoryRow label="Interest Receivable" category="Interest Receivable" value={interestReceivable} />
              <CategoryRow label="Interest Payable" category="Bank Charges and Interest Payable" value={-interestPayable} />
            </>
          )}
          <Row label="Profit Before Tax" value={profitBeforeTax} bold />
          {depreciation !== 0 && (
            <Row label="Profit Before Depreciation and Tax" value={profitBeforeDepreciationAndTax} />
          )}
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
          <CategoryRow label="Stock" category="Stock" value={stock} indent />
          <CategoryRow label="Trade Debtors" category="Trade Debtors" value={debtors} indent />
          <CategoryRow label="Prepayments and Accrued Income" category="Prepayments and Accrued Income" value={prepayments} indent />
          <CategoryRow label="Cash at Bank and in Hand" category="Cash at Bank and in Hand" value={cash} indent />
          {dlaIsAsset && dla !== 0 && <CategoryRow label="Directors' Loan Account" category="Directors' Loan Account" value={dla} indent />}
          <Row label="Total Current Assets" value={currentAssets + (dlaIsAsset ? dla : 0)} />

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Creditors: Amounts Falling Due Within One Year</p>
          <details className="group">
            <summary className="flex justify-between py-1.5 text-sm cursor-pointer list-none">
              <span className="text-slate-600 flex items-center gap-1.5">
                <span className="text-slate-400 text-xs group-open:rotate-90 transition-transform">▶</span>
                Creditors due within one year
              </span>
              <span>{fmtSigned(-creditors1yr)}</span>
            </summary>
            <div className="pl-6 pr-1 pb-2 space-y-1 border-l-2 border-slate-100 ml-1.5 mt-1">
              {creditor1yrCategories.filter((c) => get(c) !== 0).map((c) => (
                <CategoryRow key={c} label={c} category={c} value={-get(c)} />
              ))}
              {!dlaIsAsset && dla !== 0 && (
                <CategoryRow label="Directors' Loan Account" category="Directors' Loan Account" value={dla} />
              )}
            </div>
          </details>

          <Row label="Net Current Assets" value={netCurrentAssets} bold />
          <Row label="Total Assets Less Current Liabilities" value={totalAssetsLessCurrentLiabilities} bold />

          {creditorsAfter1yr !== 0 && (
            <>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Creditors: Amounts Falling Due After More Than One Year</p>
              <CategoryRow label="Bank Loans" category="Bank Loans - Due After One Year" value={-creditorsAfter1yr} />
            </>
          )}

          <Row label="Net Assets" value={netAssets} bold />

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-1">Capital and Reserves</p>
          <CategoryRow label="Called Up Share Capital" category="Called Up Share Capital" value={shareCapital} indent />
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