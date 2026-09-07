import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

/** Constant-time enough: bcrypt compares the full hash; a null hash still costs a compare. */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, '$2a$12$C6UzMDM.H6dfI/f/IKcEeO0m0WbNdmxOhs0tCXY2AvZQxmqGeX0m.');
    return false;
  }
  return bcrypt.compare(password, hash);
}
