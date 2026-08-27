import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "../api/caller";
import { SignIn, SignOutButton } from "../signin";
import styles from "../signin.module.css";

/**
 * One page for signing in, signing up and checking who you are.
 *
 * §2: nothing on Ariane requires an account. Searching, compiling a journey,
 * reading the graph and the coverage table all work signed out, and always
 * will. An account buys one thing, ten minutes on the voice line instead of
 * one, so the page says that rather than implying a wall.
 *
 * Dynamic because it reads the session cookie. It is one page; the rest of the
 * site stays static.
 */

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await currentUser();

  return (
    <div className={styles.page}>
      {user ? (
        <>
          <h1>You are signed in</h1>
          <p>
            As <b>{user.email}</b>. Voice calls run up to ten minutes.
          </p>
          <div className={styles.who}>
            <Link href="/voice" className="nav-cta">
              <span>Talk to Ariane</span>
              <span className="nav-cta-icon" aria-hidden>
                ↗
              </span>
            </Link>
            <SignOutButton />
          </div>
        </>
      ) : (
        <>
          <h1>Sign in or create an account</h1>
          <p>
            Enter your email and we will send a six digit code. No password. If you have not used Ariane before, the
            same code creates your account.
          </p>
          <SignIn autoFocus />
          <p className="small faint" style={{ marginTop: 18 }}>
            You do not need an account to search, open a service or build a journey. Signing in raises the voice line
            from one minute to ten.
          </p>
        </>
      )}
    </div>
  );
}
