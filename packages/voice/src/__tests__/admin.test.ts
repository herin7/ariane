import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_TTL_MS,
  hashPassword,
  issueAdminSession,
  openAdminSession,
  sameString,
  verifyPassword,
} from "../ops/admin";

/**
 * §11. The two things about the admin panel that are worth getting exactly
 * right: a password that only matches itself, and a cookie that only this
 * deployment's secret could have written.
 */

describe("the admin password", () => {
  const password = "a-long-enough-operator-password";
  const stored = hashPassword(password);

  it("is not the password", () => {
    expect(stored).not.toContain(password);
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
  });

  it("salts, so the same password hashes differently every time", () => {
    expect(hashPassword(password)).not.toBe(stored);
  });

  it("accepts the password", () => {
    expect(verifyPassword(password, stored)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(verifyPassword("A-long-enough-operator-password", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
    expect(verifyPassword(`${password} `, stored)).toBe(false);
  });

  it("refuses a hash somebody made up, rather than throwing", () => {
    for (const junk of ["", "x", "scrypt$$$$", "scrypt$16384$8$1$!!!$!!!", "plain$hunter2", "$$$$$"]) {
      expect(verifyPassword(password, junk)).toBe(false);
    }
  });

  it("refuses an absurd cost instead of hanging on it", () => {
    // A stored hash is trusted input today, but a hash that asks for 2^30
    // rounds is a way to take the login page down if that ever changes.
    const [, , r, p, salt, key] = hashPassword(password).split("$");
    expect(verifyPassword(password, `scrypt$1073741824$${r}$${p}$${salt}$${key}`)).toBe(false);
  });
});

describe("comparing two strings", () => {
  it("is true only for equal strings, whatever their lengths", () => {
    expect(sameString("admin", "admin")).toBe(true);
    expect(sameString("admin", "admins")).toBe(false);
    expect(sameString("admin", "")).toBe(false);
    expect(sameString("", "")).toBe(true);
  });
});

describe("the admin session cookie", () => {
  const secret = "a-session-secret-for-the-test";

  it("round trips a username", () => {
    expect(openAdminSession(issueAdminSession("root", secret), secret)).toBe("root");
  });

  it("is refused under a different secret, which is what rotation means", () => {
    expect(openAdminSession(issueAdminSession("root", secret), "rotated")).toBeUndefined();
  });

  it("cannot be forged by editing the payload", () => {
    const cookie = issueAdminSession("root", secret);
    const [, signature] = cookie.split(".");
    const forged = `${Buffer.from("root:99999999999999").toString("base64url")}.${signature}`;
    expect(openAdminSession(forged, secret)).toBeUndefined();
  });

  it("cannot be forged by dropping the signature", () => {
    const [payload] = issueAdminSession("root", secret).split(".");
    expect(openAdminSession(payload, secret)).toBeUndefined();
    expect(openAdminSession(`${payload}.`, secret)).toBeUndefined();
    expect(openAdminSession(`${payload}.x`, secret)).toBeUndefined();
  });

  it("expires", () => {
    const cookie = issueAdminSession("root", secret, 1_000);
    expect(openAdminSession(cookie, secret, 1_000 + ADMIN_SESSION_TTL_MS - 1)).toBe("root");
    expect(openAdminSession(cookie, secret, 1_000 + ADMIN_SESSION_TTL_MS)).toBeUndefined();
    expect(openAdminSession(cookie, secret, 1_000 + ADMIN_SESSION_TTL_MS + 60_000)).toBeUndefined();
  });

  it("refuses everything when the deployment has no secret", () => {
    // Otherwise an unconfigured deployment signs with "" and every cookie is
    // valid, which is the worst possible default.
    expect(openAdminSession(issueAdminSession("root", ""), "")).toBeUndefined();
    expect(openAdminSession(undefined, secret)).toBeUndefined();
  });
});
