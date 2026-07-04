"use client";

import { useState } from "react";
import NewClientForm from "./new-client-form";

interface Client {
  id: string;
  client_ref: string | null;
  client_name: string;
  entity_type: string | null;
  email: string | null;
  onboarding_status: string | null;
  accounts_next_due: string | null;
}

export default function ClientsPageClient({
  clients,
  error,
  createAction,
  deleteAction,
  autoOpen,
}: {
  clients: Client[];
  error?: string;
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  autoOpen?: boolean;
}) {
  const [showModal, setShowModal] = useState(autoOpen || false);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");

  const entityTypes = Array.from(
    new Set(clients.map((c) => c.entity_type).filter(Boolean))
  ) as string[];

  const filtered = clients.filter(c => {
    const matchesSearch =
      c.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.client_ref?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase());
    const matchesEntity = !entityFilter || c.entity_type === entityFilter;
    return matchesSearch && matchesEntity;
  });

  const handleCreate = async (formData: FormData) => {
    await createAction(formData);
    setShowModal(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {filtered.length} of {clients.length} client{clients.length !== 1 ? "s" : ""} in your practice
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            + Add Client
          </button>
        </div>

        {/* Search + Filter */}
        <div className="mt-4 flex gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, reference or email..."
            className="w-full max-w-md rounded-xl border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
          >
            <option value="">All entity types</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-100 p-3 text-sm text-red-700">
            Could not load clients: {error}
          </div>
        )}

        {/* Clients List */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100">

          {/* Table header */}
          <div className="grid grid-cols-5 gap-4 px-6 py-3 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <div>Reference</div>
            <div className="col-span-2">Client Name</div>
            <div>Status</div>
            <div>Actions</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-50">
            {filtered.map((client) => (
              <div key={client.id}
                className="grid grid-cols-5 gap-4 px-6 py-4 items-center hover:bg-slate-50 transition-colors">

                <div>
                  {client.client_ref ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {client.client_ref}
                    </span>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </div>

                <div className="col-span-2">
                  <a href={`/clients/${client.id}`}
                    className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-sm">
                    {client.client_name}
                  </a>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {client.entity_type || "No entity type"}
                    {client.email && ` · ${client.email}`}
                  </p>
                  {client.accounts_next_due && (
                    <p className="text-xs text-orange-500 mt-0.5">
                      Accounts due: {new Date(client.accounts_next_due).toLocaleDateString("en-GB")}
                    </p>
                  )}
                </div>

                <div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    client.onboarding_status === "Active Client" ? "bg-green-100 text-green-700"
                    : client.onboarding_status === "Prospect" ? "bg-blue-100 text-blue-700"
                    : client.onboarding_status === "Onboarding" ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-600"
                  }`}>
                    {client.onboarding_status || "Unknown"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <a href={`/clients/${client.id}`}
                    className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors">
                    View
                  </a>
                  <form action={deleteAction.bind(null, client.id)}>
                    <button className="rounded-lg bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="px-6 py-12 text-center">
                <p className="text-slate-500 text-sm">
                  {search || entityFilter
                    ? "No clients matching your search/filter."
                    : "No clients yet."}
                </p>
                {!search && !entityFilter && (
                  <button
                    onClick={() => setShowModal(true)}
                    className="mt-3 text-blue-600 text-sm hover:underline"
                  >
                    Add your first client →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 my-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Add New Client</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Enter a company number to auto-fill from Companies House.
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
              >
                ✕ Close
              </button>
            </div>
            <div className="p-6">
              <NewClientForm action={handleCreate} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
