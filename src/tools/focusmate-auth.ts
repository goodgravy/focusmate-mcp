import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  launchPersistentContext,
  hasAuthData,
  clearAuthData,
  isLoggedIn,
  LOGIN_URL
} from '../automation/browser.js';
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
      if (!force && hasAuthData()) {
        const output: AuthOutput = {
          success: true,
          message: 'Already authenticated. Use force=true to re-authenticate.'
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      }

      // Clear existing auth data if forcing
      if (force) {
        clearAuthData();
      }

      let context;

      try {
        // Launch headed browser with persistent context for interactive login
        // This preserves IndexedDB where Firebase stores auth tokens
        context = await launchPersistentContext({ headless: false, slowMo: 100 });
        const page = context.pages()[0] || await context.newPage();

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
              // Auth data is automatically persisted in user data directory
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
        // Close context - data is persisted in user data directory
        if (context) {
          await context.close();
        }
      }
    }
  );
}
