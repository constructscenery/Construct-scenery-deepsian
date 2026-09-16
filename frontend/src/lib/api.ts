// Empty string → same-origin requests; Next.js rewrites proxy to the backend.
// Set BACKEND_URL in the Next.js server environment for production.
const BASE_URL = '';

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  cache?: RequestCache;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, skipAuth = false, cache } = opts;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (!skipAuth) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
    if (token) requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache,
  });

  // If 401 try once to refresh token
  if (res.status === 401 && !skipAuth) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      requestHeaders['Authorization'] = `Bearer ${localStorage.getItem('cs_token')}`;
      const retryRes = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: requestHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error ?? 'Request failed');
      }
      return retryRes.json() as Promise<T>;
    }
    // Refresh failed — clear auth and redirect to login
    clearAuth();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error ?? 'Request failed');
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  const refresh_token = localStorage.getItem('cs_refresh_token');
  if (!refresh_token) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
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

export function clearAuth() {
  localStorage.removeItem('cs_token');
  localStorage.removeItem('cs_refresh_token');
  localStorage.removeItem('cs_user');
}

// ─── Auth endpoints ────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{ access_token: string; refresh_token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    }),

  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  logout: (refresh_token: string) =>
    request<{ message: string }>('/api/auth/logout', {
      method: 'POST',
      body: { refresh_token },
    }),

  forgotPassword: (email: string) =>
    request<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
      skipAuth: true,
    }),

  verifyOtp: (email: string, otp: string) =>
    request<{ message: string }>('/api/auth/verify-otp', {
      method: 'POST',
      body: { email, otp },
      skipAuth: true,
    }),

  resetPassword: (email: string, otp: string, new_password: string) =>
    request<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: { email, otp, new_password },
      skipAuth: true,
    }),
};

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: 'managing_director' | 'construction_accountant' | 'construction_coordinator';
  avatar_url?: string | null;
};

// ─── User administration (MD only) ─────────────────────────────────────────────
export type ManagedUser = AuthUser & {
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const usersApi = {
  list: () => request<ManagedUser[]>('/api/users'),

  create: (data: { email: string; password: string; full_name: string; role: string }) =>
    request<{ message: string; user: ManagedUser }>('/api/users', {
      method: 'POST',
      body: data,
    }),

  update: (id: string, data: Partial<{ full_name: string; role: string; is_active: boolean }>) =>
    request<{ message: string; user: ManagedUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: data,
    }),
};

// ─── Profile self-service ──────────────────────────────────────────────────────
export const profileApi = {
  update: (data: { full_name?: string; email?: string; current_password?: string; new_password?: string }) =>
    request<{ message: string; user: AuthUser }>('/api/auth/profile', {
      method: 'PATCH',
      body: data,
    }),

  uploadAvatar: (file: File): Promise<{ message: string; avatar_url: string }> => {
    const formData = new FormData();
    formData.append('avatar', file);
    const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
    return fetch('/api/auth/profile/avatar', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Upload failed' })); throw new Error(e.error); }
      return r.json();
    });
  },
};

// ─── Production types ──────────────────────────────────────────────────────────
export type ProductionStatus = 'pre_production' | 'active_build' | 'strike' | 'complete' | 'archived';
export type ContractType     = 'on_a_price' | 'cost_plus';
export type SetStatus        = 'not_started' | 'in_progress' | 'nearing_completion' | 'complete' | 'handed_over';

export type Production = {
  id: string;
  name: string;
  production_company: string | null;
  production_designer: string | null;
  production_type: string | null;
  start_date: string | null;
  end_date: string | null;
  contract_type: ContractType;
  status: ProductionStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  total_sets: number;
  completed_sets: number;
  archived_at: string | null;
  archived_by: string | null;
  rollback_notice: string | null;
  post_production_percentometer: {
    status: 'processing' | 'complete' | 'failed';
    labour_total?: number;
    materials_total?: number;
    grand_total?: number;
    labour_pct?: string;
    materials_pct?: string;
    computed_at?: string;
    error?: string;
  } | null;
};

export type AuditLogEntry = {
  id: string;
  action: 'archived' | 'unarchived';
  created_at: string;
  performed_by: string;
  production_name: string | null;
  metadata: Record<string, unknown>;
};

export type ProductionSet = {
  id: string;
  production_id: string;
  set_number: string | null;
  set_name: string;
  shoot_week: string | null;
  handover_date: string | null;
  completion_status: SetStatus;
  notes: string | null;
  days_until_handover: number | null;
  countdown_colour: 'green' | 'amber' | 'red' | null;
  linked_po_count: number;
};

export type ProductionDocument = {
  id: string;
  production_id: string;
  document_type: string;
  file_url: string;
  file_key: string | null;
  file_name: string;
  file_size: number | null;
  file_mime_type: string | null;
  uploaded_by: string;
  uploaded_at: string;
};

export type ProductionDetail = Production & {
  sets: ProductionSet[];
  production_documents: ProductionDocument[];
  days_remaining: number | null;
  sets_outstanding: number;
  has_linked_pos: boolean;
  has_linked_timesheets: boolean;
};

// ─── Dashboard types ───────────────────────────────────────────────────────────
export type DashboardData = {
  generated_at: string;
  current_week: { start: string; end: string };
  po_spend: {
    today_total: number;
    week_total: number;
    by_production: Array<{ production: string; total: number }>;
  };
  current_week_labour: {
    week_ending: string;
    total: number;
    by_production: Array<{ production: string; total: number; pending: number; approved: number }>;
  };
  active_productions: Array<{
    id: string;
    name: string;
    status: ProductionStatus;
    contract_type: ContractType;
    total_budget: number | null;
    total_costs_to_date: number;
    amount_remaining: number | null;
    percent_remaining: string | null;
    rag_status: 'green' | 'amber' | 'red' | 'unknown';
  }>;
  crew_headcount: {
    total: number;
    by_production: Array<{ production: string; headcount: number }>;
  };
  forecasting_variance: Array<{
    forecast_name: string;
    production: string;
    forecast_total: number;
    actual_cost: number;
    variance_gbp: number;
    variance_percentage: string;
    status: 'over_forecast' | 'under_forecast' | 'on_track';
  }>;
  production_pipeline: Array<{
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    current_phase: ProductionStatus;
    days_remaining: number | null;
  }>;
  pending_approvals: {
    purchase_orders: number;
    timesheets: number;
    total: number;
  };
  cash_flow: { note: string; data: null };
};

// ─── Productions API ───────────────────────────────────────────────────────────
export const productionsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Production[]>(`/api/productions${qs}`);
  },
  create: (data: Partial<Production>) =>
    request<Production>('/api/productions', { method: 'POST', body: data }),
  getById: (id: string) =>
    request<ProductionDetail>(`/api/productions/${id}`),
  update: (id: string, data: Partial<Production>) =>
    request<Production>(`/api/productions/${id}`, { method: 'PUT', body: data }),
  archivePreview: (id: string) =>
    request<{ production_name: string; po_count: number; timesheet_weeks: number; crew_count: number }>(
      `/api/productions/${id}/archive-preview`
    ),
  getAuditLog: () =>
    request<AuditLogEntry[]>('/api/productions/audit-log'),
  archive: (id: string) =>
    request<{ message: string; production: Production }>(`/api/productions/${id}/archive`, { method: 'POST' }),
  unarchive: (id: string) =>
    request<{ message: string; production: Production }>(`/api/productions/${id}/unarchive`, { method: 'POST' }),
  transitionStatus: (id: string, body: {
    to_status: string;
    is_rollback?: boolean;
    reason?: string;
    checklist_confirmed?: boolean;
  }) =>
    request<{ message: string; production: Production }>(`/api/productions/${id}/transition`, {
      method: 'POST', body,
    }),
  listArchived: () =>
    request<Production[]>(`/api/productions?include_archived=true`).then(all =>
      all.filter(p => p.status === 'archived')
    ),

  getSets: (id: string) =>
    request<ProductionSet[]>(`/api/productions/${id}/sets`),
  createSet: (id: string, data: Partial<ProductionSet>) =>
    request<ProductionSet>(`/api/productions/${id}/sets`, { method: 'POST', body: data }),
  updateSet: (id: string, setId: string, data: Partial<ProductionSet>) =>
    request<ProductionSet>(`/api/productions/${id}/sets/${setId}`, { method: 'PUT', body: data }),
  patchSet: (id: string, setId: string, completion_status: string) =>
    request<ProductionSet>(`/api/productions/${id}/sets/${setId}`, { method: 'PATCH', body: { completion_status } }),
  deleteSet: (id: string, setId: string) =>
    request<{ message: string }>(`/api/productions/${id}/sets/${setId}`, { method: 'DELETE' }),

  getDocuments: (id: string) =>
    request<ProductionDocument[]>(`/api/productions/${id}/documents`),
  uploadDocument: (id: string, formData: FormData) =>
    fetch(`/api/productions/${id}/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}`,
      },
      body: formData,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Upload failed' })); throw new Error(e.error); }
      return r.json() as Promise<ProductionDocument>;
    }),
  deleteDocument: (id: string, docId: string) =>
    request<{ message: string }>(`/api/productions/${id}/documents/${docId}`, { method: 'DELETE' }),
};

// ─── Dashboard API ─────────────────────────────────────────────────────────────
// get() backs Warren's Dashboard (MD only). Accountant/Coordinator use their
// own scoped overview endpoints, which deliberately exclude Cost
// Report/Forecasting financial data they're not permitted to see.
export const dashboardApi = {
  get: () => request<DashboardData>('/api/dashboard'),

  accountantOverview: () => request<{
    current_week_labour: DashboardData['current_week_labour'];
    active_productions:  DashboardData['active_productions'];
  }>('/api/dashboard/accountant-overview'),

  coordinatorOverview: () => request<{
    active_count:        number;
    crew_headcount:       DashboardData['crew_headcount'];
    open_po_count:        number;
    production_pipeline:  DashboardData['production_pipeline'];
  }>('/api/dashboard/coordinator-overview'),
};

// ─── Timesheet types ───────────────────────────────────────────────────────────
export type TimesheetStatus = 'draft' | 'submitted' | 'distributed' | 'amendment_requested' | 'finalised';

export type Timesheet = {
  id: string;
  crew_member_id: string;
  production_id: string;
  week_ending_date: string;
  status: TimesheetStatus;
  grand_total: string | null;
  gross_total?: string | null;
  net_total_amount?: string | null;
  overtime_amount?: string | null;
  travel_amount?: string | null;
  mileage_amount?: string | null;
  per_diem_amount?: string | null;
  ad_hoc_amount?: string | null;
  food_amount?: string | null;
  days_worked?: number | null;
  overtime_hours_total?: number | null;
  invoice_attachment_url: string | null;
  invoice_attachment_name: string | null;
  // joined from crew_members
  first_name?: string;
  last_name?: string;
  crew_number?: string;
  crew_trade?: string;
  crew_rank?: string;
  // joined from productions
  prod_name?: string;
  amended_at?: string | null;
  attendance_days?: Array<{ day: string; worked: boolean }>;
};

export const timesheetsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Timesheet[]>(`/api/timesheets${qs}`, { cache: 'no-store' });
  },
  getById: (id: string) => request<Timesheet>(`/api/timesheets/${id}`, { cache: 'no-store' }),
  create: (data: { crew_member_id: string; production_id: string; week_ending_date: string }) =>
    request<Timesheet>('/api/timesheets', { method: 'POST', body: data }),
  submit: (id: string) =>
    request<{ message: string; timesheet: Timesheet }>(`/api/timesheets/${id}/submit`, { method: 'POST' }),
  bulkDistribute: (data: { week_ending_date: string; production_id?: string }) =>
    request<{ message: string }>('/api/timesheets/bulk-distribute', { method: 'POST', body: data }),
};

export type GatewayError = {
  error_code: 'CREW_NOT_FOUND' | 'CREW_INACTIVE' | 'CREW_RECORD_INCOMPLETE' | 'NO_PRODUCTION_ENGAGEMENT' | 'RATE_NOT_CONFIGURED' | 'PRODUCTION_NOT_ACTIVE';
  error: string;
  missing_fields?: string[];
  crew_member_id?: string;
  crew_name?: string;
};

// ─── Purchase Order types ──────────────────────────────────────────────────────
export type POStatus = 'draft' | 'submitted' | 'issued' | 'invoice_received' | 'approved';

export type PurchaseOrder = {
  id: string;
  po_number: string;
  title: string | null;
  supplier_name: string;
  supplier_id: string | null;
  supplier_email: string | null;
  supplier_address: string | null;
  street_name: string | null;
  zip_code: string | null;
  city: string | null;
  county: string | null;
  date_of_po: string;
  production_id: string;
  set_code: string | null;
  account_code: string | null;
  description: string | null;
  department?: string | null;
  net_amount: string;
  vat: string;
  gross_amount: string;
  status: POStatus;
  paid_from: string;
  invoice_attachment_url: string | null;
  invoice_attachment_name: string | null;
  confirmation_attachment_url: string | null;
  confirmation_attachment_name: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  // joined
  prod_name?: string;
  prod_status?: string;
};

export const purchaseOrdersApi = {
  getAccountCodes: () => request<string[]>('/api/purchase-orders/account-codes'),
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<PurchaseOrder[]>(`/api/purchase-orders${qs}`);
  },
  getById: (id: string) => request<PurchaseOrder>(`/api/purchase-orders/${id}`),
  create: (data: Partial<PurchaseOrder>) =>
    request<{ message: string; purchase_order: PurchaseOrder }>('/api/purchase-orders', { method: 'POST', body: data }),
  update: (id: string, data: Partial<PurchaseOrder>) =>
    request<{ message: string; purchase_order: PurchaseOrder }>(`/api/purchase-orders/${id}`, { method: 'PUT', body: data }),
  submit: (id: string) =>
    request<{ message: string; purchase_order: PurchaseOrder }>(`/api/purchase-orders/${id}/submit`, {
      method: 'POST', body: {},
    }),
  approve: (id: string) =>
    request<{ message: string; purchase_order: PurchaseOrder }>(`/api/purchase-orders/${id}/approve`, {
      method: 'POST', body: {},
    }),
  downloadPdf: async (id: string, po_number: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
    const res = await fetch(`/api/purchase-orders/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to download PDF');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${po_number}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  attachInvoice: (id: string, formData: FormData) =>
    fetch(`/api/purchase-orders/${id}/attach-invoice`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}`,
      },
      body: formData,
    }).then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? r.statusText);
      }
      return r.json() as Promise<{ message: string; purchase_order: PurchaseOrder }>;
    }),
  downloadInvoice: (id: string) =>
    request<{ url: string; filename: string }>(`/api/purchase-orders/${id}/invoice/download`),
  deleteInvoice: (id: string) =>
    request<{ message: string }>(`/api/purchase-orders/${id}/invoice`, { method: 'DELETE' }),
  attachConfirmation: (id: string, formData: FormData) =>
    fetch(`/api/purchase-orders/${id}/attach-confirmation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}`,
      },
      body: formData,
    }).then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? r.statusText);
      }
      return r.json() as Promise<{ message: string; purchase_order: PurchaseOrder }>;
    }),
  downloadConfirmation: async (id: string, filename: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
    const res = await fetch(`/api/purchase-orders/${id}/confirmation/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('Failed to download order confirmation');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'order-confirmation';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  delete: (id: string) =>
    request<{ message: string }>(`/api/purchase-orders/${id}`, { method: 'DELETE' }),
  import: (formData: FormData) =>
    fetch('/api/purchase-orders/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}`,
      },
      body: formData,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
      return r.json() as Promise<{
        total_rows: number;
        imported_count: number;
        skipped_count: number;
        errors: Array<{ row: number; data: Record<string, string>; error: string }>;
      }>;
    }),
};

// ─── Crew types ────────────────────────────────────────────────────────────────
export type EmploymentStatus = 'paye' | 'self_employed';

export type CrewMember = {
  id: string;
  crew_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  home_address: string | null;
  employment_status: EmploymentStatus;
  crew_trade: string | null;
  crew_rank: string | null;
  email: string | null;
  is_active: boolean;
  company_name: string | null;
  company_registration_number: string | null;
  vat_registration_number: string | null;
  paye_withholding_rate: number | null;
  account_name: string | null;
  account_number: string | null;
  sort_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  qualifications: string[];
  company_utr: string | null;
  created_at: string;
  active_productions?: string[];
};

export type CrewDocument = {
  id: string;
  crew_member_id: string;
  document_type: 'government_id' | 'contract' | 'other';
  context_type: 'crew_identity' | 'crew_contract' | null;
  production_id: string | null;
  production_name?: string | null;
  file_url: string;
  file_key: string | null;
  file_name: string;
  file_size: number | null;
  file_mime_type: string | null;
  uploaded_at: string;
};

export type CrewProductionHistory = {
  id: string;
  crew_member_id: string;
  production_id: string;
  prod_id: string;
  prod_name: string;
  prod_status: string;
  start_date: string | null;
  end_date: string | null;
  contract_url: string | null;
};

export type CrewTimesheetHistory = {
  id: string;
  week_ending_date: string;
  status: string;
  grand_total: string | null;
  prod_id: string;
  prod_name: string;
};

export type CrewDetail = CrewMember & {
  production_history: CrewProductionHistory[];
  timesheet_history: CrewTimesheetHistory[];
  documents: CrewDocument[];
};

export type CrewRegistrationRequest = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  home_address: string | null;
  email: string;
  phone: string | null;
  employment_status: EmploymentStatus;
  crew_trade: string;
  company_name: string | null;
  company_registration_number: string | null;
  vat_registration_number: string | null;
  company_utr: string | null;
  account_name: string | null;
  account_number: string | null;
  sort_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  qualifications: string[];
  notes: string | null;
  reviewed_by: string | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_crew_member_id: string | null;
  created_crew_number?: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicCrewRegistrationData = {
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  home_address?: string;
  email: string;
  phone?: string;
  employment_status: EmploymentStatus;
  crew_trade: string;
  company_name?: string;
  company_registration_number?: string;
  vat_registration_number?: string;
  company_utr?: string;
  account_name?: string;
  account_number?: string;
  sort_code?: string;
  emergency_contact_name?: string;
  emergency_contact_relationship?: string;
  emergency_contact_phone?: string;
  qualifications?: string[];
  notes?: string;
};

export const crewApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<CrewMember[]>(`/api/crew${qs}`);
  },
  getById: (id: string) => request<CrewDetail>(`/api/crew/${id}`),
  create: (data: Partial<CrewMember>) =>
    request<CrewMember>('/api/crew', { method: 'POST', body: data }),
  update: (id: string, data: Partial<CrewMember>) =>
    request<CrewMember>(`/api/crew/${id}`, { method: 'PUT', body: data }),
  getTrades: () =>
    request<{ bectu: Record<string, string[]>; non_bectu: string[] }>('/api/crew/trades'),
  linkToProduction: (id: string, data: { production_id: string; start_date?: string; end_date?: string }) =>
    request<{ id: string }>(`/api/crew/${id}/productions`, { method: 'POST', body: data }),
  uploadDocument: (id: string, formData: FormData) =>
    fetch(`/api/crew/${id}/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}`,
      },
      body: formData,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
      return r.json() as Promise<CrewDocument>;
    }),
  deleteDocument: (crewId: string, docId: string) =>
    request<{ message: string }>(`/api/crew/${crewId}/documents/${docId}`, { method: 'DELETE' }),
  delete: (id: string) =>
    request<{ message: string; soft_deleted: boolean }>(`/api/crew/${id}`, { method: 'DELETE' }),

  // ── Registration Requests & Invites ─────────────────────────────────────────
  sendInvite: (data: { email: string; name?: string; message?: string }) =>
    request<{ message: string; inviteUrl: string }>('/api/crew/send-invite', { method: 'POST', body: data }),
  listRequests: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    request<{
      requests: CrewRegistrationRequest[];
      counts: { pending: number; approved: number; rejected: number; total: number };
    }>(`/api/crew/requests?status=${status}`),
  getRequestById: (id: string) =>
    request<CrewRegistrationRequest>(`/api/crew/requests/${id}`),
  approveRequest: (id: string, data: { crew_rank: string; paye_withholding_rate?: number }) =>
    request<{ message: string; crew_member: CrewMember }>(`/api/crew/requests/${id}/approve`, { method: 'POST', body: data }),
  rejectRequest: (id: string, data: { reason?: string }) =>
    request<{ message: string; request: CrewRegistrationRequest }>(`/api/crew/requests/${id}/reject`, { method: 'POST', body: data }),
  deleteRequest: (id: string) =>
    request<{ message: string }>(`/api/crew/requests/${id}`, { method: 'DELETE' }),

  // ── Public Portal endpoints (no auth required) ──────────────────────────────
  getPublicTrades: () =>
    request<{ bectu: Record<string, string[]>; non_bectu: string[] }>('/api/public/crew/trades'),
  submitPublicRegistration: (data: PublicCrewRegistrationData) =>
    request<{ message: string; id: string }>('/api/public/crew/register', { method: 'POST', body: data }),
};

// ─── Cost Report types ─────────────────────────────────────────────────────────
export type CostReportSupplierItem = {
  date: string;
  supplier: string;
  description: string | null;
  po_number: string;
  set_code: string | null;
  account_code: string | null;
  cost_ex_vat: number;
  vat: number;
  total: number;
  purchase_method: string;
};

export type CostReportLabourWeek = {
  week_ending_date: string;
  total: number;
  crew: Array<{ crew_number: string; name: string; trade: string | null; rank: string | null; grand_total: number }>;
};

export type CostReportInvoice = {
  id: string;
  production_id: string;
  invoice_description: string | null;
  po_number: string | null;
  date: string;
  invoice_number: string | null;
  amount: string;
  notes: string | null;
};

export type CostReport = {
  production: Production;
  contract_type: ContractType;
  as_at_date: string;
  metrics: {
    total_supplier_costs: number;
    total_labour_costs: number;
    total_hire_costs?: number;
    total_costs_to_date: number;
    total_invoiced_to_production: number;
    current_profit: number;
    profit_percentage_of_turnover: string;
  };
  supplier_costs: CostReportSupplierItem[];
  labour_weekly: CostReportLabourWeek[];
  invoices_to_production: CostReportInvoice[];
};

export const costReportApi = {
  get: (productionId: string, asAtDate?: string) => {
    const qs = asAtDate ? `?as_at_date=${asAtDate}` : '';
    return request<CostReport>(`/api/cost-reports/${productionId}${qs}`);
  },
  addInvoice: (productionId: string, data: {
    invoice_description?: string;
    po_number?: string;
    date?: string;
    invoice_number?: string;
    amount: number;
    notes?: string;
  }) => request<CostReportInvoice>(`/api/cost-reports/${productionId}/invoices`, {
    method: 'POST', body: data,
  }),
  exportPDF: (productionId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetch(`/api/cost-reports/${productionId}/export/pdf${qs}`, {
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
    });
  },
};

// ─── Forecasting types ─────────────────────────────────────────────────────────
export type Forecast = {
  id: string;
  name: string;
  production_id: string | null;
  prod_name?: string;
  total_labour_cost: number;
  total_materials_cost: number;
  total_forecast_cost: number;
  percentometer_carpenter_cost: number | null;
  percentometer_total: number | null;
  created_at: string;
  created_by: string;
};

export type PercentometerRatio = {
  id?: string;
  cost_type: string;
  percentage: number;
};

export type CatalogueItem = {
  id: string;
  supplier_name: string;
  item_description: string;
  unit: string | null;
  unit_price: string;
  category: string | null;
  last_used_date: string | null;
  created_at: string;
};

export const forecastingApi = {
  getAllForecasts: (productionId?: string) => {
    const qs = productionId ? `?production_id=${productionId}` : '';
    return request<Forecast[]>(`/api/forecasting/forecasts${qs}`);
  },
  createForecast: (data: {
    name: string;
    production_id?: string | null;
    percentometer_carpenter_cost?: number | null;
    labour_items?: unknown[];
    materials_items?: unknown[];
  }) => request<Forecast>('/api/forecasting/forecasts', { method: 'POST', body: data }),
  deleteForecast: (id: string) =>
    request<{ message: string }>(`/api/forecasting/forecasts/${id}`, { method: 'DELETE' }),

  getRatios: () =>
    request<PercentometerRatio[]>('/api/forecasting/percentometer/ratios'),
  updateRatios: (ratios: Array<{ cost_type: string; percentage: number }>) =>
    request<PercentometerRatio[]>('/api/forecasting/percentometer/ratios', {
      method: 'PUT', body: { ratios },
    }),
  calculate: (carpenter_cost: number) =>
    request<{
      result: Array<{ cost_type: string; percentage: number; estimated_cost: number }>;
      total_estimated_cost: number;
    }>('/api/forecasting/percentometer/calculate', {
      method: 'POST', body: { carpenter_cost },
    }),

  getCatalogue: () => request<CatalogueItem[]>('/api/forecasting/catalogue'),
  createCatalogueItem: (data: Partial<CatalogueItem>) =>
    request<CatalogueItem>('/api/forecasting/catalogue', { method: 'POST', body: data }),
  updateCatalogueItem: (id: string, data: Partial<CatalogueItem>) =>
    request<CatalogueItem>(`/api/forecasting/catalogue/${id}`, { method: 'PUT', body: data }),
  deleteCatalogueItem: (id: string) =>
    request<{ message: string }>(`/api/forecasting/catalogue/${id}`, { method: 'DELETE' }),

  getBectuRates: () =>
    request<Record<string, Record<string, number>>>('/api/forecasting/bectu-rates'),
};

// ─── Crew Rates types ─────────────────────────────────────────────────────────
export type CrewRate = {
  id: string;
  trade: string;
  rank: string;
  daily_rate: string | null;
  overtime_rate: string | null;
  weekly_rate: string | null;
  rate_year: string;
  rate_type: 'bectu' | 'non_bectu';
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
};

export const crewRatesApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<CrewRate[]>(`/api/crew-rates${qs}`);
  },
  update: (id: string, data: { daily_rate?: string | null; overtime_rate?: string | null }) =>
    request<CrewRate>(`/api/crew-rates/${id}`, { method: 'PATCH', body: data }),
  importCSV: (formData: FormData) =>
    fetch('/api/crew-rates/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}`,
      },
      body: formData,
    }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
      return r.json() as Promise<{ message: string; inserted: number; expired: number }>;
    }),
};

// ─── Pay Run types & API ───────────────────────────────────────────────────────
export type PayRunStatus = 'draft' | 'processed';
export type PayRun = {
  id: string;
  production_id: string;
  week_ending_date: string;
  status: PayRunStatus;
  created_by: string;
  processed_at: string | null;
  created_at: string;
  prod_name?: string;
};
export type PayRunItem = {
  timesheet_id: string;
  crew_number: string;
  crew_name: string;
  employment_type: 'paye' | 'self_employed';
  gross_amount: number;
  withholding_amount: number;
  net_amount: number;
  sort_code: string | null;
  account_number: string | null;
  account_name: string | null;
  payment_reference: string;
};
export type PayRunPreview = {
  production_name: string;
  week_ending_date: string;
  items: PayRunItem[];
  total_gross: number;
  total_net: number;
};
export const payRunsApi = {
  getAvailableWeeks: (production_id: string) =>
    request<Array<{ week_ending_date: string; timesheet_count: number; pay_run_id: string | null; pay_run_status: string | null; processed_at: string | null }>>(
      `/api/pay-runs/available-weeks?production_id=${production_id}`
    ),
  getPreview: (production_id: string, week_ending_date: string) =>
    request<PayRunPreview>(`/api/pay-runs/preview?production_id=${production_id}&week_ending_date=${week_ending_date}`),
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<PayRun[]>(`/api/pay-runs${qs}`);
  },
  getById: (id: string) =>
    request<PayRun & { items: PayRunItem[] }>(`/api/pay-runs/${id}`),
  create: (data: { production_id: string; week_ending_date: string }) =>
    request<{ message: string; pay_run: PayRun }>('/api/pay-runs', { method: 'POST', body: data }),
  process: (id: string) =>
    request<{ message: string; pay_run: PayRun }>(`/api/pay-runs/${id}/process`, { method: 'POST', body: {} }),
  syncLabour: (id: string) =>
    request<{ message: string }>(`/api/pay-runs/${id}/sync-labour`, { method: 'POST', body: {} }),
  exportCsv: (id: string) =>
    fetch(`/api/pay-runs/${id}/export-csv`, {
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
    }),
};

// ─── Materials Catalogue types & API ───────────────────────────────────────────
export type MaterialsCatalogueItem = {
  id: string;
  material_name: string | null;
  description: string | null;
  category: string | null;
  supplier_name: string | null;
  product_description: string;
  unit_of_measure: string | null;
  unit_price: number;
  price_updated_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export const materialsCatalogueApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<MaterialsCatalogueItem[]>(`/api/materials-catalogue${qs}`);
  },
  create: (data: Partial<MaterialsCatalogueItem>) =>
    request<MaterialsCatalogueItem>('/api/materials-catalogue', { method: 'POST', body: data }),
  update: (id: string, data: Partial<MaterialsCatalogueItem>) =>
    request<MaterialsCatalogueItem>(`/api/materials-catalogue/${id}`, { method: 'PATCH', body: data }),
  delete: (id: string) =>
    request<{ message: string }>(`/api/materials-catalogue/${id}`, { method: 'DELETE' }),
  importCSV: (formData: FormData) =>
    fetch('/api/materials-catalogue/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
      body: formData,
    }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); } return r.json() as Promise<{ imported: number }>; }),
};

export type MaterialsInventoryItem = {
  id: string;
  material_id: string;
  material_name: string;
  description: string | null;
  category: string | null;
  quantity: number;
  quantity_purchased: number;
  unit_of_measure: string;
  production_id: string | null;
  production_name: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MaterialsInventorySummaryItem = {
  material_id: string;
  material_name: string;
  unit_of_measure: string;
  production_id: string | null;
  production_name: string | null;
  total_bought: number;
  remaining_stock: number;
};

export const materialsInventoryApi = {
  list: () => request<MaterialsInventoryItem[]>('/api/materials-inventory'),
  summary: () => request<MaterialsInventorySummaryItem[]>('/api/materials-inventory/summary'),
  create: (data: Partial<MaterialsInventoryItem>) =>
    request<MaterialsInventoryItem>('/api/materials-inventory', { method: 'POST', body: data }),
  update: (id: string, data: Partial<MaterialsInventoryItem>) =>
    request<MaterialsInventoryItem>(`/api/materials-inventory/${id}`, { method: 'PUT', body: data }),
  restock: (id: string, quantity: number) =>
    request<MaterialsInventoryItem>(`/api/materials-inventory/${id}/restock`, { method: 'POST', body: { quantity } }),
  delete: (id: string) =>
    request<{ message: string }>(`/api/materials-inventory/${id}`, { method: 'DELETE' }),
};

// ─── Suppliers Database API ────────────────────────────────────────────────────
export type Supplier = {
  id: string;
  name: string;
  category: string | null;
  primary_contact_name: string | null;
  email: string | null;
  street_name: string | null;
  city: string | null;
  county: string | null;
  zip_code: string | null;
  phone: string | null;
  account_number: string | null;
  credit_terms: string | null;
  payment_terms: string | null;
  lead_times: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export const supplierApi = {
  list: () => request<Supplier[]>('/api/suppliers'),
  getAll: () => request<{ suppliers: Supplier[] }>('/api/suppliers'),
  getNames: () => request<string[]>('/api/suppliers/names'),
  getById: (id: string) => request<Supplier>(`/api/suppliers/${id}`),
  create: (data: Partial<Supplier>) =>
    request<Supplier>('/api/suppliers', { method: 'POST', body: data }),
  update: (id: string, data: Partial<Supplier>) =>
    request<Supplier>(`/api/suppliers/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) =>
    request<{ message: string }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
  getHistory: (id: string) => request<SupplierPurchaseOrder[]>(`/api/suppliers/${id}/history`),
  getAllHistory: () => request<SupplierPurchaseOrder[]>('/api/suppliers/history'),
};
export const suppliersApi = supplierApi;

export type SupplierPurchaseOrder = {
  id: string;
  po_number: string;
  title: string | null;
  date_of_po: string;
  status: string;
  net_amount: number;
  vat: number;
  gross_amount: number;
  supplier_name: string;
  supplier_category: string | null;
  supplier_location: string | null;
  production_id: string;
  production_name: string;
  production_status: string;
};

// ─── Percentometer new API (versioned ratios + actuals) ────────────────────────
export type PercentometerActualsRow = {
  cost_type: string;
  historical_pct: number;
  estimated_gbp: number;
  actual_gbp: number;
  actual_pct: number;
  variance_gbp: number;
  variance_pct: number | null;
  rag: 'green' | 'amber' | 'red' | 'unknown';
};
export const percentometerApi = {
  getRatios: (current = true) =>
    request<Array<{ id: string; cost_type: string; percentage: number; effective_from: string; effective_to: string | null }>>(`/api/percentometer/ratios${current ? '?current=true' : ''}`),
  calculate: (known_cost: number, known_cost_type = 'Carpenters') =>
    request<{ known_cost: number; total_estimated_job_cost: number; breakdown: Array<{ cost_type: string; percentage: number; estimated_value: number }> }>(
      '/api/percentometer/calculate', { method: 'POST', body: { known_cost, known_cost_type } }
    ),
  updateRatio: (id: string, percentage: number) =>
    request<{ id: string; cost_type: string; percentage: number; effective_from: string }>(`/api/percentometer/ratios/${id}`, { method: 'PATCH', body: { percentage } }),
  getActuals: (productionId: string) =>
    request<{ status: string; grand_total?: number; computed_at?: string; comparison?: PercentometerActualsRow[]; message?: string }>(`/api/percentometer/actuals/${productionId}`),
};

// ─── Crew Import API ───────────────────────────────────────────────────────────
export type CrewImportPreviewRow = {
  row: number; first_name: string; last_name: string;
  crew_trade: string; crew_rank: string;
  employment_status: string | null;
  is_duplicate: boolean; errors: string[]; valid: boolean;
};
export const crewImportApi = {
  preview: (formData: FormData) =>
    fetch('/api/crew/import/preview', {
      method: 'POST',
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
      body: formData,
    }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
      return r.json() as Promise<{ total_rows: number; valid_rows: number; invalid_rows: number; preview: CrewImportPreviewRow[] }>; }),
  import: (formData: FormData) =>
    fetch('/api/crew/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
      body: formData,
    }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
      return r.json() as Promise<{ total_rows: number; created: number; skipped: number; created_records: Array<{ row: number; crew_number: string; first_name: string; last_name: string }>; skipped_records: Array<{ row: number; first_name: string; last_name: string; reason: string }> }>; }),
};

// ─── App Settings API ─────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => request<Record<string, { value: unknown; updated_at: string }>>('/api/settings'),
  patch: (key: string, value: unknown) =>
    request<{ key: string; value: unknown; updated_at: string }>(`/api/settings/${key}`, { method: 'PATCH', body: { value } }),
};

// ─── Dashboard new dedicated endpoints ────────────────────────────────────────
export type CostSummaryItem = {
  production_id: string; production_name: string; contract_type: ContractType;
  total_budget: number | null; total_costs_to_date: number;
  amount_remaining: number | null; budget_utilisation_pct: number | null;
  rag_status: 'green' | 'amber' | 'red' | 'unknown';
};
export type ForecastVarianceItem = {
  production_id: string; production_name: string;
  forecast_total: number; actual_total: number;
  variance_amount: number; variance_pct: number | null;
};
export type WeeklyPLProduction = {
  production_id: string; production_name: string;
  weeks: Array<{ week_ending_date: string; margin_earned: number; warrens_salary: number; luton_uplift: number; box_rental_uplift: number; weekly_profit: number; running_total_profit: number }>;
};
export const dashboardNewApi = {
  costSummary: () => request<CostSummaryItem[]>('/api/dashboard/cost-summary'),
  labourCosts: () => request<{ current_week_ending: string; total_labour_this_week: number; breakdown: Array<{ production_name: string; amount: number; status: 'approved' | 'pending' }> }>('/api/dashboard/labour-costs'),
  crewHeadcount: () => request<{ total_active_crew: number; breakdown: Array<{ production_name: string; crew_count: number }>; note?: string }>('/api/dashboard/crew-headcount'),
  forecastVariance: () => request<ForecastVarianceItem[]>('/api/dashboard/forecast-variance'),
  weeklyPL: () => request<WeeklyPLProduction[]>('/api/dashboard/weekly-pl'),
  poSpend: () => request<{ total_approved_today: number; total_approved_this_week: number; breakdown: Array<{ production_name: string; amount: number }> }>('/api/dashboard/po-spend'),
};

// ─── Extended Forecast API (link + forecast variance per production) ──────────
export const forecastLinkApi = {
  link: (id: string, production_id: string, is_primary: boolean) =>
    request<{ id: string; scenario_name: string; production_id: string; is_primary: boolean; combined_total: number }>(`/api/forecasting/forecasts/${id}/link`, { method: 'PATCH', body: { production_id, is_primary } }),
  getProductionVariance: (productionId: string) =>
    request<{ linked: boolean; production_id?: string; scenario_name?: string; forecast_total?: number; actual_total?: number; variance_amount?: number; variance_pct?: number; status?: string; message?: string }>(`/api/productions/${productionId}/forecast-variance`),
};

// ─── Extended Cost Report API ──────────────────────────────────────────────────
export const costReportExtApi = {
  getType1: (productionId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<unknown>(`/api/cost-reports/${productionId}/type1${qs}`);
  },
  getType2: (productionId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<unknown>(`/api/cost-reports/${productionId}/type2${qs}`);
  },
  getSnapshot: (productionId: string, asAtDate: string) =>
    request<{ as_at_date: string; total_supplier_costs: number; total_labour_costs: number; total_costs_to_date: number }>(`/api/cost-reports/${productionId}/snapshot?as_at_date=${asAtDate}`),
  exportCSV: (productionId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetch(`/api/cost-reports/${productionId}/export/csv${qs}`, {
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
    });
  },
  exportPDF: (productionId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetch(`/api/cost-reports/${productionId}/export/pdf${qs}`, {
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
    });
  },
  omitEntry: (productionId: string, data: { entry_id: string; week_ending_date: string; omit_reason?: string }) =>
    request<unknown>(`/api/cost-reports/${productionId}/omit-entry`, { method: 'POST', body: data }),
  unomitEntry: (productionId: string, entryId: string, week_ending_date?: string) => {
    const qs = week_ending_date ? `?week_ending_date=${week_ending_date}` : '';
    return request<{ message: string }>(`/api/cost-reports/${productionId}/omit-entry/${entryId}${qs}`, { method: 'DELETE' });
  },
  updatePoBilling: (productionId: string, sourceId: string, data: { cs_invoice_number?: string; amount_invoiced?: number; notes?: string }) =>
    request<unknown>(`/api/cost-reports/${productionId}/po-billing/${sourceId}`, { method: 'PATCH', body: data }),
  updateMarginsReference: (productionId: string, data: { items?: string[]; notes?: string }) =>
    request<unknown>(`/api/cost-reports/${productionId}/margins-reference`, { method: 'PUT', body: data }),
  upsertWeeklyPL: (productionId: string, weekEndingDate: string, data: { warrens_salary?: number; luton_uplift?: number; box_rental_uplift?: number; notes?: string; cs_invoice_number?: string; po_reference?: string }) =>
    request<unknown>(`/api/cost-reports/${productionId}/weekly-pl/${weekEndingDate}`, { method: 'PUT', body: data }),
  getNextInvoiceNumber: (productionId: string) =>
    request<{ next_invoice_number: string }>(`/api/cost-reports/${productionId}/next-invoice-number`),
  deleteInvoice: (productionId: string, invoiceId: string) =>
    request<{ message: string }>(`/api/cost-reports/${productionId}/invoices/${invoiceId}`, { method: 'DELETE' }),
  upsertBudget: (productionId: string, data: {
    margin_rate?: number;
    contracted_weeks?: number;
    notes?: string;
    budget_lines?: Array<{
      account_code?: string | null;
      description?: string;
      weekly_cost?: number;
      weeks?: number;
      total?: number;
      bectu_rate?: number | null;
      agreed_rate?: number | null;
      line_margin_rate?: number | null;
      is_above_line?: boolean;
      set_id?: string | null;
      notes?: string | null;
      line_type?: string;
    }>;
  }) =>
    request<unknown>(`/api/cost-reports/${productionId}/budget`, { method: 'POST', body: data }),
};

// ─── Module 8: Assets & Hire Equipment ───────────────────────────────────────

export type VehicleComplianceStatus = 'compliant' | 'due_soon' | 'overdue' | 'none';

export interface VehicleComplianceInfo {
  date: string | null;
  days_remaining: number | null;
  status: VehicleComplianceStatus;
  label: string;
}

export interface Vehicle {
  id: string;
  registration_number: string;
  make: string;
  model: string;
  year_of_manufacture: number | null;
  mileage: number | null;
  number_plate: string | null;
  colour: string | null;
  vehicle_type: string | null;
  owner_assigned_to: string | null;
  notes: string | null;
  mot_expiry_date: string | null;
  insurance_renewal_date: string | null;
  tax_renewal_date: string | null;
  tax_direct_debit: boolean;
  mot_compliance?: VehicleComplianceInfo;
  insurance_compliance?: VehicleComplianceInfo;
  tax_compliance?: VehicleComplianceInfo;
  overall_status?: VehicleComplianceStatus;
  created_at: string;
  updated_at: string;
}

export interface HireEquipment {
  id: string;
  equipment_type: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_official_name?: string | null;
  description: string | null;
  production_id: string;
  production_name?: string;
  production_status?: string;
  hire_start_date: string;
  weekly_hire_rate: number;
  return_date: string | null;
  status: 'active' | 'returned';
  notes: string | null;
  days_hired?: number;
  weeks_hired?: number;
  total_cost?: number;
  created_at: string;
  updated_at: string;
}

export interface AssetsHireSummary {
  total_vehicles: number;
  deadlines_due_soon: number;
  deadlines_overdue: number;
  mot_due_count: number;
  insurance_due_count: number;
  tax_due_count: number;
  active_hires_count: number;
  total_hires_count: number;
  active_weekly_run_rate: number;
  total_hire_cost_to_date: number;
}

export const vehiclesApi = {
  getAll: (params?: { search?: string; status?: string; vehicle_type?: string }) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]).toString() : '';
    return request<{ vehicles: Vehicle[] }>(`/api/vehicles${qs}`);
  },
  getById: (id: string) =>
    request<{ vehicle: Vehicle }>(`/api/vehicles/${id}`),
  create: (data: Partial<Vehicle>) =>
    request<{ message: string; vehicle: Vehicle }>('/api/vehicles', { method: 'POST', body: data }),
  update: (id: string, data: Partial<Vehicle>) =>
    request<{ message: string; vehicle: Vehicle }>(`/api/vehicles/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) =>
    request<{ message: string }>(`/api/vehicles/${id}`, { method: 'DELETE' }),
  triggerComplianceCheck: () =>
    request<{ message: string; sent: number; skipped: number }>('/api/vehicles/compliance-check', { method: 'POST' }),
};

export const hireEquipmentApi = {
  getAll: (params?: { production_id?: string; status?: string; supplier_name?: string; search?: string }) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]).toString() : '';
    return request<{ hire_equipment: HireEquipment[] }>(`/api/hire-equipment${qs}`);
  },
  getById: (id: string) =>
    request<{ hire_equipment: HireEquipment }>(`/api/hire-equipment/${id}`),
  create: (data: Partial<HireEquipment>) =>
    request<{ message: string; hire_equipment: HireEquipment }>('/api/hire-equipment', { method: 'POST', body: data }),
  update: (id: string, data: Partial<HireEquipment>) =>
    request<{ message: string; hire_equipment: HireEquipment }>(`/api/hire-equipment/${id}`, { method: 'PUT', body: data }),
  return: (id: string, data: { return_date?: string; notes?: string }) =>
    request<{ message: string; hire_equipment: HireEquipment }>(`/api/hire-equipment/${id}/return`, { method: 'POST', body: data }),
  delete: (id: string) =>
    request<{ message: string }>(`/api/hire-equipment/${id}`, { method: 'DELETE' }),
};

export const assetsHireApi = {
  getSummary: () =>
    request<{ summary: AssetsHireSummary }>('/api/assets-hire/summary'),
};

// ─── Buildings, Assets & IT ──────────────────────────────────────────────────

export interface Building {
  id: string;
  name: string;
  address: string | null;
  ownership_status: string | null;
  lease_expiry: string | null;
  landlord_contact: string | null;
  access_code: string | null;
  utilities: any | null;
  insurance_policies: any | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  cost: number | null;
  condition: string | null;
  assigned_to: string | null;
  assignment_type: 'production' | 'location' | null;
  maintenance_schedule: any | null;
  depreciation: any | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ITResource {
  id: string;
  name: string;
  type: string | null;
  vendor: string | null;
  subscription_start: string | null;
  renewal_date: string | null;
  cost: number | null;
  billing_cycle: 'monthly' | 'annual' | 'one_time' | 'free' | null;
  reminder_enabled: boolean;
  reminder_days: number;
  credentials?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const buildingsApi = {
  getAll: () => request<{ buildings: Building[] }>('/api/buildings'),
  getById: (id: string) => request<{ building: Building }>(`/api/buildings/${id}`),
  create: (data: Partial<Building>) => request<{ message: string; building: Building }>('/api/buildings', { method: 'POST', body: data }),
  update: (id: string, data: Partial<Building>) => request<{ message: string; building: Building }>(`/api/buildings/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) => request<{ message: string }>(`/api/buildings/${id}`, { method: 'DELETE' }),
};

export const assetsPlantApi = {
  getAll: () => request<{ assets: Asset[] }>('/api/assets-plant'),
  getById: (id: string) => request<{ asset: Asset }>(`/api/assets-plant/${id}`),
  create: (data: Partial<Asset>) => request<{ message: string; asset: Asset }>('/api/assets-plant', { method: 'POST', body: data }),
  update: (id: string, data: Partial<Asset>) => request<{ message: string; asset: Asset }>(`/api/assets-plant/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) => request<{ message: string }>(`/api/assets-plant/${id}`, { method: 'DELETE' }),
};

export const itResourcesApi = {
  getAll: () => request<{ it_resources: ITResource[] }>('/api/it-resources'),
  getById: (id: string) => request<{ it_resource: ITResource }>(`/api/it-resources/${id}`),
  getCredentials: (id: string) => request<{ credentials: string }>(`/api/it-resources/${id}/credentials`),
  create: (data: Partial<ITResource>) => request<{ message: string; it_resource: ITResource }>('/api/it-resources', { method: 'POST', body: data }),
  update: (id: string, data: Partial<ITResource>) => request<{ message: string; it_resource: ITResource }>(`/api/it-resources/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) => request<{ message: string }>(`/api/it-resources/${id}`, { method: 'DELETE' }),
};

export default request;

export type SafetyHealthDocumentType = 'risk_template' | 'risk_assessment' | 'coshh' | 'insurance';
export type SafetyHealthDocumentStatus = 'active' | 'pending_alteration';
export type SafetyHealthDocument = {
  id: string;
  document_type: SafetyHealthDocumentType;
  file_name: string;
  file_size: number | null;
  file_mime_type: string | null;
  assessment_date: string | null;
  location: string | null;
  production_id: string | null;
  production_name?: string | null;
  production_ids?: string[];
  productions?: Array<{ id: string; name: string }>;
  tags: string[];
  status: SafetyHealthDocumentStatus;
  public_token: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

export const safetyHealthApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<SafetyHealthDocument[]>(`/api/safety-health${qs}`);
  },
  upload: (formData: FormData) => fetch('/api/safety-health/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
    body: formData,
  }).then(async response => {
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error ?? response.statusText); }
    return response.json() as Promise<SafetyHealthDocument>;
  }),
  replace: (id: string, formData: FormData) => fetch(`/api/safety-health/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('cs_token') ?? '' : ''}` },
    body: formData,
  }).then(async response => {
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error ?? response.statusText); }
    return response.json() as Promise<SafetyHealthDocument>;
  }),
  delete: (id: string) => request<{ message: string }>(`/api/safety-health/${id}`, { method: 'DELETE' }),
  download: async (id: string, filename: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
    const response = await fetch(`/api/safety-health/${id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error('Unable to download document');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  },
  publicUrl: (token: string) => `${window.location.origin}/api/public/safety-health/${token}`,
  publicList: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<SafetyHealthDocument[]>(`/api/public/safety-health${qs}`, { skipAuth: true, cache: 'no-store' });
  },
};

