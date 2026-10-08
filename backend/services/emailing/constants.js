/**
 * Crew emailing — shared constants.
 * Values mirror the enums in src/enums/index.ts (EmailMessageType, EmailDeliveryStatus,
 * EmailEventType, EmailSuppressionReason, CrewSubmissionStatus, AvailabilityResponse).
 */

// EmailMessageType
const MESSAGE_TYPES = Object.freeze({
  TIMESHEET_REMINDER:  'timesheet_reminder',
  INVOICE_REQUEST:     'invoice_request',
  AVAILABILITY_POLL:   'availability_poll',
  MANUAL:              'manual',
  SUBMISSION_APPROVED: 'submission_approved',
  SUBMISSION_RETURNED: 'submission_returned',
  SUBMISSION_DECLINED: 'submission_declined',
});
const SENDABLE_MESSAGE_TYPES = [
  MESSAGE_TYPES.TIMESHEET_REMINDER,
  MESSAGE_TYPES.INVOICE_REQUEST,
  MESSAGE_TYPES.AVAILABILITY_POLL,
  MESSAGE_TYPES.MANUAL,
];

// EmailDeliveryStatus
const DELIVERY_STATUS = Object.freeze({
  QUEUED:       'queued',
  SENDING:      'sending',
  SENT:         'sent',
  DELIVERED:    'delivered',
  DELAYED:      'delayed',
  SOFT_BOUNCED: 'soft_bounced',
  BOUNCED:      'bounced',
  COMPLAINED:   'complained',
  REJECTED:     'rejected',
  FAILED:       'failed',
  SUPPRESSED:   'suppressed',
  CANCELLED:    'cancelled',
});

// EmailSuppressionReason
const SUPPRESSION_REASONS = Object.freeze({
  HARD_BOUNCE:     'hard_bounce',
  COMPLAINT:       'complaint',
  INVALID_ADDRESS: 'invalid_address',
  MANUAL:          'manual',
});

// CrewSubmissionStatus
const SUBMISSION_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  RETURNED:  'returned',
  APPROVED:  'approved',
  DECLINED:  'declined',
});

// AvailabilityResponse
const AVAILABILITY_RESPONSES = ['available', 'partial', 'unavailable'];
// CrewAvailabilityStatus (existing crew_members.availability_status values)
const CREW_AVAILABILITY_STATUSES = ['available', 'booked', 'unavailable'];

// DayOfWeek — Monday first, week ends Sunday (matches timesheet_entries.day_of_week)
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Placeholder stored in queued/persisted bodies instead of a crew member's secret portal token. */
const PORTAL_TOKEN_MARKER = '__CS_PORTAL_TOKEN__';

/** Retry backoff (seconds) for transient provider errors, indexed by attempts already made. */
const RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600, 14400];

// ProductionStatus values that accept timesheets (mirrors createTimesheet's status gate)
const TIMESHEET_PRODUCTION_STATUSES = ['active_build', 'strike'];

module.exports = {
  MESSAGE_TYPES,
  SENDABLE_MESSAGE_TYPES,
  DELIVERY_STATUS,
  SUPPRESSION_REASONS,
  SUBMISSION_STATUS,
  AVAILABILITY_RESPONSES,
  CREW_AVAILABILITY_STATUSES,
  WEEK_DAYS,
  PORTAL_TOKEN_MARKER,
  RETRY_BACKOFF_SECONDS,
  TIMESHEET_PRODUCTION_STATUSES,
};
