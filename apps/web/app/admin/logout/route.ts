import { NextResponse } from "next/server";
import { endAdminSession } from "../session";

/**
 * GET /admin/logout — clear the cookie, go to the sign-in page.
 *
 * A link rather than a form because the cookie is SameSite=Strict: no other
 * origin can make a browser send it, so there is nothing here for a forged
 * request to reach, and the worst a forged one could do is sign somebody out.
 */
export async function GET(request: Request) {
  await endAdminSession();
  return NextResponse.redirect(new URL("/admin/login", request.url));
}
