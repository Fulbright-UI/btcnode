import { describe, expect, it } from 'vitest';
import { classifyLogLine, controlRequestSchema, statusSnapshotSchema } from './index.js';

describe('log classification', () => {
  it('flags trouble first, the tip second, and nothing else', () => {
    expect(classifyLogLine('UpdateTip: new best=… height=1')).toBe('tip');
    expect(classifyLogLine('Warning: something odd')).toBe('warn');
    expect(classifyLogLine('Potential stale tip detected')).toBe('error');
    expect(classifyLogLine('error: UpdateTip failed')).toBe('error'); // trouble wins over tip
    expect(classifyLogLine('Saw new cmpctblock header hash=… peer=3')).toBeNull();
  });
});

describe('control contract', () => {
  it('accepts only the four actions', () => {
    expect(controlRequestSchema.safeParse({ action: 'reboot' }).success).toBe(true);
    expect(controlRequestSchema.safeParse({ action: 'restart-nginx' }).success).toBe(false);
    expect(controlRequestSchema.safeParse({ action: 'reboot; rm -rf /' }).success).toBe(false);
  });
});

describe('status contract', () => {
  it('rejects a snapshot with a formatted string where a number belongs', () => {
    const r = statusSnapshotSchema.safeParse({ generatedAt: '2026-09-07 19:00' });
    expect(r.success).toBe(false);
  });
});
