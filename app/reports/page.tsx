import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function ReportsPage() {
  const [
    { data: jobs },
    { data: entries },
    { data: invoices },
    { data: writeoffs },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("time_entries")
      .select("*"),
    supabase
      .from("invoices")
      .select("*"),
    supabase
      .from("wip_writeoffs")
      .select("*"),
  ]);

  // Build WIP data per job
  const wipData = (jobs || []).map((job) => {
    const jobEntries = (entries || []).filter(e => e.job_id === job.id);
    const totalHours = jobEntries.reduce((sum, e) => sum + Number(e.hours), 0);
    const billableHours = jobEntries.filter(e => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
    const chargeOutValue = jobEntries.filter(e => e.billable).reduce((sum, e) => sum + (Number(e.hours) * Number(e.hourly_rate)), 0);

    // Find invoices linked to this job
    const jobInvoices = (invoices || []).filter(i => i.job_id === job.id);
    const invoicedAmount = jobInvoices.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
    const paidAmount = jobInvoices.filter(i => i.status === "Paid").reduce((sum, i) => sum + Number(i.subtotal || 0), 0);

    const jobWriteoffs = (writeoffs || []).filter(w => w.job_id === job.id);
    const writtenOffAmount = jobWriteoffs.reduce((sum, w) => sum + Number(w.amount), 0);

    const wip = chargeOutValue - invoicedAmount - writtenOffAmount;
    const overBudget = invoicedAmount > 0 && chargeOutValue > invoicedAmount;

    return {
      job,
      totalHours,
      billableHours,
      chargeOutValue,
      invoicedAmount,
      paidAmount,
      writtenOffAmount,
      wip: Math.max(wip, 0),
      overBudget,
    };
  }).filter(d => d.totalHours > 0 || d.invoicedAmount > 0 || d.writtenOffAmount > 0);

  // Practice-wide stats
  const totalWIP = wipData.reduce((sum, d) => sum + d.wip, 0);
  const totalInvoiced = wipData.reduce((sum, d) => sum + d.invoicedAmount, 0);
  const totalPaid = wipData.reduce((sum, d) => sum + d.paidAmount, 0);
  const totalWrittenOff = wipData.reduce((sum, d) => sum + d.writtenOffAmount, 0);
  const totalBillableHours = (entries || []).filter(e => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
  const totalNonBillableHours = (entries || []).filter(e => !e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
  const totalHoursAll = totalBillableHours + totalNonBillableHours;
  const utilisationRate = totalHoursAll > 0 ? (totalBillableHours / totalHoursAll * 100).toFixed(1) : "0";
  const overBudgetJobs = wipData.filter(d => d.overBudget).length;

  // Top clients by WIP
  const clientWIP: Record<string, { name: string; wip: number; invoiced: number; paid: number; hours: number; writtenOff: number }> = {};
  wipData.forEach(d => {
    const clientId = d.job.client_id;
    const clientName = d.job.clients?.client_name || "Unknown";
    if (!clientWIP[clientId]) {
      clientWIP[clientId] = { name: clientName, wip: 0, invoiced: 0, paid: 0, hours: 0, writtenOff: 0 };
    }
    clientWIP[clientId]!.wip += d.wip;
    clientWIP[clientId]!.invoiced += d.invoicedAmount;
    clientWIP[clientId]!.paid += d.paidAmount;
    clientWIP[clientId]!.hours += d.totalHours;
    clientWIP[clientId]!.writtenOff += d.writtenOffAmount;
  });

  const topClients = Object.values(clientWIP)
    .sort((a, b) => (b.wip + b.invoiced) - (a.wip + a.invoiced))
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports & WIP</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Work in progress, time analysis and billing overview.
          </p>
        </div>
      </div>

      <div className="p-8 space-y-8">

        {/* Practice Overview */}
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-5">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <p className="text-sm font-medium text-slate-500">Total WIP</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">£{totalWIP.toFixed(2)}</p>
            <p className="mt-1 text-xs text-slate-400">Unbilled work value</p>
          </div>

          <div className="rounded-2xl bg-blue-600 p-6 shadow-sm">
            <p className="text-sm font-medium text-blue-100">Total Invoiced</p>
            <p className="mt-2 text-3xl font-bold text-white">£{totalInvoiced.toFixed(2)}</p>
            <p className="mt-1 text-xs text-blue-200">All invoices raised</p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <p className="text-sm font-medium text-slate-500">Total Paid</p>
            <p className="mt-2 text-3xl font-bold text-green-600">£{totalPaid.toFixed(2)}</p>
            <p className="mt-1 text-xs text-slate-400">Cash received</p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <p className="text-sm font-medium text-slate-500">Written Off</p>
            <p className="mt-2 text-3xl font-bold text-slate-500">£{totalWrittenOff.toFixed(2)}</p>
            <p className="mt-1 text-xs text-slate-400">WIP not being billed</p>
          </div>

          <div className={`rounded-2xl p-6 shadow-sm ${overBudgetJobs > 0 ? "bg-red-50 border border-red-100" : "bg-white border border-slate-100"}`}>
            <p className={`text-sm font-medium ${overBudgetJobs > 0 ? "text-red-500" : "text-slate-500"}`}>Over Budget</p>
            <p className={`mt-2 text-3xl font-bold ${overBudgetJobs > 0 ? "text-red-600" : "text-slate-900"}`}>{overBudgetJobs}</p>
            <p className={`mt-1 text-xs ${overBudgetJobs > 0 ? "text-red-400" : "text-slate-400"}`}>Jobs over invoiced</p>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">

          {/* WIP by Job */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Job Summary</h2>

              {wipData.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 text-sm">No data yet.</p>
                  <p className="text-slate-400 text-xs mt-1">Log time against jobs to see WIP data.</p>
                  <Link href="/timesheets" className="text-blue-600 text-sm hover:underline mt-1 block">
                    Log time →
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Table header */}
                  <div className="grid grid-cols-6 gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider px-4">
                    <div className="col-span-2">Job / Client</div>
                    <div className="text-right">Time Value</div>
                    <div className="text-right">Invoiced</div>
                    <div className="text-right">Written Off</div>
                    <div className="text-right">WIP</div>
                  </div>

                  {wipData.map((d) => (
                    <div key={d.job.id}
                      className={`rounded-xl border p-4 ${d.overBudget ? "border-red-200 bg-red-50" : "border-slate-100"}`}>
                      <div className="grid grid-cols-6 gap-2 items-center">
                        <div className="col-span-2">
                          <div className="flex items-center gap-2">
                            <Link href={`/jobs/${d.job.id}`}
                              className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-sm">
                              {d.job.job_name}
                            </Link>
                            {d.overBudget && (
                              <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold">!</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {d.job.clients?.client_name} · {d.totalHours.toFixed(1)}h
                          </p>
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                            d.job.status === "Active" ? "bg-green-100 text-green-700"
                            : d.job.status === "Completed" ? "bg-blue-100 text-blue-700"
                            : "bg-slate-100 text-slate-600"
                          }`}>
                            {d.job.status}
                          </span>
                        </div>

                        <div className="text-right">
                          <p className="font-semibold text-slate-900 text-sm">£{d.chargeOutValue.toFixed(2)}</p>
                          <p className="text-xs text-slate-400">{d.billableHours.toFixed(1)}h billable</p>
                        </div>

                        <div className="text-right">
                          <p className="font-semibold text-slate-900 text-sm">£{d.invoicedAmount.toFixed(2)}</p>
                          {d.paidAmount > 0 && (
                            <p className="text-xs text-green-600">£{d.paidAmount.toFixed(2)} paid</p>
                          )}
                        </div>

                        <div className="text-right">
                          <p className="text-sm text-slate-500">
                            {d.writtenOffAmount > 0 ? `£${d.writtenOffAmount.toFixed(2)}` : "—"}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className={`font-bold text-sm ${d.wip > 0 ? "text-orange-600" : "text-green-600"}`}>
                            £{d.wip.toFixed(2)}
                          </p>
                          <p className="text-xs text-slate-400">unbilled</p>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Totals row */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                    <div className="grid grid-cols-6 gap-2 items-center">
                      <div className="col-span-2">
                        <p className="font-bold text-slate-900 text-sm">Totals</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm">
                          £{wipData.reduce((sum, d) => sum + d.chargeOutValue, 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm">£{totalInvoiced.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-500 text-sm">£{totalWrittenOff.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-orange-600 text-sm">£{totalWIP.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">

            {/* Top Clients */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-base font-bold text-slate-900 mb-4">Top Clients</h2>

              {topClients.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No data yet</p>
              ) : (
                <div className="space-y-4">
                  {topClients.map((client, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-slate-900">{client.name}</p>
                        <p className="text-xs text-slate-500">{client.hours.toFixed(1)}h</p>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>WIP: £{client.wip.toFixed(2)}</span>
                        <span>Invoiced: £{client.invoiced.toFixed(2)}</span>
                      </div>
                      {client.paid > 0 && (
                        <p className="text-xs text-green-600">Paid: £{client.paid.toFixed(2)}</p>
                      )}
                      {client.writtenOff > 0 && (
                        <p className="text-xs text-slate-400">Written off: £{client.writtenOff.toFixed(2)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Time Analysis */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-base font-bold text-slate-900 mb-4">Time Analysis</h2>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Billable</span>
                    <span className="font-semibold text-slate-900">{totalBillableHours.toFixed(1)}h</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full"
                      style={{ width: totalHoursAll > 0 ? `${(totalBillableHours / totalHoursAll * 100)}%` : "0%" }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Non-billable</span>
                    <span className="font-semibold text-slate-900">{totalNonBillableHours.toFixed(1)}h</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className="bg-slate-400 h-2 rounded-full"
                      style={{ width: totalHoursAll > 0 ? `${(totalNonBillableHours / totalHoursAll * 100)}%` : "0%" }} />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold text-slate-900">Utilisation Rate</span>
                    <span className={`font-bold ${Number(utilisationRate) >= 70 ? "text-green-600" : Number(utilisationRate) >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                      {utilisationRate}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
