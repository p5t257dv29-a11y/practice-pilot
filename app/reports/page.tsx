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
    { data: quotes },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("time_entries")
      .select("*"),
    supabase
      .from("quotes")
      .select("*")
      .eq("status", "Accepted"),
  ]);

  // Build WIP data per job
  const wipData = (jobs || []).map((job) => {
    const jobEntries = (entries || []).filter(e => e.job_id === job.id);
    const totalHours = jobEntries.reduce((sum, e) => sum + Number(e.hours), 0);
    const billableHours = jobEntries.filter(e => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
    const chargeOutValue = jobEntries.filter(e => e.billable).reduce((sum, e) => sum + (Number(e.hours) * Number(e.hourly_rate)), 0);
    const acceptedQuote = (quotes || []).find(q => q.client_id === job.client_id);
    const quotedAmount = acceptedQuote ? Number(acceptedQuote.subtotal) : 0;
    const wip = chargeOutValue; // WIP = value of work done not yet billed

    return {
      job,
      totalHours,
      billableHours,
      chargeOutValue,
      quotedAmount,
      wip,
      overBudget: quotedAmount > 0 && chargeOutValue > quotedAmount,
    };
  }).filter(d => d.totalHours > 0); // Only show jobs with time logged

  // Practice-wide stats
  const totalWIP = wipData.reduce((sum, d) => sum + d.wip, 0);
  const totalBillableHours = (entries || []).filter(e => e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
  const totalNonBillableHours = (entries || []).filter(e => !e.billable).reduce((sum, e) => sum + Number(e.hours), 0);
  const totalHours = totalBillableHours + totalNonBillableHours;
  const utilisationRate = totalHours > 0 ? (totalBillableHours / totalHours * 100).toFixed(1) : "0";
  const overBudgetJobs = wipData.filter(d => d.overBudget).length;

  // Top clients by WIP
  const clientWIP: Record<string, { name: string; wip: number; hours: number }> = {};
  wipData.forEach(d => {
    const clientId = d.job.client_id;
    const clientName = d.job.clients?.client_name || "Unknown";
    if (!clientWIP[clientId]) {
      clientWIP[clientId] = { name: clientName, wip: 0, hours: 0 };
    }
    clientWIP[clientId]!.wip += d.wip;
    clientWIP[clientId]!.hours += d.totalHours;
  });

  const topClients = Object.values(clientWIP)
    .sort((a, b) => b.wip - a.wip)
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports & WIP</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Work in progress, time analysis and profitability.
          </p>
        </div>
      </div>

      <div className="p-8 space-y-8">

        {/* Practice Overview */}
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <p className="text-sm font-medium text-slate-500">Total WIP</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">£{totalWIP.toFixed(2)}</p>
            <p className="mt-1 text-xs text-slate-400">Unbilled work value</p>
          </div>

          <div className="rounded-2xl bg-blue-600 p-6 shadow-sm">
            <p className="text-sm font-medium text-blue-100">Billable Hours</p>
            <p className="mt-2 text-3xl font-bold text-white">{totalBillableHours.toFixed(1)}</p>
            <p className="mt-1 text-xs text-blue-200">{utilisationRate}% utilisation</p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <p className="text-sm font-medium text-slate-500">Non-billable Hours</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{totalNonBillableHours.toFixed(1)}</p>
            <p className="mt-1 text-xs text-slate-400">Admin, training etc.</p>
          </div>

          <div className={`rounded-2xl p-6 shadow-sm ${overBudgetJobs > 0 ? "bg-red-50 border border-red-100" : "bg-white border border-slate-100"}`}>
            <p className={`text-sm font-medium ${overBudgetJobs > 0 ? "text-red-500" : "text-slate-500"}`}>Over Budget</p>
            <p className={`mt-2 text-3xl font-bold ${overBudgetJobs > 0 ? "text-red-600" : "text-slate-900"}`}>{overBudgetJobs}</p>
            <p className={`mt-1 text-xs ${overBudgetJobs > 0 ? "text-red-400" : "text-slate-400"}`}>Jobs over quoted amount</p>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">

          {/* WIP by Job */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Work in Progress by Job</h2>

              {wipData.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 text-sm">No time logged against jobs yet.</p>
                  <Link href="/timesheets" className="text-blue-600 text-sm hover:underline mt-1 block">
                    Log time →
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {wipData.map((d) => (
                    <div key={d.job.id}
                      className={`rounded-xl border p-4 ${d.overBudget ? "border-red-200 bg-red-50" : "border-slate-100"}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Link href={`/jobs/${d.job.id}`}
                              className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-sm">
                              {d.job.job_name}
                            </Link>
                            {d.overBudget && (
                              <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold">
                                Over budget
                              </span>
                            )}
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              d.job.status === "Active" ? "bg-green-100 text-green-700"
                              : d.job.status === "Completed" ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                            }`}>
                              {d.job.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {d.job.clients?.client_name} · {d.totalHours.toFixed(1)} hrs logged
                          </p>

                          {/* Progress bar */}
                          {d.quotedAmount > 0 && (
                            <div className="mt-2">
                              <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>£{d.chargeOutValue.toFixed(2)} of £{d.quotedAmount.toFixed(2)} quoted</span>
                                <span>{Math.min((d.chargeOutValue / d.quotedAmount * 100), 100).toFixed(0)}%</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full transition-all ${d.overBudget ? "bg-red-500" : "bg-blue-500"}`}
                                  style={{ width: `${Math.min((d.chargeOutValue / d.quotedAmount * 100), 100)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="text-right ml-4">
                          <p className="font-bold text-slate-900">£{d.chargeOutValue.toFixed(2)}</p>
                          <p className="text-xs text-slate-400">WIP value</p>
                          {d.billableHours > 0 && (
                            <p className="text-xs text-slate-400">{d.billableHours.toFixed(1)} billable hrs</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">

            {/* Top Clients by WIP */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-base font-bold text-slate-900 mb-4">Top Clients by WIP</h2>

              {topClients.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No data yet</p>
              ) : (
                <div className="space-y-3">
                  {topClients.map((client, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{client.name}</p>
                        <p className="text-xs text-slate-400">{client.hours.toFixed(1)} hrs</p>
                      </div>
                      <p className="font-bold text-slate-900 text-sm">£{client.wip.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Utilisation */}
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
                      style={{ width: totalHours > 0 ? `${(totalBillableHours / totalHours * 100)}%` : "0%" }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Non-billable</span>
                    <span className="font-semibold text-slate-900">{totalNonBillableHours.toFixed(1)}h</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div className="bg-slate-400 h-2 rounded-full"
                      style={{ width: totalHours > 0 ? `${(totalNonBillableHours / totalHours * 100)}%` : "0%" }} />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 mt-3">
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
