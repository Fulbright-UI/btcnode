import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('admin password', () => {
  it('verifies the password it hashed and nothing else', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batter', hash)).toBe(false);
  });

  it('refuses every password when no hash is configured', async () => {
    expect(await verifyPassword('', null)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
  });
});
