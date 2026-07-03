import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const { letterId } = await request.json();

  if (!letterId) {
    return NextResponse.json({ error: "Missing letter ID" }, { status: 400 });
  }

  const { data: letter, error } = await supabase
    .from("engagement_letters")
    .select("*, clients(client_name)")
    .eq("id", letterId)
    .single();

  if (error || !letter) {
    return NextResponse.json({ error: "Letter not found" }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const signingUrl = `${baseUrl}/sign/${letter.token}`;

  const { error: emailError } = await resend.emails.send({
    from: "PracticePilot <onboarding@resend.dev>",
    to: letter.client_email,
    subject: `Letter of Engagement — ${letter.clients?.client_name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">Letter of Engagement</h2>
        <p>Dear ${letter.clients?.client_name},</p>
        <p>Please find your letter of engagement from E&P Accountancy Services Limited.</p>
        <p>Please click the button below to review and sign your letter of engagement.</p>
        
        <div style="margin: 30px 0;">
          <a href="${signingUrl}" 
             style="display: inline-block; background: #0f172a; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            Review &amp; Sign Letter
          </a>
        </div>

        <p style="color: #64748b; font-size: 14px;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="color: #3b82f6; font-size: 14px; word-break: break-all;">${signingUrl}</p>

        <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
          Kind regards,<br>
          E&P Accountancy Services Limited
        </p>
      </div>
    `,
  });

  if (emailError) {
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  // Mark as sent
  await supabase
    .from("engagement_letters")
    .update({ sent_at: new Date().toISOString(), status: "Sent" })
    .eq("id", letterId);

  return NextResponse.json({ success: true, signingUrl });
}
