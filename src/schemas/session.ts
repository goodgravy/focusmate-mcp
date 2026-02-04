import { z } from 'zod';

export const SessionDuration = z.enum(['25', '50', '75']);
export type SessionDuration = z.infer<typeof SessionDuration>;

export const SessionStatus = z.enum([
  'pending',      // Booked, waiting for partner match
  'matched',      // Partner assigned
  'in_progress',  // Session currently happening
  'completed',    // Session finished
  'cancelled',    // Session cancelled
  'no_show'       // Partner or user didn't show
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const Session = z.object({
  id: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  duration: z.number(), // minutes
  status: SessionStatus,
  partnerId: z.string().nullable(),
  partnerName: z.string().nullable(),
  title: z.string().optional()
});
export type Session = z.infer<typeof Session>;

export const BookSessionInput = z.object({
  startTime: z.string().datetime().describe('ISO 8601 datetime for session start'),
  duration: SessionDuration.default('50').describe('Session duration in minutes (25, 50, or 75)')
});
export type BookSessionInput = z.infer<typeof BookSessionInput>;

export const BookSessionOutput = z.object({
  success: z.boolean(),
  session: Session.optional(),
  error: z.string().optional(),
  errorCode: z.string().optional()
});
export type BookSessionOutput = z.infer<typeof BookSessionOutput>;

export const CancelSessionInput = z.object({
  sessionId: z.string().describe('The ID of the session to cancel')
});
export type CancelSessionInput = z.infer<typeof CancelSessionInput>;

export const CancelSessionOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  errorCode: z.string().optional()
});
export type CancelSessionOutput = z.infer<typeof CancelSessionOutput>;

export const ListSessionsInput = z.object({
  startDate: z.string().datetime().describe('Start of date range (ISO 8601)'),
  endDate: z.string().datetime().optional().describe('End of date range (ISO 8601). Defaults to 7 days from startDate')
});
export type ListSessionsInput = z.infer<typeof ListSessionsInput>;

export const ListSessionsOutput = z.object({
  sessions: z.array(Session),
  totalCount: z.number()
});
export type ListSessionsOutput = z.infer<typeof ListSessionsOutput>;

export const AuthOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  errorCode: z.string().optional()
});
export type AuthOutput = z.infer<typeof AuthOutput>;
