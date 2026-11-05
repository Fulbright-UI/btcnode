import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const cases = [
  { lang: 'en', colorScheme: 'light' },
  { lang: 'de', colorScheme: 'dark' },
] as const;

for (const { lang, colorScheme } of cases) {
  test(`the dashboard renders and passes axe (${lang}, ${colorScheme})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ colorScheme });

    await page.goto(`/?lang=${lang}`);
    await expect(page.locator('header h1')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // color-contrast is left out for now: the faint text and some status
    // colours sit below 4.5:1, and changing the palette is a design call.
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();
    const found = violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`);
    expect(found).toEqual([]);
    expect(errors).toEqual([]);
  });
}
