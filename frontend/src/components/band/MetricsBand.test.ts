import type { StatusSnapshot } from '@btcnode/shared';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import MetricsBand from '@/components/band/MetricsBand.vue';
import { useStatusStore } from '@/stores/status';
import { setup } from '@/test/mount';
import { snapshot } from '@/test/snapshot';

enableAutoUnmount(afterEach);

type Node = NonNullable<StatusSnapshot['node']>;

function render(s: StatusSnapshot | null, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  useStatusStore().snapshot = s;
  // the band renders a fragment of tiles; wrap it so find() sees all of them
  return mount(
    defineComponent(() => () => h('div', [h(MetricsBand)])),
    { global },
  );
}

function withNode(node: Partial<Node>, over: Partial<StatusSnapshot> = {}): StatusSnapshot {
  const s = snapshot();
  return snapshot({ node: { ...s.node!, ...node }, ...over });
}

const sync = { state: { level: 'sync' as const, warnings: [] } };

function tiles(w: ReturnType<typeof render>) {
  return w.findAll('.tile').map((t) => ({
    cls: t.classes().filter((c) => c !== 'tile'),
    value: t.find('.tile-value').text(),
    label: t.find('.tile-label').text(),
    extra: t.find('.tile-extra').exists() ? t.find('.tile-extra').text() : null,
  }));
}

describe('MetricsBand', () => {
  it('shows halving, fee, connections and temperature for a synced node', () => {
    const t = tiles(render(snapshot()));
    expect(t).toHaveLength(4);
    expect(t[0]!.value).toBe('935days');
    expect(t[0]!.label).toMatch(/^halving · about \d{4}-\d\d-\d\d$/);
    expect(t[0]!.extra).toBe('134,688 blocks to go');
    expect(t[1]).toEqual({
      cls: ['good', 'wide'],
      value: '2.8sat/vB',
      label: 'fee for the next block',
      extra: 'safe: 4.1',
    });
    expect(t[2]).toEqual({ cls: ['good'], value: '23', label: 'Connections', extra: null });
    expect(t[3]).toEqual({ cls: ['good'], value: '52.5 °C', label: 'Temperature', extra: null });
  });

  it('drops the safe fee when it rounds to the same value', () => {
    const t = tiles(
      render(withNode({ fees: { economical: 3, conservative: 3.04, lastBlockMedian: 1 } })),
    );
    expect(t[1]!.extra).toBeNull();
    const none = tiles(
      render(withNode({ fees: { economical: 3, conservative: null, lastBlockMedian: 1 } })),
    );
    expect(none[1]!.extra).toBeNull();
  });

  it('falls back to the median fee of the last block, then to the mempool size', () => {
    const median = tiles(
      render(withNode({ fees: { economical: null, conservative: 9, lastBlockMedian: 6 } })),
    );
    expect(median[1]!.value).toBe('6.0sat/vB');
    expect(median[1]!.label).toBe('median fee in the last block');
    const mempool = tiles(
      render(withNode({ fees: { economical: null, conservative: null, lastBlockMedian: null } })),
    );
    expect(mempool[1]).toEqual({ cls: [], value: '41,233', label: 'in the mempool', extra: null });
  });

  it('compares verified with known blocks during the sync', () => {
    const t = tiles(render(withNode({ blocks: 800_000, pruned: false }, sync)));
    expect(t[0]).toEqual({
      cls: ['wide'],
      value: '800,000of915,312',
      label: 'blocks verified · known to the network',
      extra: '870.0 GB on disk',
    });
    expect(t[1]).toEqual({ cls: [], value: '115,312', label: 'blocks behind', extra: null });
  });

  it('notes pruning and never counts negative blocks behind', () => {
    const t = tiles(render(withNode({ blocks: 915_400, pruned: true }, sync)));
    expect(t[0]!.extra).toBe('870.0 GB on disk · pruning active');
    expect(t[1]!.value).toBe('0');
  });

  it('warns about few connections and colours the temperature by threshold', () => {
    const s = snapshot();
    const few = tiles(
      render(
        withNode(
          { connections: { total: 3, inbound: 0, outbound: 3 } },
          { system: { ...s.system, temperature: 80 } },
        ),
      ),
    );
    expect(few[2]!.cls).toEqual(['warn']);
    expect(few[3]!.cls).toEqual(['warn']);
    const warm = tiles(render(snapshot({ system: { ...s.system, temperature: 65 } })));
    expect(warm[3]!.cls).toEqual([]);
  });

  it('shows only the temperature without node data and nothing without a temperature', () => {
    const s = snapshot();
    const t = tiles(render(snapshot({ node: null })));
    expect(t).toHaveLength(1);
    expect(t[0]!.label).toBe('Temperature');
    const none = tiles(render(snapshot({ system: { ...s.system, temperature: null } })));
    expect(none.map((x) => x.label)).not.toContain('Temperature');
    expect(tiles(render(null))).toHaveLength(0);
  });

  it('speaks German', () => {
    const t = tiles(render(snapshot(), 'de'));
    expect(t[0]!.extra).toBe('noch 134.688 Blöcke');
    expect(t[0]!.label).toMatch(/\d\d\.\d\d\.\d{4}/);
  });
});
