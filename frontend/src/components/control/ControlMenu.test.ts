import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ControlMenu from '@/components/control/ControlMenu.vue';
import { useAuthStore } from '@/stores/auth';
import { json, setup, stubFetch } from '@/test/mount';

enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());

const session = { authenticated: true, controlAvailable: true };

function render(authenticated = false, locale: 'en' | 'de' = 'en') {
  const { global } = setup(locale);
  const auth = useAuthStore();
  auth.authenticated = authenticated;
  auth.controlAvailable = true;
  const w = mount(ControlMenu, { global, attachTo: document.body });
  return { w, auth };
}

async function open(w: ReturnType<typeof render>['w']) {
  await w.find('button.control-toggle').trigger('click');
}

describe('ControlMenu', () => {
  it('starts closed with an accessible gear toggle', () => {
    const { w } = render();
    const toggle = w.find('button.control-toggle');
    expect(toggle.attributes('aria-label')).toBe('Control');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(w.find('.control-popover').exists()).toBe(false);
    expect(w.find('.dot').exists()).toBe(false);
  });

  it('toggles the popover and shows the login form when logged out', async () => {
    const { w } = render();
    await open(w);
    expect(w.find('button.control-toggle').attributes('aria-expanded')).toBe('true');
    expect(w.find('h2').text()).toBe('Control');
    expect(w.find('input[type=password]').attributes('placeholder')).toBe('Admin password');
    const submit = w.find('button[type=submit]');
    expect(submit.text()).toBe('Log in');
    expect(submit.attributes('disabled')).toBeDefined();
    await open(w);
    expect(w.find('.control-popover').exists()).toBe(false);
  });

  it('logs in with the password and shows the actions afterwards', async () => {
    const fetch = stubFetch((url) =>
      url === '/api/auth/login'
        ? json({ ...session, actions: ['restart-bitcoind', 'reboot', 'poweroff'] })
        : json({}, 404),
    );
    const { w, auth } = render();
    await open(w);
    await w.find('input[type=password]').setValue('secret');
    expect(w.find('button[type=submit]').attributes('disabled')).toBeUndefined();
    await w.find('form').trigger('submit');
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ password: 'secret' });
    expect(auth.authenticated).toBe(true);
    expect(w.find('.dot').exists()).toBe(true);
    // no electrs on this host: three actions, the two dangerous ones marked
    const buttons = w.findAll('.control-actions button');
    expect(buttons.map((b) => b.text())).toEqual([
      'Restart bitcoind',
      'Reboot the Pi',
      'Shut the Pi down',
    ]);
    expect(buttons.map((b) => b.classes('danger'))).toEqual([false, true, true]);
    expect(w.find('.control-head button').text()).toBe('Log out');
  });

  it.each([
    [401, 'Wrong password'],
    [429, 'Too many attempts. Wait a minute'],
    [500, 'Control is not reachable right now'],
  ])('translates a login failure with HTTP %i', async (status, message) => {
    stubFetch(() => json({}, status));
    const { w, auth } = render();
    await open(w);
    await w.find('input[type=password]').setValue('nope');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(auth.authenticated).toBe(false);
    const p = w.find('.control-status');
    expect(p.text()).toBe(message);
    expect(p.classes()).toContain('error');
    // the password field is cleared after every attempt
    expect((w.find('input[type=password]').element as HTMLInputElement).value).toBe('');
  });

  it('asks for confirmation, runs the action and reports success', async () => {
    const fetch = stubFetch((url) =>
      url === '/api/control' ? json({ ok: true, action: 'restart-electrs' }) : json({}, 404),
    );
    const { w } = render(true);
    await open(w);
    const buttons = w.findAll('.control-actions button');
    expect(buttons).toHaveLength(4);
    await buttons[1]!.trigger('click');
    expect(w.find('.control-confirm span').text()).toBe('Really Restart electrs?');
    expect(w.find('.control-actions').exists()).toBe(false);
    await w.find('.control-confirm button.primary').trigger('click');
    await flushPromises();
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      action: 'restart-electrs',
    });
    expect(w.find('.control-confirm').exists()).toBe(false);
    const status = w.find('.control-status');
    expect(status.text()).toBe('Done: Restart electrs');
    expect(status.classes()).toContain('good');
  });

  it('reports a failed action with the backend message', async () => {
    stubFetch(() => json({ ok: false, action: 'reboot', message: 'agent busy' }));
    const { w } = render(true);
    await open(w);
    await w.findAll('.control-actions button')[2]!.trigger('click');
    await w.find('.control-confirm button.primary').trigger('click');
    await flushPromises();
    const status = w.find('.control-status');
    expect(status.text()).toBe('Failed: agent busy');
    expect(status.classes()).toContain('error');
  });

  it('logs out when the session expired during an action', async () => {
    stubFetch(() => json({}, 401));
    const { w, auth } = render(true);
    await open(w);
    await w.findAll('.control-actions button')[0]!.trigger('click');
    await w.find('.control-confirm button.primary').trigger('click');
    await flushPromises();
    expect(auth.authenticated).toBe(false);
    expect(w.find('form.control-form').exists()).toBe(true);
  });

  it('shows the poweroff hint while confirming and cancels back to the list', async () => {
    const fetch = stubFetch();
    const { w } = render(true);
    await open(w);
    await w.findAll('.control-actions button')[3]!.trigger('click');
    expect(w.find('.control-status').text()).toContain('bitcoind stops cleanly first');
    const cancel = w.findAll('.control-confirm button')[1]!;
    expect(cancel.text()).toBe('Cancel');
    await cancel.trigger('click');
    expect(w.find('.control-actions').exists()).toBe(true);
    expect(w.find('.control-status').text()).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a click outside, dropping a pending confirmation', async () => {
    const { w } = render(true);
    await open(w);
    await w.findAll('.control-actions button')[2]!.trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.find('.control-popover').exists()).toBe(false);

    await open(w);
    // the confirmation did not survive closing
    expect(w.find('.control-actions').exists()).toBe(true);
    // other keys and clicks inside keep it open
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await w.find('.control-popover').trigger('mousedown');
    expect(w.find('.control-popover').exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await w.vm.$nextTick();
    expect(w.find('.control-popover').exists()).toBe(false);
  });

  it('closing with the toggle drops a pending confirmation', async () => {
    const { w } = render(true);
    await open(w);
    await w.findAll('.control-actions button')[0]!.trigger('click');
    await open(w);
    await open(w);
    expect(w.find('.control-confirm').exists()).toBe(false);
  });

  it('logs out through the header button', async () => {
    const fetch = stubFetch(() => json({ authenticated: false, controlAvailable: true }));
    const { w, auth } = render(true);
    await open(w);
    await w.find('.control-head button').trigger('click');
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.anything());
    expect(auth.authenticated).toBe(false);
  });

  it('speaks German', async () => {
    const { w } = render(true, 'de');
    await open(w);
    expect(w.find('h2').text()).toBe('Steuerung');
    expect(w.find('.control-actions button').text()).toBe('bitcoind neu starten');
  });
});
