import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ChainCheck from '@/components/network/ChainCheck.vue';
import NetworkMap from '@/components/network/NetworkMap.vue';
import NetworkMapCard from '@/components/network/NetworkMapCard.vue';
import PeerDetail from '@/components/network/PeerDetail.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { peer, snapshot } from '@/test/snapshot';

// the template's /bitcoin.png lives in public/, which vitest cannot import
vi.mock('/bitcoin.png', () => ({ default: '/bitcoin.png' }));

enableAutoUnmount(afterEach);

function render(s: StatusSnapshot | null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  const status = useStatusStore();
  status.snapshot = s;
  const w = mount(NetworkMapCard, { global });
  return { w, status };
}

const figures = (w: ReturnType<typeof render>['w']) =>
  w.findAll('.network-figures > span:not(.chain-check)').map((s) => s.text());

const selected = (w: ReturnType<typeof render>['w']) =>
  w.findComponent(PeerDetail).props('selected');

const shownPeers = (w: ReturnType<typeof render>['w']) =>
  w
    .findComponent(NetworkMap)
    .props('peers')
    .map((p) => p.id);

describe('NetworkMapCard with peers', () => {
  it('sums up the peers, draws the map and the legend', () => {
    const { w } = render(snapshot());
    expect(w.find('h2').text()).toBe('Connected nodes');
    expect(figures(w)).toEqual([
      '4 Connected',
      '2 inbound',
      '1 Electrum server',
      '1 Tor',
      '1 IPv6',
      '1 I2P',
      '40 ms Average round trip',
      '40 ms fastest',
      '55 ms own response time',
    ]);
    expect(w.find('.network-figures .warn').exists()).toBe(false);
    expect(w.findComponent(ChainCheck).exists()).toBe(true);
    expect(w.findAll('g.peer')).toHaveLength(4);
    expect(w.findAll('.legend span').map((s) => s.text())).toEqual([
      'Electrum',
      'Tor',
      'IPv4',
      'IPv6',
      'I2P',
      'announced the last block first',
      'outbound',
      'inbound',
    ]);
    expect(selected(w)).toBeNull();
    expect(w.find('.peer-detail .hint').exists()).toBe(true);
  });

  it('flags a slow own response and hides the chain check while syncing', () => {
    const s = snapshot();
    const { w } = render(
      snapshot({
        node: { ...s.node!, inSync: false },
        peers: { list: [peer({ currentPingMs: 2500, latencyMs: null })], total: 1 },
      }),
    );
    expect(w.find('.network-figures .warn').text()).toBe('2.5 s own response time');
    expect(w.findComponent(ChainCheck).exists()).toBe(false);
    // no link latency known: neither average nor fastest
    expect(figures(w).some((f) => f.includes('fastest'))).toBe(false);
  });

  it('shows the hovered peer and falls back to the pinned one on leave', async () => {
    const { w } = render(snapshot());
    const box = w.find('.network-map-box');
    await box.trigger('mouseenter');
    const rows = w.findAll('g.peer');
    await rows[2]!.trigger('mouseenter');
    expect(selected(w)).toBe(2);
    expect(w.find('.peer-detail .peer-address').text()).toBe('[2001:db8::7]:8333');

    await rows[1]!.trigger('click');
    await w.find('g.hub').trigger('mouseenter');
    expect(selected(w)).toBe('self');
    expect(rows[1]!.classes()).toContain('active');

    await box.trigger('mouseleave');
    expect(selected(w)).toBe(1);
    // a second click releases the pin
    await rows[1]!.trigger('click');
    expect(selected(w)).toBeNull();
  });

  it('keeps the map still while the pointer is inside and releases it on leave', async () => {
    const { w, status } = render(snapshot());
    await w.find('.network-map-box').trigger('mouseenter');
    status.snapshot = snapshot({ peers: { list: [peer({ id: 50 })], total: 1 } });
    await nextTick();
    expect(shownPeers(w)).toEqual([0, 3, 7, 9]);
    // the detail box sees the frozen list too
    expect(w.findComponent(PeerDetail).props('snapshot').peers.list).toHaveLength(4);
    await w.find('.network-map-box').trigger('mouseleave');
    expect(shownPeers(w)).toEqual([50]);
  });

  it('keeps the map still while a dot is pinned, even after the pointer left', async () => {
    const { w, status } = render(snapshot());
    const map = w.findComponent(NetworkMap);
    map.vm.$emit('pin', 0);
    await nextTick();
    status.snapshot = snapshot({ peers: { list: [peer({ id: 50 })], total: 1 } });
    await nextTick();
    expect(shownPeers(w)).toEqual([0, 3, 7, 9]);
    await w.find('.network-map-box').trigger('mouseleave');
    expect(shownPeers(w)).toEqual([0, 3, 7, 9]);
    // unpinning from outside the map releases it
    w.findComponent(NetworkMap).vm.$emit('pin', 0);
    await nextTick();
    expect(shownPeers(w)).toEqual([50]);
  });

  it('follows live updates while nobody looks', async () => {
    const { w, status } = render(snapshot());
    status.snapshot = snapshot({ peers: { list: [peer({ id: 50 })], total: 1 } });
    await nextTick();
    expect(shownPeers(w)).toEqual([50]);
  });
});

describe('NetworkMapCard without peers', () => {
  it('explains a denied getpeerinfo and shows the connection figures', () => {
    const { w } = render(snapshot({ peers: { list: [], total: 0, unavailable: 'denied' } }));
    expect(w.find('.card-head .hint').text()).toBe('drawing follows once the method is allowed');
    const dl = w.findAll('.network-fallback dd').map((d) => d.text());
    expect(dl).toEqual(['23', '5', '18', 'Satoshi:31.1.0', '38 min']);
    const foot = w.find('.card-foot');
    expect(foot.find('code').text()).toBe('getpeerinfo');
    expect(foot.text()).toBe(
      "The network drawing needs the getpeerinfo call. Add it to the node's rpcwhitelist.",
    );
    expect(w.findComponent(NetworkMap).exists()).toBe(false);
  });

  it('says the peer list is still being queried', () => {
    const { w } = render(snapshot({ peers: { list: [], total: 0, unavailable: 'pending' } }));
    expect(w.find('.card-head .hint').text()).toBe('querying peers');
    expect(w.find('.card-foot').text()).toContain('has not delivered the peer list yet');
  });

  it('shows only the heading without node data or snapshot', () => {
    const noNode = render(snapshot({ node: null, peers: { list: [], total: 0 } })).w;
    expect(noNode.find('.hint').exists()).toBe(false);
    expect(noNode.find('.network-fallback').exists()).toBe(false);
    const nothing = render(null).w;
    expect(nothing.find('h2').text()).toBe('Connected nodes');
    expect(nothing.findAll('.card-head > *')).toHaveLength(1);
  });

  it('speaks German', () => {
    const { w } = render(snapshot({ peers: { list: [], total: 0, unavailable: 'pending' } }), 'de');
    expect(w.find('.card-head .hint').text()).toBe('Gegenstellen werden abgefragt');
    expect(w.find('.network-fallback dt').text()).toBe('Verbindungen');
  });
});
