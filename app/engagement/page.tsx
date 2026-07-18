import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function deleteEngagementLetter(id: string) {
  "use server";

  await supabase.from("engagement_letters").delete().eq("id", id);
  revalidatePath("/engagement");
}

export default async function EngagementPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status: statusFilter, q } = await searchParams;
  const query = (q || "").trim().toLowerCase();

  const { data: letters, error } = await supabase
    .from("engagement_letters")
    .select("*, clients(client_name)")
    .order("created_at", { ascending: false });

  const draftCount = letters?.filter(l => l.status === "Draft").length ?? 0;
  const sentCount = letters?.filter(l => l.status === "Sent").length ?? 0;
  const signedCount = letters?.filter(l => l.status === "Signed").length ?? 0;

  const filteredLetters = (letters || []).filter((letter) => {
    if (statusFilter && letter.status !== statusFilter) return false;
    if (query) {
      const haystack = [letter.clients?.client_name, letter.client_email]
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
            <h1 className="text-2xl font-bold text-slate-900">Engagement Letters</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Create and send letters of engagement for digital signing.
            </p>
          </div>
          <a href="/engagement/new"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            + New Engagement Letter
          </a>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load engagement letters: {error.message}
          </div>
        )}

        {/* Drillable stat filters */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <a href={statusFilter === "Draft" ? "/engagement" : "/engagement?status=Draft"} className={statCardClass(statusFilter === "Draft")}>
            <p className={`text-2xl font-bold ${statusFilter === "Draft" ? "text-white" : "text-slate-900"}`}>{draftCount}</p>
            <p className={`text-xs mt-1 ${statusFilter === "Draft" ? "text-slate-300" : "text-slate-500"}`}>Draft</p>
          </a>
          <a href={statusFilter === "Sent" ? "/engagement" : "/engagement?status=Sent"} className={statCardClass(statusFilter === "Sent")}>
            <p className={`text-2xl font-bold ${statusFilter === "Sent" ? "text-white" : "text-blue-600"}`}>{sentCount}</p>
            <p className={`text-xs mt-1 ${statusFilter === "Sent" ? "text-slate-300" : "text-slate-500"}`}>Sent</p>
          </a>
          <a href={statusFilter === "Signed" ? "/engagement" : "/engagement?status=Signed"} className={statCardClass(statusFilter === "Signed")}>
            <p className={`text-2xl font-bold ${statusFilter === "Signed" ? "text-white" : "text-green-600"}`}>{signedCount}</p>
            <p className={`text-xs mt-1 ${statusFilter === "Signed" ? "text-slate-300" : "text-slate-500"}`}>Signed</p>
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
            <a href="/engagement"
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center">
              Clear
            </a>
          )}
        </form>

        {/* List */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {isFiltered ? `Results (${filteredLetters.length})` : `All Letters (${letters?.length ?? 0})`}
          </h2>

          <div className="mt-4 space-y-3">
            {filteredLetters.map((letter) => (
              <div key={letter.id} className="rounded-xl border border-slate-100 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <a href={`/engagement/${letter.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-600 transition-colors">
                        {letter.clients?.client_name || "Unknown Client"}
                      </a>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        letter.status === "Signed" ? "bg-green-100 text-green-700"
                        : letter.status === "Sent" ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-600"
                      }`}>
                        {letter.status}
                      </span>
                    </div>

                    <p className="text-sm text-slate-500 mt-0.5">{letter.client_email}</p>

                    <div className="mt-1 flex gap-4 text-xs text-slate-400">
                      {letter.start_date && (
                        <span>Start: {new Date(letter.start_date).toLocaleDateString("en-GB")}</span>
                      )}
                      {letter.sent_at && (
                        <span>Sent: {new Date(letter.sent_at).toLocaleDateString("en-GB")}</span>
                      )}
                      {letter.signed_at && (
                        <span className="text-green-600">✓ Signed: {new Date(letter.signed_at).toLocaleDateString("en-GB")}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <a href={`/engagement/${letter.id}`}
                      className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                      Manage
                    </a>
                    <form action={deleteEngagementLetter.bind(null, letter.id)}>
                      <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}

            {isFiltered && filteredLetters.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No engagement letters match this filter.</p>
            )}

            {!isFiltered && letters && letters.length === 0 && (
              <div className="text-center py-12">
                <p className="text-slate-500 text-sm">No engagement letters yet.</p>
                <a href="/engagement/new"
                  className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  + New Engagement Letter
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
