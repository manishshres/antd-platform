import { test, expect } from '@playwright/test';

test.describe('Page-by-page Validation', () => {
  test.beforeEach(async ({ page }) => {
    // Login as platform admin before each test
    await page.goto('/login');
    await page.fill('input#login_email', 'admin@manish.dev');
    await page.fill('input#login_password', 'admin123');
    await Promise.all([
      page.waitForURL('**/dashboard', { timeout: 15000 }),
      page.click('button[type="submit"]')
    ]);
  });

  test('Dashboard loads properly', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-layout-content').first()).toBeVisible();
  });

  test('Settings page loads tabs correctly', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const tabs = ['Organization', 'Locations', 'API Keys', 'Webhooks', 'Billing', 'SMTP Settings', 'Email Templates', 'Authentication'];
    for (const tab of tabs) {
      await expect(page.locator(`text=${tab}`).first()).toBeVisible();
    }
  });

  test('Platform Admin page renders provisioning summary and list', async ({ page }) => {
    await page.goto('/platform-admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Platform Administration').first()).toBeVisible();
    await expect(page.locator('text=Provision New Organization').first()).toBeVisible();
  });

  test('Health dashboard loads and shows UP status', async ({ page }) => {
    await page.goto('/admin/health');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=System Health Dashboard').first()).toBeVisible();
  });

  test('Provisioning wizard loads properly', async ({ page }) => {
    await page.goto('/provisioning/new');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=New Tenant Provisioning').first()).toBeVisible();
    await expect(page.locator('text=Business Info').first()).toBeVisible();
  });
});
