import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyLogLine, LOG_KINDS } from './log.js';

const kinds = LOG_KINDS.map((k) => k.kind);

describe('log classification holds for any line', () => {
  it('returns a known kind or null', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (line) => {
        const kind = classifyLogLine(line);
        expect(kind === null || kinds.includes(kind)).toBe(true);
      }),
    );
  });

  it('puts trouble before everything else', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), fc.string({ maxLength: 100 }), (a, b) => {
        expect(classifyLogLine(`${a} UpdateTip: ${b} error `)).toBe('error');
      }),
    );
  });
});
