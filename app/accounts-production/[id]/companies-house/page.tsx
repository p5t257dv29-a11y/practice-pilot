import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { calculateNBV } from "../../../fixed-assets/page";
import { CREDIT_NORMAL, calculateProfitAndLoss } from "../../page";
import { computeBalanceSheet } from "../frs105/page";
import PrintButton from "../../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateNote(trialBalanceId: string, field: string, formData: FormData) {
  "use server";
  const text = String(formData.get("note_text") || "").trim();
  await supabase.from("trial_balances").update({ [field]: text || null }).eq("id", trialBalanceId);
  revalidatePath(`/accounts-production/${trialBalanceId}/companies-house`);
}

async function updateEmployeeCount(trialBalanceId: string, formData: FormData) {
  "use server";
  const count = parseInt(String(formData.get("average_employees") || "").trim());
  await supabase.from("trial_balances").update({ average_employees: isNaN(count) ? null : count }).eq("id", trialBalanceId);
  revalidatePath(`/accounts-production/${trialBalanceId}/companies-house`);
}

export default async function CompaniesHouseAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit_note?: string }>;
}) {
  const { id } = await params;
  const { edit_note } = await searchParams;

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name, company_number, address)")
    .eq("id", id)
    .single();

  if (error || !tb) notFound();

  const [{ data: lines }, { data: officers }, { data: practiceSettings }] = await Promise.all([
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", id),
    supabase.from("company_officers").select("*").eq("client_id", tb.client_id).eq("is_active", true).order("appointed_on", { ascending: true }),
    supabase.from("practice_settings").select("firm_name, address").limit(1).maybeSingle(),
  ]);

  const client = tb.clients as any;
  const firmName = practiceSettings?.firm_name || "Your Accountants";
  const firmAddress = practiceSettings?.address || "";

  const result = await computeBalanceSheet(tb.client_id, tb.period_end, lines || [], {});

  const { data: priorTb } = await supabase
    .from("trial_balances")
    .select("*")
    .eq("client_id", tb.client_id)
    .lt("period_end", tb.period_start)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  let prior: Awaited<ReturnType<typeof computeBalanceSheet>> | null = null;
  let priorLines: any[] = [];
  if (priorTb) {
    const { data: pLines } = await supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", priorTb.id);
    priorLines = pLines || [];
    prior = await computeBalanceSheet(tb.client_id, priorTb.period_end, priorLines, {});
  }

  // Debtors / Creditors breakdown, mapped from existing categories to the
  // more granular lines Companies House filings typically show. Adjust the
  // mapping here if your chart of accounts splits these differently.
  const totalsFor = (lineSet: any[]) => {
    const totals = new Map<string, number>();
    lineSet.forEach((l) => {
      if (!l.category) return;
      const net = CREDIT_NORMAL.has(l.category) ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      totals.set(l.category, (totals.get(l.category) || 0) + net);
    });
    return (cat: string) => totals.get(cat) || 0;
  };
  const get = totalsFor(lines || []);
  const getPrior = totalsFor(priorLines);

  const tradeDebtors = get("Trade Debtors");
  const otherDebtors = get("Prepayments and Accrued Income");
  const priorTradeDebtors = getPrior("Trade Debtors");
  const priorOtherDebtors = getPrior("Prepayments and Accrued Income");

  const tradeCreditors = get("Trade Creditors");
  const taxAndSocialSecurity = get("VAT Liability") + get("PAYE/NI Liability") + get("Corporation Tax Liability");
  const otherCreditors = get("Accruals and Deferred Income") + get("Bank Loans - Due Within One Year");
  const priorTradeCreditors = getPrior("Trade Creditors");
  const priorTaxAndSocialSecurity = getPrior("VAT Liability") + getPrior("PAYE/NI Liability") + getPrior("Corporation Tax Liability");
  const priorOtherCreditors = getPrior("Accruals and Deferred Income") + getPrior("Bank Loans - Due Within One Year");

  // Tangible fixed asset movement — aggregated across all tangible categories,
  // same underlying logic as the fixed asset note on the full FRS102/105 accounts.
  const { data: registerAssetsRaw } = await supabase.from("fixed_assets").select("*").eq("client_id", tb.client_id);
  const registerAssets = (registerAssetsRaw || []).filter((a) => a.category !== "Goodwill" && a.category !== "Intangible");
  const pStart = new Date(tb.period_start);
  const pEnd = new Date(tb.period_end);
  let costStart = 0, additionsAmt = 0, disposalsAmt = 0, depStart = 0, charge = 0, depEnd = 0;
  registerAssets.forEach((asset) => {
    const acq = new Date(asset.acquisition_date);
    const disposedInPeriod = asset.disposal_date && new Date(asset.disposal_date) >= pStart && new Date(asset.disposal_date) <= pEnd;
    const acquiredBeforeStart = acq < pStart;
    const acquiredInPeriod = acq >= pStart && acq <= pEnd;
    const cost = Number(asset.cost);
    if (acquiredBeforeStart) costStart += cost;
    if (acquiredInPeriod) additionsAmt += cost;
    if (disposedInPeriod) disposalsAmt += cost;
    const assetDepStart = acquiredBeforeStart ? calculateNBV(asset, pStart).accumulatedDepreciation : 0;
    const depEndCalcDate = disposedInPeriod ? new Date(asset.disposal_date) : pEnd;
    const assetDepEndRaw = (acquiredBeforeStart || acquiredInPeriod) ? calculateNBV(asset, depEndCalcDate).accumulatedDepreciation : 0;
    depStart += assetDepStart;
    charge += assetDepEndRaw - assetDepStart;
    if (!disposedInPeriod) depEnd += assetDepEndRaw;
  });
  const costEnd = costStart + additionsAmt - disposalsAmt;
  const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");

  const isBalanced = Math.abs(result.netAssets - result.shareholdersFunds) < 1;

  const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
  const fmtBracket = (n: number) => n === 0 ? "—" : n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
  const periodEndFormatted = new Date(tb.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const periodStartFormatted = new Date(tb.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const currentYearLabel = new Date(tb.period_end).getFullYear();
  const priorYearLabel = priorTb ? new Date(priorTb.period_end).getFullYear() : null;

  let noteNum = 1;
  const nStatutory = noteNum++;
  const nPolicies = noteNum++;
  const nEmployees = noteNum++;
  const nFixedAssets = registerAssets.length > 0 ? noteNum++ : null;
  const nDebtors = noteNum++;
  const nCreditors = noteNum++;

  const accountingPoliciesDefault = `Basis of preparing the financial statements\nThese financial statements have been prepared in accordance with Financial Reporting Standard 102 "The Financial Reporting Standard applicable in the UK and Republic of Ireland" including the provisions of Section 1A "Small Entities" and the Companies Act 2006. The financial statements have been prepared under the historical cost convention.\n\nSignificant judgements and estimates\nEstimates and judgements are continually evaluated and are based on historical experience and other factors, including expectations of future events that are believed to be reasonable under the circumstances. The Directors do not consider there to be any material estimates and judgements.\n\nTurnover\nRevenue is measured at the fair value of the consideration received or receivable and represents the amount receivable for goods or services rendered, net of returns, discounts and rebates allowed by the company and value added taxes.\n\nTangible fixed assets\nDepreciation is provided at rates calculated to write off the cost of each asset over its expected useful life.\n\nFinancial instruments\nThe company only has financial assets and financial liabilities of a kind that qualify as basic financial instruments. Basic financial instruments, including trade and other debtors and creditors, are initially recognised at transaction value and subsequently measured at their settlement value.\n\nTaxation\nTaxation for the year comprises current and deferred tax. Current tax is recognised at the amount of tax payable using the tax rates and laws that have been enacted or substantively enacted by the balance sheet date.`;

  const directorsCount = (officers || []).length;
  const signingDirectors = (officers || []).slice(0, 2);

  const BSRow = ({ label, value, priorValue, bold, note }: { label: string; value: number; priorValue?: number | null; bold?: boolean; note?: string }) => (
    <tr className={bold ? "font-bold" : ""}>
      <td className="py-1">{label}</td>
      <td className="py-1 text-center text-xs text-slate-400">{note || ""}</td>
      <td className={`py-1 text-right font-mono ${bold ? "border-t border-slate-400" : ""}`}>{fmtBracket(value)}</td>
      <td className={`py-1 text-right font-mono ${bold ? "border-t border-slate-400" : ""}`}>
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
        <h1 className="text-2xl font-bold text-slate-900 mt-4">Companies House Filing (Abbreviated Accounts)</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Balance Sheet and minimal notes only, as required for public filing under the small companies regime. This is separate from the full FRS102/FRS105 accounts prepared for members and HMRC.
        </p>
      </div>

      <div className="max-w-3xl mx-auto p-8 space-y-8">

        {!isBalanced && (
          <div className="rounded-2xl bg-red-50 border border-red-100 p-4 print:hidden">
            <p className="text-sm font-bold text-red-700">⚠ Balance Sheet does not balance — check the full accounts before using this filing view</p>
          </div>
        )}

        <div className="flex justify-end print:hidden">
          <PrintButton />
        </div>

        {/* Cover Page */}
        <div className="bg-white shadow-sm border border-slate-200 p-12 rounded-2xl">
          <p className="text-xs text-slate-700 text-right font-semibold">REGISTERED NUMBER: {client?.company_number || "________"} (England and Wales)</p>
          <div className="text-center mt-32">
            <p className="text-sm font-bold text-slate-900">Unaudited Financial Statements for the Year Ended {periodEndFormatted}</p>
            <p className="text-sm text-slate-700 mt-4">for</p>
            <p className="text-sm font-bold text-slate-900 mt-4">{client?.client_name}</p>
          </div>
        </div>

        {/* Contents */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Contents of the Financial Statements<br />for the Year Ended {periodEndFormatted}</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-2">Company Information</td><td className="py-2 text-right">1</td></tr>
              <tr><td className="py-2">Balance Sheet</td><td className="py-2 text-right">2</td></tr>
              <tr><td className="py-2">Notes to the Financial Statements</td><td className="py-2 text-right">4</td></tr>
              <tr><td className="py-2">Accountants' Report</td><td className="py-2 text-right">7</td></tr>
            </tbody>
          </table>
        </div>

        {/* Company Information */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Company Information<br /><span className="font-normal text-slate-500">for the Year Ended {periodEndFormatted}</span></h2>
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="py-2 font-bold w-1/3 align-top">DIRECTORS:</td>
                <td className="py-2">
                  {(officers || []).length > 0 ? (officers || []).map((o: any) => <div key={o.id}>{o.name}</div>) : "________________"}
                </td>
              </tr>
              <tr>
                <td className="py-4 font-bold align-top">REGISTERED OFFICE:</td>
                <td className="py-4 whitespace-pre-line">{client?.address || "Not on file"}</td>
              </tr>
              <tr>
                <td className="py-2 font-bold align-top">REGISTERED NUMBER:</td>
                <td className="py-2">{client?.company_number || "________"} (England and Wales)</td>
              </tr>
              <tr>
                <td className="py-4 font-bold align-top">ACCOUNTANTS:</td>
                <td className="py-4 whitespace-pre-line">
                  {firmName}
                  {firmAddress && `\n${firmAddress}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Balance Sheet */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <p className="text-xs text-slate-500 text-center">{client?.client_name} (Registered number: {client?.company_number || "________"})</p>
          <h2 className="text-sm font-bold text-slate-900 text-center mt-2">Balance Sheet</h2>
          <p className="text-sm text-slate-500 text-center mb-4">{periodEndFormatted}</p>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <td></td><td className="text-center">Notes</td>
                <td className="text-right font-bold">{currentYearLabel}<br />£</td>
                <td className="text-right font-bold">{priorYearLabel ? `${priorYearLabel}\n£` : ""}</td>
              </tr>
            </thead>
            <tbody>
              <tr><td className="pt-3 font-bold uppercase" colSpan={4}>Fixed Assets</td></tr>
              <BSRow label="Tangible assets" value={result.fixedAssetsNBV} priorValue={prior?.fixedAssetsNBV} note={nFixedAssets ? String(nFixedAssets) : ""} />

              <tr><td className="pt-3 font-bold uppercase" colSpan={4}>Current Assets</td></tr>
              <BSRow label="Debtors" value={tradeDebtors + otherDebtors} priorValue={priorTradeDebtors + priorOtherDebtors} note={String(nDebtors)} />
              <BSRow label="Cash at bank" value={get("Cash at Bank and in Hand")} priorValue={getPrior("Cash at Bank and in Hand")} />
              <BSRow label="Total current assets" value={result.currentAssets} priorValue={prior?.currentAssets} bold />

              <tr><td className="pt-3 font-bold uppercase" colSpan={4}>Creditors</td></tr>
              <BSRow label="Amounts falling due within one year" value={-result.creditors1yr} priorValue={prior ? -prior.creditors1yr : null} note={String(nCreditors)} />
              <BSRow label="Net Current Assets" value={result.netCurrentAssets} priorValue={prior?.netCurrentAssets} bold />
              <BSRow label="Total Assets Less Current Liabilities" value={result.totalAssetsLessCurrentLiabilities} priorValue={prior?.totalAssetsLessCurrentLiabilities} bold />

              <BSRow label="Net Assets" value={result.netAssets} priorValue={prior?.netAssets} bold />

              <tr><td className="pt-3 font-bold uppercase" colSpan={4}>Capital and Reserves</td></tr>
              <BSRow label="Called up share capital" value={result.shareCapital} priorValue={prior?.shareCapital} />
              <BSRow label="Retained earnings" value={result.plReserveCfwd} priorValue={prior?.plReserveCfwd} />
              <BSRow label="Shareholders' Funds" value={result.shareholdersFunds} priorValue={prior?.shareholdersFunds} bold />
            </tbody>
          </table>

          <div className="mt-6 text-xs text-slate-700 space-y-2 border-t border-slate-200 pt-4">
            <p>The company is entitled to exemption from audit under Section 477 of the Companies Act 2006 for the year ended {periodEndFormatted}.</p>
            <p>The members have not required the company to obtain an audit of its financial statements for the year ended {periodEndFormatted} in accordance with Section 476 of the Companies Act 2006.</p>
            <p>The directors acknowledge their responsibilities for:</p>
            <p className="pl-4">(a) ensuring that the company keeps accounting records which comply with Sections 386 and 387 of the Companies Act 2006 and</p>
            <p className="pl-4">(b) preparing financial statements which give a true and fair view of the state of affairs of the company as at the end of each financial year and of its profit or loss for each financial year in accordance with the requirements of Sections 394 and 395 and which otherwise comply with the requirements of the Companies Act 2006 relating to financial statements, so far as applicable to the company.</p>
          </div>

          <div className="mt-6 text-xs text-slate-700 space-y-2 border-t border-slate-200 pt-4">
            <p>The financial statements have been prepared and delivered in accordance with the provisions applicable to companies subject to the small companies regime.</p>
            <p>In accordance with Section 444 of the Companies Act 2006, the Income Statement has not been delivered.</p>
            <p>The financial statements were approved by the Board of Directors and authorised for issue on _______________ and were signed on its behalf by:</p>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200 space-y-8">
            {signingDirectors.length > 0 ? signingDirectors.map((d: any) => (
              <div key={d.id}>
                <p className="border-b border-dashed border-slate-400 w-56">&nbsp;</p>
                <p className="text-xs text-slate-500 mt-1">{d.name} - Director</p>
              </div>
            )) : (
              <>
                <div><p className="border-b border-dashed border-slate-400 w-56">&nbsp;</p><p className="text-xs text-slate-500 mt-1">Director</p></div>
              </>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-6">The notes form part of these financial statements.</p>
        </div>

        {/* Notes */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-sm font-bold text-slate-900 mb-4">Notes to the Financial Statements<br /><span className="font-normal text-slate-500">for the Year Ended {periodEndFormatted}</span></h2>

          <div className="mb-6">
            <p className="text-sm font-bold text-slate-900">{nStatutory}. Statutory Information</p>
            <p className="text-sm text-slate-600 mt-2">
              {client?.client_name} is a private company, limited by shares, registered in England and Wales. The company's registered number and registered office address can be found on the Company Information page.
            </p>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">{nPolicies}. Accounting Policies</p>
              <a href={edit_note === "policies" ? `/accounts-production/${id}/companies-house` : `/accounts-production/${id}/companies-house?edit_note=policies`}
                className="text-xs font-semibold text-blue-600 hover:underline print:hidden">
                {edit_note === "policies" ? "Cancel" : "Edit"}
              </a>
            </div>
            {edit_note === "policies" ? (
              <form action={updateNote.bind(null, id, "note_accounting_policies")} className="mt-2 print:hidden">
                <textarea name="note_text" rows={14}
                  defaultValue={tb.note_accounting_policies || accountingPoliciesDefault}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                <button type="submit" className="mt-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                  Save
                </button>
              </form>
            ) : (
              <div className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{tb.note_accounting_policies || accountingPoliciesDefault}</div>
            )}
          </div>

          <div className="mb-6">
            <p className="text-sm font-bold text-slate-900">{nEmployees}. Employees and Directors</p>
            <p className="text-sm text-slate-600 mt-2">
              The average number of employees during the year was <strong>{tb.average_employees ?? "________"}</strong> ({priorYearLabel ? `${priorYearLabel}: ________` : "no comparative available"}).
            </p>
            <form action={updateEmployeeCount.bind(null, id)} className="mt-3 flex items-end gap-2 print:hidden">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Set average employee count</label>
                <input name="average_employees" type="number" min="0" defaultValue={tb.average_employees ?? ""}
                  className="w-40 rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                Save
              </button>
            </form>
          </div>

          {nFixedAssets && (
            <div className="mb-6">
              <p className="text-sm font-bold text-slate-900">{nFixedAssets}. Tangible Fixed Assets</p>
              <table className="w-full text-xs mt-3">
                <tbody>
                  <tr><td className="py-1 font-semibold" colSpan={2}>COST</td></tr>
                  <tr><td className="py-1">At {periodStartFormatted}</td><td className="py-1 text-right">{fmtInt(costStart)}</td></tr>
                  <tr><td className="py-1">Additions</td><td className="py-1 text-right">{fmtInt(additionsAmt)}</td></tr>
                  <tr><td className="py-1">Disposals</td><td className="py-1 text-right">{disposalsAmt > 0 ? `(${fmtInt(disposalsAmt)})` : "—"}</td></tr>
                  <tr className="border-t border-slate-200"><td className="py-1 font-semibold">At {periodEndFormatted}</td><td className="py-1 text-right font-semibold">{fmtInt(costEnd)}</td></tr>
                  <tr><td className="pt-3 py-1 font-semibold" colSpan={2}>DEPRECIATION</td></tr>
                  <tr><td className="py-1">At {periodStartFormatted}</td><td className="py-1 text-right">{fmtInt(depStart)}</td></tr>
                  <tr><td className="py-1">Charge for year</td><td className="py-1 text-right">{fmtInt(charge)}</td></tr>
                  <tr className="border-t border-slate-200"><td className="py-1 font-semibold">At {periodEndFormatted}</td><td className="py-1 text-right font-semibold">{fmtInt(depEnd)}</td></tr>
                  <tr><td className="pt-3 py-1 font-semibold" colSpan={2}>NET BOOK VALUE</td></tr>
                  <tr><td className="py-1 font-semibold">At {periodEndFormatted}</td><td className="py-1 text-right font-semibold">{fmtInt(costEnd - depEnd)}</td></tr>
                  {prior && <tr><td className="py-1">At {new Date(tb.period_start).toLocaleDateString("en-GB")}</td><td className="py-1 text-right">{fmtInt(costStart - depStart)}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          <div className="mb-6">
            <p className="text-sm font-bold text-slate-900">{nDebtors}. Debtors: Amounts Falling Due Within One Year</p>
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-xs text-slate-500"><td></td><td className="text-right">{currentYearLabel}<br />£</td><td className="text-right">{priorYearLabel ? `${priorYearLabel}\n£` : ""}</td></tr>
              </thead>
              <tbody>
                <tr><td className="py-1 text-slate-600">Trade debtors</td><td className="py-1 text-right font-mono">{fmtBracket(tradeDebtors)}</td><td className="py-1 text-right font-mono">{prior ? fmtBracket(priorTradeDebtors) : ""}</td></tr>
                <tr><td className="py-1 text-slate-600">Other debtors</td><td className="py-1 text-right font-mono">{fmtBracket(otherDebtors)}</td><td className="py-1 text-right font-mono">{prior ? fmtBracket(priorOtherDebtors) : ""}</td></tr>
                <tr className="font-bold border-t border-slate-200"><td className="py-1">Total</td><td className="py-1 text-right font-mono">{fmtBracket(tradeDebtors + otherDebtors)}</td><td className="py-1 text-right font-mono">{prior ? fmtBracket(priorTradeDebtors + priorOtherDebtors) : ""}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="mb-6">
            <p className="text-sm font-bold text-slate-900">{nCreditors}. Creditors: Amounts Falling Due Within One Year</p>
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-xs text-slate-500"><td></td><td className="text-right">{currentYearLabel}<br />£</td><td className="text-right">{priorYearLabel ? `${priorYearLabel}\n£` : ""}</td></tr>
              </thead>
              <tbody>
                <tr><td className="py-1 text-slate-600">Trade creditors</td><td className="py-1 text-right font-mono">{fmtBracket(tradeCreditors)}</td><td className="py-1 text-right font-mono">{prior ? fmtBracket(priorTradeCreditors) : ""}</td></tr>
                <tr><td className="py-1 text-slate-600">Taxation and social security</td><td className="py-1 text-right font-mono">{fmtBracket(taxAndSocialSecurity)}</td><td className="py-1 text-right font-mono">{prior ? fmtBracket(priorTaxAndSocialSecurity) : ""}</td></tr>
                <tr><td className="py-1 text-slate-600">Other creditors</td><td className="py-1 text-right font-mono">{fmtBracket(otherCreditors)}</td><td className="py-1 text-right font-mono">{prior ? fmtBracket(priorOtherCreditors) : ""}</td></tr>
                <tr className="font-bold border-t border-slate-200"><td className="py-1">Total</td><td className="py-1 text-right font-mono">{fmtBracket(tradeCreditors + taxAndSocialSecurity + otherCreditors)}</td><td className="py-1 text-right font-mono">{prior ? fmtBracket(priorTradeCreditors + priorTaxAndSocialSecurity + priorOtherCreditors) : ""}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Accountants' Report */}
        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-sm font-bold text-slate-900 text-center mb-4">
            Accountants' Report to the Board of Directors<br />on the Unaudited Financial Statements of<br />{client?.client_name}
          </h2>
          <div className="text-sm text-slate-700 space-y-3">
            <p className="font-bold">
              The following reproduces the text of the report prepared for the directors in respect of the company's annual unaudited financial statements. In accordance with the Companies Act 2006, the company is only required to file a Balance Sheet. Readers are cautioned that the Income Statement and certain other primary statements and the Report of the Directors are not required to be filed with the Registrar of Companies.
            </p>
            <p>
              In order to assist you to fulfil your duties under the Companies Act 2006, we have prepared for your approval the financial statements of {client?.client_name} for the year ended {periodEndFormatted} which comprise the Income Statement, Balance Sheet and the related notes from the company's accounting records and from information and explanations you have given us.
            </p>
            <p>
              This report is made solely to the Board of Directors of {client?.client_name}, as a body, in accordance with our terms of engagement. Our work has been undertaken solely to prepare for your approval the financial statements of {client?.client_name} and state those matters that we have agreed to state to the Board of Directors, as a body, in this report. To the fullest extent permitted by law, we do not accept or assume responsibility to anyone other than {client?.client_name} and its Board of Directors, as a body, for our work or for this report.
            </p>
            <p>
              It is your duty to ensure that {client?.client_name} has kept adequate accounting records and to prepare statutory financial statements that give a true and fair view of the assets, liabilities, financial position and profit of {client?.client_name}. You consider that {client?.client_name} is exempt from the statutory audit requirement for the year.
            </p>
            <p>
              We have not been instructed to carry out an audit or a review of the financial statements of {client?.client_name}. For this reason, we have not verified the accuracy or completeness of the accounting records or information and explanations you have given to us and we do not, therefore, express any opinion on the statutory financial statements.
            </p>
          </div>
          <div className="mt-8 whitespace-pre-line text-sm text-slate-700">
            {firmName}
            {firmAddress && `\n${firmAddress}`}
          </div>
          <p className="text-sm text-slate-700 mt-6">Date: .............................................</p>
          <p className="text-center text-xs text-slate-400 mt-8">This page does not form part of the statutory financial statements</p>
        </div>

        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>Draft filing view — check carefully before submission.</strong> This reflects the Balance Sheet and minimal notes typically filed under the small companies regime, generated from your mapped trial balance. Does not include iXBRL tagging and cannot be submitted directly to Companies House — file through recognised software or your existing filing route. Verify the director list, registered office, employee count, and debtors/creditors breakdown before use, and confirm whether your firm's accountants' report wording (e.g. "Chartered Accountants") matches your actual designation.
          </p>
        </div>
      </div>
    </div>
  );
}