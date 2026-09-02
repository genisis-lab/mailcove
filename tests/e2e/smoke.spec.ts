import { expect, test, type Page } from '@playwright/test';

const email = process.env.MAILCOVE_E2E_EMAIL ?? 'admin@example.com';
const password = process.env.MAILCOVE_E2E_PASSWORD ?? 'mailcove-e2e-passw0rd';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/mail\//, { timeout: 20_000 });
}

test('health endpoint is up', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).service).toBe('mailcove');
});

test('setup or login reaches the inbox, then compose opens', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/setup')) {
    const continueBtn = page.getByRole('button', { name: /continue|next|get started|create/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) await continueBtn.click();
    if (await page.getByLabel('Name').isVisible().catch(() => false)) {
      await page.getByLabel('Name').fill('E2E Admin');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: false }).first().fill(password);
      const confirm = page.getByLabel(/confirm|repeat/i);
      if (await confirm.isVisible().catch(() => false)) await confirm.fill(password);
      await page.getByRole('button', { name: /create|continue/i }).click();
    }
  }

  if (page.url().includes('/login')) {
    await signIn(page);
  }

  await expect(page.getByRole('button', { name: /compose/i }).or(page.getByRole('link', { name: /compose/i }))).toBeVisible({
    timeout: 20_000,
  });

  await page.keyboard.press('c');
  await expect(page.getByText(/new message|to/i).first()).toBeVisible({ timeout: 10_000 });
});
