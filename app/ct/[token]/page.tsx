import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCtRates, calculateFullCorporationTax } from "../../corporation-tax/page";
import { calculateS455 } from "../../directors-loan-account/page";
import PrintButton from "../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function approveComputation(token: string) {
  "use server";
  await supabase
    .from("corporation_tax_computations")
    .update({ status: "Approved", approved_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/ct/${token}`);
}

async function queryComputation(token: string) {
  "use server";
  await supabase
    .from("corporation_tax_computations")
    .update({ status: "Queried", queried_at: new Date().toISOString() })
    .eq("token", token);
  revalidatePath(`/ct/${token}`);
}

export default async function PublicCTPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [{ data: comp, error }, { data: practiceSettings }] = await Promise.all([
    supabase
      .from("corporation_tax_computations")
      .select("*, clients(client_name, company_number, corporation_tax_reference, address)")
      .eq("token", token)
      .single(),
    supabase.from("practice_settings").select("firm_name").limit(1).maybeSingle(),
  ]);

  if (error || !comp) notFound();

  const client = comp.clients as any;
  const firmName = practiceSettings?.firm_name || "Your Accountant";

  const approveWithToken = approveComputation.bind(null, token);
  const queryWithToken = queryComputation.bind(null, token);

  const isApproved = comp.status === "Approved";
  const isQueried = comp.status === "Queried";
  const isResponded = isApproved || isQueried;

  const { data: assets } = await supabase.from("fixed_assets").select("*").eq("client_id", comp.client_id);
  const { data: linkedDLAs } = await supabase.from("directors_loan_accounts").select("*").eq("corporation_tax_id", comp.id);
  const { data: officers } = await supabase
    .from("company_officers")
    .select("id, name, role")
    .eq("client_id", comp.client_id)
    .eq("is_active", true);

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
  const fmtDateTime = (d: string) =>
    `${new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} at ${new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

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
    const turnoverShareRatio = Number(comp.accounting_profit) !== 0 ? p.accountingProfitShare / Number(comp.accounting_profit) : 1 / total;
    const turnoverShare = Number(comp.turnover || 0) * turnoverShareRatio;
    const taxPaidOnAccountShare = Number(comp.tax_paid_on_account || 0) * turnoverShareRatio;

    const tradingProfit = p.taxableProfitBeforeLosses - p.totalChargeableGains - p.rdecCredit + p.rdEnhancedDeduction;
    const netTradingProfit = tradingProfit;
    const totalProfitsBeforeDeductions = tradingProfit + p.totalChargeableGains + p.rdecCredit - p.rdEnhancedDeduction;
    const profitsBeforeQualifyingDonations = totalProfitsBeforeDeductions - p.loss.lossesUsed;
    const profitsChargeableToCT = p.loss.taxableProfitAfterLosses;

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

        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Income</h2>
          <Box number="155" label="Trading and professional profits" value={fmt(tradingProfit)} />
          <Box number="160" label="Less: trading losses brought forward" value="0.00" indent />
          <Box number="165" label="Net trading and professional profits" value={fmt(netTradingProfit)} bold />
          {p.rdecCredit > 0 && (
            <Box number="205" label="Income not falling under any other heading (R&D expenditure credit)" value={fmt(p.rdecCredit)} />
          )}
        </div>

        {p.gainRows.length > 0 && (
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Chargeable Gains</h2>
            <Box number="210" label="Gross chargeable gains" value={fmt(p.gainRows.filter((g: any) => !g.result.isLoss).reduce((s: number, g: any) => s + g.result.taxableGain, 0))} />
            <Box number="215" label="Allowable losses including losses brought forward" value={fmt(p.gainRows.filter((g: any) => g.result.isLoss).reduce((s: number, g: any) => s + g.result.lossAmount, 0))} indent />
            <Box number="220" label="Net chargeable gains" value={fmt(p.totalChargeableGains)} bold />
          </div>
        )}

        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Profits Before Deductions and Reliefs</h2>
          <Box number="235" label="Profits before other deductions and reliefs" value={fmt(totalProfitsBeforeDeductions)} bold />
        </div>

        <div className="p-6 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Deductions and Reliefs</h2>
          <Box number="285" label="Trading losses carried forward and claimed against total profits" value={fmt(p.loss.lossesUsed)} />
          <Box number="295" label="Total of deductions and reliefs" value={fmt(p.loss.lossesUsed)} indent />
          <Box number="300" label="Profits before qualifying donations and group relief" value={fmt(profitsBeforeQualifyingDonations)} />
          <Box number="315" label="Profits chargeable to Corporation Tax" value={fmt(profitsChargeableToCT)} bold />
        </div>

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

        {p.rdecUsedAgainstCT > 0 && (
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Reliefs and Deductions in Terms of Tax</h2>
            <Box number="470" label="Total reliefs and deductions in terms of tax (R&D expenditure credit used)" value={fmt(p.rdecUsedAgainstCT)} bold />
          </div>
        )}

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

      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-6 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{firmName}</h1>
            <p className="text-slate-400 text-sm mt-0.5 print:text-slate-500">Practice Management</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400 print:text-slate-500">Corporation Tax</p>
            <p className="font-bold text-lg">Period Ended {fmtDate(comp.period_end)}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        <div className="flex justify-end mb-4 print:hidden">
          <PrintButton />
        </div>

        {isApproved && (
          <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-4 text-center print:hidden">
            <p className="text-green-700 font-bold text-lg">✓ Computation Approved</p>
            <p className="text-green-600 text-sm mt-1">Thank you! We'll proceed to file your return.</p>
          </div>
        )}

        {isQueried && (
          <div className="mb-6 rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-center print:hidden">
            <p className="text-yellow-700 font-bold text-lg">Query Raised</p>
            <p className="text-yellow-600 text-sm mt-1">Thanks for letting us know. We'll be in touch to go through it with you.</p>
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-6 mb-6 print:border-0 print:shadow-none">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Prepared for</p>
          <p className="mt-1 font-bold text-slate-900 text-lg">{client?.client_name || "Client"}</p>
          <p className="text-sm text-slate-500 mt-1">
            Accounting period: {fmtDate(comp.period_start)} to {fmtDate(comp.period_end)}
            {isSplit && " · split into two Corporation Tax returns as this period exceeds 12 months"}
          </p>

          {isApproved && comp.approved_at && (
            <p className="text-sm font-semibold text-green-700 mt-3 pt-3 border-t border-slate-100">
              ✓ Approved{comp.client_email ? ` by ${comp.client_email}` : ""} on {fmtDateTime(comp.approved_at)}
            </p>
          )}
          {isQueried && comp.queried_at && (
            <p className="text-sm font-semibold text-yellow-700 mt-3 pt-3 border-t border-slate-100">
              Query raised{comp.client_email ? ` by ${comp.client_email}` : ""} on {fmtDateTime(comp.queried_at)}
            </p>
          )}
        </div>

        {periods.map((p: any, i: number) => renderPeriodCT600(p, i, periods.length))}

        {isSplit && (
          <div className="rounded-2xl bg-purple-50 border border-purple-200 p-4 mb-6">
            <div className="flex justify-between font-bold text-purple-900">
              <span>Total Corporation Tax due (both returns)</span>
              <span className="font-mono">£{fmt(totalCorporationTax)}</span>
            </div>
          </div>
        )}

        {dlaResults.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none mb-6">
            <div className="bg-amber-50 border-b border-amber-100 px-6 py-2">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Supplementary Page CT600A — Loans to Participators</p>
            </div>
            <div className="p-6 space-y-6">
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
          <p className="text-xs text-slate-400 mt-2">Due nine months and one day after the end of the accounting period.</p>
        </div>

        {/* Declaration — read only for the client; the signing director is set by us internally */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none mt-6">
          <div className="bg-slate-50 border-b border-slate-100 px-6 py-2">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Declaration</p>
          </div>
          <div className="p-6 text-sm text-slate-700 space-y-4">
            <p>
              I declare that the information given on this Company Tax Return and any supplementary pages is correct and complete to the best of my knowledge and belief.
              I understand that giving false information in the return, or concealing any part of the company&apos;s profits or tax payable, can lead to both the company and me being prosecuted.
            </p>
            <div className="grid grid-cols-3 gap-6 pt-2">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Box 975 — Name</p>
                <p className="text-sm font-medium text-slate-900 border-b border-slate-300 h-8 pb-1">{declarationName || " "}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Box 980 — Date</p>
                {isApproved && comp.approved_at ? (
                  <p className="text-sm font-medium text-slate-900 border-b border-slate-300 h-8 pb-1">
                    {new Date(comp.approved_at).toLocaleDateString("en-GB")}
                  </p>
                ) : (
                  <div className="border-b border-slate-300 h-8"></div>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Box 985 — Status</p>
                <p className="text-sm font-medium text-slate-900 border-b border-slate-300 h-8 pb-1 capitalize">{declarationStatus || " "}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Approve / Query */}
        {!isResponded && (
          <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100 print:hidden">
            <h2 className="text-lg font-bold text-slate-900 text-center">Do these figures look correct?</h2>
            <p className="text-sm text-slate-500 text-center mt-1">Please approve below, or raise a query if anything needs checking.</p>
            <div className="mt-6 flex gap-4 justify-center">
              <form action={approveWithToken}>
                <button type="submit" className="rounded-xl bg-green-600 px-8 py-3 text-sm font-bold text-white hover:bg-green-700 transition-colors">
                  ✓ Approve
                </button>
              </form>
              <form action={queryWithToken}>
                <button type="submit" className="rounded-xl bg-white border border-slate-200 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                  I Have a Question
                </button>
              </form>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          This computation was prepared by {firmName} · Period ended {fmtDate(comp.period_end)} · This is provided for approval purposes ahead of filing.
        </p>

      </div>
    </div>
  );
}