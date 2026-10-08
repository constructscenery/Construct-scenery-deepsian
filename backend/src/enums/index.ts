export enum UserRole {
  MANAGING_DIRECTOR = 'managing_director',
  CONSTRUCTION_ACCOUNTANT = 'construction_accountant',
  CONSTRUCTION_COORDINATOR = 'construction_coordinator',
  GUEST = 'guest',
}

export enum FreelancerCallPriority {
  FIRST_CALL = 'first_call',
  BACKUP = 'backup',
  NEVER_CALL = 'never_call',
}

export enum SafetyHealthDocumentType {
  RISK_TEMPLATE = 'risk_template',
  RISK_ASSESSMENT = 'risk_assessment',
  COSHH = 'coshh',
  INSURANCE = 'insurance',
}

export enum SafetyHealthDocumentStatus {
  ACTIVE = 'active',
  PENDING_ALTERATION = 'pending_alteration',
}

export enum ProductionStatus {
  PRE_PRODUCTION = 'pre_production',
  ACTIVE_BUILD = 'active_build',
  STRIKE = 'strike',
  COMPLETE = 'complete',
  ARCHIVED = 'archived',
}

export enum ContractType {
  ON_A_PRICE = 'on_a_price',
  COST_PLUS = 'cost_plus',
}

export enum HistoricalCostReportType {
  TYPE_1 = 'type1',
  TYPE_2 = 'type2',
}

export enum HistoricalCostReportSource {
  AUTOMATIC = 'automatic',
  MANUAL_UPLOAD = 'manual_upload',
}

export enum SetCompletionStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  NEARING_COMPLETION = 'nearing_completion',
  COMPLETE = 'complete',
  HANDED_OVER = 'handed_over',
}

export enum ProductionDocumentType {
  SHOOTING_SCHEDULE = 'shooting_schedule',
  DRAWING = 'drawing',
  CONTRACT = 'contract',
  SIGN_OFF = 'sign_off',
  OTHER = 'other',
}

export enum EmploymentStatus {
  PAYE = 'paye',
  SELF_EMPLOYED = 'self_employed',
}

export enum CrewDocumentType {
  GOVERNMENT_ID = 'government_id',
  CONTRACT = 'contract',
  OTHER = 'other',
}

export enum CrewAvailabilityStatus {
  AVAILABLE = 'available',
  BOOKED = 'booked',
  UNAVAILABLE = 'unavailable',
}

export enum PaidFrom {
  SUPPLIER_ACCOUNT = 'supplier_account',
  ARBUTHNOT_CURRENT_ACCOUNT = 'arbuthnot_current_account',
  CHARGE_CARD = 'charge_card',
  PLEO_CHARGE_CARD = 'pleo_charge_card',
}

export enum PurchaseOrderStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
}

export enum TimesheetStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  DISTRIBUTED = 'distributed',
  AMENDMENT_REQUESTED = 'amendment_requested',
  FINALISED = 'finalised',
}

export enum PayRunStatus {
  DRAFT = 'draft',
  PROCESSED = 'processed',
}

export enum DayOfWeek {
  MONDAY = 'Monday',
  TUESDAY = 'Tuesday',
  WEDNESDAY = 'Wednesday',
  THURSDAY = 'Thursday',
  FRIDAY = 'Friday',
  SATURDAY = 'Saturday',
  SUNDAY = 'Sunday',
}

export enum PercentometerCostType {
  CARPENTERS = 'Carpenters',
  PAINTERS = 'Painters',
  STAGEHANDS = 'Stagehands',
  RIGGERS = 'Riggers',
  TIMBER = 'Timber',
  PLASTERWORK = 'Plasterwork',
  MISC = 'Misc',
  SCULPTORS = 'Sculptors',
  METALWORK = 'Metalwork',
  PAINT = 'Paint',
  GLASS = 'Glass',
}

// ─── Crew Emailing & Self-Service Portal ─────────────────────────────────────

export enum EmailMessageType {
  TIMESHEET_REMINDER = 'timesheet_reminder',
  INVOICE_REQUEST = 'invoice_request',
  AVAILABILITY_POLL = 'availability_poll',
  MANUAL = 'manual',
  SUBMISSION_APPROVED = 'submission_approved',
  SUBMISSION_RETURNED = 'submission_returned',
  SUBMISSION_DECLINED = 'submission_declined',
}

export enum EmailDeliveryStatus {
  QUEUED = 'queued',
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  DELAYED = 'delayed',
  SOFT_BOUNCED = 'soft_bounced',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
  REJECTED = 'rejected',
  FAILED = 'failed',
  SUPPRESSED = 'suppressed',
  CANCELLED = 'cancelled',
}

export enum EmailEventType {
  SEND = 'send',
  DELIVERY = 'delivery',
  DELIVERY_DELAY = 'delivery_delay',
  BOUNCE = 'bounce',
  COMPLAINT = 'complaint',
  REJECT = 'reject',
  RENDERING_FAILURE = 'rendering_failure',
  OPEN = 'open',
  CLICK = 'click',
  SUBSCRIPTION = 'subscription',
}

export enum EmailSuppressionReason {
  HARD_BOUNCE = 'hard_bounce',
  COMPLAINT = 'complaint',
  INVALID_ADDRESS = 'invalid_address',
  MANUAL = 'manual',
}

export enum CrewSubmissionStatus {
  SUBMITTED = 'submitted',
  RETURNED = 'returned',
  APPROVED = 'approved',
  DECLINED = 'declined',
}

export enum CrewSubmissionReviewAction {
  SUBMITTED = 'submitted',
  RESUBMITTED = 'resubmitted',
  APPROVED = 'approved',
  RETURNED = 'returned',
  DECLINED = 'declined',
}

export enum AvailabilityResponse {
  AVAILABLE = 'available',
  PARTIAL = 'partial',
  UNAVAILABLE = 'unavailable',
}
