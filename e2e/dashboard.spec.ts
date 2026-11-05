import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const lang of ['en', 'de']) {
  test(`the dashboard renders and passes axe (${lang})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`/?lang=${lang}`);
    await expect(page.locator('header h1')).toBeVisible();
    await page.waitForLoadState('networkidle');

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const found = violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`);
    expect(found).toEqual([]);
    expect(errors).toEqual([]);
  });
}
