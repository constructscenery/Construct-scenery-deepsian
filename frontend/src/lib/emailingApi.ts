// Crew emailing + crew portal API client.
// Kept separate from lib/api.ts so the existing client is untouched.

type Opts = { method?: string; body?: unknown; form?: FormData; auth?: boolean };

async function refreshToken(): Promise<boolean> {
  const refresh_token = localStorage.getItem('cs_refresh_token');
  if (!refresh_token) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem('cs_token', data.access_token);
    localStorage.setItem('cs_refresh_token', data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

async function call<T>(path: string, { method = 'GET', body, form, auth = true }: Opts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (!form) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    cache: 'no-store',
  });
  if (res.status === 401 && auth && !retried && (await refreshToken())) return call<T>(path, { method, body, form, auth }, true);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error ?? err.message ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

// ─── Types ───────────────────────────────────────────────────────────────────
export type MessageType =
  | 'timesheet_reminder' | 'invoice_request' | 'availability_poll' | 'manual'
  | 'submission_approved' | 'submission_returned' | 'submission_declined';
export type SendableMessageType = 'timesheet_reminder' | 'invoice_request' | 'availability_poll' | 'manual';
export type DeliveryStatus =
  | 'queued' | 'sending' | 'sent' | 'delivered' | 'delayed' | 'soft_bounced' | 'bounced'
  | 'complained' | 'rejected' | 'failed' | 'suppressed' | 'cancelled';
export type SubmissionStatus = 'submitted' | 'returned' | 'approved' | 'declined';
export type IneligibleReason = 'not_found' | 'inactive' | 'no_email' | 'invalid_email' | 'suppressed' | 'live_sending_disabled';

export type EmailSettings = {
  live_sending_enabled: boolean;
  automation_timesheet_reminders: boolean;
  automation_timesheet_followups: boolean;
  automation_invoice_requests: boolean;
  reply_to_address: string;
  from_name: string;
  portal_link_ttl_days: number;
};

export type TestRecipient = { id: string; email: string; name: string | null; created_at: string; added_by_name?: string | null };

export type Overview = {
  settings: EmailSettings;
  messages: { queued: number; sent_7d: number; delivered_7d: number; failed_7d: number; problems_30d: number };
  submissions: { timesheets_pending: number; invoices_pending: number };
  suppressions: { suppressed: number };
  polls: { open_polls: number };
};

export type ProviderStatus = {
  provider: string;
  region: string;
  from_email: string | null;
  configuration_set: string | null;
  sns_topic_arn: string | null;
  credentials_configured: boolean;
  production_access_enabled: boolean | null;
  sending_enabled: boolean | null;
  enforcement_status: string | null;
  send_quota: { max_24_hour_send: number; max_send_rate: number; sent_last_24_hours: number } | null;
  configuration_set_found: boolean | null;
  errors: string[];
};

export type EmailTemplate = {
  id: string;
  template_key: string | null;
  name: string;
  message_type: MessageType;
  subject: string;
  body: string;
  is_system: boolean;
  is_active: boolean;
  updated_at: string;
  updated_by_name?: string | null;
};
export type MergeField = { key: string; label: string };

export type RecipientRow = {
  id: string;
  crew_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  employment_status: 'paye' | 'self_employed';
  crew_trade: string | null;
  is_active: boolean;
  suppression_reason: string | null;
  eligible: boolean;
  reason: IneligibleReason | null;
  last_email_status?: DeliveryStatus | null;
  last_emailed_at?: string | null;
  production_id?: string;
  production_name?: string;
  week_ending_date?: string;
  grand_total?: string;
  timesheet_id?: string;
};

export type SendRecipient = { crew_member_id: string; production_id?: string | null; week_ending_date?: string | null; amount?: number };
export type SendRequest = {
  message_type: SendableMessageType;
  recipients: SendRecipient[];
  subject?: string;
  body?: string;
  template_id?: string;
  poll_id?: string;
  production_id?: string;
  week_ending_date?: string;
  client_request_id?: string;
};

export type RecipientCheck = {
  crew_member_id: string;
  production_id: string | null;
  week_ending_date: string | null;
  name: string | null;
  email: string | null;
  eligible: boolean;
  reason: IneligibleReason | null;
};
export type PreviewResult = {
  subject: string;
  html: string;
  text: string;
  live_sending_enabled: boolean;
  recipients: RecipientCheck[];
  summary: { total: number; eligible: number };
};
export type SendResult = {
  batch_id: string;
  live_sending_enabled: boolean;
  summary: Record<string, number>;
  results: (RecipientCheck & { status: string; reason: string | null })[];
};

export type EmailMessage = {
  id: string;
  module: string;
  message_type: MessageType | null;
  subject: string | null;
  recipient_email: string;
  recipient_name: string | null;
  crew_member_id: string | null;
  crew_number?: string | null;
  production_id: string | null;
  production_name: string | null;
  week_ending_date: string | null;
  status: DeliveryStatus;
  status_updated_at: string | null;
  attempts: number;
  error_message: string | null;
  provider_message_id: string | null;
  is_automated: boolean;
  is_test: boolean;
  sent_at: string;
  created_at: string | null;
  delivered_at: string | null;
  sent_by_name: string | null;
};
export type EmailEvent = { id: string; event_type: string; recipient_email: string | null; bounce_type: string | null; bounce_subtype: string | null; diagnostic: string | null; occurred_at: string };
export type EmailMessageDetail = EmailMessage & { body_html: string | null; body_text: string | null; reply_to: string | null; events: EmailEvent[] };

export type Suppression = {
  id: string;
  email: string;
  reason: 'hard_bounce' | 'complaint' | 'invalid_address' | 'manual';
  detail: string | null;
  created_at: string;
  cleared_at: string | null;
  cleared_by_name?: string | null;
  crew: { id: string; name: string; crew_number: string }[] | null;
};

export type SubmissionReview = { id: string; action: string; notes: string | null; revision: number; actor_type: 'crew' | 'staff'; actor_name: string | null; created_at: string };
type SubmissionBase = {
  id: string;
  crew_member_id: string;
  production_id: string;
  production_name: string;
  week_ending_date: string;
  status: SubmissionStatus;
  crew_notes: string | null;
  reviewer_notes: string | null;
  revision: number;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  timesheet_id: string | null;
  timesheet_status: string | null;
  first_name: string;
  last_name: string;
  crew_number: string;
  email: string | null;
  employment_status: 'paye' | 'self_employed';
};
export type TimesheetSubmission = SubmissionBase & { days_worked?: string; overtime_hours?: string; crew_trade?: string | null; crew_rank?: string | null };
export type SubmissionEntry = {
  date: string;
  day_of_week: string;
  full_day_worked: boolean;
  overtime_hours: string | number;
  set_number: string | null;
  site: string | null;
  travel: string | number;
  mileage: string | number;
  per_diem: string | number;
  ad_hoc_reimbursement: string | number;
  meal_breakfast: boolean;
  meal_lunch: boolean;
  meal_supper: boolean;
};
export type TimesheetSubmissionDetail = TimesheetSubmission & {
  entries: SubmissionEntry[];
  reviews: SubmissionReview[];
  existing_timesheet_id: string | null;
  timesheet_grand_total: string | null;
  production_status: string;
};
export type InvoiceSubmission = SubmissionBase & {
  invoice_number: string | null;
  amount: string | null;
  file_name: string;
  file_size: string | null;
  file_mime_type: string | null;
};
export type InvoiceSubmissionDetail = InvoiceSubmission & {
  reviews: SubmissionReview[];
  existing_timesheet_id: string | null;
  timesheet_grand_total: string | null;
  timesheet_has_invoice: boolean | null;
  company_name?: string | null;
};
export type ReviewResult = {
  submission: SubmissionBase;
  timesheet_id?: string;
  timesheet_created?: boolean;
  finalise?: { finalised: boolean; reason?: string };
  invoice_request?: Record<string, number> | { error: string } | null;
  notification?: { status: string; reason?: string } | null;
};

export type AvailabilityPoll = {
  id: string;
  title: string;
  message: string | null;
  start_date: string;
  end_date: string;
  production_id: string | null;
  production_name: string | null;
  response_deadline: string | null;
  created_at: string;
  created_by_name?: string | null;
  closed_at: string | null;
  recipient_count?: string;
  response_count?: string;
  available_count?: string;
  partial_count?: string;
  unavailable_count?: string;
};
export type PollRecipient = {
  id: string;
  crew_member_id: string;
  first_name: string;
  last_name: string;
  crew_number: string;
  email: string | null;
  crew_trade: string | null;
  availability_status: 'available' | 'booked' | 'unavailable' | null;
  invited_at: string;
  response: 'available' | 'partial' | 'unavailable' | null;
  response_notes: string | null;
  responded_at: string | null;
  applied_status: string | null;
  applied_at: string | null;
  last_email_status: DeliveryStatus | null;
};
export type AvailabilityPollDetail = AvailabilityPoll & { recipients: PollRecipient[] };

export type AutomationType = 'timesheet_reminders' | 'timesheet_followups' | 'invoice_requests';
export type AutomationRun = {
  type: AutomationType;
  week_ending_date: string;
  dry_run: boolean;
  count: number;
  live_sending_enabled?: boolean;
  recipients?: { crew_member_id: string; name: string; email: string | null; production_name: string; suppressed: boolean }[];
  summary?: Record<string, number>;
  skipped?: string;
};

export type PortalLinkStatus = { active: boolean; url?: string; expires_at?: string; created_at?: string; last_used_at?: string | null };

// ─── Staff API ───────────────────────────────────────────────────────────────
const E = '/api/emailing';
export const emailingApi = {
  overview: () => call<Overview>(`${E}/overview`),
  getSettings: () => call<{ settings: EmailSettings; test_recipients: TestRecipient[]; automations: Record<AutomationType, { settingKey: string; label: string }> }>(`${E}/settings`),
  updateSettings: (patch: Partial<EmailSettings>) => call<{ settings: EmailSettings }>(`${E}/settings`, { method: 'PUT', body: patch }),
  addTestRecipient: (email: string, name?: string) => call<TestRecipient>(`${E}/settings/test-recipients`, { method: 'POST', body: { email, name } }),
  removeTestRecipient: (id: string) => call<{ message: string }>(`${E}/settings/test-recipients/${id}`, { method: 'DELETE' }),
  providerStatus: () => call<ProviderStatus>(`${E}/provider-status`),

  templates: (messageType?: MessageType) => call<{ templates: EmailTemplate[]; merge_fields: MergeField[] }>(`${E}/templates${qs({ message_type: messageType })}`),
  createTemplate: (t: Pick<EmailTemplate, 'name' | 'message_type' | 'subject' | 'body'>) => call<EmailTemplate>(`${E}/templates`, { method: 'POST', body: t }),
  updateTemplate: (id: string, t: Partial<Pick<EmailTemplate, 'name' | 'subject' | 'body' | 'is_active'>>) => call<EmailTemplate>(`${E}/templates/${id}`, { method: 'PUT', body: t }),
  deleteTemplate: (id: string) => call<{ message: string }>(`${E}/templates/${id}`, { method: 'DELETE' }),
  resetTemplate: (id: string) => call<EmailTemplate>(`${E}/templates/${id}/reset`, { method: 'POST' }),

  recipients: (params: { search?: string; production_id?: string }) => call<RecipientRow[]>(`${E}/recipients${qs(params)}`),
  recipientGroup: (params: { group: 'timesheet_missing' | 'invoice_missing' | 'poll_non_responders'; production_id?: string; week_ending_date?: string; poll_id?: string }) =>
    call<RecipientRow[]>(`${E}/recipient-groups${qs(params)}`),
  preview: (req: SendRequest) => call<PreviewResult>(`${E}/preview`, { method: 'POST', body: req }),
  send: (req: SendRequest) => call<SendResult>(`${E}/send`, { method: 'POST', body: req }),

  messages: (params: Record<string, string | number | undefined>) => call<{ messages: EmailMessage[]; total: number; page: number; limit: number }>(`${E}/messages${qs(params)}`),
  message: (id: string) => call<EmailMessageDetail>(`${E}/messages/${id}`),
  retryMessage: (id: string) => call<{ message: string }>(`${E}/messages/${id}/retry`, { method: 'POST' }),
  cancelMessage: (id: string) => call<{ message: string }>(`${E}/messages/${id}/cancel`, { method: 'POST' }),
  processQueue: () => call<{ processed: number }>(`${E}/queue/process`, { method: 'POST' }),

  suppressions: (includeCleared = false) => call<Suppression[]>(`${E}/suppressions${qs({ include_cleared: includeCleared || undefined })}`),
  addSuppression: (email: string, detail?: string) => call<Suppression>(`${E}/suppressions`, { method: 'POST', body: { email, detail } }),
  clearSuppression: (id: string, note?: string) => call<Suppression>(`${E}/suppressions/${id}`, { method: 'DELETE', body: { note } }),

  timesheetSubmissions: (params: { status?: SubmissionStatus | 'all'; production_id?: string; search?: string }) => call<TimesheetSubmission[]>(`${E}/submissions/timesheets${qs(params)}`),
  timesheetSubmission: (id: string) => call<TimesheetSubmissionDetail>(`${E}/submissions/timesheets/${id}`),
  reviewTimesheet: (id: string, action: 'approve' | 'return' | 'decline', body: { notes?: string; finalise?: boolean; notify?: boolean; request_invoice?: boolean }) =>
    call<ReviewResult>(`${E}/submissions/timesheets/${id}/${action}`, { method: 'POST', body }),
  invoiceSubmissions: (params: { status?: SubmissionStatus | 'all'; production_id?: string; search?: string }) => call<InvoiceSubmission[]>(`${E}/submissions/invoices${qs(params)}`),
  invoiceSubmission: (id: string) => call<InvoiceSubmissionDetail>(`${E}/submissions/invoices/${id}`),
  invoiceFileUrl: (id: string) => `${E}/submissions/invoices/${id}/file?token=${encodeURIComponent(typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : '')}`,
  reviewInvoice: (id: string, action: 'approve' | 'return' | 'decline', body: { notes?: string; finalise?: boolean; notify?: boolean }) =>
    call<ReviewResult>(`${E}/submissions/invoices/${id}/${action}`, { method: 'POST', body }),

  polls: (status: 'open' | 'closed' | 'all' = 'open') => call<AvailabilityPoll[]>(`${E}/polls${qs({ status })}`),
  createPoll: (p: { title: string; message?: string; start_date: string; end_date: string; production_id?: string; response_deadline?: string }) =>
    call<AvailabilityPoll>(`${E}/polls`, { method: 'POST', body: p }),
  poll: (id: string) => call<AvailabilityPollDetail>(`${E}/polls/${id}`),
  closePoll: (id: string) => call<AvailabilityPoll>(`${E}/polls/${id}/close`, { method: 'POST' }),
  applyPollResponse: (pollId: string, recipientId: string, availability_status: 'available' | 'booked' | 'unavailable') =>
    call<PollRecipient>(`${E}/polls/${pollId}/recipients/${recipientId}/apply`, { method: 'POST', body: { availability_status } }),

  portalLink: (crewId: string, reveal = false) => call<PortalLinkStatus>(`${E}/portal-links/${crewId}${qs({ reveal: reveal || undefined })}`),
  rotatePortalLink: (crewId: string) => call<PortalLinkStatus>(`${E}/portal-links/${crewId}/rotate`, { method: 'POST' }),
  revokePortalLink: (crewId: string) => call<{ revoked: boolean }>(`${E}/portal-links/${crewId}/revoke`, { method: 'POST' }),

  runAutomation: (type: AutomationType, body: { dry_run: boolean; week_ending_date?: string }) => call<AutomationRun>(`${E}/automations/${type}/run`, { method: 'POST', body }),
};

// ─── Public crew portal ──────────────────────────────────────────────────────
export type PortalHome = {
  crew: { first_name: string; last_name: string; crew_number: string; employment_status: 'paye' | 'self_employed'; needs_invoices: boolean };
  productions: { id: string; name: string }[];
  productions_linked: boolean;
  weeks: string[];
  link_expires_at: string;
  alerts: { polls_awaiting: number; timesheets_returned: number; invoices_returned: number };
};
export type PortalDay = {
  date: string;
  day_of_week: string;
  full_day_worked: boolean;
  overtime_hours: number;
  set_number: string;
  site: string;
  travel: number;
  mileage: number;
  per_diem: number;
  ad_hoc_reimbursement: number;
  meal_breakfast: boolean;
  meal_lunch: boolean;
  meal_supper: boolean;
};
export type PortalSubmission = {
  id: string;
  production_id: string;
  production_name: string;
  week_ending_date: string;
  status: SubmissionStatus;
  crew_notes: string | null;
  reviewer_notes: string | null;
  revision: number;
  submitted_at: string;
  reviewed_at: string | null;
  days_worked?: string;
};
export type PortalWeek = { submission: PortalSubmission | null; days: PortalDay[]; editable: boolean; locked_reason: string | null };
export type PortalInvoice = PortalSubmission & { invoice_number: string | null; amount: string | null; file_name: string };
export type PortalOutstandingInvoice = { production_id: string; production_name: string; week_ending_date: string; grand_total: string };
export type PortalPoll = {
  id: string;
  title: string;
  message: string | null;
  start_date: string;
  end_date: string;
  response_deadline: string | null;
  closed_at: string | null;
  production_name: string | null;
  response: 'available' | 'partial' | 'unavailable' | null;
  response_notes: string | null;
  responded_at: string | null;
};

const P = '/api/public/crew-portal';
export const crewPortalApi = {
  home: (token: string) => call<PortalHome>(`${P}/${token}`, { auth: false }),
  timesheets: (token: string) => call<PortalSubmission[]>(`${P}/${token}/timesheets`, { auth: false }),
  week: (token: string, productionId: string, week: string) =>
    call<PortalWeek>(`${P}/${token}/timesheets/week${qs({ production_id: productionId, week_ending_date: week })}`, { auth: false }),
  submitTimesheet: (token: string, body: { production_id: string; week_ending_date: string; entries: PortalDay[]; notes?: string }) =>
    call<{ message: string; submission: { id: string; status: SubmissionStatus } }>(`${P}/${token}/timesheets`, { method: 'POST', body, auth: false }),
  invoices: (token: string) => call<{ invoices: PortalInvoice[]; outstanding: PortalOutstandingInvoice[] }>(`${P}/${token}/invoices`, { auth: false }),
  uploadInvoice: (token: string, form: FormData) => call<{ message: string }>(`${P}/${token}/invoices`, { method: 'POST', form, auth: false }),
  availability: (token: string) => call<PortalPoll[]>(`${P}/${token}/availability`, { auth: false }),
  respond: (token: string, pollId: string, body: { response: 'available' | 'partial' | 'unavailable'; notes?: string }) =>
    call<{ message: string }>(`${P}/${token}/availability/${pollId}`, { method: 'POST', body, auth: false }),
};

// ─── Display helpers ─────────────────────────────────────────────────────────
export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  timesheet_reminder: 'Timesheet reminder',
  invoice_request: 'Invoice request',
  availability_poll: 'Availability request',
  manual: 'Message',
  submission_approved: 'Submission approved',
  submission_returned: 'Returned for changes',
  submission_declined: 'Submission declined',
};

export const REASON_LABELS: Record<IneligibleReason, string> = {
  not_found: 'Not found',
  inactive: 'Deactivated',
  no_email: 'No email',
  invalid_email: 'Invalid email',
  suppressed: 'Suppressed (bounce/complaint)',
  live_sending_disabled: 'Not in test group',
};

export const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-700',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-blue-50 text-blue-700',
  delivered: 'bg-emerald-50 text-emerald-700',
  delayed: 'bg-amber-50 text-amber-700',
  soft_bounced: 'bg-amber-50 text-amber-700',
  bounced: 'bg-red-50 text-red-700',
  complained: 'bg-red-50 text-red-700',
  rejected: 'bg-red-50 text-red-700',
  failed: 'bg-red-50 text-red-700',
  suppressed: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-100 text-slate-500',
  submitted: 'bg-blue-50 text-blue-700',
  returned: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-red-50 text-red-700',
};

export const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(iso.endsWith('T00:00:00Z') ? { timeZone: 'UTC' } : {}) });
};
export const fmtDateTime = (d?: string | null) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export const newRequestId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

/** Sundays: current week ending first, then previous weeks. */
export const recentSundays = (count = 8) => {
  const today = new Date();
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const offset = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + offset);
  return Array.from({ length: count }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() - 7 * i);
    return x.toISOString().slice(0, 10);
  });
};
