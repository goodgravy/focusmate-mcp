import { describe, it, expect } from 'vitest';
import {
  BookSessionInput,
  CancelSessionInput,
  ListSessionsInput,
  SessionDuration,
  Session
} from '../src/schemas/session.js';

describe('SessionDuration', () => {
  it('accepts valid durations', () => {
    expect(SessionDuration.parse('25')).toBe('25');
    expect(SessionDuration.parse('50')).toBe('50');
    expect(SessionDuration.parse('75')).toBe('75');
  });

  it('rejects invalid durations', () => {
    expect(() => SessionDuration.parse('30')).toThrow();
    expect(() => SessionDuration.parse('100')).toThrow();
    expect(() => SessionDuration.parse('')).toThrow();
  });
});

describe('BookSessionInput', () => {
  it('accepts valid booking input', () => {
    const result = BookSessionInput.parse({
      startTime: '2026-04-01T10:00:00.000Z',
      duration: '50'
    });
    expect(result.startTime).toBe('2026-04-01T10:00:00.000Z');
    expect(result.duration).toBe('50');
  });

  it('defaults duration to 50', () => {
    const result = BookSessionInput.parse({
      startTime: '2026-04-01T10:00:00.000Z'
    });
    expect(result.duration).toBe('50');
  });

  it('rejects non-ISO datetime', () => {
    expect(() => BookSessionInput.parse({
      startTime: 'next tuesday',
      duration: '50'
    })).toThrow();
  });

  it('rejects invalid duration', () => {
    expect(() => BookSessionInput.parse({
      startTime: '2026-04-01T10:00:00.000Z',
      duration: '30'
    })).toThrow();
  });
});

describe('ListSessionsInput', () => {
  it('accepts valid date range', () => {
    const result = ListSessionsInput.parse({
      startDate: '2026-04-01T00:00:00.000Z',
      endDate: '2026-04-07T00:00:00.000Z'
    });
    expect(result.startDate).toBe('2026-04-01T00:00:00.000Z');
    expect(result.endDate).toBe('2026-04-07T00:00:00.000Z');
  });

  it('endDate is optional', () => {
    const result = ListSessionsInput.parse({
      startDate: '2026-04-01T00:00:00.000Z'
    });
    expect(result.endDate).toBeUndefined();
  });
});

describe('CancelSessionInput', () => {
  it('accepts a session ID', () => {
    const result = CancelSessionInput.parse({ sessionId: 'abc-123' });
    expect(result.sessionId).toBe('abc-123');
  });

  it('rejects missing session ID', () => {
    expect(() => CancelSessionInput.parse({})).toThrow();
  });
});

describe('Session', () => {
  it('parses a complete session', () => {
    const session = Session.parse({
      id: 'sess-1',
      startTime: '2026-04-01T10:00:00.000Z',
      endTime: '2026-04-01T10:50:00.000Z',
      duration: 50,
      status: 'matched',
      partnerId: 'user-2',
      partnerName: 'Jane D.'
    });
    expect(session.id).toBe('sess-1');
    expect(session.status).toBe('matched');
  });

  it('allows null partner fields', () => {
    const session = Session.parse({
      id: 'sess-1',
      startTime: '2026-04-01T10:00:00.000Z',
      endTime: '2026-04-01T10:50:00.000Z',
      duration: 50,
      status: 'pending',
      partnerId: null,
      partnerName: null
    });
    expect(session.partnerId).toBeNull();
    expect(session.partnerName).toBeNull();
  });
});
