import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPortalRoute = pathname.startsWith("/portal");
  const isPortalUser = user?.user_metadata?.role === "portal";

  // Public bypass routes — never require auth
const isPublicBypass =
    pathname.startsWith("/q/") ||
    pathname.startsWith("/onboard/") ||
    pathname.startsWith("/sign/") ||
    pathname.startsWith("/p11d/approve/") ||
    pathname.startsWith("/portal/set-password");
  if (isPublicBypass) {
    return supabaseResponse;
  }

  // Not logged in
  if (!user) {
    if (isPortalRoute && pathname !== "/portal/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/portal/login";
      return NextResponse.redirect(url);
    }
    if (!isPortalRoute && pathname !== "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Logged in as a portal user — confine them to /portal/*
  if (isPortalUser) {
    if (!isPortalRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/portal/dashboard";
      return NextResponse.redirect(url);
    }
    if (pathname === "/portal/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/portal/dashboard";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Logged in as staff — keep them out of the portal area entirely
  if (isPortalRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Logged in and on the staff login page — redirect to dashboard
  if (pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};