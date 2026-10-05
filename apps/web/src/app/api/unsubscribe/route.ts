import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * Unsubscribe from newsletters, no sign-in (CAN-SPAM; RFC 8058).
 *
 *   POST /api/unsubscribe?t=<token>  — what mail apps send for one-click
 *                                       (List-Unsubscribe-Post), and what the
 *                                       button below submits.
 *   GET  /api/unsubscribe?t=<token>  — a page with that button. It changes
 *                                       nothing: link scanners open every link
 *                                       in an email, and must not unsubscribe
 *                                       anyone by doing so.
 *
 * Receipts and practice emails keep coming: they're about the family's own
 * place, not marketing. The answer is the same whether or not the token was
 * known, so the endpoint can't be used to test tokens.
 */

const page = (title: string, body: string) =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#fff7ed;color:#0f172a">
<main style="max-width:480px;margin:10vh auto;padding:28px;background:#fff;border-radius:20px;box-shadow:0 2px 0 #fed7aa">
<h1 style="margin:0 0 12px;font-size:24px">${title}</h1>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );

const TOKEN = /^[0-9a-f]{20,64}$/;

export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  if (!TOKEN.test(t)) return page("Link not recognised", "<p>This unsubscribe link isn't complete. Reply to any of our emails and we'll take you off the list.</p>");
  return page(
    "Unsubscribe from our newsletter?",
    `<p>You'll stop getting news and offers. Emails about your child's place, practices and payments will still come.</p>
<form method="post" action="/api/unsubscribe?t=${t}"><button type="submit" style="margin-top:12px;min-height:44px;padding:10px 20px;border:0;border-radius:12px;background:#ea580c;color:#fff;font-size:16px;font-weight:600">Unsubscribe</button></form>`
  );
}

export async function POST(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  if (TOKEN.test(t)) {
    const { error } = await createAdminSupabase().rpc("unsubscribe_marketing", { p_token: t, p_source: "email_unsubscribe" });
    if (error) {
      console.error("Unsubscribe failed", error.message);
      return page("Something went wrong", "<p>We couldn't record that just now. Please try again, or reply to any of our emails.</p>");
    }
  }
  return page("You're unsubscribed", "<p>You won't get any more newsletters or offers from us. Emails about your child's place, practices and payments will still come.</p>");
}
