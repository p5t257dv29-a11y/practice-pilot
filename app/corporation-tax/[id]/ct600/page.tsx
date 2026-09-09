import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { getCtRates, calculateFullCorporationTax } from "../../page";
import { calculateS455 } from "../../../directors-loan-account/page";
import PrintButton from "../../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  const Box = ({ number, label, value, bold, indent }: { number?: string; label: string; value: string; bold?: boolean; indent?: boolean }) => (
    <div className={`flex items-center justify-between py-1.5 ${indent ? "pl-6" : ""} ${bold ? "font-bold border-t border-slate-200 mt-1 pt-2" : ""}`}>
      <div className="flex items-baseline gap-2 min-w-0">
        {number && <span className="flex-shrink-0 text-xs font-mono text-slate-400 w-14">Box {number}</span>}
        <span className={`text-sm ${bold ? "text-slate-900" : "text-slate-700"} truncate`}>{label}</span>
      </div>
      <span className={`flex-shrink-0 text-sm font-mono tabular-nums ${bold ? "text-slate-900" : "text-slate-700"}`}>£{value}</span>
    </div>
  );

  const renderPeriodCT600 = (p: any, index: number, total: number) => {
    // Turnover isn't itemised per sub-period elsewhere, so it's apportioned
    // here using the same profit-share ratio already computed for the split.
    const turnoverShareRatio = Number(comp.accounting_profit) !== 0 ? p.accountingProfitShare / Number(comp.accounting_profit) : 1 / total;
    const turnoverShare = Number(comp.turnover || 0) * turnoverShareRatio;

    // Isolates the pure trading result (Box 155) by removing the chargeable
    // gains and R&D adjustments that taxableProfitBeforeLosses already folds in
    // — those get their own boxes further down, matching the real CT600 layout.
    const tradingProfit = p.taxableProfitBeforeLosses - p.totalChargeableGains - p.rdecCredit + p.rdEnhancedDeduction;
    const netTradingProfit = tradingProfit; // no trading losses b/f modelled as a separate carried-forward pool here — see Losses Used below
    const totalProfitsBeforeDeductions = tradingProfit + p.totalChargeableGains + p.rdecCredit - p.rdEnhancedDeduction;
    const profitsChargeableToCT = p.loss.taxableProfitAfterLosses;

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
            <Box number="205" label="Net non-trading profits chargeable (R&D expenditure credit)" value={fmt(p.rdecCredit)} />
          )}
        </div>

        {/* Chargeable Gains */}
        {p.gainRows.length > 0 && (
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Chargeable Gains</h2>
            <Box number="260" label="Gross chargeable gains" value={fmt(p.gainRows.filter((g: any) => !g.result.isLoss).reduce((s: number, g: any) => s + g.result.taxableGain, 0))} />
            <Box number="265" label="Less: allowable losses" value={fmt(p.gainRows.filter((g: any) => g.result.isLoss).reduce((s: number, g: any) => s + g.result.lossAmount, 0))} indent />
            <Box number="275" label="Net chargeable gains" value={fmt(p.totalChargeableGains)} bold />
          </div>
        )}

        {/* Total Profits */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Total Profits</h2>
          <Box number="285" label="Profits before deductions and reliefs" value={fmt(totalProfitsBeforeDeductions)} bold />
        </div>

        {/* Deductions and Reliefs */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Deductions and Reliefs</h2>
          <Box number="305" label="Trading losses of this or a later accounting period" value={fmt(p.loss.lossesUsed)} />
          <Box number="325" label="Total deductions" value={fmt(p.loss.lossesUsed)} indent />
          <Box number="330" label="Profits chargeable to Corporation Tax" value={fmt(profitsChargeableToCT)} bold />
        </div>

        {/* Corporation Tax Calculation */}
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Corporation Tax Calculation</h2>
          <div className="grid grid-cols-2 gap-x-6 text-sm mb-2">
            <div className="flex justify-between"><span className="text-slate-500">Band</span><span className="font-medium">{p.ct.band}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Effective rate</span><span className="font-medium">{(p.ct.effectiveRate * 100).toFixed(2)}%</span></div>
          </div>
          <Box number="480" label="Corporation Tax at effective rate" value={fmt(p.ct.corporationTax)} />
          <Box number="605" label="Corporation Tax (Box 480 total)" value={fmt(p.ct.corporationTax)} bold />
        </div>

        {/* Reliefs and Deductions in Terms of Tax */}
        {p.rdecUsedAgainstCT > 0 && (
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Reliefs and Deductions in Terms of Tax</h2>
            <Box number="625" label="R&D expenditure credit used against this liability" value={fmt(p.rdecUsedAgainstCT)} />
            <Box number="650" label="Total reliefs and deductions" value={fmt(p.rdecUsedAgainstCT)} indent bold />
          </div>
        )}

        {/* Calculation of Tax Outstanding */}
        <div className="p-6">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Calculation of Tax Outstanding</h2>
          <Box number="620" label="Net Corporation Tax liability" value={fmt(p.netCorporationTaxDue)} bold />
          {(p.rdecPayable > 0 || p.erisPayableCredit > 0) && (
            <Box number="890" label="R&D payable credit due (repayment)" value={fmt(p.rdecPayable + p.erisPayableCredit)} />
          )}
          <Box number="730" label="Tax outstanding for this period" value={fmt(Math.max(0, p.netCorporationTaxDue - p.rdecPayable - p.erisPayableCredit))} bold />
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
                  <Box number="A5" label="Name of participator" value={dla.director_name} />
                  <Box number="A15" label="Amount outstanding at period end" value={fmt(Number(dla.closing_balance))} />
                  <Box number="A20" label="Rate of tax" value={`${(Number(dla.s455_rate) * 100).toFixed(2)}%`} />
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

        <div className="rounded-2xl bg-yellow-50 border border-yellow-100 p-4 mt-6 print:hidden">
          <p className="text-xs text-yellow-800">
            Doesn't model group relief, controlled foreign companies (CT600B), tonnage tax, or discretionary trust income — none captured here. Box numbering reflects a recent CT600 version from general knowledge and may not exactly match the current live HMRC form; always cross-check against the actual form in use before filing. This is a working reference for review purposes, not a filable return — file through recognised software or your existing filing route.
          </p>
        </div>
      </div>
    </div>
  );
}