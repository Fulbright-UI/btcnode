import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NetworkMap from '@/components/network/NetworkMap.vue';
import { setup } from '@/test/mount';
import { peer, snapshot } from '@/test/snapshot';

// the template's /bitcoin.png lives in public/, which vitest cannot import
vi.mock('/bitcoin.png', () => ({ default: '/bitcoin.png' }));

enableAutoUnmount(afterEach);

const peers = snapshot().peers.list;

function render(list = peers, pinned: number | null = null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  return mount(NetworkMap, { global, props: { peers: list, pinned } });
}

describe('NetworkMap', () => {
  it('draws the hub and one labelled row per peer', () => {
    const w = render();
    expect(w.attributes('aria-label')).toBe('Network of the 4 connected nodes');
    expect(w.find('.hub-label').text()).toBe('this node');
    const rows = w.findAll('g.peer');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.find('.peer-label').text())).toEqual([
      '127.0.0.1:51102 · Electrum · local · 40 ms · 170.0 KB',
      'peerexample.onion:8333 · Tor · inbound · 40 ms · 170.0 KB',
      '[2001:db8::7]:8333 · IPv6 · 40 ms · 170.0 KB',
      'peerexample.i2p:0 · I2P · 40 ms · 170.0 KB',
    ]);
    expect(rows.map((r) => r.classes()[1])).toEqual(['electrs', 'onion', 'ipv6', 'i2p']);
    // the announcer of the tip stands out, outbound dots are filled
    expect(rows[3]!.classes()).toContain('announcer');
    expect(rows.map((r) => r.find('.peer-dot').classes('filled'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(w.findAll('.active')).toHaveLength(0);
  });

  it('marks the pinned row', () => {
    const w = render(peers, 2);
    expect(w.findAll('g.peer.active')).toHaveLength(1);
    expect(w.findAll('g.peer')[2]!.classes()).toContain('active');
  });

  it('emits hover for peers and hub, pin on click, and null on leave', async () => {
    const w = render();
    const rows = w.findAll('g.peer');
    await rows[1]!.trigger('mouseenter');
    await rows[2]!.trigger('focus');
    await w.find('g.hub').trigger('mouseenter');
    await w.find('g.hub').trigger('focus');
    await rows[3]!.trigger('click');
    await w.trigger('mouseleave');
    expect(w.emitted('hover')).toEqual([[1], [2], ['self'], ['self'], [null]]);
    expect(w.emitted('pin')).toEqual([[3]]);
  });

  it('keeps foreign text as text, never as markup', () => {
    const w = render([peer({ address: '<b>x</b>:8333', userAgent: '<script>' })]);
    expect(w.find('b').exists()).toBe(false);
    expect(w.find('.peer-label').text()).toContain('<b>x</b>:8333');
  });

  it('draws nothing without peers', () => {
    const w = render([]);
    expect(w.find('svg').exists()).toBe(false);
  });

  it('speaks German', () => {
    const w = render(peers, null, 'de');
    expect(w.attributes('aria-label')).toBe('Netz der 4 verbundenen Knoten');
  });
});
