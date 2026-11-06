import { warningCodeSchema } from '@btcnode/shared';
import { describe, expect, it } from 'vitest';
import { withSetup } from '@/test/composable';
import { useWarnings } from './useWarnings';

describe('useWarnings', () => {
  it('fills the numbers of a warning into its sentence', () => {
    const w = withSetup(useWarnings);
    expect(w.text({ code: 'temperature', params: { value: 81 } })).toBe('Temperature: 81 °C');
    expect(w.text({ code: 'electrumIndexing', params: { blocks: '1.234' } })).toBe(
      'Electrum index: 1.234 blocks to go',
    );
  });

  it('works without params', () => {
    const w = withSetup(useWarnings);
    expect(w.text({ code: 'power' })).toBe('Power supply: irregular');
  });

  it('names the network of a slow ping', () => {
    const w = withSetup(useWarnings, 'de');
    expect(w.text({ code: 'peerLatencySlow', params: { network: 'onion', ms: 3400 } })).toBe(
      'Ping Tor (Median): 3400 ms',
    );
  });

  it('translates into German', () => {
    const w = withSetup(useWarnings, 'de');
    expect(w.text({ code: 'mempoolFull' })).toBe('Mempool fast voll');
    expect(w.text({ code: 'disk', params: { percent: 93 } })).toBe('Speicherplatz: 93 % belegt');
  });

  it('has a sentence for every code the backend can send', () => {
    for (const locale of ['en', 'de'] as const) {
      const w = withSetup(useWarnings, locale);
      for (const code of warningCodeSchema.options) {
        const text = w.text({
          code,
          params: { value: 1, percent: 2, blocks: 3, ms: 4, network: 'i2p' },
        });
        expect(text).not.toContain('warnings.');
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
