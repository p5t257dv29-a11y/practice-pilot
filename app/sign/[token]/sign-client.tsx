"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface EngagementLetter {
  id: string;
  token: string;
  status: string;
  signed_at: string | null;
  client_email: string;
  services_description: string;
  fee_description: string;
  start_date: string | null;
  partner_name: string;
  custom_terms: string | null;
  clients: {
    client_name: string;
    address: string | null;
  };
}

export default function SignClient({ token }: { token: string }) {
  const [letter, setLetter] = useState<EngagementLetter | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function loadLetter() {
      const { data, error } = await supabase
        .from("engagement_letters")
        .select("*, clients(client_name, address)")
        .eq("token", token)
        .single();

      if (error || !data) {
        setError("This signing link is invalid or has expired.");
        setLoading(false);
        return;
      }

      setLetter(data);
      if (data.signed_at) setSigned(true);
      setLoading(false);
    }

    loadLetter();
  }, [token]);

  const handleSign = async () => {
    if (!agreed || !letter) return;
    setSigning(true);

    await supabase.from("engagement_letters").update({
      signed_at: new Date().toISOString(),
      status: "Signed",
    }).eq("token", token);

    setSigned(true);
    setSigning(false);
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

  if (signed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-3xl">
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Letter Signed!</h1>
          <p className="mt-2 text-slate-600">
            Thank you for signing your letter of engagement. We look forward to working with you.
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
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-sm font-bold">
              PP
            </div>
            <div>
              <h1 className="text-sm font-bold">E&P Accountancy Services</h1>
              <p className="text-xs text-slate-400">Letter of Engagement</p>
            </div>
          </div>
          <p className="text-sm text-slate-400">Please read and sign below</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-8">

        {/* Letter */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-8 text-sm text-slate-700 leading-relaxed space-y-5">

            <div className="text-right text-xs text-slate-400">
              {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </div>

            <div>
              <p className="font-bold text-slate-900">E&P Accountancy Services Limited</p>
              <p className="text-xs text-slate-500 mt-1">Letter of Engagement</p>
            </div>

            <div>
              <p className="font-semibold">{letter?.clients?.client_name}</p>
              {letter?.clients?.address && (
                <p className="text-slate-500 text-xs mt-0.5">{letter.clients.address}</p>
              )}
            </div>

            <p>Dear {letter?.clients?.client_name},</p>

            <p>
              We are pleased to confirm our appointment as your accountants and tax advisers
              {letter?.start_date && ` with effect from ${new Date(letter.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}.
              This letter sets out the terms of our engagement.
            </p>

            <div>
              <p className="font-semibold text-slate-900">Services</p>
              <p className="mt-1 whitespace-pre-line">{letter?.services_description}</p>
            </div>

            <div>
              <p className="font-semibold text-slate-900">Fees</p>
              <p className="mt-1 whitespace-pre-line">{letter?.fee_description}</p>
            </div>

            <div>
              <p className="font-semibold text-slate-900">Your Responsibilities</p>
              <p className="mt-1">
                You are responsible for maintaining adequate accounting records and for preparing
                accounts which give a true and fair view. You are also responsible for making
                available to us all information of which you are aware that is relevant to the
                preparation of the accounts.
              </p>
            </div>

            <div>
              <p className="font-semibold text-slate-900">Our Responsibilities</p>
              <p className="mt-1">
                We will prepare your accounts and tax returns using the information and
                explanations provided to us. We will not be responsible for errors arising
                from incorrect or incomplete information provided by you.
              </p>
            </div>

            <div>
              <p className="font-semibold text-slate-900">Confidentiality</p>
              <p className="mt-1">
                We confirm that we will keep your affairs strictly confidential and will not
                disclose information about your affairs to any third party without your consent,
                except where we are required to do so by law or professional regulations.
              </p>
            </div>

            <div>
              <p className="font-semibold text-slate-900">Termination</p>
              <p className="mt-1">
                Either party may terminate this engagement by giving one month's written notice.
                Any outstanding fees will be payable on termination.
              </p>
            </div>

            {letter?.custom_terms && (
              <div>
                <p className="font-semibold text-slate-900">Additional Terms</p>
                <p className="mt-1 whitespace-pre-line">{letter.custom_terms}</p>
              </div>
            )}

            <div className="border-t border-slate-200 pt-4">
              <p>Yours sincerely,</p>
              <br />
              <p className="font-semibold">{letter?.partner_name || "E&P Accountancy Services Limited"}</p>
            </div>
          </div>
        </div>

        {/* Signing section */}
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Sign this Letter</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            By signing below you confirm you have read and agree to the terms above.
          </p>

          <label className="flex items-start gap-3 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded"
            />
            <span className="text-sm text-slate-700">
              I confirm I have read and agree to the terms set out in this letter of engagement on behalf of <strong>{letter?.clients?.client_name}</strong>.
            </span>
          </label>

          <button
            onClick={handleSign}
            disabled={!agreed || signing}
            className="mt-4 w-full rounded-xl bg-green-600 px-6 py-3 text-sm font-bold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {signing ? "Signing..." : "✓ Sign Letter of Engagement"}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          This letter of engagement was prepared by E&P Accountancy Services Limited.
        </p>
      </div>
    </div>
  );
}
