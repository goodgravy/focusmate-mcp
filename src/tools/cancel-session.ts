import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  launchPersistentContext,
  hasAuthData,
  withErrorScreenshot
} from '../automation/browser.js';
import {
  CancelSessionInput,
  type CancelSessionOutput
} from '../schemas/session.js';
import { SessionNotFoundError, AuthExpiredError } from '../utils/errors.js';

export function registerCancelSessionTool(server: McpServer): void {
  server.tool(
    'cancel_session',
    'Cancel an existing Focusmate session by its ID.',
    {
      sessionId: CancelSessionInput.shape.sessionId
    },
    async ({ sessionId }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      // Check if authenticated
      if (!hasAuthData()) {
        const output: CancelSessionOutput = {
          success: false,
          message: 'Not authenticated. Please run focusmate_auth first.',
          errorCode: 'AUTH_REQUIRED'
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };
      }

      let context;

      try {
        // Use persistent context which preserves Firebase auth tokens in IndexedDB
        context = await launchPersistentContext({ headless: true });
        const page = context.pages()[0] || await context.newPage();

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

          // Find and click the cancel button - use the one in the Upcoming session panel
          const cancelButton = page.getByLabel('Upcoming session').getByRole('button', { name: /cancel/i }).first()
            .or(page.locator('button:has-text("Cancel session")').first());

          await cancelButton.click();

          // Handle confirmation dialog - click the "Cancel" button (not "Keep")
          const confirmCancelButton = page.getByRole('button', { name: 'Cancel', exact: true })
            .or(page.getByRole('button', { name: /confirm/i }))
            .or(page.getByRole('button', { name: /yes.*cancel/i }));

          try {
            await confirmCancelButton.waitFor({ timeout: 3000 });
            await confirmCancelButton.click();
          } catch {
            // No confirmation dialog, cancellation already processed
          }

          // Wait for success indicator or for the session to disappear from Upcoming
          const successIndicator = page.getByText(/cancelled/i)
            .or(page.getByText(/session has been cancelled/i))
            .or(page.getByRole('alert'));

          try {
            await successIndicator.waitFor({ timeout: 3000 });
          } catch {
            // If no explicit success message, check that the confirmation dialog is gone
            // and the session is no longer in the Upcoming panel
            await page.waitForTimeout(1000);
          }

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
            : error instanceof AuthExpiredError ? 'AUTH_EXPIRED'
            : 'AUTOMATION_FAILED'
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
        };

      } finally {
        if (context) {
          await context.close();
        }
      }
    }
  );
}
