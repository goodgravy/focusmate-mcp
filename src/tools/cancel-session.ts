import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  launchBrowser,
  createAuthenticatedContext,
  withErrorScreenshot
} from '../automation/browser.js';
import {
  CancelSessionInput,
  type CancelSessionOutput
} from '../schemas/session.js';
import { SessionNotFoundError } from '../utils/errors.js';

export function registerCancelSessionTool(server: McpServer): void {
  server.tool(
    'cancel_session',
    'Cancel an existing FocusMate session by its ID.',
    {
      sessionId: CancelSessionInput.shape.sessionId
    },
    async ({ sessionId }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      let browser;
      let context;

      try {
        browser = await launchBrowser({ headless: true });
        context = await createAuthenticatedContext(browser);
        const page = await context.newPage();

        const result = await withErrorScreenshot(page, 'cancel-session', async () => {
          // Navigate directly to the session page
          const sessionUrl = `https://app.focusmate.com/session/${sessionId}`;
          await page.goto(sessionUrl, { waitUntil: 'networkidle' });

          // Check if we got redirected to login (auth expired)
          if (page.url().includes('/login')) {
            throw new Error('Authentication expired. Please run focusmate_auth to log in again.');
          }

          // Check if session exists (404 or error page)
          const notFoundIndicator = page.getByText(/not found/i)
            .or(page.getByText(/doesn't exist/i))
            .or(page.getByText(/404/i));

          try {
            await notFoundIndicator.waitFor({ timeout: 2000 });
            throw new SessionNotFoundError(sessionId);
          } catch (e) {
            if (e instanceof SessionNotFoundError) {
              throw e;
            }
            // Session exists, continue
          }

          // Find and click the cancel button
          const cancelButton = page.getByRole('button', { name: /cancel/i })
            .or(page.locator('button:has-text("Cancel session")'))
            .or(page.locator('[data-testid="cancel-button"]'));

          await cancelButton.click();

          // Handle confirmation dialog if present
          const confirmCancelButton = page.getByRole('button', { name: /confirm/i })
            .or(page.getByRole('button', { name: /yes.*cancel/i }))
            .or(page.locator('[data-testid="confirm-cancel"]'));

          try {
            await confirmCancelButton.waitFor({ timeout: 3000 });
            await confirmCancelButton.click();
          } catch {
            // No confirmation dialog, cancellation already processed
          }

          // Wait for success indicator
          const successIndicator = page.getByText(/cancelled/i)
            .or(page.getByText(/session has been cancelled/i))
            .or(page.getByRole('alert'));

          await successIndicator.waitFor({ timeout: 5000 });

          return true;
        });

        const output: CancelSessionOutput = {
          success: true,
          message: `Session ${sessionId} has been cancelled.`
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } catch (error) {
        const output: CancelSessionOutput = {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          errorCode: error instanceof SessionNotFoundError ? 'SESSION_NOT_FOUND'
            : 'AUTOMATION_FAILED'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } finally {
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
