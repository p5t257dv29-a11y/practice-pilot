import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function deleteOnboardingRequest(id: string) {
  "use server";

  await supabase.from("onboarding_requests").delete().eq("id", id);
  revalidatePath("/onboarding");
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status: statusFilter, q } = await searchParams;
  const query = (q || "").trim().toLowerCase();

  const { data: requests, error } = await supabase
    .from("onboarding_requests")
    .select("*, clients(client_name)")
    .order("created_at", { ascending: false });

  const pendingCount = requests?.filter(r => r.status === "Pending").length ?? 0;
  const inProgressCount = requests?.filter(r => r.status === "In Progress").length ?? 0;
  const completeCount = requests?.filter(r => r.status === "Complete").length ?? 0;

  const filteredRequests = (requests || []).filter((request) => {
    if (statusFilter && request.status !== statusFilter) return false;
    if (query) {
      const haystack = [request.clients?.client_name, request.client_email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const isFiltered = Boolean(statusFilter || query);

  const statCardClass = (active: boolean) =>
    `rounded-2xl p-4 shadow-sm border text-center transition-all cursor-pointer ${
      active ? "bg-slate-900 border-slate-900" : "bg-white border-slate-100 hover:shadow-md hover:border-slate-200"
    }`;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Onboarding</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage new client onboarding and professional clearance requests.
            </p>
          </div>
          <a href="/onboarding/new"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            + New Onboarding
          </a>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load onboarding requests: {error.message}
          </div>
        )}

        {/* Drillable stat filters */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <a href={statusFilter === "Pending" ? "/onboarding" : "/onboarding?status=Pending"} className={statCardClass(statusFilter === "Pending")}>
            <p className={`text-2xl font-bold ${statusFilter === "Pending" ? "text-white" : "text-slate-900"}`}>{pendingCount}</p>
            <p className={`text-xs mt-1 ${statusFilter === "Pending" ? "text-slate-300" : "text-slate-500"}`}>Pending</p>
          </a>
          <a href={statusFilter === "In Progress" ? "/onboarding" : "/onboarding?status=In+Progress"} className={statCardClass(statusFilter === "In Progress")}>
            <p className={`text-2xl font-bold ${statusFilter === "In Progress" ? "text-white" : "text-blue-600"}`}>{inProgressCount}</p>
            <p className={`text-xs mt-1 ${statusFilter === "In Progress" ? "text-slate-300" : "text-slate-500"}`}>In Progress</p>
          </a>
          <a href={statusFilter === "Complete" ? "/onboarding" : "/onboarding?status=Complete"} className={statCardClass(statusFilter === "Complete")}>
            <p className={`text-2xl font-bold ${statusFilter === "Complete" ? "text-white" : "text-green-600"}`}>{completeCount}</p>
            <p className={`text-xs mt-1 ${statusFilter === "Complete" ? "text-slate-300" : "text-slate-500"}`}>Complete</p>
          </a>
        </div>

        {/* Search */}
        <form method="get" className="mb-6 flex gap-2 max-w-md">
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          <input
            name="q"
            defaultValue={q || ""}
            placeholder="Search by client or email..."
            className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <button type="submit"
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
            Search
          </button>
          {isFiltered && (
            <a href="/onboarding"
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center">
              Clear
            </a>
          )}
        </form>

        {/* List — only shown once a filter or search narrows things down */}
        {isFiltered ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">
              Results ({filteredRequests.length})
            </h2>

            <div className="mt-4 space-y-3">
              {filteredRequests.map((request) => (
                <div key={request.id}
                  className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <a href={`/onboarding/${request.id}`}
                          className="font-semibold text-slate-900 hover:text-blue-600 transition-colors">
                          {request.clients?.client_name || "Unknown Client"}
                        </a>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          request.status === "Complete" ? "bg-green-100 text-green-700"
                          : request.status === "In Progress" ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-600"
                        }`}>
                          {request.status}
                        </span>
                      </div>

                      <p className="text-sm text-slate-500 mt-0.5">
                        {request.client_email || "No email"}
                      </p>

                      <div className="mt-2 flex gap-4 text-xs text-slate-400">
                        <span>
                          📋 Client form: {request.completed_at
                            ? <span className="text-green-600 font-medium">Completed</span>
                            : request.sent_at
                            ? <span className="text-blue-600 font-medium">Sent</span>
                            : <span>Not sent</span>}
                        </span>
                        <span>
                          📨 Clearance: {request.clearance_received
                            ? <span className="text-green-600 font-medium">Received</span>
                            : request.clearance_sent_at
                            ? <span className="text-blue-600 font-medium">Sent</span>
                            : <span>Not sent</span>}
                        </span>
                      </div>

                      {/* Checklist indicators */}
                      <div className="mt-2 flex gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${request.id_received ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                          ID {request.id_received ? "✓" : "○"}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${request.prev_accounts_received ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                          Prev Accounts {request.prev_accounts_received ? "✓" : "○"}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${request.signed_engagement_received ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                          Engagement Letter {request.signed_engagement_received ? "✓" : "○"}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 ml-4">
                      <a href={`/onboarding/${request.id}`}
                        className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                        Manage
                      </a>
                      <form action={deleteOnboardingRequest.bind(null, request.id)}>
                        <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ))}

              {filteredRequests.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-8">No onboarding requests match this filter.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <p className="text-sm text-slate-500 text-center py-8">
              {requests && requests.length === 0
                ? "No onboarding requests yet. Click + New Onboarding to add your first one."
                : "Search, or click a stat above, to see requests."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
