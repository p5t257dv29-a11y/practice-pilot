import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCtRates, calculateFullCorporationTax } from "../../page";
import { calculateS455 } from "../../../directors-loan-account/page";
import PrintButton from "../../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function setDeclarationSignatory(compId: string, formData: FormData) {
  "use server";
  const officerId = String(formData.get("declaration_officer_id") || "").trim();
  const status = String(formData.get("declaration_status") || "").trim();

  await supabase.from("corporation_tax_computations").update({
    declaration_officer_id: officerId || null,
    declaration_status: status || null,
  }).eq("id", compId);

  revalidatePath(`/corporation-tax/${compId}/ct600`);
}

export default async function CT600Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("corporation_tax_computations")
    .select("*, clients(client_name, company_number, corporation_tax_reference, address)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const client = comp.clients as any;

  const { data: assets } = await supabase.from("fixed_assets").select("*").eq("client_id", comp.client_id);
  const { data: linkedDLAs } = await supabase.from("directors_loan_accounts").select("*").eq("corporation_tax_id", id);
  const { data: officers } = await supabase
    .from("company_officers")
    .select("id, name, role")
    .eq("client_id", comp.client_id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  const selectedOfficer = (officers || []).find((o: any) => o.id === comp.declaration_officer_id) || null;
  const declarationName = selectedOfficer?.name || "";
  const declarationStatus = comp.declaration_status || (selectedOfficer?.role ? selectedOfficer.role.replace(/-/g, " ") : "");

  const dlaResults = (linkedDLAs || []).map((dla) => ({
    dla,
    result: calculateS455({
      closingBalance: Number(dla.closing_balance),
      periodEnd: dla.period_end,
      repaidByDueDate: dla.repaid_by_due_date,
      s455Rate: Number(dla.s455_rate),
    }),
  }));
  const totalS455 = dlaResults.reduce((s, r) => s + r.result.s455Due, 0);

  const ctRates = await getCtRates("2026/27");
  const full = await calculateFullCorporationTax(comp, assets || [], ctRates);
  const { periods, isSplit, totalCorporationTax } = full;

  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB");

  const Box = ({ number, label, value, bold, indent, raw }: { number?: string; label: string; value: string; bold?: boolean; indent?: boolean; raw?: boolean }) => (
    <div className={`flex items-center justify-between py-1.5 ${indent ? "pl-6" : ""} ${bold ? "font-bold border-t border-slate-200 mt-1 pt-2" : ""}`}>
      <div className="flex items-baseline gap-2 min-w-0">
        {number && <span className="flex-shrink-0 text-xs font-mono text-slate-400 w-14">Box {number}</span>}
        <span className={`text-sm ${bold ? "text-slate-900" : "text-slate-700"} truncate`}>{label}</span>
      </div>
      <span className={`flex-shrink-0 text-sm font-mono tabular-nums ${bold ? "text-slate-900" : "text-slate-700"}`}>{raw ? value : `£${value}`}</span>
    </div>
  );

  const renderPeriodCT600 = (p: any, index: number, total: number) => {
    // Turnover isn't itemised per sub-period elsewhere, so it's apportioned
    // here using the same profit-share ratio already computed for the split.
    // Tax already paid on account is apportioned the same way — it's a
    // whole-computation figure with no natural per-period split of its own.
    const turnoverShareRatio = Number(comp.accounting_profit) !== 0 ? p.accountingProfitShare / Number(comp.accounting_profit) : 1 / total;
    const turnoverShare = Number(comp.turnover || 0) * turnoverShareRatio;
    const taxPaidOnAccountShare = Number(comp.tax_paid_on_account || 0) * turnoverShareRatio;

    // Isolates the pure trading result (Box 155) by removing the chargeable
    // gains and R&D adjustments that taxableProfitBeforeLosses already folds in
    // — those get their own boxes further down, matching the real CT600 layout.
    const tradingProfit = p.taxableProfitBeforeLosses - p.totalChargeableGains - p.rdecCredit + p.rdEnhancedDeduction;
    const netTradingProfit = tradingProfit; // no trading losses b/f modelled as a separate carried-forward pool here — see Losses Used below
    const totalProfitsBeforeDeductions = tradingProfit + p.totalChargeableGains + p.rdecCredit - p.rdEnhancedDeduction;
    const profitsBeforeQualifyingDonations = totalProfitsBeforeDeductions - p.loss.lossesUsed;
    const profitsChargeableToCT = p.loss.taxableProfitAfterLosses;

    // Box 430 (Corporation Tax total) is the tax at the full applicable rate
    // before marginal relief is deducted; the calculation engine returns the
    // already-net figure plus the relief amount separately, so the gross
    // figure is reconstructed here for the box that expects it.
    const box430CorporationTax = p.ct.corporationTax + p.ct.marginalRelief;

    const rdCreditsTotal = p.rdecPayable + p.erisPayableCredit;
    const taxOutstandingOrOverpaid = (p.netCorporationTaxDue - rdCreditsTotal) - taxPaidOnAccountShare;

    return (
      <div key={index} className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none mb-6">
        {total > 1 && (
          <div className="bg-purple-50 border-b border-purple-100 px-6 py-2">
            <p className="text-xs font-bold text-purple-700 uppercase tracking-wide">
              Return {index + 1} of {total} — Accounting period {fmtDate(p.periodStart)} to {fmtDate(p.periodEnd)}
            </p>
          </div>
        )}

        {/* Company Information */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Company Information</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Box 1 — Company name</span><span className="font-medium">{client?.client_name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Box 2 — Registration number</span><span className="font-medium">{client?.company_number || "—"}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Box 3 — Tax reference (UTR)</span><span className="font-medium">{client?.corporation_tax_reference || "—"}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Box 30 — Type of company</span><span className="font-medium">0 — Other</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Box 35 — Period start</span><span className="font-medium">{fmtDate(p.periodStart)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Box 40 — Period end</span><span className="font-medium">{fmtDate(p.periodEnd)}</span></div>
          </div>
        </div>

        {/* Turnover */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Turnover</h2>
          <Box number="145" label="Total turnover from trade or profession" value={fmt(turnoverShare)} />
        </div>

        {/* Trading Profit Computation (working schedule, not itself CT600 boxes) */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-1">Trading Profit Computation</h2>
          <p className="text-xs text-slate-400 mb-2">Working schedule — not itself part of the numbered CT600 boxes, but shows how Box 155 is arrived at.</p>
          <div className="text-sm">
            <div className="flex justify-between py-1"><span className="text-slate-600">Profit per accounts</span><span className="font-mono">£{fmt(p.accountingProfitShare)}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-600">Add: Depreciation</span><span className="font-mono">£{fmt(p.depreciationShare)}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-600">Add: Other disallowable expenses</span><span className="font-mono">£{fmt(p.disallowableShare)}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-600">Less: Capital allowances</span><span className="font-mono text-red-600">(£{fmt(p.ca.totalCapitalAllowances)})</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-600">Less: Other allowable deductions</span><span className="font-mono text-red-600">(£{fmt(p.otherDeductionsShare)})</span></div>
            {p.profitOnDisposalShare !== 0 && (
              <div className="flex justify-between py-1"><span className="text-slate-600">Less: Profit/(loss) on disposal per accounts</span><span className="font-mono text-red-600">(£{fmt(p.profitOnDisposalShare)})</span></div>
            )}
            {p.rdEnhancedDeduction > 0 && (
              <div className="flex justify-between py-1"><span className="text-slate-600">Less: ERIS enhanced R&D deduction</span><span className="font-mono text-red-600">(£{fmt(p.rdEnhancedDeduction)})</span></div>
            )}
            {p.rdecCredit > 0 && (
              <div className="flex justify-between py-1"><span className="text-slate-600">Add: R&D expenditure credit (taxable)</span><span className="font-mono">£{fmt(p.rdecCredit)}</span></div>
            )}
            <div className="flex justify-between py-1.5 border-t border-slate-200 mt-1 font-bold">
              <span>Trading profit</span>
              <span className="font-mono">£{fmt(tradingProfit)}</span>
            </div>
          </div>
        </div>

        {/* Income */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Income</h2>
          <Box number="155" label="Trading and professional profits" value={fmt(tradingProfit)} />
          <Box number="160" label="Less: trading losses brought forward" value="0.00" indent />
          <Box number="165" label="Net trading and professional profits" value={fmt(netTradingProfit)} bold />
          {p.rdecCredit > 0 && (
            <Box number="205" label="Income not falling under any other heading (R&D expenditure credit)" value={fmt(p.rdecCredit)} />
          )}
        </div>

        {/* Chargeable Gains */}
        {p.gainRows.length > 0 && (
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Chargeable Gains</h2>
            <Box number="210" label="Gross chargeable gains" value={fmt(p.gainRows.filter((g: any) => !g.result.isLoss).reduce((s: number, g: any) => s + g.result.taxableGain, 0))} />
            <Box number="215" label="Allowable losses including losses brought forward" value={fmt(p.gainRows.filter((g: any) => g.result.isLoss).reduce((s: number, g: any) => s + g.result.lossAmount, 0))} indent />
            <Box number="220" label="Net chargeable gains" value={fmt(p.totalChargeableGains)} bold />
          </div>
        )}

        {/* Profits before deductions and reliefs */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Profits Before Deductions and Reliefs</h2>
          <Box number="235" label="Profits before other deductions and reliefs" value={fmt(totalProfitsBeforeDeductions)} bold />
        </div>

        {/* Deductions and Reliefs */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Deductions and Reliefs</h2>
          <Box number="285" label="Trading losses carried forward and claimed against total profits" value={fmt(p.loss.lossesUsed)} />
          <Box number="295" label="Total of deductions and reliefs" value={fmt(p.loss.lossesUsed)} indent />
          <Box number="300" label="Profits before qualifying donations and group relief" value={fmt(profitsBeforeQualifyingDonations)} />
          <Box number="315" label="Profits chargeable to Corporation Tax" value={fmt(profitsChargeableToCT)} bold />
        </div>

        {/* Corporation Tax Calculation */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Corporation Tax Calculation</h2>
          <div className="grid grid-cols-2 gap-x-6 text-sm mb-2">
            <div className="flex justify-between"><span className="text-slate-500">Band</span><span className="font-medium">{p.ct.band}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Effective rate</span><span className="font-medium">{(p.ct.effectiveRate * 100).toFixed(2)}%</span></div>
          </div>
          <Box number="326" label="Number of associated companies in this period" value={String(comp.associated_companies || 0)} raw />
          <Box number="430" label="Corporation Tax" value={fmt(box430CorporationTax)} />
          {p.ct.marginalRelief > 0 && (
            <Box number="435" label="Marginal relief" value={fmt(p.ct.marginalRelief)} indent />
          )}
          <Box number="440" label="Corporation Tax chargeable" value={fmt(p.ct.corporationTax)} bold />
        </div>

        {/* Reliefs and Deductions in Terms of Tax */}
        {p.rdecUsedAgainstCT > 0 && (
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Reliefs and Deductions in Terms of Tax</h2>
            <Box number="470" label="Total reliefs and deductions in terms of tax (R&D expenditure credit used)" value={fmt(p.rdecUsedAgainstCT)} bold />
          </div>
        )}

        {/* Calculation of Tax Outstanding */}
        <div className="p-6">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Calculation of Tax Outstanding</h2>
          <Box number="475" label="Net Corporation Tax liability" value={fmt(p.netCorporationTaxDue)} bold />
          {p.erisPayableCredit > 0 && (
            <Box number="875" label="Payable Research and Development tax credit (ERIS)" value={fmt(p.erisPayableCredit)} />
          )}
          {p.rdecPayable > 0 && (
            <Box number="880" label="Payable Research and Development expenditure credit" value={fmt(p.rdecPayable)} />
          )}
          {taxPaidOnAccountShare > 0 && (
            <Box number="595" label="Tax already paid (and not already repaid)" value={fmt(taxPaidOnAccountShare)} />
          )}
          {taxOutstandingOrOverpaid >= 0 ? (
            <Box number="600" label="Tax outstanding for this period" value={fmt(taxOutstandingOrOverpaid)} bold />
          ) : (
            <Box number="605" label="Tax overpaid for this period" value={fmt(Math.abs(taxOutstandingOrOverpaid))} bold />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <div className="flex items-center justify-between">
          <a href={`/corporation-tax/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to Computation
          </a>
          <PrintButton />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">CT600 Company Tax Return Summary</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Box numbers reflect the current CT600 form structure — HMRC revises these periodically, so always verify against the live form before filing. This is a working reference, not a filable return.
        </p>
      </div>

      {/* Declaration signatory picker — screen only, never printed */}
      <div className="max-w-3xl mx-auto px-8 pt-8 print:hidden">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Declaration Signatory</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pick which director signs this return — pulled from the company's Directors &amp; Officers record. This choice is saved against this computation and fills the Declaration section below.
          </p>
          {(officers || []).length === 0 ? (
            <p className="text-sm text-slate-500 mt-3">No active directors on file for this client. Add them under the client's Directors tab first.</p>
          ) : (
            <form action={setDeclarationSignatory.bind(null, id)} className="mt-3 flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-slate-700 mb-1">Signing Director</label>
                <select name="declaration_officer_id" defaultValue={comp.declaration_officer_id || ""}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="">Not selected</option>
                  {(officers || []).map((o: any) => (
                    <option key={o.id} value={o.id}>{o.name}{o.role ? ` — ${o.role.replace(/-/g, " ")}` : ""}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-slate-700 mb-1">Status (Box 985)</label>
                <input name="declaration_status" defaultValue={comp.declaration_status || ""} placeholder="e.g. Director"
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        {periods.map((p: any, i: number) => renderPeriodCT600(p, i, periods.length))}

        {isSplit && (
          <div className="rounded-2xl bg-purple-50 border border-purple-200 p-4 mb-6">
            <div className="flex justify-between font-bold text-purple-900">
              <span>Total Corporation Tax due (both returns)</span>
              <span className="font-mono">£{fmt(totalCorporationTax)}</span>
            </div>
          </div>
        )}

        {/* CT600A — Loans to Participators */}
        {dlaResults.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none mb-6">
            <div className="bg-amber-50 border-b border-amber-100 px-6 py-2">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Supplementary Page CT600A — Loans to Participators</p>
            </div>
            <div className="p-6 space-y-6">
              <p className="text-xs text-slate-400">
                Required whenever a close company has made a loan to a director/shareholder (participator) that remains outstanding, or was written off, during the period.
              </p>
              {dlaResults.map(({ dla, result }, i) => (
                <div key={dla.id} className={i > 0 ? "pt-6 border-t border-slate-100" : ""}>
                  <p className="text-sm font-bold text-slate-900 mb-2">Loan {i + 1} — {dla.director_name}</p>
                  <Box number="A5" label="Name of participator" value={dla.director_name} raw />
                  <Box number="A15" label="Amount outstanding at period end" value={fmt(Number(dla.closing_balance))} />
                  <Box number="A20" label="Rate of tax" value={`${(Number(dla.s455_rate) * 100).toFixed(2)}%`} raw />
                  <Box number="A30" label="Tax due under s455 (this loan)" value={fmt(result.s455Due)} bold={result.s455Due > 0} />
                  {result.isOverdrawn && result.s455Due === 0 && (
                    <p className="text-xs text-green-700 mt-1">Repaid within 9 months of the accounting period end — no s455 charge arises.</p>
                  )}
                </div>
              ))}
              <div className="pt-4 border-t border-slate-200">
                <Box label="Total s455 due (CT600A)" value={fmt(totalS455)} bold />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-slate-900 p-6 text-white">
          <div className="flex justify-between items-center">
            <span className="font-bold">Total Tax Payable (Corporation Tax + s455)</span>
            <span className="font-mono text-2xl font-bold">£{fmt(totalCorporationTax + totalS455)}</span>
          </div>
        </div>

        {/* Declaration */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none mt-6">
          <div className="bg-slate-50 border-b border-slate-100 px-6 py-2">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Declaration</p>
          </div>
          <div className="p-6 text-sm text-slate-700 space-y-4">
            <p>
              I declare that the information I have given on this Company Tax Return and any supplementary pages is correct and complete to the best of my knowledge and belief.
              I understand that giving false information in the return, or concealing any part of the company&apos;s profits or tax payable, can lead to both the company and me being prosecuted.
            </p>
            <div className="grid grid-cols-3 gap-6 pt-2">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Box 975 — Name</p>
                <p className="text-sm font-medium text-slate-900 border-b border-slate-300 h-8 pb-1">{declarationName || " "}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Box 980 — Date</p>
                {comp.status === "Approved" && comp.approved_at ? (
                  <p className="text-sm font-medium text-slate-900 border-b border-slate-300 h-8 pb-1">
                    {new Date(comp.approved_at).toLocaleDateString("en-GB")}
                  </p>
                ) : (
                  <div className="border-b border-slate-300 h-8"></div>
                )}
              </div>              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Box 985 — Status</p>
                <p className="text-sm font-medium text-slate-900 border-b border-slate-300 h-8 pb-1 capitalize">{declarationStatus || " "}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4 mt-6 print:hidden">
          <p className="text-xs text-yellow-800">
            Doesn't model group relief, controlled foreign companies (CT600B), tonnage tax, qualifying donations, or discretionary trust income — none captured here. Box numbering reflects a recent CT600 version from general knowledge and may not exactly match the current live HMRC form; always cross-check against the actual form in use before filing. This is a working reference for review purposes, not a filable return — file through recognised software or your existing filing route.
          </p>
        </div>
      </div>
    </div>
  );
}