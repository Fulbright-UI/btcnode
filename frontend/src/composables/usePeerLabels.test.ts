import type { NetworkKind } from '@btcnode/shared';
import { describe, expect, it } from 'vitest';
import { withSetup } from '@/test/composable';
import { peer } from '@/test/snapshot';
import { usePeerLabels } from './usePeerLabels';

describe('usePeerLabels', () => {
  it('names every network, translating only the generic ones', () => {
    const en = withSetup(usePeerLabels, 'en');
    const de = withSetup(usePeerLabels, 'de');
    const names: Record<NetworkKind, [string, string]> = {
      local: ['local', 'lokal'],
      electrs: ['Electrum server', 'Electrum-Server'],
      ipv4: ['IPv4', 'IPv4'],
      ipv6: ['IPv6', 'IPv6'],
      onion: ['Tor', 'Tor'],
      i2p: ['I2P', 'I2P'],
      cjdns: ['CJDNS', 'CJDNS'],
      unknown: ['unknown', 'unbekannt'],
    };
    for (const [kind, [inEnglish, inGerman]] of Object.entries(names)) {
      expect(en.networkName(kind as NetworkKind)).toBe(inEnglish);
      expect(de.networkName(kind as NetworkKind)).toBe(inGerman);
    }
  });

  it('treats a kind it does not know as unknown', () => {
    const l = withSetup(usePeerLabels);
    expect(l.networkName('satellite' as NetworkKind)).toBe('unknown');
  });

  it('explains inbound Tor peers and our own Electrum server', () => {
    const l = withSetup(usePeerLabels);
    expect(l.peerNetworkLabel(peer({ network: 'onion', inbound: true }))).toBe('Tor · inbound');
    expect(l.peerNetworkLabel(peer({ network: 'onion', inbound: false }))).toBe('Tor');
    expect(l.peerNetworkLabel(peer({ network: 'electrs', inbound: true }))).toBe(
      'Electrum · local',
    );
    expect(l.peerNetworkLabel(peer({ network: 'ipv6', inbound: true }))).toBe('IPv6');
  });

  it('builds the spoke line from address, network, latency and traffic', () => {
    const l = withSetup(usePeerLabels);
    expect(l.peerLine(peer())).toBe('198.51.100.7:8333 · IPv4 · 40 ms · 170.0 KB');
  });

  it('leaves the latency out when it is unknown', () => {
    const l = withSetup(usePeerLabels, 'de');
    expect(l.peerLine(peer({ latencyMs: null, bytesSent: 1500, bytesReceived: 0 }))).toBe(
      '198.51.100.7:8333 · IPv4 · 1,5 KB',
    );
  });

  it('shortens long onion addresses', () => {
    const l = withSetup(usePeerLabels);
    const address = `${'a'.repeat(56)}.onion:8333`;
    const line = l.peerLine(peer({ address, network: 'onion', latencyMs: 1500 }));
    expect(line).toBe('aaaaaaaaaaaa…aa.onion:8333 · Tor · 1.5 s · 170.0 KB');
  });
});
