import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopyField from '@/components/cards/CopyField.vue';
import { setup } from '@/test/mount';

enableAutoUnmount(afterEach);

const VALUE = 'electrsexample.onion:50001';

function stubClipboard(writeText: (text: string) => Promise<void>, secure = true) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
}

function render(locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  return mount(CopyField, {
    global,
    props: { label: 'Over Tor', value: VALUE },
    attachTo: document.body,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.getSelection()?.removeAllRanges();
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('CopyField', () => {
  it('shows label and value with an accessible copy button', () => {
    const w = render();
    expect(w.find('.copy-label').text()).toBe('Over Tor');
    expect(w.find('.copy-text').text()).toBe(VALUE);
    const button = w.find('button');
    expect(button.attributes('aria-label')).toBe('copy Over Tor');
    expect(button.attributes('title')).toBeUndefined();
    expect(button.classes()).not.toContain('done');
  });

  it('copies the value and confirms briefly', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const w = render();
    await w.find('button').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(VALUE);
    const button = w.find('button');
    expect(button.classes()).toContain('done');
    expect(button.attributes('title')).toBe('copied');
    vi.advanceTimersByTime(1200);
    await flushPromises();
    expect(w.find('button').classes()).not.toContain('done');
  });

  it('selects the text instead outside a secure context', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText, false);
    const w = render();
    await w.find('button').trigger('click');
    await flushPromises();
    expect(writeText).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe(VALUE);
    expect(w.find('button').classes()).not.toContain('done');
  });

  it('selects the text when the clipboard refuses', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    const w = render();
    await w.find('button').trigger('click');
    await flushPromises();
    expect(window.getSelection()?.toString()).toBe(VALUE);
  });

  it('speaks German', async () => {
    stubClipboard(() => Promise.resolve());
    const w = render('de');
    expect(w.find('button').attributes('aria-label')).toBe('Over Tor kopieren');
    await w.find('button').trigger('click');
    await flushPromises();
    expect(w.find('button').attributes('title')).toBe('kopiert');
  });
});
