import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createService(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  await supabase.from("services").insert({
    service_name: get("service_name"),
    description: get("description"),
    default_price: parseFloat(get("default_price")) || 0,
    vat_rate: parseFloat(get("vat_rate")) || 20,
    job_template: get("job_template"),
    is_active: true,
  });
  revalidatePath("/services");
}

async function updateService(id: string, formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();
  await supabase.from("services").update({
    service_name: get("service_name"),
    description: get("description"),
    default_price: parseFloat(get("default_price")) || 0,
    vat_rate: parseFloat(get("vat_rate")) || 20,
    job_template: get("job_template"),
  }).eq("id", id);
  revalidatePath("/services");
}

async function toggleActive(id: string, current: boolean) {
  "use server";
  await supabase.from("services").update({ is_active: !current }).eq("id", id);
  revalidatePath("/services");
}

async function deleteService(id: string) {
  "use server";
  await supabase.from("services").delete().eq("id", id);
  revalidatePath("/services");
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;

  const { data: services, error } = await supabase
    .from("services")
    .select("*")
    .order("service_name", { ascending: true });

  const activeServices = services?.filter((s) => s.is_active) || [];
  const inactiveServices = services?.filter((s) => !s.is_active) || [];

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Services</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage your practice service price list.
          </p>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load services: {error.message}
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-3">

          {/* Add Service Form */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 sticky top-8">
              <h2 className="text-lg font-bold text-slate-900">Add Service</h2>
              <p className="text-sm text-slate-500 mt-0.5">Add to your price list.</p>

              <form action={createService} className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Service Name *</label>
                  <input name="service_name" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="e.g. Year End Accounts" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea name="description" rows={2}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Brief description" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Default Price (£)</label>
                  <input name="default_price" type="number" defaultValue="0" step="0.01" min="0"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">VAT Rate</label>
                  <select name="vat_rate"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="20">20% Standard</option>
                    <option value="5">5% Reduced</option>
                    <option value="0">0% Zero rated</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Job Type Link</label>
                  <select name="job_template"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">None</option>
                    <option>Year End Accounts</option>
                    <option>Corporation Tax Return</option>
                    <option>VAT Return</option>
                    <option>Payroll</option>
                    <option>Self Assessment</option>
                    <option>Bookkeeping</option>
                    <option>Management Accounts</option>
                    <option>Companies House Filing</option>
                  </select>
                </div>

                <button type="submit"
                  className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Add Service
                </button>
              </form>
            </div>
          </div>

          {/* Services List */}
          <div className="lg:col-span-2 space-y-6">

            {/* Active Services */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                Active Services ({activeServices.length})
              </h2>

              <div className="mt-4 space-y-3">
                {activeServices.map((service) => (
                  <div key={service.id} className="rounded-xl border border-slate-100">

                    {/* Service row */}
                    <div className="flex items-center justify-between p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{service.service_name}</p>
                          {service.job_template && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600 font-medium">
                              {service.job_template}
                            </span>
                          )}
                        </div>
                        {service.description && (
                          <p className="text-xs text-slate-500 mt-0.5">{service.description}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">VAT: {service.vat_rate}%</p>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-bold text-slate-900">£{Number(service.default_price).toFixed(2)}</p>
                          <p className="text-xs text-slate-400">default price</p>
                        </div>

                        <div className="flex gap-2">
                          <a
                            href={edit === service.id ? "/services" : `/services?edit=${service.id}`}
                            className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
                          >
                            {edit === service.id ? "Cancel" : "Edit"}
                          </a>
                          <form action={toggleActive.bind(null, service.id, service.is_active)}>
                            <button className="rounded-lg bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-600 hover:bg-yellow-100 transition-colors">
                              Deactivate
                            </button>
                          </form>
                          <form action={deleteService.bind(null, service.id)}>
                            <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                              Delete
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>

                    {/* Inline edit form */}
                    {edit === service.id && (
                      <div className="border-t border-slate-100 p-4 bg-slate-50 rounded-b-xl">
                        <h3 className="text-sm font-bold text-slate-900 mb-4">Edit Service</h3>
                        <form action={updateService.bind(null, service.id)} className="grid gap-4 md:grid-cols-2">

                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Service Name *</label>
                            <input name="service_name" required defaultValue={service.service_name}
                              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white" />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Default Price (£)</label>
                            <input name="default_price" type="number" step="0.01" min="0"
                              defaultValue={service.default_price}
                              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white" />
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                            <textarea name="description" rows={2} defaultValue={service.description || ""}
                              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white" />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">VAT Rate</label>
                            <select name="vat_rate" defaultValue={service.vat_rate}
                              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                              <option value="20">20% Standard</option>
                              <option value="5">5% Reduced</option>
                              <option value="0">0% Zero rated</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Job Type Link</label>
                            <select name="job_template" defaultValue={service.job_template || ""}
                              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
                              <option value="">None</option>
                              <option>Year End Accounts</option>
                              <option>Corporation Tax Return</option>
                              <option>VAT Return</option>
                              <option>Payroll</option>
                              <option>Self Assessment</option>
                              <option>Bookkeeping</option>
                              <option>Management Accounts</option>
                              <option>Companies House Filing</option>
                            </select>
                          </div>

                          <div className="md:col-span-2 flex gap-3">
                            <button type="submit"
                              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                              Save Changes
                            </button>
                            <a href="/services"
                              className="rounded-xl bg-white border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                              Cancel
                            </a>
                          </div>

                        </form>
                      </div>
                    )}
                  </div>
                ))}

                {activeServices.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-6">
                    No active services yet. Add your first service.
                  </p>
                )}
              </div>
            </div>

            {/* Inactive Services */}
            {inactiveServices.length > 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">
                  Inactive Services ({inactiveServices.length})
                </h2>
                <div className="mt-4 space-y-3">
                  {inactiveServices.map((service) => (
                    <div key={service.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 p-4 opacity-60">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{service.service_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          £{Number(service.default_price).toFixed(2)} · VAT: {service.vat_rate}%
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <form action={toggleActive.bind(null, service.id, service.is_active)}>
                          <button className="rounded-lg bg-green-50 px-3 py-1 text-xs font-semibold text-green-600 hover:bg-green-100 transition-colors">
                            Reactivate
                          </button>
                        </form>
                        <form action={deleteService.bind(null, service.id)}>
                          <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
