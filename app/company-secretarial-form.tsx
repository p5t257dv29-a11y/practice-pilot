"use client";

import { useState } from "react";

interface Client {
  id: string;
  client_name: string;
}

interface Officer {
  id: string;
  client_id: string;
  name: string;
}

interface Shareholding {
  id: string;
  client_id: string;
  shareholder_name: string;
}

const DIRECTOR_EVENTS = ["Director Appointed", "Director Resigned", "Director Details Changed"];
const SHARE_ALLOTMENT_EVENTS = ["Shares Allotted"];
const SHARE_TRANSFER_EVENTS = ["Shares Transferred"];
const OFFICE_EVENTS = ["Registered Office Changed"];

export default function CompanySecretarialForm({
  clients,
  officers,
  shareholdings,
  eventTypes,
  createAction,
}: {
  clients: Client[];
  officers: Officer[];
  shareholdings: Shareholding[];
  eventTypes: string[];
  createAction: (formData: FormData) => Promise<void>;
}) {
  const [eventType, setEventType] = useState("");
  const [clientId, setClientId] = useState("");

  const isDirectorEvent = DIRECTOR_EVENTS.includes(eventType);
  const isExistingDirectorEvent = eventType === "Director Resigned" || eventType === "Director Details Changed";
  const isAllotment = SHARE_ALLOTMENT_EVENTS.includes(eventType);
  const isTransfer = SHARE_TRANSFER_EVENTS.includes(eventType);
  const isShareEvent = isAllotment || isTransfer;
  const isOfficeEvent = OFFICE_EVENTS.includes(eventType);

  const clientOfficers = officers.filter((o) => o.client_id === clientId);
  const clientShareholders = shareholdings.filter((s) => s.client_id === clientId);
  // De-duplicate shareholder names for the "allotted/transferred to" suggestions list
  const clientShareholderNames = Array.from(new Set(clientShareholders.map((s) => s.shareholder_name)));

  return (
    <form action={createAction} className="mt-6 grid gap-4 md:grid-cols-2">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
        <select name="client_id" required value={clientId} onChange={(e) => setClientId(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
          <option value="">Select a client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.client_name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Event Type *</label>
        <select name="event_type" required value={eventType} onChange={(e) => setEventType(e.target.value)}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white">
          <option value="">Select event type</option>
          {eventTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Event Date *</label>
        <input name="event_date" type="date" required
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
      </div>
      <div></div>

      {/* Director fields */}
      {isDirectorEvent && (
        <div className="md:col-span-2 rounded-xl border border-slate-100 p-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Director Details</p>
          {isExistingDirectorEvent ? (
            <>
              {!clientId ? (
                <p className="text-xs text-slate-400">Select a client above to see their current directors.</p>
              ) : clientOfficers.length === 0 ? (
                <p className="text-xs text-slate-400">No active directors on record for this client.</p>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Director *</label>
                  <select name="officer_id" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select current director</option>
                    {clientOfficers.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  {eventType === "Director Resigned" && (
                    <p className="text-xs text-slate-400 mt-1">This will mark them as resigned on the client's Directors record too.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Director Name *</label>
              <input name="director_name" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. Jane Doe" />
            </div>
          )}
        </div>
      )}

      {/* Registered office field */}
      {isOfficeEvent && (
        <div className="md:col-span-2 rounded-xl border border-slate-100 p-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Registered Office</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Registered Office *</label>
            <input name="new_address" required
              className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Full new address — updates the client record automatically" />
          </div>
        </div>
      )}

      {/* Share fields */}
      {isShareEvent && (
        <div className="md:col-span-2 rounded-xl border border-slate-100 p-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Share {isTransfer ? "Transfer" : "Allotment"} Details
          </p>
          <datalist id="shareholder-suggestions">
            {clientShareholderNames.map((name) => <option key={name} value={name} />)}
          </datalist>
          <div className="grid gap-4 md:grid-cols-2">
            {isTransfer && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Transferred From *</label>
                {clientId && clientShareholders.length > 0 ? (
                  <select name="transferred_from" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="">Select current shareholder</option>
                    {clientShareholderNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <input name="transferred_from" required
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder={clientId ? "No shareholders on record — type name" : "Select a client first"} />
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {isTransfer ? "Transferred To *" : "Allotted To *"}
              </label>
              <input name="shareholder_name" required list="shareholder-suggestions"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Existing or new shareholder name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Share Class</label>
              <input name="share_class" defaultValue="Ordinary"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Number of Shares *</label>
              <input name="number_of_shares" type="number" step="1" min="1" required
                className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Price Per Share (£)</label>
              <input name="price_per_share" type="number" step="0.0001" min="0"
                className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Nominal or paid value" />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Note: this logs the transaction but doesn't automatically recalculate shareholding percentages — update the Shareholdings tab on the client record separately.
          </p>
        </div>
      )}

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {isDirectorEvent || isShareEvent || isOfficeEvent ? "Additional Notes" : "Details *"}
        </label>
        <textarea name="details" required={!isDirectorEvent && !isShareEvent && !isOfficeEvent} rows={2}
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          placeholder={isDirectorEvent || isShareEvent || isOfficeEvent ? "Anything else worth noting" : "e.g. PSC ceased to have significant control"} />
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input name="filed" type="checkbox" className="w-4 h-4 rounded" />
          <span className="text-sm font-medium text-slate-700">Already filed at Companies House</span>
        </label>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Filed Date (if applicable)</label>
        <input name="filed_date" type="date"
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
      </div>

      <div className="md:col-span-2">
        <button type="submit"
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
          Log Event
        </button>
      </div>
    </form>
  );
}
