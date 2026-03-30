import { describe, it, expect } from 'vitest';

/**
 * Tests for the booking validation logic (extracted from book-session.ts).
 */

function validateBookingTime(startTime: string): { valid: boolean; error?: string } {
  const targetDate = new Date(startTime);

  if (isNaN(targetDate.getTime())) {
    return { valid: false, error: 'Invalid date' };
  }

  if (targetDate <= new Date()) {
    return { valid: false, error: 'Cannot book in the past' };
  }

  const minutes = targetDate.getMinutes();
  if (minutes % 15 !== 0) {
    return { valid: false, error: 'Must be on 15-minute boundary' };
  }

  return { valid: true };
}

describe('Booking time validation', () => {
  it('rejects past times', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(validateBookingTime(past).valid).toBe(false);
  });

  it('accepts future on-the-hour', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    future.setHours(10, 0, 0, 0);
    expect(validateBookingTime(future.toISOString()).valid).toBe(true);
  });

  it('accepts future at :15', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    future.setHours(10, 15, 0, 0);
    expect(validateBookingTime(future.toISOString()).valid).toBe(true);
  });

  it('accepts future at :30', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    future.setHours(10, 30, 0, 0);
    expect(validateBookingTime(future.toISOString()).valid).toBe(true);
  });

  it('accepts future at :45', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    future.setHours(10, 45, 0, 0);
    expect(validateBookingTime(future.toISOString()).valid).toBe(true);
  });

  it('rejects :10', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    future.setHours(10, 10, 0, 0);
    expect(validateBookingTime(future.toISOString()).valid).toBe(false);
  });

  it('rejects :05', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    future.setHours(10, 5, 0, 0);
    expect(validateBookingTime(future.toISOString()).valid).toBe(false);
  });

  it('rejects invalid date string', () => {
    expect(validateBookingTime('not-a-date').valid).toBe(false);
  });
});

describe('12-hour time formatting', () => {
  function to12Hour(hours: number): string {
    const hour12 = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    const ampm = hours >= 12 ? 'pm' : 'am';
    return `${hour12}${ampm}`;
  }

  it('formats midnight as 12am', () => {
    expect(to12Hour(0)).toBe('12am');
  });

  it('formats 1am', () => {
    expect(to12Hour(1)).toBe('1am');
  });

  it('formats noon as 12pm', () => {
    expect(to12Hour(12)).toBe('12pm');
  });

  it('formats 1pm', () => {
    expect(to12Hour(13)).toBe('1pm');
  });

  it('formats 11pm', () => {
    expect(to12Hour(23)).toBe('11pm');
  });

  it('formats 6am', () => {
    expect(to12Hour(6)).toBe('6am');
  });
});
