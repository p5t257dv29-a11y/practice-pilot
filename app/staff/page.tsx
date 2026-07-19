import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createStaff(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const name = get("name");
  if (!name) return;

  await supabase.from("staff").insert({
    name,
    email: get("email") || null,
    role: get("role") || null,
    charge_out_rate: parseFloat(get("charge_out_rate")) || 0,
    is_active: true,
  });
  revalidatePath("/staff");
}

async function updateStaff(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  const name = get("name");
  if (!name) return;

  await supabase.from("staff").update({
    name,
    email: get("email") || null,
    role: get("role") || null,
    charge_out_rate: parseFloat(get("charge_out_rate")) || 0,
  }).eq("id", id);
  revalidatePath("/staff");
}

async function toggleActive(id: string, current: boolean) {
  "use server";
  await supabase.from("staff").update({ is_active: !current }).eq("id", id);
  revalidatePath("/staff");
}

async function deleteStaff(id: string) {
  "use server";
  await supabase.from("staff").delete().eq("id", id);
  revalidatePath("/staff");
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;

  const { data: staff, error } = await supabase
    .from("staff")
    .select("*")
    .order("name", { ascending: true });

  const activeStaff = staff?.filter((s) => s.is_active) || [];
  const inactiveStaff = staff?.filter((s) => !s.is_active) || [];

  const renderMember = (member: any, dimmed: boolean) => {
    const isEditing = edit === member.id;

    if (isEditing) {
      return (
        <div key={member.id} className="rounded-xl border border-slate-200 p-4 bg-slate-50">
          <form action={updateStaff.bind(null, member.id)} className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
              <input name="name" required defaultValue={member.name}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input name="email" type="email" defaultValue={member.email || ""}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
              <input name="role" defaultValue={member.role || ""}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Charge-out Rate (£/hr)</label>
              <input name="charge_out_rate" type="number" step="0.01" min="0" defaultValue={member.charge_out_rate || 0}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm bg-white" />
            </div>
            <div className="md:col-span-4 flex items-center gap-3">
              <button type="submit"
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                Save
              </button>
              <a href="/staff" className="text-sm font-semibold text-slate-500 hover:text-slate-700">
                Cancel
              </a>
            </div>
          </form>
        </div>
      );
    }

    return (
      <div key={member.id}
        className={`flex items-center justify-between rounded-xl border border-slate-100 p-4 ${dimmed ? "opacity-60" : ""}`}>
        <div>
          <p className="font-semibold text-slate-900">{member.name}</p>
          <p className="text-sm text-slate-500">
            {member.role || "No role set"}
            {member.email && ` · ${member.email}`}
            {" · "}
            <span className="font-mono tabular-nums">
              £{Number(member.charge_out_rate || 0).toFixed(2)}/hr
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/staff?edit=${member.id}`}
            className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
            Edit
          </a>
          <form action={toggleActive.bind(null, member.id, member.is_active)}>
            <button className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
              member.is_active
                ? "bg-yellow-50 text-yellow-600 hover:bg-yellow-100"
                : "bg-green-50 text-green-600 hover:bg-green-100"
            }`}>
              {member.is_active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
          <form action={deleteStaff.bind(null, member.id)}>
            <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
              Delete
            </button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="p-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Staff</h1>
        <p className="mt-1 text-slate-500">
          Manage your team. Charge-out rates set here feed automatically into Timesheets.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-700">
          Could not load staff: {error.message}
        </div>
      )}

      {/* Add Staff Form */}
      <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
        <h2 className="text-lg font-bold text-slate-900">Add Staff Member</h2>
        <form action={createStaff} className="mt-4 grid gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
            <input name="name" required
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Full name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input name="email" type="email"
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="email@example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <input name="role"
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="e.g. Accountant, Bookkeeper" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Charge-out Rate (£/hr)</label>
            <input name="charge_out_rate" type="number" step="0.01" min="0"
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="e.g. 75" />
          </div>
          <div className="md:col-span-4">
            <button type="submit"
              className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
              Add Staff Member
            </button>
          </div>
        </form>
      </div>

      {/* Active Staff */}
      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
        <h2 className="text-lg font-bold text-slate-900">
          Active Staff ({activeStaff.length})
        </h2>
        <div className="mt-4 space-y-3">
          {activeStaff.map((member) => renderMember(member, false))}
          {activeStaff.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">
              No staff yet. Add your first team member above.
            </p>
          )}
        </div>
      </div>

      {/* Inactive Staff */}
      {inactiveStaff.length > 0 && (
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            Inactive Staff ({inactiveStaff.length})
          </h2>
          <div className="mt-4 space-y-3">
            {inactiveStaff.map((member) => renderMember(member, true))}
          </div>
        </div>
      )}
    </div>
  );
}
