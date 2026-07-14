import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { CREDIT_NORMAL } from "../../../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Finds the same category's workpaper on the client's most recent prior trial
// balance, so a brand-new workpaper can start pre-populated rather than blank —
// prepayments, accruals etc. often carry the same items period to period.
async function findPriorWorkpaperLines(clientId: string, periodStart: string, category: string) {
  const { data: priorTb } = await supabase
    .from("trial_balances")
    .select("id")
    .eq("client_id", clientId)
    .lt("period_end", periodStart)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!priorTb) return [];

  const { data: priorWorkpaper } = await supabase
    .from("workpapers")
    .select("*, workpaper_lines(*)")
    .eq("trial_balance_id", priorTb.id)
    .eq("category", category)
    .maybeSingle();

  return priorWorkpaper?.workpaper_lines || [];
}

async function getOrCreateWorkpaper(trialBalanceId: string, clientId: string, periodStart: string, category: string) {
  const { data: existing } = await supabase
    .from("workpapers")
    .select("*, workpaper_lines(*)")
    .eq("trial_balance_id", trialBalanceId)
    .eq("category", category)
    .maybeSingle();

  if (existing) return { workpaper: existing, rolledForward: false };

  const { data: created } = await supabase
    .from("workpapers")
    .insert({ trial_balance_id: trialBalanceId, category })
    .select("*, workpaper_lines(*)")
    .single();

  if (!created) return { workpaper: null, rolledForward: false };

  // Brand new workpaper — try to roll forward last period's supporting lines
  const priorLines = await findPriorWorkpaperLines(clientId, periodStart, category);
  if (priorLines.length > 0) {
    await supabase.from("workpaper_lines").insert(
      priorLines.map((l: any) => ({
        workpaper_id: created.id,
        description: l.description,
        amount: l.amount,
      }))
    );
    const { data: refreshed } = await supabase
      .from("workpapers")
      .select("*, workpaper_lines(*)")
      .eq("id", created.id)
      .single();
    return { workpaper: refreshed, rolledForward: true };
  }

  return { workpaper: created, rolledForward: false };
}

async function addLine(workpaperId: string, trialBalanceId: string, category: string, formData: FormData) {
  "use server";
  const description = String(formData.get("description") || "").trim();
  const amount = parseFloat(String(formData.get("amount") || "0")) || 0;
  if (!description) return;

  await supabase.from("workpaper_lines").insert({ workpaper_id: workpaperId, description, amount });
  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

async function deleteLine(trialBalanceId: string, category: string, lineId: string) {
  "use server";
  await supabase.from("workpaper_lines").delete().eq("id", lineId);
  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

async function updateNotes(workpaperId: string, trialBalanceId: string, category: string, formData: FormData) {
  "use server";
  const notes = String(formData.get("notes") || "").trim();
  await supabase.from("workpapers").update({ notes }).eq("id", workpaperId);
  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

async function markPrepared(workpaperId: string, trialBalanceId: string, category: string, formData: FormData) {
  "use server";
  const staffName = String(formData.get("staff_name") || "").trim();
  if (!staffName) return;
  await supabase.from("workpapers").update({ prepared_by: staffName, prepared_at: new Date().toISOString() }).eq("id", workpaperId);
  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

async function markReviewed(workpaperId: string, trialBalanceId: string, category: string, formData: FormData) {
  "use server";
  const staffName = String(formData.get("staff_name") || "").trim();
  if (!staffName) return;
  await supabase.from("workpapers").update({ reviewed_by: staffName, reviewed_at: new Date().toISOString() }).eq("id", workpaperId);
  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

async function clearSignOff(workpaperId: string, trialBalanceId: string, category: string, field: "prepared" | "reviewed") {
  "use server";
  if (field === "prepared") {
    await supabase.from("workpapers").update({ prepared_by: null, prepared_at: null }).eq("id", workpaperId);
  } else {
    await supabase.from("workpapers").update({ reviewed_by: null, reviewed_at: null }).eq("id", workpaperId);
  }
  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

async function uploadDocument(workpaperId: string, trialBalanceId: string, category: string, formData: FormData) {
  "use server";
  const file = formData.get("document") as File | null;
  if (!file || file.size === 0) return;

  const storagePath = `${workpaperId}/${Date.now()}-${file.name}`;
  const fileBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("workpaper-documents")
    .upload(storagePath, fileBuffer, { contentType: file.type });

  if (uploadError) {
    console.error("Could not upload document:", uploadError.message);
    return;
  }

  await supabase.from("workpaper_documents").insert({
    workpaper_id: workpaperId,
    file_name: file.name,
    storage_path: storagePath,
    file_size: file.size,
  });

  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

async function deleteDocument(trialBalanceId: string, category: string, docId: string, storagePath: string) {
  "use server";
  await supabase.storage.from("workpaper-documents").remove([storagePath]);
  await supabase.from("workpaper_documents").delete().eq("id", docId);
  revalidatePath(`/accounts-production/${trialBalanceId}/workpapers/${encodeURIComponent(category)}`);
}

export default async function WorkpaperDetailPage({
  params,
}: {
  params: Promise<{ id: string; category: string }>;
}) {
  const { id, category: encodedCategory } = await params;
  const category = decodeURIComponent(encodedCategory);

  const [{ data: tb, error }, { data: lines }, { data: staff }] = await Promise.all([
    supabase.from("trial_balances").select("*, clients(client_name)").eq("id", id).single(),
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", id).eq("category", category),
    supabase.from("staff").select("id, name").eq("is_active", true).order("name", { ascending: true }),
  ]);

  if (error || !tb) notFound();

  const { workpaper, rolledForward } = await getOrCreateWorkpaper(id, tb.client_id, tb.period_start, category);
  if (!workpaper) notFound();

  const { data: documents } = await supabase
    .from("workpaper_documents")
    .select("*")
    .eq("workpaper_id", workpaper.id)
    .order("uploaded_at", { ascending: false });

  // Bucket is private, so each document needs a short-lived signed URL to download
  const documentsWithUrls = await Promise.all(
    (documents || []).map(async (doc) => {
      const { data: signed } = await supabase.storage
        .from("workpaper-documents")
        .createSignedUrl(doc.storage_path, 300);
      return { ...doc, url: signed?.signedUrl || null };
    })
  );

  const tbBalance = (lines || []).reduce((s, l) => {
    const net = CREDIT_NORMAL.has(category) ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
    return s + net;
  }, 0);

  const workpaperLines = workpaper.workpaper_lines || [];
  const supportingTotal = workpaperLines.reduce((s: number, l: any) => s + Number(l.amount), 0);
  const variance = tbBalance - supportingTotal;
  const isAgreed = Math.abs(variance) < 0.01;

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDateTime = (iso: string) =>
    `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  const addLineWithIds = addLine.bind(null, workpaper.id, id, category);
  const deleteLineWithIds = deleteLine.bind(null, id, category);
  const updateNotesWithIds = updateNotes.bind(null, workpaper.id, id, category);
  const markPreparedWithIds = markPrepared.bind(null, workpaper.id, id, category);
  const markReviewedWithIds = markReviewed.bind(null, workpaper.id, id, category);
  const uploadDocumentWithIds = uploadDocument.bind(null, workpaper.id, id, category);
  const deleteDocumentWithIds = deleteDocument.bind(null, id, category);

  const fmtFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href={`/accounts-production/${id}/workpapers`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to Workpapers
        </a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">{category}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {(tb.clients as any)?.client_name} · {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="p-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">

          {rolledForward && (
            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
              <p className="text-sm font-semibold text-blue-700">↻ Rolled forward from last period</p>
              <p className="text-xs text-blue-600 mt-0.5">These lines were copied from the prior period's workpaper — review and update the amounts for this period.</p>
            </div>
          )}

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Supporting Detail</h2>
            <p className="text-sm text-slate-500 mt-0.5">Itemized breakdown that should sum to the trial balance figure.</p>

            <div className="mt-4 space-y-2">
              {workpaperLines.map((line: any) => (
                <div key={line.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <span className="text-sm text-slate-900">{line.description}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono font-medium">{fmt(Number(line.amount))}</span>
                    <form action={deleteLineWithIds.bind(null, line.id)}>
                      <button className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              ))}
              {workpaperLines.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No supporting lines added yet.</p>
              )}
            </div>

            <form action={addLineWithIds} className="mt-4 flex gap-2 items-end border-t border-slate-100 pt-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <input name="description" required
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="e.g. Per bank statement, or customer name" />
              </div>
              <div className="w-40">
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount (£)</label>
                <input name="amount" type="number" step="0.01" required
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Add
              </button>
            </form>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Supporting Documents</h2>
            <p className="text-sm text-slate-500 mt-0.5">Bank statements, supplier statements, or anything else proving this figure.</p>

            <div className="mt-4 space-y-2">
              {documentsWithUrls.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg flex-shrink-0">📄</span>
                    <div className="min-w-0">
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium text-blue-600 hover:underline truncate block">
                          {doc.file_name}
                        </a>
                      ) : (
                        <span className="text-sm font-medium text-slate-900 truncate block">{doc.file_name}</span>
                      )}
                      <p className="text-xs text-slate-400">
                        {fmtFileSize(doc.file_size)} · {new Date(doc.uploaded_at).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                  </div>
                  <form action={deleteDocumentWithIds.bind(null, doc.id, doc.storage_path)}>
                    <button className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors flex-shrink-0">
                      Delete
                    </button>
                  </form>
                </div>
              ))}
              {documentsWithUrls.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">No documents uploaded yet.</p>
              )}
            </div>

            <form action={uploadDocumentWithIds} className="mt-4 flex gap-2 items-end border-t border-slate-100 pt-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">Upload Document</label>
                <input name="document" type="file" required
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <button type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Upload
              </button>
            </form>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Notes</h2>
            <form action={updateNotesWithIds} className="mt-3">
              <textarea name="notes" defaultValue={workpaper.notes || ""} rows={3}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Anything worth noting about this reconciliation" />
              <button type="submit"
                className="mt-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Notes
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <div className={`rounded-2xl p-6 shadow-sm ${isAgreed ? "bg-green-600" : "bg-red-600"}`}>
            <p className="text-sm font-medium text-white/80">{isAgreed ? "✓ Agreed" : "Variance"}</p>
            <p className="mt-2 text-3xl font-bold text-white">{fmt(Math.abs(variance))}</p>
            {!isAgreed && (
              <p className="mt-1 text-xs text-white/80">
                {variance > 0 ? "Supporting detail is short of the TB balance" : "Supporting detail exceeds the TB balance"}
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Trial Balance</span><span className="font-medium">{fmt(tbBalance)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Supporting Total</span><span className="font-medium">{fmt(supportingTotal)}</span></div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                <span>Variance</span>
                <span className={isAgreed ? "text-green-600" : "text-red-600"}>{fmt(variance)}</span>
              </div>
            </div>
          </div>

          {/* Sign-off */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Sign-off</h2>

            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Prepared</p>
              {workpaper.prepared_by ? (
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-sm text-slate-700">{workpaper.prepared_by} · {fmtDateTime(workpaper.prepared_at)}</p>
                  <form action={clearSignOff.bind(null, workpaper.id, id, category, "prepared")}>
                    <button className="text-xs text-slate-400 hover:text-red-600 transition-colors">Clear</button>
                  </form>
                </div>
              ) : (
                <form action={markPreparedWithIds} className="mt-1 flex gap-2">
                  <select name="staff_name" required
                    className="flex-1 rounded-xl border border-slate-200 p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select staff</option>
                    {(staff || []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <button type="submit"
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors whitespace-nowrap">
                    Mark Prepared
                  </button>
                </form>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Reviewed</p>
              {workpaper.reviewed_by ? (
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-sm text-slate-700">{workpaper.reviewed_by} · {fmtDateTime(workpaper.reviewed_at)}</p>
                  <form action={clearSignOff.bind(null, workpaper.id, id, category, "reviewed")}>
                    <button className="text-xs text-slate-400 hover:text-red-600 transition-colors">Clear</button>
                  </form>
                </div>
              ) : (
                <form action={markReviewedWithIds} className="mt-1 flex gap-2">
                  <select name="staff_name" required
                    className="flex-1 rounded-xl border border-slate-200 p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select staff</option>
                    {(staff || []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <button type="submit"
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors whitespace-nowrap">
                    Mark Reviewed
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
