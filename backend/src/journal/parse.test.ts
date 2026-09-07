import { describe, expect, it } from 'vitest';
import { parseJournalLine, shortenLogLine } from './parse.js';

const prefix = '2026-09-06T14:04:16+02:00 btcnode bitcoind[32327]: 2026-09-06T12:04:16Z ';

/** One line per Core release the parser must understand — a new release gets a row here first. */
const ANNOUNCE_FORMATS: [string, string, { height?: number; peerId: number }][] = [
  ['v26–v29', 'Saw new cmpctblock header hash=0000abc peer=311', { peerId: 311 }],
  [
    'v30–v31',
    'Saw new cmpctblock header hash=0000abc height=965079 peer=311',
    { height: 965079, peerId: 311 },
  ],
  [
    'master',
    'Saw new cmpctblock header hash=0000abc height=965079 peer=311, peeraddr=1.2.3.4:8333',
    { height: 965079, peerId: 311 },
  ],
  ['headers', 'Saw new header hash=0000abc height=965079 peer=12', { height: 965079, peerId: 12 }],
];

const SAMPLE_FORMATS: [string, string, { height?: number; peerId?: number }][] = [
  [
    'v26–v30',
    'New block-relay-only v2 peer connected: version: 70016, blocks=965079, peer=818',
    { height: 965079, peerId: 818 },
  ],
  [
    'v31',
    'New block-relay-only peer connected: transport: v2, version: 70016, blocks=965079 peer=818',
    { height: 965079, peerId: 818 },
  ],
  ['master', 'New block-relay-only peer connected: transport: v2, version: 70016, peer=818', {}],
];

describe('journal parsing', () => {
  it.each(ANNOUNCE_FORMATS)('reads announcements as %s writes them', (_v, line, want) => {
    const p = parseJournalLine(prefix + line, 0);
    if (want.height === undefined) {
      expect(p).toMatchObject({ kind: 'announceNoHeight', peerId: want.peerId });
    } else {
      expect(p).toMatchObject({ kind: 'announce', height: want.height, peerId: want.peerId });
    }
  });

  it.each(SAMPLE_FORMATS)('reads chain-check samples as %s writes them', (_v, line, want) => {
    const p = parseJournalLine(prefix + line, 0);
    if (want.height === undefined) expect(p.kind).toBe('sampleNoBlocks');
    else expect(p).toMatchObject({ kind: 'sample', height: want.height, peerId: want.peerId });
  });

  it('takes the journald timestamp, not the fallback', () => {
    const p = parseJournalLine(prefix + 'Bitcoin Core version v31.1.0 (release build)', 1);
    expect(p.kind).toBe('start');
    expect(p.at).toBe(Date.parse('2026-09-06T14:04:16+02:00') / 1000);
  });

  it('reads the offset without a colon, as systemd 252 writes it', () => {
    const line =
      '2026-09-07T18:17:51+0000 btcnode bitcoind[256923]: 2026-09-07T18:17:51Z Bitcoin Core version v31.1.0';
    const p = parseJournalLine(line, 1);
    expect(p.kind).toBe('start');
    expect(p.at).toBe(Date.parse('2026-09-07T18:17:51+00:00') / 1000);
    expect(shortenLogLine(line)).toBe('18:17:51  Bitcoin Core version v31.1.0');
  });

  it('falls back on lines without a journald prefix', () => {
    expect(parseJournalLine('UpdateTip: new best=… height=1', 42)).toEqual({
      kind: 'other',
      at: 42,
    });
  });

  it('shortens the doubled timestamp and keeps unknown lines untouched', () => {
    expect(shortenLogLine(prefix + 'UpdateTip: x')).toBe('14:04:16  UpdateTip: x');
    expect(shortenLogLine('2026-09-06T14:04:16+02:00 btcnode nginx[5]: hello')).toBe(
      '14:04:16  hello',
    );
    expect(shortenLogLine('-- Boot abc --')).toBe('-- Boot abc --');
  });
});
