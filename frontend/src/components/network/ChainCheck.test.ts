import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ChainCheck from '@/components/network/ChainCheck.vue';
import { setup } from '@/test/mount';
import { NOW } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type Check = StatusSnapshot['chainCheck'];
type Verdict = Check['samples'][number]['verdict'];

function check(verdicts: Verdict[], over: Partial<Check> = {}): Check {
  return {
    samples: verdicts.map((verdict, i) => ({
      at: NOW - (verdicts.length - i) * 600,
      peerId: 800 + i,
      height: 100,
      verdict,
    })),
    ahead: 0,
    alarm: false,
    unsupported: false,
    ...over,
  };
}

function render(c: Check, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  return mount(ChainCheck, { global, props: { check: c, generatedAt: NOW } });
}

const sentence = (w: ReturnType<typeof render>) => w.text().replace(/\s+/g, ' ').trim();

describe('ChainCheck', () => {
  it('draws one dot per sample and accounts for every probe', () => {
    const w = render(check(['behind', 'same', 'same']));
    expect(w.findAll('i.probe').map((i) => i.classes()[1])).toEqual(['behind', 'same', 'same']);
    expect(sentence(w)).toBe(
      '2 of 3 probes matched our height, 1 behind, none ahead · last 10 min ago',
    );
    expect(w.attributes('title')).toBe(
      'Chain check: every few minutes Core asks a random node for its height. Last 10 min ago',
    );
    expect(w.classes()).not.toContain('warn');
  });

  it('mentions a single stranger that claimed more blocks', () => {
    const w = render(check(['same', 'ahead'], { ahead: 1 }));
    expect(sentence(w)).toBe(
      '1 of 2 probes matched our height, one claimed up to 1 blocks more without delivering headers · last 10 min ago',
    );
  });

  it('counts several strangers that claimed more blocks', () => {
    const w = render(check(['ahead', 'ahead', 'same'], { ahead: 1200 }));
    expect(sentence(w)).toContain(', 2 claimed up to 1,200 blocks more without delivering headers');
  });

  it('raises the alarm when probes keep reporting a longer chain', () => {
    const w = render(check(['ahead', 'ahead', 'same'], { ahead: 5, alarm: true }));
    expect(sentence(w)).toBe('2 probes report up to 5 blocks more than we have');
    expect(w.classes()).toContain('warn');
  });

  it('says when this Core cannot take part', () => {
    const w = render(check([], { unsupported: true }));
    expect(sentence(w)).toBe('Chain check: this Bitcoin Core does not log the height of a probe');
    expect(w.find('.probes').exists()).toBe(false);
    expect(w.attributes('title')).toBeUndefined();
  });

  it('renders nothing without samples', () => {
    const w = render(check([]));
    expect(w.find('.chain-check').exists()).toBe(false);
  });

  it('speaks German', () => {
    const w = render(check(['ahead', 'ahead'], { ahead: 3, alarm: true }), 'de');
    expect(sentence(w)).toBe('2 Stichproben melden bis zu 3 Blöcke mehr als wir');
  });
});
