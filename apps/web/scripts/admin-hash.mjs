#!/usr/bin/env node
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";

/**
 * Print an ADMIN_PASSWORD_HASH for a password you type.
 *
 * §11: the plaintext never touches a file, a flag or your shell history — it is
 * read from stdin and only the hash is printed. Paste that into the Vercel
 * environment; there is nothing to commit.
 *
 *   node scripts/admin-hash.mjs
 *
 * Also prints a fresh ADMIN_SESSION_SECRET, because you need one and generating
 * it here is one less thing to get wrong.
 */

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question("password: ");
rl.close();

if (password.length < 12) {
  console.error("\nUse at least 12 characters. This guards every transcript in the database.");
  process.exit(1);
}

// The same parameters `verifyPassword` in @ariane/voice expects, inlined so
// this script has no build step and can be run from a checkout with nothing
// installed.
const N = 16384;
const salt = randomBytes(16);
const key = scryptSync(password, salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

console.log(`\nADMIN_PASSWORD_HASH=scrypt$${N}$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`);
console.log(`ADMIN_SESSION_SECRET=${randomBytes(32).toString("hex")}`);
