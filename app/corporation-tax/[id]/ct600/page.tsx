import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateCorporationTax, applyLossRelief } from "../../page";
import { calculateCapitalAllowances } from "../../../fixed-assets/capital-allowances/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function CT600SummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("corporation_tax_computations")
    .select("*, clients(client_name, company_number, corporation_tax_reference)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const { data: assets } = await supabase
    .from("fixed_assets")
    .select("*")
    .eq("client_id", comp.client_id);

  const ca = calculateCapitalAllowances({
    assets: assets || [],
    periodStart: comp.period_start,
    periodEnd: comp.period_end,
    mainPoolBfwd: Number(comp.main_pool_bfwd),
    specialRatePoolBfwd: Number(comp.special_rate_pool_bfwd),
    jobId: comp.job_id,
  });

  const taxableProfitBeforeLosses =
    Number(comp.accounting_profit) +
    Number(comp.depreciation_addback) +
    Number(comp.disallowable_expenses) -
    ca.totalCapitalAllowances -
    Number(comp.other_allowable_deductions);

  const loss = applyLossRelief(taxableProfitBeforeLosses, Number(comp.brought_forward_losses));

  const ct = calculateCorporationTax({
    taxableProfit: loss.taxableProfitAfterLosses,
    periodStart: comp.period_start,
    periodEnd: comp.period_end,
    associatedCompanies: comp.associated_companies,
  });

  const client = comp.clients as any;
  const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const Box = ({ number, label, value, note }: { number: string; label: string; value: string; note?: string }) => (
    <div className="flex items-start justify-between border-b border-slate-100 py-2.5 gap-4">
      <div className="flex items-start gap-3 flex-1">
        <span className="text-xs font-mono font-bold text-slate-400 mt-0.5 w-12 flex-shrink-0">{number}</span>
        <div>
          <p className="text-sm text-slate-700">{label}</p>
          {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
        </div>
      </div>
      <span className="text-sm font-mono font-semibold text-slate-900 flex-shrink-0">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <a href={`/corporation-tax/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Computation
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">CT600 Summary</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Mirrors the HMRC Company Tax Return form's box structure. For working papers and review — use your browser's print function (⌘P) to save as PDF.
        </p>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">

          {/* Header */}
          <div className="bg-slate-900 text-white px-6 py-5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Company Tax Return</p>
            <h2 className="text-lg font-bold mt-1">CT600 Summary</h2>
          </div>

          {/* Company details */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Company Details</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs">Company Name</p>
                <p className="font-medium text-slate-900">{client?.client_name || "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Company Registration Number</p>
                <p className="font-medium text-slate-900">{client?.company_number || "Not on file"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Unique Taxpayer Reference (UTR)</p>
                <p className="font-medium text-slate-900">{client?.corporation_tax_reference || "Not on file"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Accounting Period</p>
                <p className="font-medium text-slate-900">
                  {new Date(comp.period_start).toLocaleDateString("en-GB")} to {new Date(comp.period_end).toLocaleDateString("en-GB")}
                </p>
              </div>
            </div>
          </div>

          {/* About this return */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">About This Return</p>
            <Box number="4" label="Company type" value="0 (normal company)" note="Assumed standard UK limited company — verify if different" />
            <Box number="80" label="Accounts and computations attached" value="X" note="Assumed yes — attach your statutory accounts and this computation" />
            <Box number="326" label="Number of associated companies" value={String(comp.associated_companies)} />
          </div>

          {/* Income - Turnover */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Turnover</p>
            <Box number="145" label="Total turnover from trade" value={`£${fmt(Number(comp.turnover))}`} />
          </div>

          {/* Trading profits */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Trading Profits</p>
            <Box number="155" label="Trading profits" value={`£${fmt(taxableProfitBeforeLosses)}`}
              note="Accounting profit, adjusted for disallowable expenses and capital allowances" />
            <Box number="160" label="Trading losses brought forward set against trading profits" value={`£${fmt(loss.lossesUsed)}`} />
            <Box number="165" label="Net trading profits" value={`£${fmt(loss.taxableProfitAfterLosses)}`}
              note="Box 155 minus Box 160" />
          </div>

          {/* Capital allowances reference */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Capital Allowances (included within Box 155)</p>
            <Box number="690" label="Annual Investment Allowance claimed" value={`£${fmt(ca.totalAIAClaimed)}`} />
            <Box number="—" label="First Year Allowance (zero-emission cars)" value={`£${fmt(ca.totalFYA)}`} />
            <Box number="—" label="Writing Down Allowances (main + special rate pools)" value={`£${fmt(ca.mainPoolWDA + ca.specialRateWDA)}`} />
            {comp.job_id && (
              <p className="text-xs text-slate-400 mt-2">
                Calculated from assets linked to this job in the Fixed Asset Register.
              </p>
            )}
          </div>

          {/* Non-trading income */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Non-Trading Income</p>
            <Box number="170" label="Interest and other non-trading loan relationship profits" value="£0.00"
              note="Not tracked separately by this system — include manually if applicable" />
            <Box number="190" label="Income from UK land and buildings" value="£0.00"
              note="Not tracked separately by this system — include manually if applicable" />
            <Box number="220" label="Annual profits and gains not falling under any other heading" value="£0.00" />
          </div>

          {/* Chargeable gains */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Chargeable Gains</p>
            <Box number="225" label="Gross chargeable gains" value="£0.00"
              note="Not calculated by this system — use a separate CGT computation if the company has disposed of chargeable assets" />
            <Box number="235" label="Net chargeable gains" value="£0.00" />
          </div>

          {/* Group relief */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Group Relief</p>
            <Box number="275" label="Group relief" value="£0.00" note="Not applicable — assumed standalone company" />
          </div>

          {/* Total profits */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Profits Chargeable to Corporation Tax</p>
            <Box number="235" label="Profits before deductions and reliefs" value={`£${fmt(loss.taxableProfitAfterLosses)}`}
              note="This tool does not separately track non-trading income (interest, property, gains) — verify against your accounts if applicable" />
            <Box number="300" label="Profits chargeable to Corporation Tax" value={`£${fmt(ct.profit)}`} />
          </div>

          {/* Tax calculation */}
          <div className="p-6 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tax Calculation (not official HMRC box numbers — see workings)</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Band</span><span className="font-medium">{ct.band}</span></div>
              {ct.band === "Marginal Relief" && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Tax at Main Rate (25%)</span><span className="font-medium">£{fmt(ct.profit * 0.25)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Less: Marginal Relief</span><span className="font-medium text-red-600">(£{fmt(ct.marginalRelief)})</span></div>
                </>
              )}
              <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base">
                <span>Corporation Tax Chargeable</span>
                <span>£{fmt(ct.corporationTax)}</span>
              </div>
            </div>
          </div>

          {/* Reliefs and deductions */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Reliefs and Deductions in Terms of Tax</p>
            <Box number="440" label="Community Investment Tax Relief" value="£0.00" />
            <Box number="465" label="Double taxation relief" value="£0.00" />
            <Box number="480" label="Total reliefs and deductions in terms of tax" value="£0.00" />
          </div>

          {/* Tax reconciliation */}
          <div className="p-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Tax Payable and Reconciliation</p>
            <Box number="515" label="Tax chargeable" value={`£${fmt(ct.corporationTax)}`} />
            <Box number="—" label="Payments already made on account" value={`£${fmt(Number(comp.tax_paid_on_account || 0))}`}
              note="Enter any instalment payments already made, if applicable" />
            <div className="flex justify-between border-t border-slate-200 pt-3 mt-2 font-bold text-base">
              <span>{ct.corporationTax - Number(comp.tax_paid_on_account || 0) >= 0 ? "Balance Due" : "Overpaid"}</span>
              <span>£{fmt(Math.abs(ct.corporationTax - Number(comp.tax_paid_on_account || 0)))}</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Due nine months and one day after the end of the accounting period (or by instalments for large companies).
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>This is a working-paper summary, not a filable return.</strong> It mirrors the official CT600 form's box numbers for the fields this system tracks, using verified 2026 HMRC guidance. It does not support electronic submission to HMRC — actual filing requires HMRC-recognised software with iXBRL-tagged accounts. Boxes for non-trading income (interest, property, chargeable gains), group relief, R&D reliefs, and supplementary pages are not covered. Always verify all figures against your full accounts and computations before filing, and use recognised commercial software or HMRC's own online service to submit.
          </p>
        </div>
      </div>
    </div>
  );
}
