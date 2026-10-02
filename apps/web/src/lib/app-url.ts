/**
 * The address parents are sent to.
 *
 * Links built in the browser use `window.location.origin`, but payment links go
 * out from the cron and from webhooks, where there is no browser. `APP_URL`
 * wins when it is set; otherwise Vercel's production domain, which Vercel sets
 * on every deployment. Never a preview URL — a parent's link must keep working
 * after the next deploy.
 */
export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3050";
}

export function payLink(payToken: string): string {
  return `${appUrl()}/pay/${payToken}`;
}
