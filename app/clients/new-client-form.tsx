"use client";

import { useState, useCallback } from "react";

interface Officer {
  name: string;
  role: string;
  appointed_on: string | null;
  resigned_on: string | null;
  nationality: string | null;
  country_of_residence: string | null;
  date_of_birth_month: number | null;
  date_of_birth_year: number | null;
  address: string;
  is_active: boolean;
}

interface PSC {
  name: string;
  nationality: string | null;
  country_of_residence: string | null;
  natures_of_control: string[];
  notified_on: string | null;
  ceased_on: string | null;
  date_of_birth_month: number | null;
  date_of_birth_year: number | null;
  address: string;
  is_active: boolean;
}

interface CHData {
  company_name: string;
  company_number: string;
  company_status: string;
  entity_type: string;
  address: string;
  incorporation_date: string | null;
  sic_codes: string[];
  accounts_next_due: string | null;
  accounts_last_made_up: string | null;
  confirmation_statement_next_due: string | null;
  confirmation_statement_last_made_up: string | null;
  officers: Officer[];
  pscs: PSC[];
}

export default function NewClientForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [companyNumber, setCompanyNumber] = useState("");
  const [chData, setChData] = useState<CHData | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [entityType, setEntityType] = useState("");
  const [yearEnd, setYearEnd] = useState("");
  const [lookupStatus, setLookupStatus] = useState<"idle" | "loading" | "found" | "not_found" | "error">("idle");

  const lookupCompany = useCallback(async (number: string) => {
    const clean = number.replace(/\s/g, "");
    if (clean.length < 7) return;

    setLookupStatus("loading");

    try {
      const res = await fetch(`/api/companies-house?number=${clean}`);
      if (!res.ok) {
        setLookupStatus("not_found");
        return;
      }

      const data: CHData = await res.json();
      setChData(data);
      setCompanyName(data.company_name || "");
      setAddress(data.address || "");
      setEntityType(data.entity_type || "");
      // Year end from last accounts made up date
      if (data.accounts_last_made_up) {
        setYearEnd(data.accounts_last_made_up);
      }
      setLookupStatus("found");
    } catch {
      setLookupStatus("error");
    }
  }, []);

  const handleCompanyNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCompanyNumber(value);
    setLookupStatus("idle");
    setChData(null);
    lookupCompany(value);
  };

  const activeOfficers = chData?.officers.filter(o => o.is_active) || [];
  const activePSCs = chData?.pscs.filter(p => p.is_active) || [];

  return (
    <form action={action} className="mt-6">
      {/* Hidden fields for CH data */}
      {chData && (
        <>
          <input type="hidden" name="company_status" value={chData.company_status || ""} />
          <input type="hidden" name="incorporation_date" value={chData.incorporation_date || ""} />
          <input type="hidden" name="accounts_next_due" value={chData.accounts_next_due || ""} />
          <input type="hidden" name="accounts_last_made_up" value={chData.accounts_last_made_up || ""} />
          <input type="hidden" name="confirmation_statement_next_due" value={chData.confirmation_statement_next_due || ""} />
          <input type="hidden" name="confirmation_statement_last_made_up" value={chData.confirmation_statement_last_made_up || ""} />
          <input type="hidden" name="sic_codes" value={chData.sic_codes?.join(",") || ""} />
          <input type="hidden" name="officers_json" value={JSON.stringify(chData.officers)} />
          <input type="hidden" name="pscs_json" value={JSON.stringify(chData.pscs)} />
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">

        {/* Company Number with lookup */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Company Number
          </label>
          <div className="relative">
            <input
              name="company_number"
              value={companyNumber}
              onChange={handleCompanyNumberChange}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="e.g. 12345678"
            />
            {lookupStatus === "loading" && (
              <span className="absolute right-3 top-3 text-xs text-slate-400">Looking up...</span>
            )}
            {lookupStatus === "found" && (
              <span className="absolute right-3 top-3 text-xs text-green-600">✓ Found</span>
            )}
            {lookupStatus === "not_found" && (
              <span className="absolute right-3 top-3 text-xs text-red-500">Not found</span>
            )}
          </div>
        </div>

        {/* Client Name */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Client Name *
          </label>
          <input
            name="client_name"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Auto-filled from Companies House or enter manually"
          />
        </div>

        {/* Entity Type */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Entity Type
          </label>
          <select
            name="entity_type"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">Select entity type</option>
            <option>Limited Company</option>
            <option>Sole Trader</option>
            <option>Partnership</option>
            <option>LLP</option>
          </select>
        </div>

        {/* Year End */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Year End {chData?.accounts_last_made_up && <span className="text-green-600 text-xs">(auto-filled)</span>}
          </label>
          <input
            name="year_end"
            type="date"
            value={yearEnd}
            onChange={(e) => setYearEnd(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        {/* Address */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Registered Address {chData?.address && <span className="text-green-600 text-xs">(auto-filled)</span>}
          </label>
          <textarea
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Auto-filled from Companies House or enter manually"
          />
        </div>

        {/* Filing Deadlines - shown when CH data is available */}
        {chData && (
          <div className="md:col-span-2 rounded-xl bg-blue-50 border border-blue-100 p-4">
            <p className="text-sm font-bold text-blue-900 mb-3">📅 Filing Deadlines from Companies House</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-blue-600 font-medium">Accounts Next Due</p>
                <p className="text-slate-900 font-semibold">
                  {chData.accounts_next_due
                    ? new Date(chData.accounts_next_due).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-medium">Confirmation Statement Due</p>
                <p className="text-slate-900 font-semibold">
                  {chData.confirmation_statement_next_due
                    ? new Date(chData.confirmation_statement_next_due).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-medium">Last Accounts Made Up To</p>
                <p className="text-slate-900 font-semibold">
                  {chData.accounts_last_made_up
                    ? new Date(chData.accounts_last_made_up).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-blue-600 font-medium">Company Status</p>
                <p className="text-slate-900 font-semibold capitalize">{chData.company_status || "—"}</p>
              </div>
            </div>
          </div>
        )}

        {/* Officers preview */}
        {activeOfficers.length > 0 && (
          <div className="md:col-span-2 rounded-xl bg-slate-50 border border-slate-100 p-4">
            <p className="text-sm font-bold text-slate-900 mb-3">
              👤 Directors / Officers ({activeOfficers.length} active)
            </p>
            <div className="space-y-2">
              {activeOfficers.map((officer, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-900">{officer.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 capitalize">{officer.role?.replace(/-/g, " ")}</span>
                    {officer.appointed_on && (
                      <span className="text-xs text-slate-400">
                        Appointed {new Date(officer.appointed_on).toLocaleDateString("en-GB")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">These will be saved when you create the client.</p>
          </div>
        )}

        {/* PSCs preview */}
        {activePSCs.length > 0 && (
          <div className="md:col-span-2 rounded-xl bg-slate-50 border border-slate-100 p-4">
            <p className="text-sm font-bold text-slate-900 mb-3">
              🏦 Persons with Significant Control ({activePSCs.length})
            </p>
            <div className="space-y-2">
              {activePSCs.map((psc, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium text-slate-900">{psc.name}</span>
                  {psc.natures_of_control?.length > 0 && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {psc.natures_of_control.map(n => n.replace(/-/g, " ")).join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">These will be saved when you create the client.</p>
          </div>
        )}

        {/* Rest of the form */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Primary Contact</label>
          <input name="primary_contact" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Full name" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Secondary Contact</label>
          <input name="secondary_contact" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Full name" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input name="email" type="email" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="email@example.com" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
          <input name="phone" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. 01234 567890" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">HMRC UTR</label>
          <input name="hmrc_utr" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="10-digit UTR" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Corporation Tax Reference</label>
          <input name="corporation_tax_reference" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="CT reference" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">VAT Number</label>
          <input name="vat_number" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. GB123456789" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">PAYE Reference</label>
          <input name="paye_reference" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="PAYE reference" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Accounts Office Reference</label>
          <input name="accounts_office_reference" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Accounts office reference" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Payroll Contact</label>
          <input name="payroll_contact" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Full name" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
          <input name="industry" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. Construction" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Bookkeeping Software</label>
          <input name="bookkeeping_software" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. Xero, QuickBooks" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label>
          <input name="bank_name" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. Barclays" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Sort Code</label>
          <input name="sort_code" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="e.g. 12-34-56" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Bank Account Number</label>
          <input name="bank_account_number" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="8-digit account number" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Onboarding Status</label>
          <select name="onboarding_status" className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
            <option>Prospect</option>
            <option>Onboarding</option>
            <option>Active Client</option>
            <option>Inactive</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Authentication Notes</label>
          <textarea name="authentication_notes" rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Gateway credentials, security questions, etc." />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
          <textarea name="notes" rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Any additional notes about this client" />
        </div>

      </div>

      <button type="submit" className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
        Create Client
      </button>
    </form>
  );
}
