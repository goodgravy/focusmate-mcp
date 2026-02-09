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

    // Confirm/Book button - specifically the "Book N session(s)" button at the bottom
    this.confirmBookingButton = page.getByRole('button', { name: /book \d+ session/i });

    // Cancel button
    this.cancelButton = page.getByRole('button', { name: /cancel/i });

    // Confirmation message - look for the specific toast text
    this.confirmationMessage = page.getByText(/\d+ session[s]? booked/i).first();
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
    // Focusmate uses a grid calendar with time rows and day columns
    // Clickable slots show partner avatars or are empty cells

    const hours = targetDate.getHours();
    const minutes = targetDate.getMinutes();
    const dayOfMonth = targetDate.getDate();

    // First, ensure we're looking at the right date column
    await this.navigateToDate(targetDate);

    // Format time labels to search for
    const hour12 = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hourLabel = `${hour12}${ampm}`; // e.g., "9am"
    const timeStr24 = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    // Scroll to the target time using Home key to go to top, then scroll down
    await this.page.keyboard.press('Home');
    await this.page.waitForTimeout(300);

    // Try to scroll the page to bring the target hour into view
    // Use page-level scrolling since we can't easily identify the scroll container
    await this.page.evaluate((targetHour) => {
      // Find time labels and scroll to the right one
      const timeLabels = document.querySelectorAll('*');
      for (const el of timeLabels) {
        if (el.textContent?.trim() === targetHour) {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          return;
        }
      }
    }, hourLabel);

    await this.page.waitForTimeout(500);

    // Find the time label element
    const timeLabel = this.page.locator(`text="${hourLabel}"`).first();

    // Wait for it to be visible
    try {
      await timeLabel.waitFor({ timeout: 5000 });
    } catch {
      throw new Error(`Could not find time slot for ${hourLabel}`);
    }

    // Get the bounding box of the time label
    const labelBox = await timeLabel.boundingBox();
    if (!labelBox) {
      throw new Error(`Could not get position of time label ${hourLabel}`);
    }

    // Find column headers to determine column positions
    const dayHeaders = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'];
    const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });

    // Find the header for our target day
    const headerLocator = this.page.locator(`text="${targetDayName} ${dayOfMonth}"`).first();
    const headerBox = await headerLocator.boundingBox();

    if (!headerBox) {
      throw new Error(`Could not find column header for ${targetDayName} ${dayOfMonth}`);
    }

    // Calculate click position: center of the column, at the row of our time
    // Add offset for minutes (each 15-min slot is roughly 15 pixels)
    const minuteOffset = (minutes / 60) * 60; // Approximate pixels per hour = 60
    const clickX = headerBox.x + headerBox.width / 2;
    const clickY = labelBox.y + minuteOffset + 10; // Small offset to click within the cell

    // Click the calculated position
    await this.page.mouse.click(clickX, clickY);
    await this.page.waitForTimeout(500);
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

    // The calendar typically shows 3 days at a time
    // Check if the target date is visible, if not navigate
    const dayOfMonth = targetDate.getDate();
    const dayHeader = this.page.locator(`text=/.*${dayOfMonth}.*/`).first();

    // If day is not visible, use navigation arrows
    try {
      await dayHeader.waitFor({ timeout: 2000 });
    } catch {
      // Navigate forward if needed
      const nextButton = this.page.getByRole('button', { name: /next|>/i })
        .or(this.page.locator('[aria-label*="next"], [aria-label*="Next"], button:has(svg)').last());

      // Click next until we see the target date
      for (let i = 0; i < 10; i++) {
        await nextButton.click();
        await this.page.waitForTimeout(300);
        const visible = await this.page.locator(`text=/.*${dayOfMonth}.*/`).first().isVisible();
        if (visible) break;
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
