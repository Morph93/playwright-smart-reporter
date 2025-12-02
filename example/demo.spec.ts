import { test, expect } from '@playwright/test';

// 1. A test that always passes (baseline)
test('homepage loads successfully', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// 2. A test that always fails (triggers AI analysis)
test('broken login - element not found', async ({ page }) => {
  await page.goto('https://playwright.dev');
  // This will fail - no such element exists
  await expect(page.locator('#login-button-that-does-not-exist')).toBeVisible({
    timeout: 2000,
  });
});

// 3. A test that's artificially slow (triggers performance alert after baseline)
test('slow navigation test', async ({ page }) => {
  // Artificial delay to simulate slow test
  await page.waitForTimeout(3000);
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// 4. A flaky test (50% chance of failure - demonstrates flakiness detection)
test('flaky behavior - random failure', async ({ page }) => {
  await page.goto('https://playwright.dev');

  // 50% chance of failure
  if (Math.random() > 0.5) {
    // This will fail
    await expect(
      page.locator('#element-that-randomly-appears')
    ).toBeVisible({ timeout: 1000 });
  } else {
    // This will pass
    await expect(page.locator('h1')).toBeVisible();
  }
});

// 5. A skipped test (shows skip handling)
test.skip('skipped test - not implemented yet', async ({ page }) => {
  await page.goto('https://playwright.dev');
  // TODO: Implement this test
});

// 6. Another passing test for variety
test('documentation link works', async ({ page }) => {
  await page.goto('https://playwright.dev');
  const docsLink = page.getByRole('link', { name: 'Docs' });
  await expect(docsLink).toBeVisible();
});
