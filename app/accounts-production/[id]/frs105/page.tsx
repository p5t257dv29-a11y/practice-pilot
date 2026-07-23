import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { calculateNBV } from "../../../fixed-assets/page";
import { calculateProfitAndLoss, CREDIT_NORMAL, FIXED_ASSET_CLASSES, FIXED_ASSET_MOVEMENT, DLA_MOVEMENT_CATEGORIES, getCustomPLCategories, PL_CATEGORY_GROUPS, type PLGroup } from "../../page";
import SendAccountsButton from "../../../send-accounts-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const INTANGIBLE_CLASS_SET = new Set(FIXED_ASSET_CLASSES.filter((c) => c.isIntangible).map((c) => c.assetClass));
const TANGIBLE_CLASS_SET = new Set(FIXED_ASSET_CLASSES.filter((c) => !c.isIntangible).map((c) => c.assetClass));

async function updateNote(trialBalanceId: string, field: string, formData: FormData) {
  "use server";
  const text = String(formData.get("note_text") || "").trim();
  await supabase.from("trial_balances").update({ [field]: text || null }).eq("id", trialBalanceId);
  revalidatePath(`/accounts-production/${trialBalanceId}/frs105`);
}

async function updateEmployeeCount(trialBalanceId: string, formData: FormData) {
  "use server";
  const count = parseInt(String(formData.get("average_employees") || "").trim());
  await supabase.from("trial_balances").update({ average_employees: isNaN(count) ? null : count }).eq("id", trialBalanceId);
  revalidatePath(`/accounts-production/${trialBalanceId}/frs105`);
}

export async function computeBalanceSheet(clientId: string, periodEnd: string, lines: any[], customPLGroups: Record<string, PLGroup> = {}) {
  const totals = new Map<string, number>();
  lines.forEach((l) => {
    if (!l.category) return;
    const net = CREDIT_NORMAL.has(l.category) ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
    totals.set(l.category, (totals.get(l.category) || 0) + net);
  });
  const get = (cat: string) => totals.get(cat) || 0;

  function classNBVFromTB(assetClass: string) {
    const m = FIXED_ASSET_MOVEMENT[assetClass];
    const cost = get(m.costBf) + get(m.additions) - get(m.disposalsCost);
    const dep = get(m.depBf) + get(m.depCharge) - get(m.depDisposals);
    return cost - dep;
  }

  const tbTangibleNBV = get("Tangible Fixed Assets") +
    [...TANGIBLE_CLASS_SET].reduce((s, c) => s + classNBVFromTB(c), 0);
  const tbIntangibleNBV = get("Intangible Fixed Assets") +
    [...INTANGIBLE_CLASS_SET].reduce((s, c) => s + classNBVFromTB(c), 0);

  let fixedAssetsNBV = tbTangibleNBV;
  let intangibleAssetsNBV = tbIntangibleNBV;
  const { data: clientAssets } = await supabase.from("fixed_assets").select("*").eq("client_id", clientId);
  if (clientAssets && clientAssets.length > 0) {
    const stillHeld = (a: any) => !a.disposal_date || new Date(a.disposal_date) > new Date(periodEnd);
    fixedAssetsNBV = clientAssets
      .filter((a) => stillHeld(a) && !INTANGIBLE_CLASS_SET.has(a.category))
      .reduce((s, a) => s + calculateNBV(a, new Date(periodEnd)).nbv, 0);
    intangibleAssetsNBV = clientAssets
      .filter((a) => stillHeld(a) && INTANGIBLE_CLASS_SET.has(a.category))
      .reduce((s, a) => s + calculateNBV(a, new Date(periodEnd)).nbv, 0);
  }

  const totalFixedAssets = fixedAssetsNBV + intangibleAssetsNBV;

  const pl = calculateProfitAndLoss(lines, customPLGroups);
  const stock = get("Stock");
  const debtors = get("Trade Debtors");
  const prepayments = get("Prepayments and Accrued Income");
  const cash = get("Cash at Bank and in Hand");
  const dla = get("Directors' Loan Account") + DLA_MOVEMENT_CATEGORIES.reduce((s, c) => s + get(c), 0);
  const dlaIsAsset = dla > 0;
  const currentAssets = stock + debtors + prepayments + cash + (dlaIsAsset ? dla : 0);

  const creditors1yr =
    get("Trade Creditors") + get("Accruals and Deferred Income") + get("VAT Liability") +
    get("PAYE/NI Liability") + get("Corporation Tax Liability") + get("Bank Loans - Due Within One Year") +
    (dlaIsAsset ? 0 : -dla);

  const netCurrentAssets = currentAssets - creditors1yr;
  const totalAssetsLessCurrentLiabilities = totalFixedAssets + netCurrentAssets;
  const creditorsAfter1yr = get("Bank Loans - Due After One Year");
  const netAssets = totalAssetsLessCurrentLiabilities - creditorsAfter1yr;

  const shareCapital = get("Called Up Share Capital");
  const plReserveCfwd = get("Profit and Loss Reserve") + pl.profitBeforeTax;
  const shareholdersFunds = shareCapital + plReserveCfwd;

  return { fixedAssetsNBV, intangibleAssetsNBV, totalFixedAssets, currentAssets, creditors1yr, netCurrentAssets, totalAssetsLessCurrentLiabilities, creditorsAfter1yr, netAssets, shareCapital, plReserveCfwd, shareholdersFunds, pl, dla };
}

export default async function FRS105AccountsPage({
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
    .select("*, clients(client_name, company_number, address, bank_name, email)")
    .eq("id", id)
    .single();

  if (error || !tb) notFound();

  const { data: practiceSettings } = await supabase
    .from("practice_settings")
    .select("firm_name")
    .limit(1)
    .maybeSingle();
  const firmName = practiceSettings?.firm_name || "Your Firm Name";

  const [{ data: lines }, { data: officers }] = await Promise.all([
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", id),
    supabase.from("company_officers").select("*").eq("client_id", tb.client_id).eq("is_active", true).limit(1),
  ]);

  const director = officers?.[0] as any;
  const directorName = director?.officer_name || director?.name || director?.full_name || "________________";
  const client = tb.clients as any;

  const customPL = await getCustomPLCategories(supabase);

  const current = await computeBalanceSheet(tb.client_id, tb.period_end, lines || [], customPL.groups);

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
    prior = await computeBalanceSheet(tb.client_id, priorTb.period_end, priorLines || [], customPL.groups);
  }

  const isBalanced = Math.abs(current.netAssets - current.shareholdersFunds) < 1;

  const groupOf = (cat: string) => PL_CATEGORY_GROUPS[cat] || customPL.groups[cat];
  const detailedPLGroups: { key: PLGroup; label: string; rows: { name: string; value: number; priorValue: number | null }[] }[] =
    (["turnover", "cost_of_sales", "admin_expenses", "interest_payable", "interest_receivable"] as PLGroup[]).map((key) => {
      const label = { turnover: "Turnover", cost_of_sales: "Cost of Sales", admin_expenses: "Administrative Expenses", interest_payable: "Interest Payable", interest_receivable: "Interest Receivable" }[key];
      const names = new Set<string>();
      current.pl.totals.forEach((_, cat) => { if (groupOf(cat) === key) names.add(cat); });
      if (prior) prior.pl.totals.forEach((_, cat) => { if (groupOf(cat) === key) names.add(cat); });
      const rows = Array.from(names).map((name) => ({
        name,
        value: current.pl.totals.get(name) || 0,
        priorValue: prior ? (prior.pl.totals.get(name) || 0) : null,
      }));
      return { key, label, rows };
    }).filter((g) => g.rows.length > 0);

  const { data: registerAssetsRaw } = await supabase.from("fixed_assets").select("*").eq("client_id", tb.client_id);
  const registerAssets = registerAssetsRaw || [];
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

  let noteNum = 1;
  const nGeneral = noteNum++;
  const nFixedAssets = categoryRows.length > 0 ? noteNum++ : null;
  const nShareCapital = noteNum++;
  const nEmployees = noteNum++;
  const nDirectors = noteNum++;

  const updateEmployeeCountWithId = updateEmployeeCount.bind(null, id);

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

        <div className="bg-white shadow-sm border border-slate-200 p-12 rounded-2xl">
          <p className="text-xs text-slate-500 text-right">Registered number: {client?.company_number || "________"}</p>
          <div className="text-center mt-20">
            <h1 className="text-2xl font-bold text-slate-900 uppercase">{client?.client_name}</h1>
            <p className="text-base text-slate-600 mt-6 uppercase font-bold">Unaudited Financial Statements</p>
            <p className="text-base text-slate-600">For The Year Ended {periodEndFormatted}</p>
          </div>
          <div className="mt-24 text-center text-sm text-slate-500">
            <p>{firmName}</p>
          </div>
        </div>

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

        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Company Information</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-2 font-bold w-1/3">Director</td><td className="py-2">{directorName}</td></tr>
              <tr><td className="py-2 font-bold">Company Number</td><td className="py-2">{client?.company_number || "Not on file"}</td></tr>
              <tr><td className="py-2 font-bold">Registered Office</td><td className="py-2">{client?.address || "Not on file"}</td></tr>
              <tr><td className="py-2 font-bold">Accountants</td><td className="py-2">{firmName}</td></tr>
              {client?.bank_name && (
                <tr><td className="py-2 font-bold">Bankers</td><td className="py-2">{client.bank_name}</td></tr>
              )}
            </tbody>
          </table>
        </div>

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
              {(current.intangibleAssetsNBV !== 0 || (prior && prior.intangibleAssetsNBV !== 0)) && (
                <BSRow label="Intangible assets" value={current.intangibleAssetsNBV} priorValue={prior?.intangibleAssetsNBV} note={nFixedAssets ? String(nFixedAssets) : ""} />
              )}
              <BSRow label="Tangible assets" value={current.fixedAssetsNBV} priorValue={prior?.fixedAssetsNBV} note={nFixedAssets ? String(nFixedAssets) : ""} />

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
              <BSRow label="Called up share capital" value={current.shareCapital} priorValue={prior?.shareCapital} note={String(nShareCapital)} />
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

        {detailedPLGroups.length > 0 && (
          <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
            <h2 className="text-lg font-bold text-slate-900 text-center">Detailed Profit and Loss Account</h2>
            <p className="text-sm text-slate-500 text-center mb-1">For the Year Ended {periodEndFormatted}</p>
            <p className="text-xs text-slate-400 text-center mb-6">Supplementary schedule — not required to be filed at Companies House by a micro-entity</p>

            <table className="w-full text-sm">
              <tbody>
                {detailedPLGroups.map((group) => (
                  <Fragment key={group.key}>
                    <tr><td className="pt-3 font-bold uppercase text-xs text-slate-500" colSpan={4}>{group.label}</td></tr>
                    {group.rows.map((r) => (
                      <BSRow key={r.name} label={r.name} value={group.key === "cost_of_sales" || group.key === "admin_expenses" || group.key === "interest_payable" ? -r.value : r.value} priorValue={r.priorValue === null ? null : (group.key === "cost_of_sales" || group.key === "admin_expenses" || group.key === "interest_payable" ? -r.priorValue : r.priorValue)} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Notes to the Financial Statements</h2>

          <div className="mb-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">{nGeneral}. General Information</p>
              <a href={edit_note === "general" ? `/accounts-production/${id}/frs105` : `/accounts-production/${id}/frs105?edit_note=general`}
                className="text-xs font-semibold text-blue-600 hover:underline print:hidden">
                {edit_note === "general" ? "Cancel" : "Edit"}
              </a>
            </div>
            {edit_note === "general" ? (
              <form action={updateNote.bind(null, id, "note_general_info")} className="mt-2 print:hidden">
                <textarea name="note_text" rows={5}
                  defaultValue={tb.note_general_info || `${client?.client_name} is a private company limited by shares, incorporated in England and Wales, registration number ${client?.company_number || "________"}.${client?.address ? ` The registered office is ${client.address}.` : ""}\n\nThese financial statements have been prepared in accordance with the provisions of FRS 105, the Financial Reporting Standard applicable to the Micro-entities Regime, and the Companies Act 2006. The financial statements are presented in Sterling (£).`}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                <button type="submit" className="mt-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                  Save
                </button>
              </form>
            ) : (
              <div className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">
                {tb.note_general_info || `${client?.client_name} is a private company limited by shares, incorporated in England and Wales, registration number ${client?.company_number || "________"}.${client?.address ? ` The registered office is ${client.address}.` : ""}\n\nThese financial statements have been prepared in accordance with the provisions of FRS 105, the Financial Reporting Standard applicable to the Micro-entities Regime, and the Companies Act 2006. The financial statements are presented in Sterling (£).`}
              </div>
            )}
          </div>

          {nFixedAssets && (
            <div className="mb-6">
              <p className="text-sm font-bold text-slate-900">{nFixedAssets}. Fixed Assets</p>
              <p className="text-xs text-slate-400 mt-1">Depreciation columns include amortisation for intangible asset classes (e.g. Goodwill).</p>
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
            <p className="text-sm font-bold text-slate-900">{nShareCapital}. Share Capital</p>
            <table className="w-full text-sm mt-2">
              <tbody>
                <BSRow label="Allotted, called up and fully paid" value={current.shareCapital} priorValue={prior?.shareCapital} />
              </tbody>
            </table>
          </div>

          <div className="mb-6">
            <p className="text-sm font-bold text-slate-900">{nEmployees}. Employees</p>
            <p className="text-sm text-slate-600 mt-2">
              The average number of persons (including directors) employed by the company during the year was{" "}
              <strong>{tb.average_employees ?? "________"}</strong> ({priorYearLabel ? `${priorYearLabel}: ________` : "no comparative available"}).
            </p>
            {(tb.average_employees === null || tb.average_employees === undefined) && (
              <div className="mt-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 print:hidden">
                <p className="text-xs font-semibold text-red-700">
                  ⚠ Average employee count is missing — this is a required disclosure and must be set before filing.
                </p>
              </div>
            )}
            <form action={updateEmployeeCountWithId} className="mt-3 flex items-end gap-2 print:hidden">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Set average employee count</label>
                <input name="average_employees" type="number" min="0" defaultValue={tb.average_employees ?? ""}
                  className="w-40 rounded-xl border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                Save
              </button>
            </form>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-900">{nDirectors}. Advances, Credit and Guarantees to Directors</p>
            <p className="text-sm text-slate-600 mt-2">
              {current.dla !== 0
                ? `The company had a balance of £${fmt(Math.abs(current.dla))} ${current.dla > 0 ? "owed to the company by" : "owed by the company to"} a director at the balance sheet date.`
                : "No advances, credits, or guarantees were granted to directors during the year."}
            </p>
          </div>
        </div>

        <div className="bg-white shadow-sm border border-slate-200 p-8 rounded-2xl print:hidden">
          <h2 className="text-lg font-bold text-slate-900">Send for Client Approval</h2>
          <p className="text-sm text-slate-500 mt-0.5">Send a summary of these accounts by email for digital approval.</p>
          <div className="mt-4 max-w-md">
            <SendAccountsButton
              trialBalanceId={id}
              accountsType="FRS105"
              defaultEmail={client?.email || ""}
              approvalToken={tb.accounts_type === "FRS105" ? tb.approval_token : null}
              approvalStatus={tb.accounts_type === "FRS105" ? tb.approval_status : null}
              approvedAt={tb.accounts_type === "FRS105" ? tb.approved_at : null}
              queriedAt={tb.accounts_type === "FRS105" ? tb.queried_at : null}
            />
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
