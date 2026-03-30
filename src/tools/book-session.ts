import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  launchPersistentContext,
  hasAuthData,
  navigateToDashboard,
  withErrorScreenshot
} from '../automation/browser.js';
import { BookingPage } from '../automation/pages/booking.js';
import {
  BookSessionInput,
  type BookSessionOutput,
  type Session,
  type SessionDuration
} from '../schemas/session.js';
import {
  SlotUnavailableError,
  SessionConflictError,
  AuthExpiredError
} from '../utils/errors.js';

const MAX_RETRIES = 2;

export function registerBookSessionTool(server: McpServer): void {
  server.tool(
    'book_session',
    'Book a Focusmate accountability session for a specific date, time, and duration.',
    {
      startTime: BookSessionInput.shape.startTime,
      duration: BookSessionInput.shape.duration
    },
    async ({ startTime, duration }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const targetDate = new Date(startTime);

      // Validate the time is in the future
      if (targetDate <= new Date()) {
        return errorResponse('Cannot book sessions in the past.', 'INVALID_TIME');
      }

      // Validate time is on a 15-minute boundary
      const minutes = targetDate.getMinutes();
      if (minutes % 15 !== 0) {
        const h = targetDate.getHours();
        return errorResponse(
          `Invalid time. Focusmate sessions start every 15 minutes. ` +
          `Choose a time like ${h}:00, ${h}:15, ${h}:30, or ${h}:45.`,
          'INVALID_TIME'
        );
      }

      if (!hasAuthData()) {
        return errorResponse('Not authenticated. Please run focusmate_auth first.', 'AUTH_REQUIRED');
      }

      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let context;
        try {
          context = await launchPersistentContext({ headless: true });
          const page = context.pages()[0] || await context.newPage();

          await navigateToDashboard(page);

          const result = await withErrorScreenshot(page, `book-session-attempt-${attempt}`, async () => {
            const bookingPage = new BookingPage(page);

            // Start capturing API requests to extract session details
            await bookingPage.startRequestCapture();

            await bookingPage.selectDuration(duration as SessionDuration);
            await bookingPage.selectTimeSlot(targetDate);

            if (await bookingPage.hasConflict()) {
              throw new SessionConflictError();
            }

            if (!await bookingPage.isSlotAvailable()) {
              throw new SlotUnavailableError();
            }

            await bookingPage.confirmBooking();

            const { sessionId } = await bookingPage.getConfirmationDetails();

            const endTime = new Date(targetDate);
            endTime.setMinutes(endTime.getMinutes() + parseInt(duration));

            const session: Session = {
              id: sessionId || `temp-${Date.now()}`,
              startTime: targetDate.toISOString(),
              endTime: endTime.toISOString(),
              duration: parseInt(duration),
              status: 'pending',
              partnerId: null,
              partnerName: null
            };

            return session;
          });

          const output: BookSessionOutput = { success: true, session: result };
          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
          };

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Don't retry for known non-transient errors
          if (
            error instanceof SlotUnavailableError ||
            error instanceof SessionConflictError ||
            error instanceof AuthExpiredError
          ) {
            break;
          }

          // Log retry attempt
          if (attempt < MAX_RETRIES) {
            console.error(`Booking attempt ${attempt + 1} failed, retrying: ${lastError.message}`);
          }
        } finally {
          if (context) {
            await context.close();
          }
        }
      }

      // All retries exhausted
      const output: BookSessionOutput = {
        success: false,
        error: lastError?.message || 'Unknown error occurred',
        errorCode: lastError instanceof SlotUnavailableError ? 'SLOT_UNAVAILABLE'
          : lastError instanceof SessionConflictError ? 'SESSION_CONFLICT'
          : lastError instanceof AuthExpiredError ? 'AUTH_EXPIRED'
          : 'AUTOMATION_FAILED'
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
      };
    }
  );
}

function errorResponse(
  error: string,
  errorCode: string
): { content: Array<{ type: 'text'; text: string }> } {
  const output: BookSessionOutput = { success: false, error, errorCode };
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }]
  };
}
