// Generate an ADMIN_PASSWORD_HASH value for .env / Docker.
//
// Usage:
//   npx tsx src/scripts/hash-admin-password.ts 'meinPasswort'
//   npx tsx src/scripts/hash-admin-password.ts          # prompts on stdin
//
// The plaintext is read from argv/stdin only and never written anywhere. Copy
// the printed scrypt$… value into ADMIN_PASSWORD_HASH.

import { hashPassword } from "../api/passwords";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
  });
}

async function main() {
  const arg = process.argv.slice(2).join(" ");
  const password = arg.length > 0 ? arg : await readStdin();
  if (!password) {
    console.error("no password provided (pass as argument or via stdin)");
    process.exit(1);
  }
  console.log(hashPassword(password));
}

main();
