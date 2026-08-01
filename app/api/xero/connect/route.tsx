import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(request: NextRequest) {
  const state = crypto.randomBytes(16).toString("hex");

  const scopes = [
    "openid",
    "profile",
    "email",
    "accounting.transactions",
    "accounting.contacts",
    "offline_access",
  ].join(" ");

  const authUrl = new URL("https://login.xero.com/identity/connect/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", process.env.XERO_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", process.env.XERO_REDIRECT_URI!);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  // Store state in a short-lived cookie so the callback can verify it matches,
  // protecting against CSRF on the OAuth redirect.
  response.cookies.set("xero_oauth_state", state, {
    httpOnly: true,
    secure: true,
    maxAge: 600,
    path: "/",
  });

  return response;
}