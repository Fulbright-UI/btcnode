import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import PeerDetail from '@/components/network/PeerDetail.vue';
import { setup } from '@/test/mount';
import { NOW, peer, snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

function render(s: StatusSnapshot, selected: number | 'self' | null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  return mount(PeerDetail, { global, props: { snapshot: s, selected } });
}

function rows(w: ReturnType<typeof render>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dt of w.findAll('dt')) {
    out[dt.text()] = (dt.element.nextElementSibling as HTMLElement)
      .textContent!.replace(/\s+/g, ' ')
      .trim();
  }
  return out;
}

const paragraphs = (w: ReturnType<typeof render>) => w.findAll('p').map((p) => p.text());

describe('PeerDetail at rest', () => {
  it('tells who announced the last block and who announces first most often', () => {
    const w = render(snapshot(), null);
    expect(paragraphs(w)).toEqual([
      'Block 915,312 · announced 4 min ago by peerexample.i2p:0',
      'first to announce, 61 blocks in 24 h: peerexample.i2p:0 × 13 · peer 2 × 5 · ' +
        'numbered peers are from before the restart, no longer connected',
      'Point at a line for identifier, services and connection time.',
    ]);
  });

  it('marks an announcer that is gone and numbers peers that have no address', () => {
    const s = snapshot({
      tipAnnouncement: {
        height: 100,
        peerId: 4,
        at: NOW - 30,
        connected: false,
        beforeRestart: false,
        address: 'gone.example:8333',
      },
      announcerRanking: [{ peerId: 4, count: 2, connected: false, beforeRestart: false }],
      announcedTotal: 2,
    });
    const [block, ranking] = paragraphs(render(s, null));
    expect(block).toBe('Block 100 · announced 30 s ago by gone.example:8333 (no longer connected)');
    expect(ranking).toBe(
      'first to announce, 2 blocks in 24 h: peer 4 × 2 · numbered peers are no longer connected',
    );
  });

  it('numbers an announcer from before the restart and omits the footnote when all are known', () => {
    const s = snapshot({
      tipAnnouncement: {
        height: 100,
        peerId: 4,
        at: NOW - 30,
        connected: false,
        beforeRestart: true,
      },
      announcerRanking: [
        { peerId: 9, count: 3, connected: true, beforeRestart: false, address: 'a.example:1' },
      ],
    });
    const [block, ranking] = paragraphs(render(s, null));
    expect(block).toBe('Block 100 · announced 30 s ago by peer 4');
    expect(ranking).toBe('first to announce, 61 blocks in 24 h: a.example:1 × 3');
  });

  it('stays quiet without peers, announcement or ranking', () => {
    const noPeers = snapshot({ peers: { list: [], total: 0 } });
    expect(paragraphs(render(noPeers, null)).slice(0, 2)).toEqual(['', '']);
    const nothing = snapshot({ tipAnnouncement: null, announcerRanking: [] });
    expect(paragraphs(render(nothing, null)).slice(0, 2)).toEqual(['', '']);
  });

  it('falls back to the resting view for an index beyond the list', () => {
    expect(render(snapshot(), 42).find('.hint').exists()).toBe(true);
  });
});

describe('PeerDetail for a peer', () => {
  it('lists the details of an outbound peer', () => {
    const w = render(snapshot(), 2);
    expect(w.find('.peer-head').text()).toBe('IPv6 · outbound');
    expect(w.find('.peer-head .swatch').classes()).toContain('ipv6');
    expect(w.find('.peer-address').text()).toBe('[2001:db8::7]:8333');
    expect(rows(w)).toEqual({
      Identifier: '/Satoshi:31.1.0/',
      Services: 'NETWORK, WITNESS',
      'Connected for': '1 h 0 min',
      'Response right now': '80 ms',
      Received: '120.0 KB',
      Sent: '50.0 KB',
      'Addresses from here': '10',
      'Blocks from here': '2 · last 10 min ago',
      'Blocks to here': '—',
    });
  });

  it('fills the gaps of a sparse inbound peer', () => {
    const s = snapshot({
      peers: {
        list: [
          peer({
            network: 'cjdns',
            inbound: true,
            userAgent: '',
            services: [],
            currentPingMs: null,
            connectedFor: 42,
            addressesDropped: 1200,
            blocksFrom: 0,
            lastBlockFromAt: null,
            blocksTo: 0,
            lastBlockToAt: NOW - 7200,
          }),
        ],
        total: 1,
      },
    });
    const w = render(s, 0);
    expect(w.find('.peer-head').text()).toBe('CJDNS · inbound');
    const r = rows(w);
    expect(r).toMatchObject({
      Identifier: 'unknown',
      Services: 'none',
      'Connected for': '42 s',
      'Addresses from here': '10 · 1,200 dropped',
      'Blocks from here': '—',
      'Blocks to here': 'last 2 h ago',
    });
    expect(r['Response right now']).toBeUndefined();
  });
});

describe('PeerDetail for this node', () => {
  it('shows this node as its peers see it', () => {
    const w = render(snapshot(), 'self');
    expect(w.find('.peer-head').text()).toBe('this node · 5 inbound · 18 outbound');
    expect(w.find('.peer-address').text()).toBe('selfexample.onion:8333');
    expect(rows(w)).toEqual({
      Identifier: 'Satoshi:31.1.0',
      Protocol: '70016',
      Services: 'NETWORK, WITNESS, NETWORK_LIMITED, P2P_V2',
      'Node up for': '38 min',
      'Minimum relay fee': '1.00 sat/vB',
    });
  });

  it('says so when no address or service is announced', () => {
    const s = snapshot();
    const w = render(
      snapshot({
        node: { ...s.node!, self: { services: [], localAddresses: [], relayFee: 0.1 } },
      }),
      'self',
    );
    expect(w.find('.peer-address').text()).toBe('no reachable address announced');
    expect(rows(w).Services).toBe('none');
  });

  it('shows the resting view for the hub without node data', () => {
    const w = render(snapshot({ node: null }), 'self');
    expect(w.find('.peer-head').exists()).toBe(false);
    expect(w.find('.hint').exists()).toBe(true);
  });

  it('speaks German', () => {
    const w = render(snapshot(), 'self', 'de');
    expect(w.find('.peer-head').text()).toBe('dieser Node · 5 eingehend · 18 ausgehend');
  });
});
