import { redirect } from "next/navigation";
import { adminUser } from "../../../admin/session";
import { setServicePaused } from "../../../pause";

/**
 * POST /api/admin/pause — show or clear the credits notice.
 *
 * A plain form, not a client. The admin cookie is SameSite=Strict, and the
 * origin is checked as well, so a page on another site cannot flip this.
 * A browser that is not signed in is sent to the login page, the same as
 * every other admin route.
 */

export const dynamic = "force-dynamic";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function backTo(request: Request): string {
  const referer = request.headers.get("referer");
  if (!referer) return "/admin";
  try {
    const url = new URL(referer);
    if (url.host !== request.headers.get("host")) return "/admin";
    if (!url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/")) return "/admin";
    return url.pathname;
  } catch {
    return "/admin";
  }
}

export async function POST(request: Request) {
  const user = await adminUser();
  if (!user) redirect("/admin/login");
  if (!sameOrigin(request)) redirect("/admin");

  const form = await request.formData();
  const paused = form.get("paused");
  if (paused !== "0" && paused !== "1") redirect("/admin");

  const result = await setServicePaused(paused === "1", user);
  if (result !== "ok") redirect(`/admin?pauseError=${result}`);
  redirect(backTo(request));
}
