"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "../admin.module.css";

/**
 * The admin sign-in form.
 *
 * The only client component in the panel, and it holds nothing but two input
 * values. The credentials go straight to `/api/admin/login` and what comes back
 * is a cookie this file cannot read. §11: nothing about admin auth reaches
 * client JavaScript, including whether the username was the wrong half.
 */
export default function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  return (
    <div className="container">
      <form
        className={styles.login}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setNote(undefined);
          try {
            const response = await fetch("/api/admin/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ username, password }),
            });
            const body = (await response.json()) as { signedIn?: boolean; error?: string };
            if (body.signedIn) {
              router.replace("/admin");
              router.refresh();
              return;
            }
            setNote(body.error ?? "That username and password did not match.");
          } catch {
            setNote("Could not reach the server.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22 }}>Ariane admin</h1>
        <input
          required
          autoComplete="username"
          placeholder="Username"
          aria-label="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Checking" : "Sign in"}
        </button>
        {note && (
          <p className="small" role="status" style={{ color: "var(--bad)", margin: 0 }}>
            {note}
          </p>
        )}
      </form>
    </div>
  );
}
