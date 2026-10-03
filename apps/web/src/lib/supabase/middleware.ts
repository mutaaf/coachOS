import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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
    data: { user: account },
  } = await supabase.auth.getUser();
  // An account without the admin role is treated as nobody: it can't open the
  // dashboard, which renders every family's details. See lib/admin.ts.
  const user = isAdmin(account) ? account : null;

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/api") &&
    // The registration page is deliberately public — parents sign up without an
    // account. It reads and writes only through server actions.
    !request.nextUrl.pathname.startsWith("/join") &&
    // Attendance sheets are opened by coaches, who have no account — the
    // passcode on the sheet itself is what guards them.
    !request.nextUrl.pathname.startsWith("/s/") &&
    // A family's payment page. Parents have no account; the long random token
    // in the URL is what scopes it to them.
    !request.nextUrl.pathname.startsWith("/pay/")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
