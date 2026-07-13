import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const { trialBalanceId, accountsType, clientEmail } = await request.json();

  if (!trialBalanceId || !accountsType || !clientEmail) {
    return NextResponse.json(
      { error: "Missing trial balance ID, accounts type, or client email" },
      { status: 400 }
    );
  }

  const token = crypto.randomBytes(32).toString("hex");

  const { data: tb, error } = await supabase
    .from("trial_balances")
    .select("*, clients(client_name)")
    .eq("id", trialBalanceId)
    .single();

  if (error || !tb) {
    return NextResponse.json({ error: "Trial balance not found" }, { status: 404 });
  }

  await supabase
    .from("trial_balances")
    .update({
      approval_token: token,
      accounts_type: accountsType,
      approval_client_email: clientEmail,
      approval_status: "Sent",
    })
    .eq("id", trialBalanceId);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const accountsUrl = `${baseUrl}/a/${token}`;
  const periodEndFormatted = new Date(tb.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const { error: emailError } = await resend.emails.send({
    from: "PracticePilot <onboarding@resend.dev>",
    to: clientEmail,
    subject: `Your Accounts for the Year Ended ${periodEndFormatted} — E&P Accountancy Services`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">Financial Statements — Year Ended ${periodEndFormatted}</h2>
        <p>Dear ${tb.clients?.client_name || "Client"},</p>
        <p>Please find your accounts summary ready for review. You can view the full breakdown and approve it by clicking the button below.</p>

        <div style="margin: 30px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Company</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">${tb.clients?.client_name || ""}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Year Ended</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">${periodEndFormatted}</td>
            </tr>
          </table>
        </div>

        <a href="${accountsUrl}"
           style="display: inline-block; background: #0f172a; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View &amp; Approve Accounts
        </a>

        <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
          Please review the figures carefully and let us know if anything looks incorrect before we proceed to file.
        </p>
        <p style="color: #64748b; font-size: 14px;">
          Kind regards,<br>
          E&P Accountancy Services
        </p>
      </div>
    `,
  });

  if (emailError) {
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, accountsUrl });
}
