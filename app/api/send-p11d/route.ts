import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";
import { calculateP11D } from "../../p11d/page";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const { computationId, clientEmail } = await request.json();

  if (!computationId || !clientEmail) {
    return NextResponse.json(
      { error: "Missing computation ID or client email" },
      { status: 400 }
    );
  }

  const token = crypto.randomBytes(32).toString("hex");

  const { data: comp, error } = await supabase
    .from("p11d_computations")
    .select("*, clients(client_name)")
    .eq("id", computationId)
    .single();

  if (error || !comp) {
    return NextResponse.json({ error: "P11D computation not found" }, { status: 404 });
  }

  await supabase
    .from("p11d_computations")
    .update({ token, client_email: clientEmail, status: "Sent" })
    .eq("id", computationId);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const computationUrl = `${baseUrl}/p11d/approve/${token}`;

  const result = calculateP11D({
    carListPrice: Number(comp.car_list_price),
    carBenefitPercentage: Number(comp.car_benefit_percentage),
    carCapitalContribution: Number(comp.car_capital_contribution),
    carAvailableDays: Number(comp.car_available_days),
    fuelProvided: comp.fuel_provided,
    fuelBenefitMultiplier: Number(comp.fuel_benefit_multiplier),
    medicalPremium: Number(comp.medical_premium),
    medicalEmployeeContribution: Number(comp.medical_employee_contribution),
    loanBalance: Number(comp.loan_balance),
    loanInterestPaid: Number(comp.loan_interest_paid),
    officialRateOfInterest: Number(comp.official_rate_of_interest),
    otherBenefitsAmount: Number(comp.other_benefits_amount),
  });

  const { error: emailError } = await resend.emails.send({
    from: "PracticePilot <onboarding@resend.dev>",
    to: clientEmail,
    subject: `P11D Benefits Summary (${comp.tax_year}) — ${comp.employee_name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a;">P11D — ${comp.employee_name}</h2>
        <p>Dear ${comp.clients?.client_name || "Client"},</p>
        <p>Please find the P11D benefits-in-kind summary for ${comp.employee_name} (${comp.tax_year}) below. You can review the full breakdown and approve it by clicking the button below.</p>

        <div style="margin: 30px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Tax Year</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">${comp.tax_year}</td>
            </tr>
            <tr>
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Total Benefits</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">£${result.totalBenefits.toFixed(2)}</td>
            </tr>
            <tr style="background: #f8fafc;">
              <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Class 1A NIC (Employer)</td>
              <td style="padding: 12px; border: 1px solid #e2e8f0;">£${result.class1ANIC.toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <a href="${computationUrl}"
           style="display: inline-block; background: #0f172a; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View &amp; Approve P11D
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

  return NextResponse.json({ success: true, computationUrl });
}