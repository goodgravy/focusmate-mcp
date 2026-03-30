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

const MAX_RETRIES = 1;

export function registerCancelSessionTool(server: McpServer): void {
  server.tool(
    'cancel_session',
    'Cancel an existing Focusmate session by its ID.',
    {
      sessionId: CancelSessionInput.shape.sessionId
    },
    async ({ sessionId }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
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

      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let context;
        try {
          context = await launchPersistentContext({ headless: true });
          const page = context.pages()[0] || await context.newPage();

          await withErrorScreenshot(page, `cancel-session-attempt-${attempt}`, async () => {
            // Navigate to the dashboard where upcoming sessions are shown
            await page.goto('https://app.focusmate.com/dashboard', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(1000);

            if (page.url().includes('/login')) {
              throw new AuthExpiredError();
            }

            // Wait for the page to load
            await page.waitForLoadState('networkidle');

            // Find the session card and its cancel/clear button
            // Strategy 1: Look for a session card that links to this session ID
            const sessionLink = page.locator(`a[href*="${sessionId}"]`);
            const hasLink = await sessionLink.count() > 0;

            if (hasLink) {
              // Find the cancel button near this session link
              const sessionCard = sessionLink.locator('..').locator('..');
              const cancelBtn = sessionCard.getByRole('button', { name: /cancel|clear|×/i }).first();

              if (await cancelBtn.isVisible()) {
                await cancelBtn.click();
              } else {
                // Try clicking a menu/options button first
                const menuBtn = sessionCard.getByRole('button').first();
                await menuBtn.click();
                await page.waitForTimeout(300);

                const cancelOption = page.getByRole('menuitem', { name: /cancel/i })
                  .or(page.getByRole('button', { name: /cancel/i }))
                  .first();
                await cancelOption.click();
              }
            } else {
              // Strategy 2: Navigate directly to the session page
              await page.goto(`https://app.focusmate.com/session/${sessionId}`, {
                waitUntil: 'networkidle'
              });

              if (page.url().includes('/login')) {
                throw new AuthExpiredError();
              }

              // Check for 404
              const notFound = await page.getByText(/not found/i)
                .or(page.getByText(/doesn't exist/i))
                .isVisible()
                .catch(() => false);

              if (notFound) {
                throw new SessionNotFoundError(sessionId);
              }

              // Find cancel button on session page
              const cancelButton = page.getByRole('button', { name: /cancel/i }).first();
              await cancelButton.waitFor({ timeout: 5000 });
              await cancelButton.click();
            }

            // Handle confirmation dialog
            const confirmButton = page.getByRole('button', { name: /cancel/i }).last()
              .or(page.getByRole('button', { name: /confirm/i }))
              .or(page.getByRole('button', { name: /yes/i }));

            try {
              await confirmButton.waitFor({ timeout: 3000 });
              await confirmButton.click();
            } catch {
              // No confirmation needed
            }

            // Wait for success indication
            await page.waitForTimeout(1500);
          });

          const output: CancelSessionOutput = {
            success: true,
            message: `Session ${sessionId} has been cancelled.`
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
          };

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (error instanceof SessionNotFoundError || error instanceof AuthExpiredError) {
            break;
          }

          if (attempt < MAX_RETRIES) {
            console.error(`Cancel attempt ${attempt + 1} failed, retrying: ${lastError.message}`);
          }
        } finally {
          if (context) {
            await context.close();
          }
        }
      }

      const output: CancelSessionOutput = {
        success: false,
        message: lastError?.message || 'Unknown error occurred',
        errorCode: lastError instanceof SessionNotFoundError ? 'SESSION_NOT_FOUND'
          : lastError instanceof AuthExpiredError ? 'AUTH_EXPIRED'
          : 'AUTOMATION_FAILED'
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
      };
    }
  );
}
