import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseJournalLine, parseTimestamp, shortenLogLine } from './parse.js';

const prefix = '2026-09-06T14:04:16+02:00 btcnode bitcoind[32327]: 2026-09-06T12:04:16Z ';

describe('journal parsing holds for any line', () => {
  it('never throws and keeps the fallback time when there is no timestamp', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 300 }),
        fc.integer({ min: 0, max: 2 ** 31 }),
        (line, fallback) => {
          const parsed = parseJournalLine(line, fallback);
          expect(Number.isFinite(parsed.at)).toBe(true);
          if (!/^\d{4}-\d{2}-\d{2}T/.test(line)) expect(parsed.at).toBe(fallback);
        },
      ),
    );
  });

  it('reads height and peer of any announcement', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 1, maxLength: 64 }),
        (height, peer, hash) => {
          const line = `${prefix}Saw new cmpctblock header hash=${hash} height=${height} peer=${peer}`;
          expect(parseJournalLine(line, 0)).toEqual({
            kind: 'announce',
            at: Date.parse('2026-09-06T12:04:16Z') / 1000,
            height,
            peerId: peer,
          });
        },
      ),
    );
  });

  it('reads any valid journald time stamp', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2009-01-03T00:00:00Z'),
          max: new Date('2099-12-31T23:59:59Z'),
          noInvalidDate: true,
        }),
        (d) => {
          const iso = d.toISOString().slice(0, 19);
          const line = `${iso}+0000 btcnode bitcoind[1]: UpdateTip: new best=00`;
          expect(parseTimestamp(line, -1)).toBe(Math.floor(d.getTime() / 1000));
        },
      ),
    );
  });

  it('shortenLogLine keeps the message after the journald prefix', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (message) => {
        expect(shortenLogLine(prefix + message)).toBe(`14:04:16  ${message.replace(/^\s+/, '')}`);
      }),
    );
  });
});
