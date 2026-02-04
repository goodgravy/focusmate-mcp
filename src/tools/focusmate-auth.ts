import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  launchBrowser,
  closeBrowser,
  createFreshContext,
  isLoggedIn,
  LOGIN_URL,
  DASHBOARD_URL
} from '../automation/browser.js';
import { saveCookies, hasCookies, deleteCookies } from '../automation/cookies.js';
import type { AuthOutput } from '../schemas/session.js';

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to complete login

export function registerFocusmateAuthTool(server: McpServer): void {
  server.tool(
    'focusmate_auth',
    'Open a browser window to log into FocusMate. Cookies will be saved for future use.',
    {
      force: z.boolean()
        .default(false)
        .describe('Force re-authentication even if valid cookies exist')
    },
    async ({ force }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      // Check if already authenticated
      if (!force && hasCookies()) {
        const output: AuthOutput = {
          success: true,
          message: 'Already authenticated. Use force=true to re-authenticate.'
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      }

      // Clear existing cookies if forcing
      if (force) {
        deleteCookies();
      }

      let browser;
      let context;

      try {
        // Launch headed browser for interactive login
        browser = await launchBrowser({ headless: false, slowMo: 100 });
        context = await createFreshContext(browser);
        const page = await context.newPage();

        // Navigate to login page
        await page.goto(LOGIN_URL);

        // Wait for user to complete login
        // We detect successful login by checking for dashboard URL or logged-in state
        const startTime = Date.now();

        while (Date.now() - startTime < AUTH_TIMEOUT_MS) {
          await page.waitForTimeout(1000);

          const currentUrl = page.url();

          // Check if we've been redirected to dashboard or another authenticated page
          if (currentUrl.includes('/dashboard') || currentUrl.includes('/home')) {
            // Verify we're actually logged in
            if (await isLoggedIn(page)) {
              // Save cookies
              await saveCookies(context);

              const output: AuthOutput = {
                success: true,
                message: 'Successfully authenticated and saved credentials.'
              };

              return {
                content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
              };
            }
          }
        }

        // Timeout reached
        const output: AuthOutput = {
          success: false,
          message: 'Authentication timed out. Please try again.',
          errorCode: 'AUTH_TIMEOUT'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } finally {
        // Clean up
        if (context) {
          await context.close();
        }
        if (browser) {
          await browser.close();
        }
      }
    }
  );
}
