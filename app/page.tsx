import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function DashboardPage() {
  const [
    { count: totalClients },
    { count: totalJobs },
    { count: activeJobs },
    { count: prospects },
    { count: totalQuotes },
    { count: acceptedQuotes },
    { count: pendingQuotes },
    { data: recentClients },
    { data: recentJobs },
    { data: recentQuotes },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("jobs").select("*", { count: "exact", head: true }),
    supabase.from("jobs").select("*", { count: "exact", head: true }).eq("status", "Active"),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("onboarding_status", "Prospect"),
    supabase.from("quotes").select("*", { count: "exact", head: true }),
    supabase.from("quotes").select("*", { count: "exact", head: true }).eq("status", "Accepted"),
    supabase.from("quotes").select("*", { count: "exact", head: true }).eq("status", "Sent"),
    supabase.from("clients").select("id, client_name, entity_type, onboarding_status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("jobs").select("*, clients(client_name)").order("created_at", { ascending: false }).limit(5),
    supabase.from("quotes").select("*, clients(client_name)").order("created_at", { ascending: false }).limit(5),
  ]);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500 mt-0.5">{today}</p>
          </div>
          <div className="flex gap-3">
            <a href="/clients?new=true" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">+ New Client</a>
            <a href="/jobs" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">+ New Job</a>
            <a href="/quotes" className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors">+ New Quote</a>
          </div>
        </div>
      </div>

      <div className="p-8">

        {/* Stat Cards — all clickable */}
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">

          <a href="/clients" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">Total Clients</p>
              <span className="text-2xl">👥</span>
            </div>
            <p className="mt-3 text-4xl font-bold text-slate-900">{totalClients ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">{prospects ?? 0} prospects</p>
          </a>

          <a href="/jobs" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">Total Jobs</p>
              <span className="text-2xl">💼</span>
            </div>
            <p className="mt-3 text-4xl font-bold text-slate-900">{totalJobs ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">{activeJobs ?? 0} active</p>
          </a>

          <a href="/jobs" className="rounded-2xl bg-blue-600 p-6 shadow-sm hover:bg-blue-700 transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-blue-100">Active Jobs</p>
              <span className="text-2xl">⚡</span>
            </div>
            <p className="mt-3 text-4xl font-bold text-white">{activeJobs ?? 0}</p>
            <p className="mt-1 text-xs text-blue-200">In progress</p>
          </a>

          <a href="/quotes" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">Quotes</p>
              <span className="text-2xl">📋</span>
            </div>
            <p className="mt-3 text-4xl font-bold text-slate-900">{totalQuotes ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">
              {acceptedQuotes ?? 0} accepted · {pendingQuotes ?? 0} pending
            </p>
          </a>

        </div>

        {/* Three column widgets */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">

          {/* Recent Clients */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Recent Clients</h2>
              <a href="/clients" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-2">
              {(recentClients || []).map((client) => (
                <a key={client.id} href={`/clients/${client.id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                      {client.client_name?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{client.client_name}</p>
                      <p className="text-xs text-slate-500">{client.entity_type || "No entity type"}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    client.onboarding_status === "Active Client" ? "bg-green-100 text-green-700"
                    : client.onboarding_status === "Prospect" ? "bg-blue-100 text-blue-700"
                    : client.onboarding_status === "Onboarding" ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {client.onboarding_status || "Unknown"}
                  </span>
                </a>
              ))}
              {recentClients && recentClients.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No clients yet. <a href="/clients?new=true" className="text-blue-600 hover:underline">Add your first →</a>
                </p>
              )}
            </div>
          </div>

          {/* Recent Jobs */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Recent Jobs</h2>
              <a href="/jobs" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-2">
              {(recentJobs || []).map((job) => (
                <a key={job.id} href={`/jobs/${job.id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-xs font-bold text-blue-600">
                      {job.job_name?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{job.job_name}</p>
                      <p className="text-xs text-slate-500">{job.clients?.client_name || "No client"}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    job.status === "Active" ? "bg-green-100 text-green-700"
                    : job.status === "Completed" ? "bg-blue-100 text-blue-700"
                    : job.status === "On Hold" ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {job.status || "Draft"}
                  </span>
                </a>
              ))}
              {recentJobs && recentJobs.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No jobs yet. <a href="/jobs" className="text-blue-600 hover:underline">Add your first →</a>
                </p>
              )}
            </div>
          </div>

          {/* Recent Quotes */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Recent Quotes</h2>
              <a href="/quotes" className="text-xs font-medium text-blue-600 hover:underline">View all →</a>
            </div>
            <div className="space-y-2">
              {(recentQuotes || []).map((quote) => (
                <a key={quote.id} href={`/quotes/${quote.id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-xs font-bold text-green-600">
                      £
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{quote.quote_number}</p>
                      <p className="text-xs text-slate-500">
                        {quote.clients?.client_name || "No client"} · £{Number(quote.total || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    quote.status === "Accepted" ? "bg-green-100 text-green-700"
                    : quote.status === "Sent" ? "bg-blue-100 text-blue-700"
                    : quote.status === "Declined" ? "bg-red-100 text-red-700"
                    : quote.status === "Expired" ? "bg-orange-100 text-orange-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {quote.status || "Draft"}
                  </span>
                </a>
              ))}
              {recentQuotes && recentQuotes.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No quotes yet. <a href="/quotes" className="text-blue-600 hover:underline">Add your first →</a>
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
