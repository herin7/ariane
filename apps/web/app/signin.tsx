"use client";

import { useEffect, useState } from "react";
import { track } from "./analytics";
import styles from "./signin.module.css";

/**
 * The whole of Ariane's login. An email, the code it carries, done.
 *
 * There is no separate sign up, because with a one time code there is nothing
 * to sign up *with*: the first code sent to an address creates the account and
 * every code after it signs into the same one. One button is the honest number
 * of buttons, so the copy says both words rather than the UI offering two doors
 * to the same room.
 *
 * No password field, so there is no password to store, leak or reset. Nothing
 * here holds a token: the code is exchanged on the server and the session comes
 * back as an HttpOnly cookie this component cannot read. §8.
 *
 * Lifted out of `voice/talk.tsx`, where it was reachable only by a guest who
 * had already run out of minute. Same component, two places now.
 */

export function SignIn({ onSignedIn, autoFocus }: { onSignedIn?: (email: string) => void; autoFocus?: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    setNote(undefined);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await response.json()) as { error?: string; sent?: boolean; signedIn?: boolean; email?: string };
    } catch {
      return { error: "Could not reach the server. Try again." };
    } finally {
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <form
        className={styles.signin}
        onSubmit={async (event) => {
          event.preventDefault();
          track("login_started");
          const result = await post("/api/auth/otp", { email });
          if (result.error) setNote(result.error);
          else setSent(true);
        }}
      >
        <input
          type="email"
          required
          autoFocus={autoFocus}
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Sending" : "Continue with email"}
        </button>
        {note && <span className="small">{note}</span>}
      </form>
    );
  }

  return (
    <form
      className={styles.signin}
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await post("/api/auth/verify", { email, code });
        if (result.signedIn) {
          if (onSignedIn) onSignedIn(result.email ?? email);
          else window.location.assign("/");
        } else setNote(result.error ?? "That code was not right.");
      }}
    >
      {/* Six to ten digits, not six: the length is a Supabase project setting
          rather than a constant, and a pinned `\d{6}` rejects a valid code in
          the browser before the server ever sees it. Kept as a string all the
          way down, because a code like 09470715 loses its first digit the
          moment anything treats it as a number. */}
      <input
        inputMode="numeric"
        pattern="\d{6,10}"
        maxLength={10}
        required
        autoFocus
        autoComplete="one-time-code"
        placeholder="Code from your email"
        aria-label="The code from your email"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
      />
      <button type="submit" className="primary" disabled={busy}>
        Sign in
      </button>
      <span className="small faint">Sent to {email}</span>
      {note && <span className="small">{note}</span>}
      <button
        type="button"
        onClick={() => {
          setSent(false);
          setCode("");
          setNote(undefined);
        }}
      >
        Use a different address
      </button>
    </form>
  );
}

/**
 * The navbar's half of it: "Sign in" until we know otherwise, the address once
 * we do.
 *
 * A client fetch rather than reading the session in the layout, because the
 * layout renders every page and one `await currentUser()` in it would turn the
 * whole statically rendered site dynamic to change one word in a header. §15.
 * The link is right either way before the fetch lands; only the label improves.
 */
export function AuthLink() {
  const [email, setEmail] = useState<string | null>();

  useEffect(() => {
    let live = true;
    fetch("/api/auth")
      .then((response) => response.json())
      .then((body: { signedIn?: boolean; email?: string }) => {
        if (live) setEmail(body.signedIn ? (body.email ?? "") : null);
      })
      .catch(() => {
        if (live) setEmail(null);
      });
    return () => {
      live = false;
    };
  }, []);

  if (email === undefined || email === null) {
    return (
      <a className={styles.authLink} href="/signin">
        Sign in
      </a>
    );
  }

  return (
    <span className={styles.account}>
      <a href="/signin" title={email}>
        {email.split("@")[0] || "Account"}
      </a>
      <SignOutButton />
    </span>
  );
}

/**
 * A button, not a link. Signing out changes state, and a GET that changes state
 * is one browser prefetch away from doing it without being asked.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={styles.signout}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
        window.location.assign("/");
      }}
    >
      Sign out
    </button>
  );
}
