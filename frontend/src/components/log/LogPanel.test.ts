import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import LogPanel from '@/components/log/LogPanel.vue';
import { useLogStore } from '@/stores/log';
import { setup } from '@/test/mount';

enableAutoUnmount(afterEach);

function render(text: string, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  const log = useLogStore();
  log.text = text;
  const w = mount(LogPanel, { global, attachTo: document.body });
  return { w, log };
}

const LOG = [
  '2026-11-05T10:00:00Z UpdateTip: new best=00ab height=915312 version=0x2000',
  '2026-11-05T09:59:00Z Warning: unknown new rules activated',
  '2026-11-05T09:58:00Z peer=7 misbehaving, disconnecting',
  '2026-11-05T09:57:00Z Saw new header',
].join('\n');

describe('LogPanel', () => {
  it('shows heading, refresh interval and an accessible scroll box', () => {
    const { w } = render('');
    expect(w.find('h2').text()).toBe('Log');
    expect(w.find('.hint').text()).toBe('newest first · every 3 s');
    expect(w.find('pre').attributes('aria-label')).toBe('Log');
    expect(w.find('pre').attributes('tabindex')).toBe('0');
  });

  it('classes each line and highlights the height of a new tip', () => {
    const { w } = render(LOG);
    const lines = w.findAll('.log-line');
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.classes().filter((c) => c !== 'log-line'))).toEqual([
      ['tip'],
      ['warn'],
      ['error'],
      [],
    ]);
    expect(lines[0]!.find('b.highlight').text()).toBe('height=915312');
    expect(lines[0]!.text()).toBe(LOG.split('\n')[0]);
    expect(w.findAll('b.highlight')).toHaveLength(1);
    expect(w.find('code').text()).toBe(LOG);
  });

  it('renders markup in a line as text', () => {
    const { w } = render('peer=1 subver=<img src=x onerror=alert(1)>');
    expect(w.find('img').exists()).toBe(false);
    expect(w.find('.log-line').text()).toContain('<img src=x');
  });

  it('keeps the scroll position when the text is refreshed', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const { w, log } = render(LOG);
    const pre = w.find('pre').element as HTMLElement;
    pre.scrollTop = 40;
    log.text = `new line\n${LOG}`;
    await nextTick();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(pre.scrollTop).toBe(40);
    expect(w.findAll('.log-line')).toHaveLength(5);
    raf.mockRestore();
  });

  it('follows the interval of the log store and speaks German', async () => {
    const { w, log } = render('', 'de');
    log.interval = 5;
    await nextTick();
    expect(w.find('.hint').text()).toBe('neueste oben · alle 5 s');
  });
});
