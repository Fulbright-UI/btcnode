import { describe, expect, it } from 'vitest';
import de from './locales/de.json';
import en from './locales/en.json';

function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (v && typeof v === 'object')
      for (const [k2, v2] of flatten(v as Record<string, unknown>, key)) out.set(k2, v2);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/**
 * The German file is checked against the English one, not against itself:
 * a test that asks the table whether the table knows a key proves nothing.
 */
describe('locale files', () => {
  const e = flatten(en);
  const d = flatten(de);

  it('carry the same keys', () => {
    expect([...d.keys()].sort()).toEqual([...e.keys()].sort());
  });

  it('use the same placeholders on both sides', () => {
    for (const [key, text] of e) expect(placeholders(d.get(key)!), key).toEqual(placeholders(text));
  });

  it('German uses real umlauts, English contains no German leftovers', () => {
    const transliterations = /\b(Bloecke|Schaetzung|waehrend|fuer|ueber|Gebuehr|Hoehe|zurueck)\b/i;
    for (const [key, text] of d) expect(text, key).not.toMatch(transliterations);
    const german =
      /\b(Blöcke|Gebühr|Knoten|eingehend|ausgehend|Dienste|Rückstand|Einträge|läuft|vor \d)\b/;
    for (const [key, text] of e) expect(text, key).not.toMatch(german);
  });
});
