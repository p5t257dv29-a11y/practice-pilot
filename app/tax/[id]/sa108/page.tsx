import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { calculateCapitalGain, getCgtRates, ukTaxYearOf } from "../../../capital-gains/page";
import PrintButton from "../../../print-button";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function SA108SummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: comp, error } = await supabase
    .from("tax_computations")
    .select("*, clients(client_name, hmrc_utr)")
    .eq("id", id)
    .single();

  if (error || !comp) notFound();

  const client = comp.clients as any;

  // --- Pull linked CGT disposals and run the same per-tax-year AEA / rate-band
  // / loss-netting logic as the rest of the CGT module, so this always
  // agrees with the Capital Gains pages and the client-facing summary. ---
  const { data: linkedGains } = await supabase
    .from("capital_gains_computations")
    .select("*")
    .eq("linked_tax_computation_id", comp.id)
    .neq("entity_type", "Company");

  const cgtRates = await getCgtRates("2026/27");

  const taxableIncomeForGains = Math.max(0,
    Number(comp.employment_income) + Number(comp.self_employment_income) +
    Number(comp.rental_income) + Number(comp.pension_income) - 12570
  );

  const sortedGains = (linkedGains || [])
    .filter((g) => ukTaxYearOf(g.disposal_date) === comp.tax_year)
    .sort((a, b) => {
      const diff = new Date(a.disposal_date).getTime() - new Date(b.disposal_date).getTime();
      if (diff !== 0) return diff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const rawGainOf = (g: any) =>
    Number(g.disposal_proceeds) - Number(g.acquisition_cost) - Number(g.incidental_costs) - Number(g.improvement_costs);

  let currentYearLossesAvailable = sortedGains
    .filter((g) => rawGainOf(g) < 0)
    .reduce((sum, g) => sum + Math.abs(rawGainOf(g)), 0);

  let aeaUsedSoFar = 0;
  let gainsStackedSoFar = 0;
  const rows = sortedGains.map((g) => {
    const result = calculateCapitalGain({
      entityType: g.entity_type,
      disposalProceeds: Number(g.disposal_proceeds),
      acquisitionCost: Number(g.acquisition_cost),
      incidentalCosts: Number(g.incidental_costs),
      improvementCosts: Number(g.improvement_costs),
      lossesBroughtForward: Number(g.losses_brought_forward),
      badrEligible: g.badr_eligible,
      taxableIncomeForBandStacking: taxableIncomeForGains,
      aeaAlreadyUsedThisYear: aeaUsedSoFar,
      gainsStackedAheadThisYear: gainsStackedSoFar,
      currentYearLossesAvailable,
      rolloverReliefClaimed: g.rollover_relief_claimed,
      amountReinvested: Number(g.amount_reinvested),
      replacementAssetCost: Number(g.replacement_asset_cost),
      acquisitionDate: g.acquisition_date,
      disposalDate: g.disposal_date,
      prrClaimed: g.main_residence_relief_claimed,
      mainResidenceFrom: g.main_residence_from,
      mainResidenceTo: g.main_residence_to,
    }, cgtRates);

    currentYearLossesAvailable -= result.currentYearLossOffset;
    aeaUsedSoFar += result.aeaApplied;
    gainsStackedSoFar += result.taxableGain;

    return { comp: g, result, isProperty: g.asset_category === "Residential Property" };
  });

  const propertyRows = rows.filter((r) => r.isProperty);
  const otherRows = rows.filter((r) => !r.isProperty);

  const sumField = (list: typeof rows, field: (r: (typeof rows)[number]) => number) =>
    list.reduce((s, r) => s + field(r), 0);

  const totalProceeds = sumField(rows, (r) => Number(r.comp.disposal_proceeds));
  const totalCosts = sumField(rows, (r) => Number(r.comp.acquisition_cost) + Number(r.comp.incidental_costs) + Number(r.comp.improvement_costs));
  const totalGainsBeforeReliefs = sumField(rows.filter((r) => !r.result.isLoss), (r) => r.result.grossGain);
  const totalLossesThisYear = sumField(rows.filter((r) => r.result.isLoss), (r) => r.result.lossAmount);
  const totalPRRClaimed = sumField(rows, (r) => r.result.prrAmount || 0);
  const totalBADRGains = sumField(rows.filter((r) => r.comp.badr_eligible && !r.result.isLoss), (r) => r.result.taxableGain);
  const totalAEAUsed = sumField(rows, (r) => r.result.aeaApplied || 0);
  const totalLossesBroughtForwardUsed = sumField(rows, (r) => r.result.lossesUsed || 0);
  const totalTaxableGains = sumField(rows, (r) => r.result.taxableGain);
  const totalGainAtBasicRate = sumField(rows, (r) => r.result.gainAtBasicRate || 0);
  const totalGainAtHigherRate = sumField(rows, (r) => r.result.gainAtHigherRate || 0);
  const totalCgtDue = sumField(rows, (r) => r.result.cgtDue);
  const totalLossesCarriedForward = rows.length > 0 ? rows[rows.length - 1].result.lossesCarriedForward : 0;

  const propertyCgtDue = sumField(propertyRows, (r) => r.result.cgtDue);
  const nonPropertyCgtDue = sumField(otherRows, (r) => r.result.cgtDue);

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

  const AssetSection = ({ title, list }: { title: string; list: typeof rows }) => (
    <div className="p-6 border-b border-slate-100">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</p>
      <Box number="—" label="Number of disposals" value={String(list.length)} />
      <Box number="—" label="Disposal proceeds" value={`£${fmt(sumField(list, (r) => Number(r.comp.disposal_proceeds)))}`} />
      <Box number="—" label="Allowable costs" value={`£${fmt(sumField(list, (r) => Number(r.comp.acquisition_cost) + Number(r.comp.incidental_costs) + Number(r.comp.improvement_costs)))}`} />
      <Box number="—" label="Gains in the year, before losses" value={`£${fmt(sumField(list.filter((r) => !r.result.isLoss), (r) => r.result.grossGain))}`} />
      <Box number="—" label="Losses in the year" value={`£${fmt(sumField(list.filter((r) => r.result.isLoss), (r) => r.result.lossAmount))}`} />
      {sumField(list, (r) => r.result.prrAmount || 0) > 0 && (
        <Box number="—" label="Private Residence Relief claimed" value={`£${fmt(sumField(list, (r) => r.result.prrAmount || 0))}`} />
      )}
      <div className="mt-3 space-y-1">
        {list.map((r) => (
          <div key={r.comp.id} className="flex justify-between text-xs text-slate-400">
            <span>{r.comp.asset_description} · {new Date(r.comp.disposal_date).toLocaleDateString("en-GB")}</span>
            <span>{r.result.isLoss ? `(£${fmt(r.result.lossAmount)})` : `£${fmt(r.result.grossGain)}`}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <div className="bg-white border-b border-slate-200 px-8 py-6 print:hidden">
        <div className="flex items-center justify-between">
          <a href={`/tax/${id}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to Computation
          </a>
          <PrintButton />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">SA108 Summary</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Mirrors the HMRC Capital Gains supplementary page's box structure. For working papers and review — use your browser's print function (⌘P) to save as PDF.
        </p>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden print:border-0 print:shadow-none">

          {/* Header */}
          <div className="bg-slate-900 text-white px-6 py-5 print:bg-white print:text-slate-900 print:border-b print:border-slate-300">
            <p className="text-xs text-slate-400 uppercase tracking-wide print:text-slate-500">Capital Gains Summary</p>
            <h2 className="text-lg font-bold mt-1">SA108 Summary</h2>
          </div>

          {/* Taxpayer details */}
          <div className="p-6 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Taxpayer Details</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400 text-xs">Name</p>
                <p className="font-medium text-slate-900">{client?.client_name || "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Unique Taxpayer Reference (UTR)</p>
                <p className="font-medium text-slate-900">{client?.hmrc_utr || "Not on file"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Tax Year</p>
                <p className="font-medium text-slate-900">{comp.tax_year}</p>
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="p-6">
              <p className="text-sm text-slate-500 text-center py-8">
                No Capital Gains computations are linked to this Personal Tax computation for {comp.tax_year}. Link a disposal to this client's tax year in the Capital Gains module to populate this summary.
              </p>
            </div>
          ) : (
            <>
              {propertyRows.length > 0 && (
                <AssetSection title="UK Residential Property" list={propertyRows} />
              )}
              {otherRows.length > 0 && (
                <AssetSection title="Other Assets (shares, other property etc.)" list={otherRows} />
              )}

              {/* Summary */}
              <div className="p-6 border-b border-slate-100 bg-slate-50 print:bg-white">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Summary</p>
                <Box number="—" label="Total disposal proceeds" value={`£${fmt(totalProceeds)}`} />
                <Box number="—" label="Total allowable costs" value={`£${fmt(totalCosts)}`} />
                <Box number="—" label="Total gains in the year, before losses" value={`£${fmt(totalGainsBeforeReliefs)}`} />
                <Box number="—" label="Total losses in the year" value={`£${fmt(totalLossesThisYear)}`}
                  note="Offset against this year's gains automatically before the Annual Exempt Amount is applied — mandatory under HMRC rules" />
                {totalPRRClaimed > 0 && (
                  <Box number="—" label="Private Residence Relief claimed" value={`£${fmt(totalPRRClaimed)}`} />
                )}
                {totalBADRGains > 0 && (
                  <Box number="—" label="Gains qualifying for Business Asset Disposal Relief" value={`£${fmt(totalBADRGains)}`}
                    note="Taxed at a flat 18% — lifetime £1m limit not tracked cumulatively by this system" />
                )}
                <Box number="—" label="Losses brought forward from earlier years, used this year" value={`£${fmt(totalLossesBroughtForwardUsed)}`} />
                <Box number="—" label="Annual Exempt Amount used" value={`£${fmt(totalAEAUsed)}`} note="£3,000 for 2026/27, shared across all disposals in the tax year" />
                <Box number="—" label="Total taxable gains" value={`£${fmt(totalTaxableGains)}`} />
                <Box number="—" label="Losses carried forward to future years" value={`£${fmt(totalLossesCarriedForward)}`} />
              </div>

              {/* Tax calculation */}
              <div className="p-6 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tax Calculation</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Gain at basic rate (18%)</span><span className="font-medium">£{fmt(totalGainAtBasicRate)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Gain at higher rate (24%)</span><span className="font-medium">£{fmt(totalGainAtHigherRate)}</span></div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base">
                    <span>Capital Gains Tax Due</span>
                    <span>£{fmt(totalCgtDue)}</span>
                  </div>
                </div>
              </div>

              {/* Payment routing */}
              <div className="p-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">How This Is Paid</p>
                {nonPropertyCgtDue > 0 && (
                  <Box number="—" label="Payable with the 31 January Self Assessment balancing payment" value={`£${fmt(nonPropertyCgtDue)}`} />
                )}
                {propertyCgtDue > 0 && (
                  <Box number="—" label="Payable separately via HMRC's 60-day UK property service" value={`£${fmt(propertyCgtDue)}`}
                    note="Not included in the 31 January balancing payment — reported and paid within 60 days of each residential property completion" />
                )}
              </div>
            </>
          )}
        </div>

        <div className="mt-6 rounded-2xl bg-yellow-50 border border-yellow-100 p-4 print:hidden">
          <p className="text-xs text-yellow-800">
            <strong>This is a working-paper summary, not a filable return.</strong> Box labels describe the SA108 fields this system tracks — exact official box numbers aren't reproduced here since they can shift between tax years, so cross-check against the current SA108 form before filing. This system doesn't distinguish listed shares, unlisted shares, and other non-property assets into separate SA108 sections — all non-property disposals are grouped together. It does not support electronic submission to HMRC, doesn't track cumulative BADR/Investors' Relief lifetime limits, deemed periods of absence for Private Residence Relief, Letting Relief, or indexation allowance. Always verify all figures before filing, and use recognised commercial software or HMRC's own online service to submit.
          </p>
        </div>
      </div>
    </div>
  );
}
