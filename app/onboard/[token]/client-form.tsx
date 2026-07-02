"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface OnboardingRequest {
  id: string;
  client_id: string;
  token: string;
  status: string;
  completed_at: string | null;
  clients: {
    client_name: string;
  };
}

export default function ClientOnboardForm({
  token,
}: {
  token: string;
}) {
  const [request, setRequest] = useState<OnboardingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    primary_contact: "",
    email: "",
    phone: "",
    address: "",
    hmrc_utr: "",
    corporation_tax_reference: "",
    vat_number: "",
    paye_reference: "",
    accounts_office_reference: "",
    bank_name: "",
    sort_code: "",
    bank_account_number: "",
    payroll_contact: "",
    bookkeeping_software: "",
    notes: "",
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function loadRequest() {
      const { data, error } = await supabase
        .from("onboarding_requests")
        .select("*, clients(client_name)")
        .eq("token", token)
        .single();

      if (error || !data) {
        setError("This onboarding link is invalid or has expired.");
        setLoading(false);
        return;
      }

      setRequest(data);
      if (data.completed_at) setSubmitted(true);
      setLoading(false);
    }

    loadRequest();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    // Update the client record with the new info
    if (request?.client_id) {
      await supabase.from("clients").update({
        primary_contact: form.primary_contact,
        email: form.email,
        phone: form.phone,
        address: form.address || undefined,
        hmrc_utr: form.hmrc_utr,
        corporation_tax_reference: form.corporation_tax_reference,
        vat_number: form.vat_number,
        paye_reference: form.paye_reference,
        accounts_office_reference: form.accounts_office_reference,
        bank_name: form.bank_name,
        sort_code: form.sort_code,
        bank_account_number: form.bank_account_number,
        payroll_contact: form.payroll_contact,
        bookkeeping_software: form.bookkeeping_software,
      }).eq("id", request.client_id);
    }

    // Mark onboarding as complete
    await supabase.from("onboarding_requests").update({
      completed_at: new Date().toISOString(),
      status: "Complete",
    }).eq("token", token);

    setSubmitted(true);
    setSubmitting(false);
  };

  const update = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-600 font-semibold">{error}</p>
          <p className="text-slate-500 text-sm mt-2">Please contact your accountant for a new link.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-3xl">
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Thank you!</h1>
          <p className="mt-2 text-slate-600">
            Your information has been submitted successfully. We'll be in touch shortly.
          </p>
          <p className="mt-4 text-sm text-slate-400">E&P Accountancy Services Limited</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-slate-900 text-white px-8 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-sm font-bold">
              PP
            </div>
            <div>
              <h1 className="text-sm font-bold">E&P Accountancy Services</h1>
              <p className="text-xs text-slate-400">Client Onboarding</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900">
            Welcome, {request?.clients?.client_name}
          </h2>
          <p className="mt-2 text-slate-600">
            Please fill in the form below so we can get your account set up. 
            All information is kept securely and confidentially.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Contact Details */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Contact Details</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Primary Contact Name *</label>
                <input required value={form.primary_contact} onChange={e => update("primary_contact", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="Full name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address *</label>
                <input required type="email" value={form.email} onChange={e => update("email", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="email@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                <input value={form.phone} onChange={e => update("phone", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="e.g. 01234 567890" />
              </div>
            </div>
          </div>

          {/* HMRC & Tax References */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-1">HMRC & Tax References</h3>
            <p className="text-sm text-slate-500 mb-4">Please provide as many as you have available.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">HMRC UTR</label>
                <input value={form.hmrc_utr} onChange={e => update("hmrc_utr", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="10-digit UTR number" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Corporation Tax Reference</label>
                <input value={form.corporation_tax_reference} onChange={e => update("corporation_tax_reference", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="CT reference" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">VAT Number</label>
                <input value={form.vat_number} onChange={e => update("vat_number", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="e.g. GB123456789" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">PAYE Reference</label>
                <input value={form.paye_reference} onChange={e => update("paye_reference", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="PAYE reference" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Accounts Office Reference</label>
                <input value={form.accounts_office_reference} onChange={e => update("accounts_office_reference", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="Accounts office reference" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Payroll Contact</label>
                <input value={form.payroll_contact} onChange={e => update("payroll_contact", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="Name of payroll contact" />
              </div>
            </div>
          </div>

          {/* Banking */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Banking Details</h3>
            <p className="text-sm text-slate-500 mb-4">Required for payroll and payment processing.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label>
                <input value={form.bank_name} onChange={e => update("bank_name", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="e.g. Barclays" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sort Code</label>
                <input value={form.sort_code} onChange={e => update("sort_code", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="e.g. 12-34-56" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Account Number</label>
                <input value={form.bank_account_number} onChange={e => update("bank_account_number", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="8-digit account number" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Bookkeeping Software</label>
                <input value={form.bookkeeping_software} onChange={e => update("bookkeeping_software", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="e.g. Xero, QuickBooks" />
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Anything Else?</h3>
            <textarea value={form.notes} onChange={e => update("notes", e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Any other information you'd like us to know..." />
          </div>

          <button type="submit" disabled={submitting}
            className="w-full rounded-xl bg-slate-900 px-6 py-4 text-sm font-bold text-white hover:bg-slate-700 transition-colors disabled:opacity-50">
            {submitting ? "Submitting..." : "Submit Information"}
          </button>

          <p className="text-center text-xs text-slate-400">
            Your information is kept securely and confidentially by E&P Accountancy Services Limited.
          </p>
        </form>
      </div>
    </div>
  );
}
