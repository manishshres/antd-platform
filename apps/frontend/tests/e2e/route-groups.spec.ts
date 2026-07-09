import { test, expect } from '@playwright/test';

/**
 * Route-group split (#8): public auth pages live under app/(auth) with a minimal
 * layout, while authenticated pages live under app/(dashboard) behind DashboardLayout
 * (which mounts LocationProvider / SocketProvider / NotificationsProvider).
 *
 * These tests assert the split's observable guarantees. None of them log in or fetch
 * protected data, so they need only the frontend dev server running (no backend).
 */
test.describe('Auth vs dashboard route groups (#8)', () => {
  test('unauthenticated dashboard route redirects to /login', async ({
    page,
  }) => {
    // The proxy middleware gates protected paths on the refresh_token cookie.
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await page.waitForURL('**/login', { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('login page does not mount the dashboard chrome', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // The (auth) layout renders no sidebar — DashboardLayout is not in the tree.
    await expect(page.locator('.ant-layout-sider')).toHaveCount(0);
    // The login form itself should be present.
    await expect(page.locator('input#login_email')).toBeVisible();
  });

  test('login page opens no realtime socket connection', async ({ page }) => {
    // SocketProvider only lives in the (dashboard) group, so a visitor to /login
    // must not open the app's realtime socket. Ignore Next.js's dev-mode HMR
    // websocket (_next/*) and match only the socket.io connection to the API.
    let socketOpened = false;
    page.on('websocket', (ws) => {
      if (/socket\.io|:4000/.test(ws.url())) {
        socketOpened = true;
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    // Give any stray effect a moment to (not) fire.
    await page.waitForTimeout(1500);

    expect(socketOpened).toBe(false);
  });
});
