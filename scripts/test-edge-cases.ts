#!/usr/bin/env npx tsx
/**
 * Edge case booking tests: early morning, late evening, next day navigation.
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const USER_DATA_DIR = path.join(os.homedir(), '.focusmate-mcp', 'browser-data');
const DASHBOARD_URL = 'https://app.focusmate.com/dashboard';
const SCREENSHOT_DIR = path.join(os.homedir(), '.focusmate-mcp', 'screenshots');
const HEADED = process.env.HEADED === '1';

function to12Hour(hours: number): string {
  const hour12 = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
  const ampm = hours >= 12 ? 'pm' : 'am';
  return `${hour12}${ampm}`;
}

async function openDashboard(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: !HEADED });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
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

async function bookSession(
  page: Page,
  targetDate: Date,
  duration: '25' | '50' | '75'
): Promise<void> {
  const hours = targetDate.getHours();
  const minutes = targetDate.getMinutes();
  const hourLabel = to12Hour(hours);
  const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
  const dayOfMonth = targetDate.getDate();
  const headerText = `${dayName} ${dayOfMonth}`;

  // Select duration
  await page.getByRole('button', { name: `${duration} min`, exact: true }).click();
  await page.waitForLoadState('networkidle');

  // Navigate to date
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

  // Scroll and measure
  await scrollToHour(page, hourLabel);

  const labelBox = await page.locator(`text="${hourLabel}"`).first().boundingBox();
  if (!labelBox) throw new Error(`Cannot find "${hourLabel}"`);

  // Measure pixels per hour
  let pixelsPerHour = 192;
  for (const offset of [1, -1]) {
    const refHour = (hours + offset + 24) % 24;
    const refLabel = to12Hour(refHour);
    try {
      const refBox = await page.locator(`text="${refLabel}"`).first().boundingBox();
      if (refBox) {
        pixelsPerHour = Math.abs(refBox.y - labelBox.y);
        break;
      }
    } catch { continue; }
  }

  const headerBox = await page.locator(`text="${headerText}"`).first().boundingBox();
  if (!headerBox) throw new Error(`Cannot find header "${headerText}"`);

  const minuteOffset = (minutes / 60) * pixelsPerHour;
  const clickX = headerBox.x + headerBox.width / 2;
  const clickY = labelBox.y + minuteOffset + (pixelsPerHour / 8);

  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(800);

  // Confirm
  const bookBtn = page.getByRole('button', { name: /Book \d+ session/i });
  if (!(await bookBtn.isVisible().catch(() => false))) {
    throw new Error('"Book" button not visible — slot selection failed');
  }
  await bookBtn.click();
  await bookBtn.waitFor({ state: 'hidden', timeout: 15000 });
}

interface TestDef {
  name: string;
  date: Date;
  duration: '25' | '50' | '75';
}

async function main() {
  console.log('Edge Case Booking Tests');
  console.log('=======================');

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);

  const tests: TestDef[] = [
    { name: 'early-morning-6am', date: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 6, 0), duration: '50' },
    { name: 'late-evening-10pm', date: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 22, 0), duration: '25' },
    { name: 'next-day-navigation', date: new Date(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate(), 12, 0), duration: '50' },
    { name: 'noon-exactly', date: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 12, 0), duration: '75' },
  ];

  const results: { name: string; passed: boolean; error?: string }[] = [];

  for (const t of tests) {
    console.log(`\n  ${t.name}: ${t.date.toLocaleString()} (${t.duration}min)`);
    let context: BrowserContext | undefined;
    try {
      const r = await openDashboard();
      context = r.context;
      await bookSession(r.page, t.date, t.duration);
      await r.page.screenshot({ path: path.join(SCREENSHOT_DIR, `edge-${t.name}.png`) });
      console.log(`    ✅ PASSED`);
      results.push({ name: t.name, passed: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`    ❌ FAILED: ${msg}`);
      results.push({ name: t.name, passed: false, error: msg });
    } finally {
      if (context) await context.close();
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n=======================`);
  console.log(`Results: ${passed}/${results.length} passed`);
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}${r.error ? ': ' + r.error : ''}`);
  }

  // Cleanup
  if (passed > 0 && process.env.CLEANUP !== '0') {
    console.log('\nCleaning up...');
    const { context: ctx, page } = await openDashboard();
    // Just navigate away — sessions will be cleaned up by the main test
    await ctx.close();
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
