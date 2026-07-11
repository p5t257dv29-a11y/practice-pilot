import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateNBV } from "../../../fixed-assets/page";
import { calculateProfitAndLoss, CREDIT_NORMAL } from "../../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Computes the full Balance Sheet position from a set of trial balance lines
// and, if available, the Fixed Asset Register (for a more accurate NBV).
async function computeBalanceSheet(clientId: string, jobId: string | null, periodEnd: string, lines: any[]) {
  const totals = new Map<string, number>();
  lines.forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category) ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
    totals.set(l.category, (totals.get(l.category) || 0) + net);
  });
  const get = (cat: string) => totals.get(cat) || 0;

  let fixedAssetsNBV = get("Tangible Fixed Assets");
  if (jobId) {
    const { data: assets } = await supabase.from("fixed_assets").select("*").eq("job_id", jobId);
    if (assets && assets.length > 0) {
      fixedAssetsNBV = assets.filter((a) => !a.disposal_date).reduce((s, a) => s + calculateNBV(a, new Date(periodEnd)).nbv, 0);
    }
  }

  const pl = calculateProfitAndLoss(lines);
  const stock = get("Stock");
  const debtors = get("Trade Debtors");
  const prepayments = get("Prepayments and Accrued Income");
  const cash = get("Cash at Bank and in Hand");
  const dla = get("Directors' Loan Account");
  const dlaIsAsset = dla > 0;
  const currentAssets = stock + debtors + prepayments + cash + (dlaIsAsset ? dla : 0);

  const creditors1yr =
    get("Trade Creditors") + get("Accruals and Deferred Income") + get("VAT Liability") +
    get("PAYE/NI Liability") + get("Corporation Tax Liability") + get("Bank Loans - Due Within One Year") +
    (dlaIsAsset ? 0 : -dla);

  const netCurrentAssets = currentAssets - creditors1yr;
  const totalAssetsLessCurrentLiabilities = fixedAssetsNBV + netCurrentAssets;
  const creditorsAfter1yr = get("Bank Loans - Due After One Year");
  const netAssets = totalAssetsLessCurrentLiabilities - creditorsAfter1yr;

  const shareCapital = get("Called Up Share Capital");
  const plReserveCfwd = get("Profit and Loss Reserve") + pl.profitBeforeTax;
  const shareholdersFunds = shareCapital + plReserveCfwd;

  return { fixedAssetsNBV, currentAssets, creditors1yr, netCurrentAssets, totalAssetsLessCurrentLiabilities, creditorsAfter1yr, netAssets, shareCapital, plReserveCfwd, shareholdersFunds, pl, dla };
}

export default async function FRS105AccountsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name, company_number, address, bank_name)")
    .eq("id", id)
    .single();

  if (error || !tb) notFound();

  const [{ data: lines }, { data: officers }] = await Promise.all([
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", id),
    supabase.from("company_officers").select("*").eq("client_id", tb.client_id).eq("is_active", true).limit(1),
  ]);

  const director = officers?.[0] as any;
  const directorName = director?.officer_name || director?.name || director?.full_name || "________________";
  const client = tb.clients as any;

  const current = await computeBalanceSheet(tb.client_id, tb.job_id, tb.period_end, lines || []);

  // Look up the most recent prior trial balance for this client (a different period,
  // ending before this one starts) to show as the comparative year, as real filed accounts do.
  const { data: priorTb } = await supabase
    .from("trial_balances")
    .select("*")
    .eq("client_id", tb.client_id)
    .lt("period_end", tb.period_start)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  let prior: Awaited<ReturnType<typeof computeBalanceSheet>> | null = null;
  if (priorTb) {
    const { data: priorLines } = await supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", priorTb.id);
    prior = await computeBalanceSheet(tb.client_id, priorTb.job_id, priorTb.period_end, priorLines || []);
  }

  const isBalanced = Math.abs(current.netAssets - current.shareholdersFunds) < 1;

  // Fixed asset note — cost/depreciation movement by category
  let registerAssets: any[] = [];
  if (tb.job_id) {
    const { data: assets } = await supabase.from("fixed_assets").select("*").eq("job_id", tb.job_id);
    registerAssets = assets || [];
  }
  const categoryRows = (() => {
    if (registerAssets.length === 0) return [];
    const pStart = new Date(tb.period_start);
    const pEnd = new Date(tb.period_end);
    const byCategory = new Map<string, any>();
    registerAssets.forEach((asset) => {
      const category = asset.category || "Tangible Fixed Assets";
      if (!byCategory.has(category)) {
        byCategory.set(category, { category, costStart: 0, additionsAmt: 0, disposalsAmt: 0, costEnd: 0, depStart: 0, charge: 0, eliminated: 0, depEnd: 0 });
      }
      const row = byCategory.get(category);
      const acq = new Date(asset.acquisition_date);
      const disposedInPeriod = asset.disposal_date && new Date(asset.disposal_date) >= pStart && new Date(asset.disposal_date) <= pEnd;
      const acquiredBeforeStart = acq < pStart;
      const acquiredInPeriod = acq >= pStart && acq <= pEnd;
      const cost = Number(asset.cost);
      const costStart = acquiredBeforeStart ? cost : 0;
      const additionsAmt = acquiredInPeriod ? cost : 0;
      const disposalsAmt = disposedInPeriod ? cost : 0;
      const depStart = acquiredBeforeStart ? calculateNBV(asset, pStart).accumulatedDepreciation : 0;
      const depEndCalcDate = disposedInPeriod ? new Date(asset.disposal_date) : pEnd;
      const depEndRaw = (acquiredBeforeStart || acquiredInPeriod) ? calculateNBV(asset, depEndCalcDate).accumulatedDepreciation : 0;
      const eliminated = disposedInPeriod ? depEndRaw : 0;
      const charge = depEndRaw - depStart;
      const depEnd = disposedInPeriod ? 0 : depEndRaw;
      row.costStart += costStart; row.additionsAmt += additionsAmt; row.disposalsAmt += disposalsAmt;
      row.costEnd += costStart + additionsAmt - disposalsAmt;
      row.depStart += depStart; row.charge += charge; row.eliminated += eliminated; row.depEnd += depEnd;
    });
    return Array.from(byCategory.values());
  })();

  const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
  const fmtBracket = (n: number) => n === 0 ? "—" : n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
  const periodEndFormatted = new Date(tb.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const periodStartFormatted = new Date(tb.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const currentYearLabel = new Date(tb.period_end).getFullYear();
  const priorYearLabel = priorTb ? new Date(priorTb.period_end).getFullYear() : null;

  // Two-column balance sheet row: current year + prior year (if available)
  const BSRow = ({ label, value, priorValue, bold, caps, note }: { label: string; value: number; priorValue?: number | null; bold?: boolean; caps?: boolean; note?: string }) => (
    <tr className={bold ? "font-bold" : ""}>
      <td className={`py-1.5 ${caps ? "uppercase" : ""}`}>{label}</td>
      <td className="py-1.5 text-center text-xs text-slate-400">{note || ""}</td>
      <td className={`py-1.5 text-right font-mono ${bold ? "border-t border-slate-400" : ""}`}>{fmtBracket(value)}</td>
      <td className={`py-1.5 text-right font-mono ${bold ? "border-t border-slate-400" : ""}`}>
        {prior ? fmtBracket(priorValue ?? 0) : ""}
      </td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <a href={`/accounts-production/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Trial Balance
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">FRS 105 Micro-Entity Accounts</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Use your browser's print function (⌘P) to save as PDF.
        </p>
      </div>

      <div className="max-w-3xl mx-auto p-8 space-y-8">

        {!isBalanced && (
          <div className="rounded-2xl bg-red-50 border border-red-100 p-4 print:hidden">
            <p className="text-sm font-bold text-red-700">⚠ Balance Sheet does not balance — check mappings before preparing accounts</p>
          </div>
        )}

        {/* Cover Page */}
        <div className="bg-white shadow-sm border border-slate-200 p-12 rounded-2xl">
          <p className="text-xs text-slate-500 text-right">Registered number: {client?.company_number || "________"}</p>
          <div className="text-center mt-20">
            <h1 className="text-2xl font-bold text-slate-900 uppercase">{client?.client_name}</h1>
            <p className="text-base text-slate-600 mt-6 uppercase font-bold">Unaudited Financial Statements</p>
            <p className="text-base text-slate-600">For The Year Ended {periodEndFormatted}</p>
          </div>
          <div className="mt-24 text-center text-sm text-slate-500">
            <p>E&amp;P Accountancy Services Limited</p>
          </div>
        </div>

        {/* Contents */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Contents</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-2">Company Information</td><td className="py-2 text-right">1</td></tr>
              <tr><td className="py-2">Balance Sheet</td><td className="py-2 text-right">2</td></tr>
              <tr><td className="py-2">Notes to the Financial Statements</td><td className="py-2 text-right">3</td></tr>
            </tbody>
          </table>
        </div>

        {/* Company Information */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Company Information</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-2 font-bold w-1/3">Director</td><td className="py-2">{directorName}</td></tr>
              <tr><td className="py-2 font-bold">Company Number</td><td className="py-2">{client?.company_number || "Not on file"}</td></tr>
              <tr><td className="py-2 font-bold">Registered Office</td><td className="py-2">{client?.address || "Not on file"}</td></tr>
              <tr><td className="py-2 font-bold">Accountants</td><td className="py-2">E&amp;P Accountancy Services Limited</td></tr>
              {client?.bank_name && (
                <tr><td className="py-2 font-bold">Bankers</td><td className="py-2">{client.bank_name}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Balance Sheet */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <p className="text-xs text-slate-500">Registered number: {client?.company_number || "________"}</p>
          <h2 className="text-lg font-bold text-slate-900 text-center mt-2">Balance Sheet</h2>
          <p className="text-sm text-slate-500 text-center mb-6">As At {periodEndFormatted}</p>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <td></td><td></td>
                <td className="text-right font-bold">{currentYearLabel}<br />£</td>
                <td className="text-right font-bold">{priorYearLabel ? `${priorYearLabel}\n£` : ""}</td>
              </tr>
            </thead>
            <tbody>
              <tr><td className="pt-3 font-bold uppercase" colSpan={4}>Fixed Assets</td></tr>
              <BSRow label="Tangible assets" value={current.fixedAssetsNBV} priorValue={prior?.fixedAssetsNBV} note="2" />

              <tr><td className="pt-3 font-bold uppercase" colSpan={4}>Current Assets</td></tr>
              <BSRow label="Total current assets" value={current.currentAssets} priorValue={prior?.currentAssets} />
              <BSRow label="Creditors: amounts falling due within one year" value={-current.creditors1yr} priorValue={prior ? -prior.creditors1yr : null} />
              <BSRow label="Net Current Assets (Liabilities)" value={current.netCurrentAssets} priorValue={prior?.netCurrentAssets} bold caps />

              <BSRow label="Total Assets Less Current Liabilities" value={current.totalAssetsLessCurrentLiabilities} priorValue={prior?.totalAssetsLessCurrentLiabilities} bold caps />

              {(current.creditorsAfter1yr !== 0 || (prior && prior.creditorsAfter1yr !== 0)) && (
                <BSRow label="Creditors: amounts falling due after more than one year" value={-current.creditorsAfter1yr} priorValue={prior ? -prior.creditorsAfter1yr : null} />
              )}

              <BSRow label="Net Assets" value={current.netAssets} priorValue={prior?.netAssets} bold caps />

              <tr><td className="pt-3 font-bold uppercase" colSpan={4}>Capital and Reserves</td></tr>
              <BSRow label="Called up share capital" value={current.shareCapital} priorValue={prior?.shareCapital} note="3" />
              <BSRow label="Profit and loss account" value={current.plReserveCfwd} priorValue={prior?.plReserveCfwd} />
              <BSRow label="Shareholders' Funds" value={current.shareholdersFunds} priorValue={prior?.shareholdersFunds} bold caps />
            </tbody>
          </table>

          <div className="mt-8 text-xs text-slate-600 space-y-2 border-t border-slate-200 pt-4">
            <p>For the year ending {periodEndFormatted} the company was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies.</p>
            <p>The member has not required the company to obtain an audit in accordance with section 476 of the Companies Act 2006.</p>
            <p>The director acknowledges their responsibilities for complying with the requirements of the Act with respect to accounting records and the preparation of accounts.</p>
            <p>These accounts have been prepared and delivered in accordance with the provisions applicable to companies subject to the micro-entities regime, and in accordance with FRS 105, the Financial Reporting Standard applicable to the Micro-entities Regime.</p>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <p className="text-sm text-slate-700 mb-8">On behalf of the board</p>
            <div className="flex justify-between items-end">
              <div>
                <p className="border-b border-dashed border-slate-400 w-56">&nbsp;</p>
                <p className="text-xs text-slate-500 mt-1">{directorName}</p>
                <p className="text-xs text-slate-500">Director</p>
              </div>
              <div>
                <p className="border-b border-dashed border-slate-400 w-40">&nbsp;</p>
                <p className="text-xs text-slate-500 mt-1">Date</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-6">The notes on page 3 form part of these financial statements.</p>
          </div>
        </div>

        {/* Profit & Loss (for members / HMRC — not required to be filed at Companies House) */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-slate-900 text-center">Profit and Loss Account</h2>
          <p className="text-sm text-slate-500 text-center mb-1">For the Year Ended {periodEndFormatted}</p>
          <p className="text-xs text-slate-400 text-center mb-6">Prepared for the members and HMRC — not required to be filed at Companies House by a micro-entity</p>

          <table className="w-full text-sm">
            <tbody>
              <BSRow label="Turnover" value={current.pl.turnover} priorValue={prior?.pl.turnover} />
              <BSRow label="Cost of Sales" value={-current.pl.costOfSales} priorValue={prior ? -prior.pl.costOfSales : null} />
              <BSRow label="Gross Profit" value={current.pl.grossProfit} priorValue={prior?.pl.grossProfit} bold />
              <BSRow label="Administrative Expenses" value={-current.pl.adminExpenses} priorValue={prior ? -prior.pl.adminExpenses : null} />
              <BSRow label="Profit Before Taxation" value={current.pl.profitBeforeTax} priorValue={prior?.pl.profitBeforeTax} bold />
            </tbody>
          </table>
        </div>

        {/* Notes */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Notes to the Financial Statements</h2>

          <div className="mb-6">
            <p className="text-sm font-bold text-slate-900">1. General Information</p>
            <p className="text-sm text-slate-600 mt-2">
              {client?.client_name} is a private company limited by shares, incorporated in England and Wales, registration number {client?.company_number || "________"}.
              {client?.address && ` The registered office is ${client.address}.`}
            </p>
            <p className="text-sm text-slate-600 mt-2">
              These financial statements have been prepared in accordance with the provisions of FRS 105, the Financial Reporting Standard applicable to the Micro-entities Regime, and the Companies Act 2006. The financial statements are presented in Sterling (£).
            </p>
          </div>

          {categoryRows.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-bold text-slate-900">2. Tangible Fixed Assets</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-1">Category</th>
                      <th className="pb-1 text-right">Cost b/fwd</th>
                      <th className="pb-1 text-right">Additions</th>
                      <th className="pb-1 text-right">Disposals</th>
                      <th className="pb-1 text-right">Cost c/fwd</th>
                      <th className="pb-1 text-right">Dep. b/fwd</th>
                      <th className="pb-1 text-right">Charge</th>
                      <th className="pb-1 text-right">Dep. c/fwd</th>
                      <th className="pb-1 text-right">NBV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {categoryRows.map((r: any) => (
                      <tr key={r.category}>
                        <td className="py-1">{r.category}</td>
                        <td className="py-1 text-right">{fmt(r.costStart)}</td>
                        <td className="py-1 text-right">{fmt(r.additionsAmt)}</td>
                        <td className="py-1 text-right">{r.disposalsAmt > 0 ? `(${fmt(r.disposalsAmt)})` : "—"}</td>
                        <td className="py-1 text-right">{fmt(r.costEnd)}</td>
                        <td className="py-1 text-right">{fmt(r.depStart)}</td>
                        <td className="py-1 text-right">{fmt(r.charge)}</td>
                        <td className="py-1 text-right">{fmt(r.depEnd)}</td>
                        <td className="py-1 text-right font-semibold">{fmt(r.costEnd - r.depEnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mb-6">
            <p className="text-sm font-bold text-slate-900">{categoryRows.length > 0 ? "3" : "2"}. Share Capital</p>
            <table className="w-full text-sm mt-2">
              <tbody>
                <BSRow label="Allotted, called up and fully paid" value={current.shareCapital} priorValue={prior?.shareCapital} />
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-900">{categoryRows.length > 0 ? "4" : "3"}. Advances, Credit and Guarantees to Directors</p>
            <p className="text-sm text-slate-600 mt-2">
              {current.dla !== 0
                ? `The company had a balance of £${fmt(Math.abs(current.dla))} ${current.dla > 0 ? "owed to the company by" : "owed by the company to"} a director at the balance sheet date.`
                : "No advances, credits, or guarantees were granted to directors during the year."}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>Draft accounts for review — not a filable document.</strong> Formatted to closely match the layout and statutory wording of real filed FRS 105 micro-entity accounts, generated from your mapped trial balance. It has not been reviewed by a qualified accountant, does not include iXBRL tagging, and cannot be submitted to Companies House or HMRC directly. Verify all figures, the registered office address, and director details before use, and file through recognised software or your existing filing route.
          </p>
        </div>
      </div>
    </div>
  );
}
