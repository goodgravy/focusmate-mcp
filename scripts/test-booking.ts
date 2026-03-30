#!/usr/bin/env npx tsx
/**
 * End-to-end booking test script.
 *
 * Tests booking sessions at various times and durations.
 * Set HEADED=1 to watch, CLEANUP=0 to keep booked sessions.
 *
 * Usage: npx tsx scripts/test-booking.ts
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const USER_DATA_DIR = path.join(os.homedir(), '.focusmate-mcp', 'browser-data');
const DASHBOARD_URL = 'https://app.focusmate.com/dashboard';
const SCREENSHOT_DIR = path.join(os.homedir(), '.focusmate-mcp', 'screenshots');
const HEADED = process.env.HEADED === '1';

interface TestCase {
  name: string;
  startTime: Date;
  duration: '25' | '50' | '75';
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function getNextSlotTime(hoursFromNow: number, minuteSlot: 0 | 15 | 30 | 45 = 0): Date {
  const date = new Date();
  date.setHours(date.getHours() + hoursFromNow, minuteSlot, 0, 0);
  if (date <= new Date()) {
    date.setHours(date.getHours() + 1);
  }
  return date;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function to12Hour(hours: number): { label: string; hour12: number; ampm: string } {
  const hour12 = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
  const ampm = hours >= 12 ? 'pm' : 'am';
  return { label: `${hour12}${ampm}`, hour12, ampm };
}

function generateTestCases(): TestCase[] {
  // Use tomorrow morning/afternoon to avoid late-night edge cases
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  function atTime(hour: number, min: 0 | 15 | 30 | 45): Date {
    const d = new Date(tomorrow);
    d.setHours(hour, min, 0, 0);
    return d;
  }

  return [
    { name: '50min-on-hour', startTime: atTime(9, 0), duration: '50' },
    { name: '25min-at-15', startTime: atTime(10, 15), duration: '25' },
    { name: '75min-at-30', startTime: atTime(14, 30), duration: '75' },
    { name: '50min-at-45', startTime: atTime(16, 45), duration: '50' },
  ];
}

async function openDashboard(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: !HEADED });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  if (page.url().includes('/login')) {
    await context.close();
    throw new Error('Not authenticated — run focusmate_auth first');
  }

  return { context, page };
}

async function scrollToHour(page: Page, hourLabel: string): Promise<void> {
  await page.evaluate(`
    (function(label) {
      var walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        { acceptNode: function(node) {
          return node.textContent && node.textContent.trim() === label
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }}
      );
      var node = walker.nextNode();
      if (node && node.parentElement) {
        node.parentElement.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    })("${hourLabel}")
  `);
  await page.waitForTimeout(400);
}

async function clickTimeSlot(page: Page, targetDate: Date): Promise<void> {
  const hours = targetDate.getHours();
  const minutes = targetDate.getMinutes();
  const { label: hourLabel } = to12Hour(hours);
  const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
  const dayOfMonth = targetDate.getDate();
  const headerText = `${dayName} ${dayOfMonth}`;

  // Ensure the target date column is visible
  let headerVisible = await page.locator(`text="${headerText}"`).first().isVisible().catch(() => false);

  if (!headerVisible) {
    const fwdBtn = page.getByRole('button', { name: 'Go forward one day' });
    for (let i = 0; i < 14 && !headerVisible; i++) {
      await fwdBtn.click();
      await page.waitForTimeout(300);
      headerVisible = await page.locator(`text="${headerText}"`).first().isVisible().catch(() => false);
    }
    if (!headerVisible) throw new Error(`Cannot navigate to ${headerText}`);
  }

  await scrollToHour(page, hourLabel);

  const labelBox = await page.locator(`text="${hourLabel}"`).first().boundingBox();
  if (!labelBox) throw new Error(`Cannot find "${hourLabel}" on page`);

  // Measure pixels per hour
  const nextHour = (hours + 1) % 24;
  const { label: nextHourLabel } = to12Hour(nextHour);
  let pixelsPerHour = 192; // default
  try {
    const nextBox = await page.locator(`text="${nextHourLabel}"`).first().boundingBox();
    if (nextBox) pixelsPerHour = nextBox.y - labelBox.y;
  } catch { /* use default */ }

  const headerBox = await page.locator(`text="${headerText}"`).first().boundingBox();
  if (!headerBox) throw new Error(`Cannot find header "${headerText}"`);

  const minuteOffset = (minutes / 60) * pixelsPerHour;
  const clickX = headerBox.x + headerBox.width / 2;
  const clickY = labelBox.y + minuteOffset + (pixelsPerHour / 8);

  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(800);
}

async function confirmBooking(page: Page): Promise<void> {
  // Primary: "Book N session" bottom bar button
  const bookBtn = page.getByRole('button', { name: /Book \d+ session/i });
  const isVisible = await bookBtn.isVisible().catch(() => false);

  if (!isVisible) {
    throw new Error('"Book N session" button not visible — slot selection may have failed');
  }

  await bookBtn.click();
  await bookBtn.waitFor({ state: 'hidden', timeout: 15000 });
}

async function testBooking(testCase: TestCase): Promise<TestResult> {
  const { name, startTime, duration } = testCase;
  console.log(`\n  ${name}: ${formatTime(startTime)} (${duration}min)`);

  let context: BrowserContext | undefined;
  try {
    ({ context } = await openDashboard().then(r => {
      return { context: r.context, page: r.page };
    }));
    // Reopen since we destructured wrong
    await context.close();

    const result = await openDashboard();
    context = result.context;
    const page = result.page;

    // Select duration
    const durBtn = page.getByRole('button', { name: `${duration} min`, exact: true });
    await durBtn.waitFor({ timeout: 10000 });
    await durBtn.click();
    await page.waitForLoadState('networkidle');

    // Click the time slot
    await clickTimeSlot(page, startTime);

    // Take pre-confirm screenshot
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `test-${name}-selected.png`)
    });

    // Confirm booking
    await confirmBooking(page);

    // Take post-confirm screenshot
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `test-${name}-confirmed.png`)
    });

    console.log(`    ✅ PASSED`);
    return { name, passed: true };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`    ❌ FAILED: ${msg}`);
    return { name, passed: false, error: msg };
  } finally {
    if (context) await context.close();
  }
}

async function cancelAllSessions(): Promise<number> {
  const { context, page } = await openDashboard();
  let cancelled = 0;

  try {
    // Look for "Clear" buttons in the Upcoming section
    while (true) {
      const clearBtn = page.getByLabel('Upcoming session').getByRole('button').first();
      if (!(await clearBtn.isVisible().catch(() => false))) break;

      // Click the session's clear/cancel button
      const btns = page.getByLabel('Upcoming session').locator('button:has-text("Clear"), button:has-text("Cancel"), button:has-text("×")');
      if (await btns.count() === 0) break;

      await btns.first().click();
      await page.waitForTimeout(500);

      // Handle any confirmation
      const confirmBtns = page.getByRole('dialog').getByRole('button', { name: /cancel|confirm|yes/i });
      if (await confirmBtns.count() > 0) {
        await confirmBtns.first().click();
        await page.waitForTimeout(500);
      }

      cancelled++;
      await page.waitForTimeout(500);
    }
  } finally {
    await context.close();
  }

  return cancelled;
}

async function main() {
  console.log('Focusmate Booking Test Suite');
  console.log('============================');

  if (!fs.existsSync(path.join(USER_DATA_DIR, 'Default'))) {
    console.error('Not authenticated. Run focusmate_auth first.');
    process.exit(1);
  }

  const testCases = generateTestCases();
  const results: TestResult[] = [];

  for (const tc of testCases) {
    const result = await testBooking(tc);
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  console.log('\n============================');
  console.log(`Results: ${passed}/${results.length} passed`);
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}${r.error ? ': ' + r.error : ''}`);
  }

  // Cleanup
  if (passed > 0 && process.env.CLEANUP !== '0') {
    console.log('\nCleaning up...');
    const n = await cancelAllSessions();
    console.log(`  Cancelled ${n} sessions`);
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
