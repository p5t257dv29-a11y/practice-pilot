import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createTemplate(formData: FormData) {
  "use server";
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await supabase.from("checklist_templates").insert({ name });
  revalidatePath("/checklists");
}

async function deleteTemplate(id: string) {
  "use server";
  await supabase.from("checklist_templates").delete().eq("id", id);
  revalidatePath("/checklists");
}

async function addTemplateItem(templateId: string, formData: FormData) {
  "use server";
  const itemText = String(formData.get("item_text") || "").trim();
  if (!itemText) return;

  const { data: existing } = await supabase
    .from("checklist_template_items")
    .select("sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 1;

  await supabase.from("checklist_template_items").insert({
    template_id: templateId,
    item_text: itemText,
    sort_order: nextOrder,
  });
  revalidatePath("/checklists");
}

async function deleteTemplateItem(templateId: string, itemId: string) {
  "use server";
  await supabase.from("checklist_template_items").delete().eq("id", itemId);
  revalidatePath("/checklists");
}

export default async function ChecklistsPage() {
  const { data: templates, error } = await supabase
    .from("checklist_templates")
    .select("*, checklist_template_items(*)")
    .order("name", { ascending: true });

  return (
    <div className="p-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Checklist Templates</h1>
        <p className="mt-1 text-slate-500">
          Manage the reusable checklists you request from clients (e.g. Year End Accounts, Self Assessment). Attach these to individual jobs from the job detail page.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-700">
          Could not load templates: {error.message}
        </div>
      )}

      {/* New template form */}
      <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
        <h2 className="text-lg font-bold text-slate-900">New Template</h2>
        <form action={createTemplate} className="mt-4 flex gap-3">
          <input name="name" required
            className="flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="e.g. Partnership Accounts" />
          <button type="submit"
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            Create Template
          </button>
        </form>
      </div>

      {/* Templates list */}
      <div className="mt-6 space-y-6">
        {(templates || []).map((template) => {
          const items = (template.checklist_template_items || []).sort(
            (a: any, b: any) => a.sort_order - b.sort_order
          );
          const addItemWithId = addTemplateItem.bind(null, template.id);

          return (
            <div key={template.id} className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">
                  {template.name} <span className="text-sm font-normal text-slate-400">({items.length} items)</span>
                </h2>
                <form action={deleteTemplate.bind(null, template.id)}>
                  <button className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                    Delete Template
                  </button>
                </form>
              </div>

              <div className="mt-4 space-y-2">
                {items.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2">
                    <p className="text-sm text-slate-700">{item.item_text}</p>
                    <form action={deleteTemplateItem.bind(null, template.id, item.id)}>
                      <button className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors">
                        Remove
                      </button>
                    </form>
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-4">No items yet.</p>
                )}
              </div>

              <form action={addItemWithId} className="mt-4 flex gap-3">
                <input name="item_text" required
                  className="flex-1 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder="Add a new checklist item..." />
                <button type="submit"
                  className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                  + Add Item
                </button>
              </form>
            </div>
          );
        })}

        {templates && templates.length === 0 && (
          <p className="text-sm text-slate-500">No templates yet. Create your first one above.</p>
        )}
      </div>
    </div>
  );
}
