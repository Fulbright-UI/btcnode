import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../auth/password.js';

/** `pnpm hash-password` — prints a bcrypt hash for ADMIN_PASSWORD_HASH. */
async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const password = await rl.question('Admin password: ');
  rl.close();
  if (password.length < 8) {
    console.error('Use at least 8 characters.');
    process.exit(1);
  }
  process.stdout.write((await hashPassword(password)) + '\n');
}

void main();
