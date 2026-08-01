import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get("xero_oauth_state")?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/integrations?xero_error=missing_code", request.url));
  }

  if (!state || state !== storedState) {
    console.error("Xero OAuth state mismatch — possible CSRF attempt or expired session.");
    return NextResponse.redirect(new URL("/integrations?xero_error=state_mismatch", request.url));
  }

  const basicAuth = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.XERO_REDIRECT_URI!,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("Xero token exchange failed:", errText);
    return NextResponse.redirect(new URL("/integrations?xero_error=token_exchange_failed", request.url));
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in } = tokenData;

  const connectionsRes = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!connectionsRes.ok) {
    console.error("Could not fetch Xero connections:", await connectionsRes.text());
    return NextResponse.redirect(new URL("/integrations?xero_error=connections_failed", request.url));
  }

  const connections = await connectionsRes.json();
  const tenant = connections[0];

  if (!tenant) {
    console.error("No Xero organisation returned from connections endpoint.");
    return NextResponse.redirect(new URL("/integrations?xero_error=no_tenant", request.url));
  }

  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  const { error: dbError } = await supabase.from("xero_connections").upsert(
    {
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName,
      access_token,
      refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" }
  );

  if (dbError) {
    console.error("Could not save Xero connection:", dbError.message);
    return NextResponse.redirect(new URL("/integrations?xero_error=save_failed", request.url));
  }

  const response = NextResponse.redirect(new URL("/integrations?xero_connected=1", request.url));
  response.cookies.delete("xero_oauth_state");
  return response;
}