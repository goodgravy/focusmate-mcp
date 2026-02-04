import type { Page, Locator } from 'playwright';
import type { SessionDuration } from '../../schemas/session.js';

export class BookingPage {
  readonly page: Page;

  // Duration selection buttons
  readonly duration25Button: Locator;
  readonly duration50Button: Locator;
  readonly duration75Button: Locator;

  // Calendar elements
  readonly calendar: Locator;
  readonly confirmBookingButton: Locator;
  readonly cancelButton: Locator;

  // Confirmation dialog
  readonly confirmationMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Duration buttons - try multiple selector strategies
    this.duration25Button = page.getByRole('button', { name: /25/i })
      .or(page.locator('button:has-text("25")'))
      .or(page.locator('[data-duration="25"]'));

    this.duration50Button = page.getByRole('button', { name: /50/i })
      .or(page.locator('button:has-text("50")'))
      .or(page.locator('[data-duration="50"]'));

    this.duration75Button = page.getByRole('button', { name: /75/i })
      .or(page.locator('button:has-text("75")'))
      .or(page.locator('[data-duration="75"]'));

    // Calendar - try common patterns
    this.calendar = page.getByRole('grid', { name: /calendar/i })
      .or(page.locator('[data-testid="calendar"]'))
      .or(page.locator('.calendar'))
      .or(page.locator('[role="grid"]'));

    // Confirm/Book button
    this.confirmBookingButton = page.getByRole('button', { name: /book.*session/i })
      .or(page.getByRole('button', { name: /schedule/i }))
      .or(page.locator('button:has-text("Book")'));

    // Cancel button
    this.cancelButton = page.getByRole('button', { name: /cancel/i });

    // Confirmation message
    this.confirmationMessage = page.getByText(/session.*booked/i)
      .or(page.getByText(/successfully.*scheduled/i))
      .or(page.getByRole('alert'));
  }

  async selectDuration(duration: SessionDuration): Promise<void> {
    switch (duration) {
      case '25':
        await this.duration25Button.click();
        break;
      case '50':
        await this.duration50Button.click();
        break;
      case '75':
        await this.duration75Button.click();
        break;
    }
    // Wait for calendar to update
    await this.page.waitForTimeout(500);
  }

  async selectTimeSlot(targetDate: Date): Promise<void> {
    // Format the time to find the right slot
    const hours = targetDate.getHours();
    const minutes = targetDate.getMinutes();

    // FocusMate slots are every 15 minutes
    // Round to nearest 15-minute slot
    const roundedMinutes = Math.round(minutes / 15) * 15;
    const slotMinutes = roundedMinutes === 60 ? 0 : roundedMinutes;
    const slotHours = roundedMinutes === 60 ? hours + 1 : hours;

    // Format as HH:MM for searching
    const timeStr = `${slotHours.toString().padStart(2, '0')}:${slotMinutes.toString().padStart(2, '0')}`;

    // Also format in 12-hour for alternative search
    const hour12 = slotHours > 12 ? slotHours - 12 : (slotHours === 0 ? 12 : slotHours);
    const ampm = slotHours >= 12 ? 'PM' : 'AM';
    const time12Str = `${hour12}:${slotMinutes.toString().padStart(2, '0')} ${ampm}`;

    // Try to find and click the time slot
    // Strategy 1: Look for button with exact time
    const timeSlotButton = this.page.getByRole('button', { name: new RegExp(timeStr) })
      .or(this.page.getByRole('button', { name: new RegExp(time12Str, 'i') }))
      .or(this.page.locator(`[data-time="${timeStr}"]`))
      .or(this.page.locator(`button:has-text("${timeStr}")`));

    // First, we may need to navigate to the correct date
    await this.navigateToDate(targetDate);

    // Then click the time slot
    await timeSlotButton.first().click();
  }

  private async navigateToDate(targetDate: Date): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);

    // Calculate days difference
    const daysDiff = Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0) {
      throw new Error('Cannot book sessions in the past');
    }

    if (daysDiff > 0) {
      // Click the appropriate date on the calendar
      // Format for finding the date
      const dayOfMonth = targetDate.getDate();
      const monthName = targetDate.toLocaleDateString('en-US', { month: 'long' });

      // Try to click the date
      const dateButton = this.page.getByRole('button', { name: new RegExp(`${dayOfMonth}`) })
        .filter({ hasText: new RegExp(dayOfMonth.toString()) })
        .or(this.page.locator(`[data-date="${targetDate.toISOString().split('T')[0]}"]`));

      // If the date is in a different month, we may need to navigate months first
      // This is a simplified approach - may need enhancement
      try {
        await dateButton.first().click({ timeout: 2000 });
      } catch {
        // Try navigating to next month/week if needed
        const nextButton = this.page.getByRole('button', { name: /next/i })
          .or(this.page.locator('[aria-label="Next"]'));
        await nextButton.click();
        await this.page.waitForTimeout(500);
        await dateButton.first().click();
      }
    }
  }

  async confirmBooking(): Promise<void> {
    await this.confirmBookingButton.click();

    // Wait for confirmation
    await this.confirmationMessage.waitFor({ timeout: 10000 });
  }

  async getConfirmationDetails(): Promise<{sessionId?: string}> {
    // Try to extract session details from the confirmation
    // This will need to be refined based on actual UI
    const confirmationText = await this.confirmationMessage.textContent();

    // Try to find a link to the session
    const sessionLink = this.page.locator('a[href*="/session/"]');
    let sessionId: string | undefined;

    try {
      const href = await sessionLink.first().getAttribute('href', { timeout: 2000 });
      if (href) {
        const match = href.match(/\/session\/([^/?]+)/);
        if (match) {
          sessionId = match[1];
        }
      }
    } catch {
      // Session ID not found in link, may be in URL or elsewhere
    }

    return { sessionId };
  }

  async isSlotAvailable(): Promise<boolean> {
    // Check if the slot shows as available (not grayed out, not already booked)
    const unavailableIndicator = this.page.getByText(/not available/i)
      .or(this.page.getByText(/fully booked/i))
      .or(this.page.locator('.unavailable'));

    try {
      await unavailableIndicator.waitFor({ timeout: 1000 });
      return false;
    } catch {
      return true;
    }
  }

  async hasConflict(): Promise<boolean> {
    // Check if there's already a session at this time
    const conflictIndicator = this.page.getByText(/already have a session/i)
      .or(this.page.getByText(/conflict/i));

    try {
      await conflictIndicator.waitFor({ timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }
}
