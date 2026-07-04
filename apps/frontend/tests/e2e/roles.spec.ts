import { test, expect } from '@playwright/test';

const ROLES = [
  {
    name: 'Platform Admin',
    email: 'admin@manish.dev',
    password: 'admin123',
    expectedLinks: [
      'Dashboard', 'Call Logs', 'Recordings', 'Conversations', 
      'Orders', 'Menu', 'Printers', 'Team Members', 
      'Analytics', 'Platform Admin', 'Platform Health', 'Audit Logs', 'Settings', 'My Profile'
    ]
  },
  {
    name: 'System Admin',
    email: 'sysadmin@test.com',
    password: 'password123',
    expectedLinks: [
      'Dashboard', 'Call Logs', 'Recordings', 'Conversations', 
      'Orders', 'Menu', 'Printers', 'Team Members', 
      'Analytics', 'Audit Logs', 'Settings', 'My Profile'
    ]
  },
  {
    name: 'Admin',
    email: 'admin@test.com',
    password: 'password123',
    expectedLinks: [
      'Dashboard', 'Call Logs', 'Recordings', 'Conversations', 
      'Orders', 'Menu', 'Printers', 'Team Members', 
      'Analytics', 'Settings', 'My Profile'
    ]
  },
  {
    name: 'Regular User',
    email: 'user@test.com',
    password: 'password123',
    expectedLinks: [
      'Dashboard', 'Call Logs', 'Orders', 'My Profile'
    ]
  }
];

for (const role of ROLES) {
  test.describe(`Role Audit: ${role.name}`, () => {
    
    test('Should login, verify navigation, and navigate without errors', async ({ page }) => {
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];

      // Monitor console for errors (filter out typical Next.js dev noise if needed)
      page.on('console', msg => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Ignore known noise from Next.js dev server and Ant Design deprecation warnings
          if (
            text.includes('Warning: React does not recognize') ||
            text.includes('Warning: [antd:') ||
            text.includes('Download the React DevTools') ||
            text.includes('Failed to load resource') // handled by request monitoring
          ) {
            return;
          }
          console.error(`[${role.name}] CONSOLE ERROR:`, text);
          consoleErrors.push(text);
        }
      });

      // Monitor network for failures
      page.on('requestfailed', request => {
        // Ignore favicon and other non-critical resources
        if (request.url().includes('favicon') || request.url().includes('_next/static')) return;
        if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
        const err = `${request.method()} ${request.url()} - ${request.failure()?.errorText}`;
        console.error(`[${role.name}] NETWORK FAILURE:`, err);
        failedRequests.push(err);
      });
      page.on('response', response => {
        // Allow 401 (auth redirects) and 404 (missing optional resources)
        if (response.status() >= 400 && response.status() !== 401 && response.status() !== 404) {
          const url = response.url();
          // Ignore Next.js internal requests
          if (url.includes('_next/') || url.includes('__nextjs')) return;
          const err = `${response.request().method()} ${url} returned ${response.status()}`;
          console.error(`[${role.name}] API ERROR:`, err);
          failedRequests.push(err);
        }
      });

      // 1. Login
      await page.goto('/login');
      await page.fill('input#login_email', role.email);
      await page.fill('input#login_password', role.password);
      
      // Wait for navigation after clicking submit
      await Promise.all([
        page.waitForURL('**/dashboard', { timeout: 15000 }),
        page.click('button[type="submit"]')
      ]);

      // 2. Verify sidebar links
      await page.waitForSelector('.ant-layout-sider', { timeout: 10000 });
      
      // Wait for the menu to fully render
      await page.waitForLoadState('networkidle');
      
      // We will look for span.ant-menu-title-content inside the sidebar
      const linkElements = await page.$$eval('.ant-layout-sider .ant-menu-title-content', els => 
        els.map(e => (e as HTMLElement).innerText.trim())
      );
      
      // The actual links rendered in the sidebar menu
      const actualLinks = linkElements;
      
      for (const expected of role.expectedLinks) {
        expect(actualLinks, `Missing expected link: ${expected}`).toContain(expected);
      }
      
      // Check for extra links that shouldn't be there
      for (const actual of actualLinks) {
        expect(role.expectedLinks, `Found unauthorized link: ${actual}`).toContain(actual);
      }

      // 3. Click each link to make sure it loads and doesn't throw console errors
      for (const linkText of role.expectedLinks) {
        // Find the link by exact text and trigger a DOM click to bypass Next.js dev overlays
        await page.$$eval('.ant-layout-sider .ant-menu-title-content', (els, text) => {
          const el = els.find(e => (e as HTMLElement).innerText.trim() === text);
          if (el) (el as HTMLElement).click();
        }, linkText);
        
        // Wait for the page to settle (APIs + rendering) instead of using fixed timeout
        await page.waitForLoadState('networkidle');
      }

      // 4. Assert no severe console errors or failed API requests
      if (consoleErrors.length > 0 || failedRequests.length > 0) {
        console.error(`[${role.name}] Test encountered errors:\nConsole:`, consoleErrors, '\nNetwork:', failedRequests);
      }
      
      expect(consoleErrors, `Console errors detected for ${role.name}`).toEqual([]);
      expect(failedRequests, `Network failures detected for ${role.name}`).toEqual([]);
      
      // 5. Logout by clearing token to ensure clean state for next test
      await page.evaluate(() => localStorage.removeItem('access_token'));
      await page.goto('/login');
      await page.waitForLoadState('domcontentloaded');
    });
  });
}
