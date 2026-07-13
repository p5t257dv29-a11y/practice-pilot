import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { ALL_CATEGORIES, PL_CATEGORIES, BS_CATEGORIES } from "../page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function saveMappings(trialBalanceId: string, clientId: string, formData: FormData) {
  "use server";

  const { data: lines } = await supabase
    .from("trial_balance_lines")
    .select("id, nominal_code")
    .eq("trial_balance_id", trialBalanceId);

  for (const line of lines || []) {
    const category = String(formData.get(`category_${line.id}`) || "").trim();
    if (!category) continue;

    await supabase.from("trial_balance_lines").update({ category }).eq("id", line.id);

    if (line.nominal_code) {
      await supabase.from("nominal_code_mappings").upsert(
        { client_id: clientId, nominal_code: line.nominal_code, category },
        { onConflict: "client_id,nominal_code" }
      );
    }
  }

  revalidatePath(`/accounts-production/${trialBalanceId}`);
  revalidatePath("/accounts-production");
}

async function updateLine(trialBalanceId: string, clientId: string, lineId: string, formData: FormData) {
  "use server";

  const get = (key: string) => String(formData.get(key) || "").trim();
  const nominal_code = get("nominal_code") || null;
  const description = get("description");
  const category = get("category") || null;
  const debit = parseFloat(get("debit")) || 0;
  const credit = parseFloat(get("credit")) || 0;

  await supabase.from("trial_balance_lines").update({
    nominal_code, description, category, debit, credit,
  }).eq("id", lineId);

  if (nominal_code && category) {
    await supabase.from("nominal_code_mappings").upsert(
      { client_id: clientId, nominal_code, category },
      { onConflict: "client_id,nominal_code" }
    );
  }

  revalidatePath(`/accounts-production/${trialBalanceId}`);
  revalidatePath("/accounts-production");
}

export default async function TrialBalanceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ line_edit?: string }>;
}) {
  const { id } = await params;
  const { line_edit } = await searchParams;

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name), jobs(job_name)")
    .eq("id", id)
    .single();

  if (error || !tb) notFound();

  const [{ data: lines }, { data: journals }] = await Promise.all([
    supabase.from("trial_balance_lines").select("*").eq("trial_balance_id", id).order("nominal_code", { ascending: true }),
    supabase.from("journals").select("*").eq("trial_balance_id", id),
  ]);

  const fmt = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const totalDebit = (lines || []).reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = (lines || []).reduce((s, l) => s + Number(l.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const unmappedLines = (lines || []).filter((l) => !l.category);
  const mappedLines = (lines || []).filter((l) => l.category);

  // Category totals (net = debit - credit, shown as entered; sign interpretation
  // depends on whether the category is normally a debit or credit balance)
  const categoryTotals = new Map<string, { debit: number; credit: number }>();
  mappedLines.forEach((l) => {
    const existing = categoryTotals.get(l.category) || { debit: 0, credit: 0 };
    existing.debit += Number(l.debit);
    existing.credit += Number(l.credit);
    categoryTotals.set(l.category, existing);
  });

  const saveMappingsWithIds = saveMappings.bind(null, id, tb.client_id);
  const updateLineWithIds = updateLine.bind(null, id, tb.client_id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <a href="/accounts-production" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            ← Back to Accounts Production
          </a>
          <div className="flex gap-3">
            <a href={`/accounts-production/${id}/journal`}
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              Journals {journals && journals.length > 0 ? `(${journals.length})` : ""} →
            </a>
            <a href={`/accounts-production/${id}/accounts`}
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              View Draft Accounts →
            </a>
            <a href={`/accounts-production/${id}/frs105`}
              className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              FRS 105 Accounts →
            </a>
            <a href={`/accounts-production/${id}/frs102`}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              FRS 102 Accounts →
            </a>
          </div>
        </div>
        <div className="mt-4">
          <h1 className="text-2xl font-bold text-slate-900">{(tb.clients as any)?.client_name || "No client"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Period {new Date(tb.period_start).toLocaleDateString("en-GB")} to {new Date(tb.period_end).toLocaleDateString("en-GB")}
            {(tb.jobs as any)?.job_name && ` · Job: ${(tb.jobs as any).job_name}`}
            {tb.filename && ` · ${tb.filename}`}
          </p>
        </div>
      </div>

      <div className="p-8">
        {/* Balance check */}
        <div className={`rounded-2xl p-4 border ${isBalanced ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-bold ${isBalanced ? "text-green-700" : "text-red-700"}`}>
                {isBalanced ? "✓ Trial balance is balanced" : "⚠ Trial balance does not balance"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Total Debits: {fmt(totalDebit)} · Total Credits: {fmt(totalCredit)}
                {!isBalanced && ` · Difference: ${fmt(Math.abs(totalDebit - totalCredit))}`}
              </p>
            </div>
          </div>
        </div>

        {/* Trial Balance snapshot */}
        {categoryTotals.size > 0 && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Trial Balance</h2>
            <p className="text-xs text-slate-400 mt-0.5">A snapshot of category totals, including any posted journals.</p>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Profit & Loss</p>
                <div className="space-y-1 text-sm">
                  {PL_CATEGORIES.filter((c) => categoryTotals.has(c)).map((c) => {
                    const t = categoryTotals.get(c)!;
                    return (
                      <div key={c} className="flex justify-between">
                        <span className="text-slate-600">{c}</span>
                        <span className="font-medium">{fmt(t.debit - t.credit)}</span>
                      </div>
                    );
                  })}
                  {PL_CATEGORIES.filter((c) => categoryTotals.has(c)).length === 0 && (
                    <p className="text-xs text-slate-400">No P&L lines mapped yet.</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Balance Sheet</p>
                <div className="space-y-1 text-sm">
                  {BS_CATEGORIES.filter((c) => categoryTotals.has(c)).map((c) => {
                    const t = categoryTotals.get(c)!;
                    return (
                      <div key={c} className="flex justify-between">
                        <span className="text-slate-600">{c}</span>
                        <span className="font-medium">{fmt(t.debit - t.credit)}</span>
                      </div>
                    );
                  })}
                  {BS_CATEGORIES.filter((c) => categoryTotals.has(c)).length === 0 && (
                    <p className="text-xs text-slate-400">No Balance Sheet lines mapped yet.</p>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-4">
              Figures shown as Debit − Credit. See "View Draft Accounts" for formatted Profit &amp; Loss and Balance Sheet statements.
            </p>
          </div>
        )}

        {/* Unmapped lines — need categorising */}
        {unmappedLines.length > 0 && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">
              Map Categories ({unmappedLines.length} unmapped)
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Assign each nominal code to a category. This is remembered for this client, so future uploads with the same codes will map automatically.
            </p>
            <form action={saveMappingsWithIds} className="mt-4 space-y-2">
              {unmappedLines.map((line) => (
                <div key={line.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {line.nominal_code && <span className="text-slate-400 font-mono mr-2">{line.nominal_code}</span>}
                      {line.description}
                    </p>
                    <p className="text-xs text-slate-400">
                      Dr {fmt(Number(line.debit))} · Cr {fmt(Number(line.credit))}
                    </p>
                  </div>
                  <select name={`category_${line.id}`}
                    className="w-72 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                    <option value="">Select category...</option>
                    <optgroup label="Profit & Loss">
                      {PL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                    <optgroup label="Balance Sheet">
                      {BS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  </select>
                </div>
              ))}
              <button type="submit"
                className="mt-3 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save Mappings
              </button>
            </form>
          </div>
        )}

        {/* All lines — now editable inline */}
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Lines ({lines?.length ?? 0})</h2>
          <p className="text-xs text-slate-400 mt-0.5">Edit a line directly for quick corrections — no need to post a journal for simple fixes.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="pb-2">Code</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2 text-right">Debit</th>
                  <th className="pb-2 text-right">Credit</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(lines || []).map((l) => {
                  const journal = l.journal_id ? journals?.find((j) => j.id === l.journal_id) : null;
                  const isEditing = line_edit === l.id;

                  if (isEditing) {
                    return (
                      <tr key={l.id} className="bg-slate-50">
                        <td colSpan={7} className="py-3">
                          <form action={updateLineWithIds.bind(null, l.id)} className="flex flex-wrap items-center gap-2 px-1">
                            <input name="nominal_code" defaultValue={l.nominal_code || ""} placeholder="Code"
                              className="w-24 rounded-xl border border-slate-200 p-2 text-sm" />
                            <input name="description" defaultValue={l.description} placeholder="Description"
                              className="flex-1 min-w-[200px] rounded-xl border border-slate-200 p-2 text-sm" />
                            <select name="category" defaultValue={l.category || ""}
                              className="w-56 rounded-xl border border-slate-200 p-2 text-sm bg-white">
                              <option value="">No category</option>
                              <optgroup label="Profit & Loss">
                                {PL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </optgroup>
                              <optgroup label="Balance Sheet">
                                {BS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </optgroup>
                            </select>
                            <input name="debit" type="number" step="0.01" min="0" defaultValue={l.debit} placeholder="Debit"
                              className="w-28 rounded-xl border border-slate-200 p-2 text-sm text-right" />
                            <input name="credit" type="number" step="0.01" min="0" defaultValue={l.credit} placeholder="Credit"
                              className="w-28 rounded-xl border border-slate-200 p-2 text-sm text-right" />
                            <button type="submit"
                              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors">
                              Save
                            </button>
                            <a href={`/accounts-production/${id}`}
                              className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                              Cancel
                            </a>
                          </form>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="py-2 font-mono text-slate-500">{l.nominal_code || "—"}</td>
                      <td className="py-2 text-slate-900">{l.description}</td>
                      <td className="py-2 text-slate-600">{l.category || <span className="text-yellow-600">Unmapped</span>}</td>
                      <td className="py-2 text-xs">
                        {journal ? (
                          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-purple-600 font-medium">
                            {journal.reference || "Journal"}
                          </span>
                        ) : (
                          <span className="text-slate-400">Upload</span>
                        )}
                      </td>
                      <td className="py-2 text-right">{Number(l.debit) > 0 ? fmt(Number(l.debit)) : "—"}</td>
                      <td className="py-2 text-right">{Number(l.credit) > 0 ? fmt(Number(l.credit)) : "—"}</td>
                      <td className="py-2 text-right">
                        <a href={`/accounts-production/${id}?line_edit=${l.id}`}
                          className="text-xs font-semibold text-blue-600 hover:underline">
                          Edit
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
