import type { NetworkKind, Peer } from '@btcnode/shared';
import { useI18n } from 'vue-i18n';
import { useFormat } from '@/composables/useFormat';
import { shortenAddress } from '@/lib/networkMap';

export function usePeerLabels() {
  const { t } = useI18n();
  const format = useFormat();

  /** Apart from "local" and "Electrum server" these are proper names and the same in both languages. */
  const networkName = (kind: NetworkKind): string => {
    switch (kind) {
      case 'local':
        return t('network.local');
      case 'electrs':
        return t('network.electrumServer');
      case 'ipv4':
        return 'IPv4';
      case 'ipv6':
        return 'IPv6';
      case 'onion':
        return 'Tor';
      case 'i2p':
        return 'I2P';
      case 'cjdns':
        return 'CJDNS';
      default:
        return t('network.unknown');
    }
  };

  /**
   * An inbound Tor peer carries no address of its own — it arrived through
   * our onion service and shows up as 127.0.0.1. "Tor" alone next to that
   * address reads like a contradiction; "Tor · inbound" explains it.
   */
  const peerNetworkLabel = (p: Peer): string => {
    if (p.network === 'onion' && p.inbound) return t('network.torInbound');
    if (p.network === 'electrs') return t('network.electrumLocal');
    return networkName(p.network);
  };

  /** The key figures shown along the spoke — short enough for one line. */
  const peerLine = (p: Peer): string => {
    const parts = [shortenAddress(p.address), peerNetworkLabel(p)];
    if (p.latencyMs !== null) parts.push(format.latency(p.latencyMs));
    parts.push(format.bytes(p.bytesSent + p.bytesReceived));
    return parts.join(' · ');
  };

  return { networkName, peerNetworkLabel, peerLine };
}
