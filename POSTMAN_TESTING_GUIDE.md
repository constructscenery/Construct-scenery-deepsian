# CS HQ — Complete Postman API Testing Guide
## Sequence-wise, per role, as the website actually works

---

## ⚠️ DATABASE SETUP (Run Once Before Testing)

Schema is now managed by **TypeORM migrations**. Run from the `backend/` folder:

```bash
cd backend
npm run migration:run
```

This runs all migrations against the Render PostgreSQL database:
- **Migration 1** — Creates all tables, indexes, and triggers
- **Migration 2** — Creates the normalised `cost_plus_budget_lines` table
- **Migration 3** — Creates the `password_reset_otps` table (OTP-based password reset)

If you need to check which migrations have run:
```bash
npm run migration:show
# [X] = applied  [ ] = pending
```

> ⚠️ **Encryption key** — `.env` already has `ENCRYPTION_KEY` set. Sensitive crew fields (bank details, address, emergency phone) are encrypted at rest but returned as **plaintext in API responses** — no change to how you test.

---

## STEP 1 — POSTMAN ENVIRONMENT SETUP

### Crew Database: Freelancers

Freelancers are a separate contact directory, not payroll crew records. All three
authenticated roles have full access to the following routes:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/crew/freelancers` | List contacts |
| POST | `/api/crew/freelancers` | Create a contact |
| PATCH | `/api/crew/freelancers/:id` | Update only supplied fields |
| DELETE | `/api/crew/freelancers/:id` | Permanently delete a contact (204) |

Example JSON body:

```json
{
  "full_name": "Alex Example",
  "email": "alex@example.test",
  "phone": "+44 7700 900123",
  "skills": "Carpentry, scenic construction",
  "notes": "Available next week",
  "is_favourite": false,
  "call_priority": "backup"
}
```

Only `full_name` is required. Optional text fields may be cleared using `null`
or an empty string. Phone and notes are AES-256-GCM encrypted at rest and
decrypted in authenticated responses. Do not put private addresses or phone
numbers in the unencrypted name, email, or skills fields.

Call priorities: `first_call` (green), `backup` (amber, default), `never_call`
(red). Never call keeps the contact but disables the directory's call and email
actions. Changing back to First call or Backup re-enables them when the relevant
contact detail is present. Favourite is an independent boolean, default `false`.

List/create/update responses contain the contact fields plus `id`, `created_at`,
and `updated_at`. Invalid fields or IDs return 400; missing update/delete targets
return 404. Invalid priorities and non-boolean favourites are rejected.
The UI provides search (including decrypted phone/notes), favourite filtering,
priority filtering, editing, and confirmed deletion. Contacts do not appear in
timesheets or payroll and do not send emails automatically.

### Health & Safety: Insurance Expiry and Public Access

All three authenticated roles can upload and edit insurance certificates.
The existing `/api/safety-health` URLs are unchanged.

- `POST {{baseUrl}}/api/safety-health/upload`: multipart form-data with `document_type=insurance` and a PDF `file`.
- `PUT {{baseUrl}}/api/safety-health/:id`: multipart form-data; the file is optional when editing expiry or alert settings.

| Field | Value | Default |
|---|---|---|
| `expiry_date` | Valid `YYYY-MM-DD`; empty string clears the date | `null` |
| `reminder_enabled` | `true` or `false` | `true` |
| `reminder_days` | Integer from 0 to 365 | `30` |

Authenticated list, upload, and edit responses include these three fields.
Public certificate listings also include `expiry_date`, but not email alert settings.
Invalid dates, booleans, or reminder intervals return HTTP 400.

Insurance with no expiry shows N/A; expired insurance shows Non-compliant;
insurance expiring within 30 days shows Due soon, otherwise Compliant.
Vehicle overall status is `none` (displayed as N/A) when insurance renewal is
unset, unless a configured MOT or tax deadline requires an overdue/due-soon warning.

The existing asset reminder job runs daily at 07:30 UTC and also checks active
insurance certificates. It emails active managing directors and construction
coordinators once per certificate expiry date when inside the chosen lead time
(including overdue dates). Disabled alerts and missing dates are skipped.
Changing the expiry date allows a new reminder for that renewal. The backend
must remain running and AWS SES must be configured for delivery.

Public directory: `/public/safety-health` on the frontend, without authentication.
Public API: `GET {{baseUrl}}/api/public/safety-health`.
Public PDF: `GET {{baseUrl}}/api/public/safety-health/:token`.
Directory and certificate QR dialogs offer a 1024px PNG download, Copy link,
and Share (native file/link sharing where supported, copy-link fallback otherwise).

### Create a new Environment called `CS HQ Local`

| Variable | Initial Value | Description |
|---|---|---|
| `baseUrl` | `http://localhost:6000` | API base URL |
| `accessToken` | *(empty)* | Set automatically by login test scripts |
| `refreshToken` | *(empty)* | Set automatically by login test scripts |
| `mdToken` | *(empty)* | MD's access token |
| `accountantToken` | *(empty)* | Accountant's access token |
| `coordinatorToken` | *(empty)* | Coordinator's access token |
| `productionId` | *(empty)* | Set by create production response |
| `setId` | *(empty)* | Set by create set response |
| `crewId1` | *(empty)* | Carpenter crew member |
| `crewId2` | *(empty)* | Scenic Painter crew member |
| `poId` | *(empty)* | Purchase Order ID |
| `timesheetId` | *(empty)* | Timesheet ID |
| `payRunId` | *(empty)* | Pay Run ID |
| `forecastId` | *(empty)* | Forecast ID |
| `catalogueItemId` | *(empty)* | Supplier catalogue item |
| `docId` | *(empty)* | Crew document ID |

### Auth Header Setup (for ALL protected requests)
In Postman: **Authorization tab → Bearer Token → `{{accessToken}}`**  
Or manually add Header: `Authorization: Bearer {{accessToken}}`

---

## STEP 2 — START THE SERVER

```bash
cd backend
node Server.js
# Should print: CS HQ API — Running on Port 6000
```

---

## ═══════════════════════════════════════════════
## PHASE 1: AUTHENTICATION
### Who: Everyone | Public routes (no token needed)
## ═══════════════════════════════════════════════

---

### 1.1 — Sign Up: Managing Director

**POST** `{{baseUrl}}/api/auth/signup`  
**Headers:** `Content-Type: application/json`  
**Body (raw JSON):**
```json
{
  "email": "warren@constructionalscenery.co.uk",
  "password": "SecurePass123!",
  "full_name": "Warren Mitchell",
  "role": "managing_director"
}
```

**Expected Response — 201:**
```json
{
  "message": "User created successfully",
  "user": {
    "id": "uuid-here",
    "email": "warren@constructionalscenery.co.uk",
    "full_name": "Warren Mitchell",
    "role": "managing_director"
  }
}
```

---

### 1.2 — Sign Up: Construction Accountant

**POST** `{{baseUrl}}/api/auth/signup`  
**Body:**
```json
{
  "email": "sarah@constructionalscenery.co.uk",
  "password": "SecurePass123!",
  "full_name": "Sarah Thompson",
  "role": "construction_accountant"
}
```

**Expected: 201 Created**

---

### 1.3 — Sign Up: Construction Coordinator

**POST** `{{baseUrl}}/api/auth/signup`  
**Body:**
```json
{
  "email": "james@constructionalscenery.co.uk",
  "password": "SecurePass123!",
  "full_name": "James O'Brien",
  "role": "construction_coordinator"
}
```

**Expected: 201 Created**

---

### 1.4 — Login as Managing Director ⭐ (captures token)

**POST** `{{baseUrl}}/api/auth/login`  
**Body:**
```json
{
  "email": "warren@constructionalscenery.co.uk",
  "password": "SecurePass123!"
}
```

**Expected Response — 200:**
```json
{
  "access_token": "eyJhbGci...",
  "refresh_token": "uuid-v4-string",
  "expires_in": 3600,
  "user": {
    "id": "uuid",
    "email": "warren@constructionalscenery.co.uk",
    "full_name": "Warren Mitchell",
    "role": "managing_director"
  }
}
```

**📌 Postman Tests tab script — paste this to auto-save all 3 tokens:**
```javascript
const r = pm.response.json();
if (r.access_token) {
    pm.environment.set("accessToken", r.access_token);
    pm.environment.set("refreshToken", r.refresh_token);
    pm.environment.set("mdToken", r.access_token);
}
```

---

### 1.5 — Login as Accountant (save token)

**POST** `{{baseUrl}}/api/auth/login`  
**Body:**
```json
{
  "email": "sarah@constructionalscenery.co.uk",
  "password": "SecurePass123!"
}
```

**Postman Tests tab:**
```javascript
const r = pm.response.json();
if (r.access_token) pm.environment.set("accountantToken", r.access_token);
```

---

### 1.6 — Login as Coordinator (save token)

**POST** `{{baseUrl}}/api/auth/login`  
**Body:**
```json
{
  "email": "james@constructionalscenery.co.uk",
  "password": "SecurePass123!"
}
```

**Postman Tests tab:**
```javascript
const r = pm.response.json();
if (r.access_token) pm.environment.set("coordinatorToken", r.access_token);
```

---

### 1.7 — Get My Profile

**GET** `{{baseUrl}}/api/auth/me`  
**Auth:** Bearer `{{accessToken}}` (currently MD)

**Expected — 200:**
```json
{
  "user": {
    "id": "uuid",
    "email": "warren@constructionalscenery.co.uk",
    "role": "managing_director",
    "full_name": "Warren Mitchell"
  }
}
```

---

### 1.8 — Refresh Token

**POST** `{{baseUrl}}/api/auth/refresh`  
**Body:**
```json
{
  "refresh_token": "{{refreshToken}}"
}
```

**Expected — 200:** Returns a new `access_token` and a new `refresh_token` (old one is invalidated)

**Postman Tests:**
```javascript
const r = pm.response.json();
if (r.access_token) {
    pm.environment.set("accessToken", r.access_token);
    pm.environment.set("refreshToken", r.refresh_token);
    pm.environment.set("mdToken", r.access_token);
}
```

---

### 1.9 — Forgot Password (Send OTP)

> ⚠️ Requires SMTP configured in `.env` (`SMTP_USER`, `SMTP_PASS`)

**POST** `{{baseUrl}}/api/auth/forgot-password`  
**Headers:** `Content-Type: application/json`  
**Body:**
```json
{
  "email": "warren@constructionalscenery.co.uk"
}
```

**Expected — 200:**
```json
{ "message": "If that email is registered, an OTP has been sent." }
```
> Returns the same message whether email exists or not (prevents user enumeration).  
> OTP is a 6-digit number, valid for **15 minutes**. Check the email inbox.

---

### 1.10 — Verify OTP

**POST** `{{baseUrl}}/api/auth/verify-otp`  
**Body:**
```json
{
  "email": "warren@constructionalscenery.co.uk",
  "otp": "123456"
}
```

**Expected — 200:**
```json
{ "message": "OTP verified" }
```

**Failure (wrong/expired OTP) — 400:**
```json
{ "error": "Invalid or expired OTP" }
```

---

### 1.11 — Reset Password

**POST** `{{baseUrl}}/api/auth/reset-password`  
**Body:**
```json
{
  "email": "warren@constructionalscenery.co.uk",
  "otp": "123456",
  "new_password": "NewSecurePass456!"
}
```

**Expected — 200:**
```json
{ "message": "Password reset successfully" }
```

> On success: password is updated, all existing refresh tokens for this user are invalidated. Login again with the new password.

---

## ═══════════════════════════════════════════════
## PHASE 2: PRODUCTIONS (Module 7)
### Who: MD + Coordinator can create/edit | Accountant read-only
## ═══════════════════════════════════════════════

> Set `{{accessToken}}` = `{{mdToken}}` before this phase

---

### 2.1 — Create Production

**POST** `{{baseUrl}}/api/productions`  
**Auth:** Bearer `{{accessToken}}`  
**Body:**
```json
{
  "name": "The Dark Knight — Season 2",
  "production_company": "Warner Bros UK",
  "production_designer": "Eve Stewart",
  "production_type": "TV Series",
  "start_date": "2026-06-01",
  "end_date": "2026-11-30",
  "contract_type": "cost_plus",
  "status": "pre_production"
}
```

**Expected — 201:**
```json
{
  "id": "prod-uuid",
  "name": "The Dark Knight — Season 2",
  "contract_type": "cost_plus",
  "status": "pre_production",
  ...
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("productionId", r.id);
```

---

### 2.2 — Create a Second Production (On-a-Price)

**POST** `{{baseUrl}}/api/productions`  
**Body:**
```json
{
  "name": "Bridgerton S4",
  "production_company": "Shondaland / Netflix",
  "production_designer": "Alice Normington",
  "production_type": "SVOD",
  "start_date": "2026-07-01",
  "end_date": "2026-12-15",
  "contract_type": "on_a_price",
  "status": "pre_production"
}
```

---

### 2.3 — Get All Productions

**GET** `{{baseUrl}}/api/productions`  
**Expected:** Array of productions

---

### 2.4 — Get Single Production

**GET** `{{baseUrl}}/api/productions/{{productionId}}`  
**Expected:** Full production object

---

### 2.5 — Update Production Status

**PUT** `{{baseUrl}}/api/productions/{{productionId}}`  
**Body:**
```json
{
  "status": "active_build"
}
```

---

### 2.6 — Add Sets to Production

**POST** `{{baseUrl}}/api/productions/{{productionId}}/sets`  
**Body:**
```json
{
  "set_number": "SET-001",
  "set_name": "Wayne Manor — Great Hall",
  "shoot_week": "W/E 2026-08-02",
  "handover_date": "2026-07-28",
  "completion_status": "not_started",
  "notes": "Full gothic interior with chandelier rig"
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("setId", r.id);
```

---

### 2.7 — Add Second Set

**POST** `{{baseUrl}}/api/productions/{{productionId}}/sets`  
**Body:**
```json
{
  "set_number": "SET-002",
  "set_name": "Gotham Police Station",
  "shoot_week": "W/E 2026-08-16",
  "handover_date": "2026-08-12",
  "completion_status": "not_started"
}
```

---

### 2.8 — Update Set Status

**PUT** `{{baseUrl}}/api/productions/{{productionId}}/sets/{{setId}}`  
**Body:**
```json
{
  "completion_status": "in_progress",
  "notes": "Timber frame complete, dressing underway"
}
```

---

### 2.9 — Get All Sets

**GET** `{{baseUrl}}/api/productions/{{productionId}}/sets`  
**Expected:** Array of sets

---

### 2.10 — Get Production Documents

**GET** `{{baseUrl}}/api/productions/{{productionId}}/documents`  
**Expected:** Empty array initially

---

### 2.11 — Upload Production Document

**POST** `{{baseUrl}}/api/productions/{{productionId}}/documents`  
**Auth:** Bearer `{{accessToken}}`  
**Body: form-data (not JSON!)**

| Key | Value | Type |
|---|---|---|
| `file` | *(choose a PDF from your machine)* | File |
| `document_type` | `shooting_schedule` | Text |

**Expected — 201:**
```json
{
  "id": "doc-uuid",
  "file_url": "http://localhost:5000/uploads/filename.pdf",
  "file_name": "filename.pdf",
  "document_type": "shooting_schedule"
}
```

---

## ═══════════════════════════════════════════════
## PHASE 3: CREW DATABASE (Module 2)
### Who: MD + Accountant + Coordinator can all create/edit
## ═══════════════════════════════════════════════

---

### 3.1 — Get Available Trades

**GET** `{{baseUrl}}/api/crew/trades`  
**Expected:**
```json
{
  "bectu": {
    "Carpenters": ["HOD", "Supervisor", "Chargehand", "Carpenter"],
    "Machinists": ["HOD", "Supervisor", "Chargehand", "Machinist"],
    "Stagehands": ["HOD", "Supervisor", "Chargehand", "Stagehand NVQ/BLSS", "Stagehand"],
    "Riggers": ["HOD", "Supervisor", "Chargehand", "Rigger"],
    "Scenic Painters": ["HOD", "Supervisor", "Chargehand", "Painter"],
    "...": "..."
  },
  "non_bectu": ["Construction Accountant", "Construction Coordinator", "Construction Manager", "Luton Driver"]
}
```

---

### 3.2 — Create Crew Member (Carpenter, PAYE)

**POST** `{{baseUrl}}/api/crew`  
**Body:**
```json
{
  "first_name": "Tom",
  "last_name": "Hargreaves",
  "date_of_birth": "1985-03-14",
  "home_address": "42 Beech Lane, Slough, SL1 3PP",
  "employment_status": "paye",
  "crew_trade": "Carpenters",
  "crew_rank": "Carpenter",
  "paye_withholding_rate": 20,
  "email": "tom.hargreaves@email.com",
  "account_name": "T Hargreaves",
  "account_number": "12345678",
  "sort_code": "20-14-56",
  "emergency_contact_name": "Linda Hargreaves",
  "emergency_contact_relationship": "Spouse",
  "emergency_contact_phone": "07700900123"
}
```

**Expected — 201:**
```json
{
  "id": "crew-uuid",
  "crew_number": "CSC-0001",
  "first_name": "Tom",
  "last_name": "Hargreaves",
  ...
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("crewId1", r.id);
```

---

### 3.3 — Create Crew Member (Scenic Painter, Self-Employed)

**POST** `{{baseUrl}}/api/crew`  
**Body:**
```json
{
  "first_name": "Maya",
  "last_name": "Chen",
  "date_of_birth": "1990-07-22",
  "home_address": "18 Osborne Road, Pinner, HA5 2DP",
  "employment_status": "self_employed",
  "crew_trade": "Scenic Painters",
  "crew_rank": "Painter",
  "paye_withholding_rate": 0,
  "company_name": "Chen Scenic Ltd",
  "company_registration_number": "13456789",
  "vat_registration_number": "GB123456789",
  "email": "maya@chenscenic.co.uk",
  "account_name": "Chen Scenic Ltd",
  "account_number": "87654321",
  "sort_code": "30-91-45",
  "emergency_contact_name": "David Chen",
  "emergency_contact_relationship": "Father",
  "emergency_contact_phone": "07700900456"
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("crewId2", r.id);
```

---

### 3.4 — Get All Crew

**GET** `{{baseUrl}}/api/crew`  
**Optional query params:** `?trade=Carpenters` or `?search=Tom`

---

### 3.5 — Get Single Crew Member

**GET** `{{baseUrl}}/api/crew/{{crewId1}}`

---

### 3.6 — Link Crew to Production (IMPORTANT — required before timesheets!)

**POST** `{{baseUrl}}/api/crew/{{crewId1}}/productions`  
**Body:**
```json
{
  "production_id": "{{productionId}}",
  "start_date": "2026-06-01",
  "end_date": "2026-11-30"
}
```

**Expected — 201:**
```json
{
  "id": "junction-uuid",
  "crew_member_id": "crew-uuid",
  "production_id": "prod-uuid",
  ...
}
```

---

### 3.7 — Link Painter to Same Production

**POST** `{{baseUrl}}/api/crew/{{crewId2}}/productions`  
**Body:**
```json
{
  "production_id": "{{productionId}}",
  "start_date": "2026-07-01",
  "end_date": "2026-11-30"
}
```

---

### 3.8 — Upload Crew Document (Government ID)

**POST** `{{baseUrl}}/api/crew/{{crewId1}}/documents`  
**Body: form-data**

| Key | Value | Type |
|---|---|---|
| `file` | *(any image or PDF)* | File |
| `document_type` | `government_id` | Text |

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("docId", r.id);
```

---

### 3.9 — Delete Crew Document

**DELETE** `{{baseUrl}}/api/crew/{{crewId1}}/documents/{{docId}}`  
**Expected — 200:** `{ "message": "Document deleted" }`

---

### 3.10 — Update Crew Member

**PUT** `{{baseUrl}}/api/crew/{{crewId1}}`  
**Body:**
```json
{
  "sort_code": "20-14-57",
  "account_number": "12345679"
}
```

---

## ═══════════════════════════════════════════════
## PHASE 4: PURCHASE ORDERS (Module 1)
### Coordinator creates → MD approves | Accountant read-only + can attach invoices
## ═══════════════════════════════════════════════

> Switch to Coordinator: Set `{{accessToken}}` = `{{coordinatorToken}}`

---

### 4.1 — Create Purchase Order (Draft)

**POST** `{{baseUrl}}/api/purchase-orders`  
**Auth:** Bearer `{{coordinatorToken}}`  
**Body:**
```json
{
  "supplier_name": "Jewson Building Supplies",
  "supplier_email": "orders@jewson.co.uk",
  "supplier_address": "Unit 4, Western Rd, Bracknell, RG12 1RT",
  "date_of_po": "2026-06-03",
  "production_id": "{{productionId}}",
  "set_code": "SET-001",
  "account_code": "TIMBER-001",
  "description": "Structural timber 4x2 — Wayne Manor Great Hall (100 lengths)",
  "net_amount": 2450.00,
  "vat": 490.00,
  "gross_amount": 2940.00,
  "paid_from": "supplier_account"
}
```

**Expected — 201:**
```json
{
  "id": "po-uuid",
  "po_number": "CS-2026-0001",
  "status": "draft",
  ...
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("poId", r.id);
```

---

### 4.2 — Update PO (while still draft)

**PUT** `{{baseUrl}}/api/purchase-orders/{{poId}}`  
**Body:**
```json
{
  "description": "Structural timber 4x2 — Wayne Manor Great Hall (120 lengths revised)",
  "net_amount": 2940.00,
  "vat": 588.00,
  "gross_amount": 3528.00
}
```

---

### 4.3 — Submit PO → Emails Supplier

**POST** `{{baseUrl}}/api/purchase-orders/{{poId}}/submit`  
**Body:** *(empty JSON `{}`)*

**Expected — 200:**
```json
{
  "message": "PO submitted",
  "po": { "status": "submitted", ... },
  "emailSent": true
}
```

> ⚡ If `supplier_email` was provided and SMTP is configured, supplier receives the PO by email.  
> Status changes from `draft` → `submitted`

---

### 4.4 — Get All POs

**GET** `{{baseUrl}}/api/purchase-orders`  
**Optional filters:** `?production_id={{productionId}}&status=submitted`

---

### 4.5 — Get Single PO

**GET** `{{baseUrl}}/api/purchase-orders/{{poId}}`

---

### 4.6 — Attach Supplier Invoice to PO

> Switch to Accountant: Set `{{accessToken}}` = `{{accountantToken}}`

**POST** `{{baseUrl}}/api/purchase-orders/{{poId}}/attach-invoice`  
**Body: form-data**

| Key | Value | Type |
|---|---|---|
| `file` | *(PDF invoice from supplier)* | File |

**Expected — 200:**
```json
{
  "message": "Invoice attached",
  "po": {
    "status": "invoice_received",
    "invoice_attachment_url": "http://localhost:5000/uploads/invoice_xxx.pdf",
    ...
  }
}
```

---

### 4.7 — Approve PO (MD only)

> Switch to MD: Set `{{accessToken}}` = `{{mdToken}}`

**POST** `{{baseUrl}}/api/purchase-orders/{{poId}}/approve`  
**Body:** *(empty `{}`)*

**Expected — 200:**
```json
{
  "message": "PO approved",
  "po": {
    "status": "approved",
    "approved_by": "warren-uuid",
    "approved_at": "2026-06-03T10:30:00Z",
    ...
  }
}
```

---

### 4.8 — Delete a Draft PO (Coordinator can delete)

> Switch to Coordinator: `{{accessToken}}` = `{{coordinatorToken}}`

First create a throwaway PO (POST /api/purchase-orders), then:  
**DELETE** `{{baseUrl}}/api/purchase-orders/<throwaway-po-id>`  
**Expected — 200:** `{ "message": "PO deleted" }`

---

## ═══════════════════════════════════════════════
## PHASE 5: TIMESHEETS (Module 3 — Part A)
### Accountant manages timesheets | Coordinator read-only
## ═══════════════════════════════════════════════

> Switch to Accountant: `{{accessToken}}` = `{{accountantToken}}`

---

### 5.1 — Create Timesheet for Carpenter (Week Ending Sunday)

**POST** `{{baseUrl}}/api/timesheets`  
**Body:**
```json
{
  "crew_member_id": "{{crewId1}}",
  "production_id": "{{productionId}}",
  "week_ending_date": "2026-07-05"
}
```

> ⚠️ Crew member must exist in the Crew Database and be active (`is_active = true`). The production must also exist. If crew doesn't exist or is inactive, you'll get a 400 error.  
> The `production_crew` link (step 3.6) is good practice but not enforced by the timesheet gateway — it's used for reporting and contract tracking.

**Expected — 201:**
```json
{
  "id": "ts-uuid",
  "crew_member_id": "...",
  "production_id": "...",
  "week_ending_date": "2026-07-05",
  "status": "draft",
  ...
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("timesheetId", r.id);
```

---

### 5.2 — Create Timesheet for Scenic Painter

**POST** `{{baseUrl}}/api/timesheets`  
**Body:**
```json
{
  "crew_member_id": "{{crewId2}}",
  "production_id": "{{productionId}}",
  "week_ending_date": "2026-07-05"
}
```

---

### 5.3 — Save Daily Entries for Carpenter's Timesheet

**PUT** `{{baseUrl}}/api/timesheets/{{timesheetId}}/entries`  
**Body:**
```json
{
  "entries": [
    {
      "date": "2026-06-29",
      "day_of_week": "Monday",
      "full_day_worked": true,
      "overtime_hours": 0,
      "set_number": "SET-001",
      "site": "Longcross Studios",
      "travel": 25.00,
      "meal_breakfast": false,
      "meal_lunch": true,
      "meal_supper": false
    },
    {
      "date": "2026-06-30",
      "day_of_week": "Tuesday",
      "full_day_worked": true,
      "overtime_hours": 2,
      "set_number": "SET-001",
      "site": "Longcross Studios",
      "travel": 25.00,
      "meal_breakfast": false,
      "meal_lunch": true,
      "meal_supper": false
    },
    {
      "date": "2026-07-01",
      "day_of_week": "Wednesday",
      "full_day_worked": true,
      "overtime_hours": 0,
      "set_number": "SET-001",
      "site": "Longcross Studios",
      "travel": 25.00,
      "meal_breakfast": false,
      "meal_lunch": true,
      "meal_supper": false
    },
    {
      "date": "2026-07-02",
      "day_of_week": "Thursday",
      "full_day_worked": true,
      "overtime_hours": 1,
      "set_number": "SET-001",
      "site": "Longcross Studios",
      "travel": 25.00,
      "meal_breakfast": false,
      "meal_lunch": true,
      "meal_supper": false
    },
    {
      "date": "2026-07-03",
      "day_of_week": "Friday",
      "full_day_worked": true,
      "overtime_hours": 0,
      "set_number": "SET-001",
      "site": "Longcross Studios",
      "travel": 25.00,
      "meal_breakfast": false,
      "meal_lunch": true,
      "meal_supper": false
    }
  ]
}
```

**Expected — 200:** Updated timesheet with calculated totals  
> Note: Until BECTU rates are filled in, weekly_rate/gross_total will be £0

---

### 5.4 — Get Timesheet (view entries)

**GET** `{{baseUrl}}/api/timesheets/{{timesheetId}}`

---

### 5.5 — Get All Timesheets

**GET** `{{baseUrl}}/api/timesheets`  
**Optional:** `?production_id={{productionId}}&week_ending_date=2026-07-05`

---

### 5.6 — Bulk Distribute Timesheets → Emails Crew

**POST** `{{baseUrl}}/api/timesheets/bulk-distribute`  
**Body:**
```json
{
  "production_id": "{{productionId}}",
  "week_ending_date": "2026-07-05"
}
```

**Expected — 200:**
```json
{
  "message": "Timesheets distributed",
  "emails_sent": 2,
  "emails_skipped": 0,
  "timesheets_sent": 2
}
```

> ⚡ Each crew member with an email gets their weekly timesheet emailed.  
> Status changes to `sent`. `emails_skipped` = crew with no email address.

---

### 5.7 — Attach Invoice from Crew Member (Self-Employed)

> When a self-employed crew member sends back their invoice, attach it:

**POST** `{{baseUrl}}/api/timesheets/{{timesheetId}}/attach-invoice`  
**Body: form-data**

| Key | Value | Type |
|---|---|---|
| `file` | *(PDF invoice from crew)* | File |

**Expected — 200:**
```json
{
  "message": "Invoice attached",
  "timesheet": {
    "status": "invoice_received",
    "invoice_attachment_url": "http://localhost:5000/uploads/invoice_maya_xxx.pdf"
  }
}
```

---

### 5.8 — Chase Invoices (send reminder to crew who haven't submitted)

**POST** `{{baseUrl}}/api/timesheets/chase-invoices`  
**Body:**
```json
{
  "production_id": "{{productionId}}",
  "week_ending_date": "2026-07-05"
}
```

**Expected — 200:**
```json
{
  "message": "Chase emails sent",
  "emails_sent": 1,
  "emails_skipped": 0
}
```

> Only emails crew with status `sent` or `reviewed` (not yet `invoice_received`)

---

### 5.9 — Get Verification Pack

**GET** `{{baseUrl}}/api/timesheets/verification-pack/2026-07-05/{{productionId}}`

**Expected — 200:** Summary of all timesheets for that week/production with totals

---

### 5.10 — Verify Timesheet (Accountant signs off)

**POST** `{{baseUrl}}/api/timesheets/{{timesheetId}}/verify`  
**Body:** *(empty `{}`)*

**Expected — 200:**
```json
{
  "message": "Timesheet verified",
  "timesheet": { "status": "verified", ... }
}
```

> Do this for ALL timesheets in the week before creating a Pay Run.

---

## ═══════════════════════════════════════════════
## PHASE 6: PAY RUNS (Module 3 — Part B)
### Accountant only
## ═══════════════════════════════════════════════

---

### 6.1 — Create Pay Run

**POST** `{{baseUrl}}/api/pay-runs`  
**Body:**
```json
{
  "production_id": "{{productionId}}",
  "week_ending_date": "2026-07-05"
}
```

**Expected — 201:**
```json
{
  "message": "Pay run created successfully",
  "pay_run": {
    "id": "pr-uuid",
    "production_id": "...",
    "week_ending_date": "2026-07-05",
    "status": "draft",
    "pay_run_items": [
      {
        "crew_member_id": "...",
        "employment_type": "paye",
        "gross_amount": "0.00",
        "withholding_amount": "0.00",
        "net_amount": "0.00",
        "sort_code": "20-14-56",
        "account_number": "12345678",
        "account_name": "T Hargreaves",
        "reference": "CSC-0001-2026-07-05"
      }
    ]
  },
  "summary": {
    "total_crew": 2,
    "total_gross": 0,
    "total_withheld": 0,
    "total_net": 0
  }
}
```

> ℹ️ Bank details are **encrypted at rest** in the database but always returned as **plaintext** in this response. The CSV export (step 6.4) also returns plaintext values.

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.pay_run && r.pay_run.id) pm.environment.set("payRunId", r.pay_run.id);
```

---

### 6.2 — Process Pay Run (locks and calculates)

**POST** `{{baseUrl}}/api/pay-runs/{{payRunId}}/process`  
**Body:** *(empty `{}`)*

**Expected — 200:**
```json
{
  "message": "Pay run processed",
  "payRun": { "status": "processed", "processed_at": "...", ... },
  "items": [
    {
      "crew_member_id": "...",
      "employment_type": "paye",
      "gross_amount": 0.00,
      "withholding_amount": 0.00,
      "net_amount": 0.00,
      "sort_code": "20-14-57",
      "account_number": "12345679",
      "account_name": "T Hargreaves",
      "reference": "CSC-0001-W05JUL"
    },
    ...
  ]
}
```

> Note: Amounts will be £0 until BECTU rates are populated. Structure is correct.

---

### 6.3 — Get Pay Run Details

**GET** `{{baseUrl}}/api/pay-runs/{{payRunId}}`

---

### 6.4 — Export Pay Run as CSV

**GET** `{{baseUrl}}/api/pay-runs/{{payRunId}}/export-csv`

**Expected:** CSV download with columns:  
`Sort Code, Account Number, Account Name, Amount, Reference`

> In Postman: you'll see raw CSV text. Save it and import into your bank.

---

### 6.5 — Get All Pay Runs

**GET** `{{baseUrl}}/api/pay-runs`

---

## ═══════════════════════════════════════════════
## PHASE 7: COST REPORTS (Module 4)
### Accountant manages | MD has full access | Coordinator blocked
## ═══════════════════════════════════════════════

> Stay as Accountant: `{{accessToken}}` = `{{accountantToken}}`

---

### 7.1 — Add Invoice to Cost Report (On-a-Price production — Type 1)

**POST** `{{baseUrl}}/api/cost-reports/{{productionId}}/invoices`  
**Body:**
```json
{
  "invoice_description": "Wayne Manor Great Hall — Construction Invoice 1",
  "po_number": "CS-2026-0001",
  "date": "2026-07-10",
  "invoice_number": "INV-2026-001",
  "amount": 45000.00,
  "notes": "First instalment — timber frame and rough carpentry complete"
}
```

---

### 7.2 — Add Second Invoice

**POST** `{{baseUrl}}/api/cost-reports/{{productionId}}/invoices`  
**Body:**
```json
{
  "invoice_description": "Gotham Police Station — Construction Invoice 1",
  "po_number": "CS-2026-0002",
  "date": "2026-07-24",
  "invoice_number": "INV-2026-002",
  "amount": 28500.00,
  "notes": "Dressed set delivered on time"
}
```

---

### 7.3 — View Cost Report (Type 1)

**GET** `{{baseUrl}}/api/cost-reports/{{productionId}}`

**Expected:**
```json
{
  "production": { "name": "...", "contract_type": "cost_plus", ... },
  "invoices": [ ... ],
  "totals": {
    "total_invoiced": 73500.00,
    "po_committed": 3528.00,
    "outstanding_pos": 0.00
  }
}
```

---

### 7.4 — Set Cost Plus Budget (for cost_plus productions — Type 2)

**POST** `{{baseUrl}}/api/cost-reports/{{productionId}}/budget`  
**Body:**
```json
{
  "total_budget": 850000.00,
  "margin_rate": 0.12,
  "contracted_weeks": 24,
  "budget_lines": [
    {
      "account_code": "LABOUR-01",
      "description": "Carpenters (HOD + 4 crew)",
      "weekly_cost": 8500.00,
      "weeks": 24,
      "total": 204000.00
    },
    {
      "account_code": "LABOUR-02",
      "description": "Scenic Painters (HOD + 2 crew)",
      "weekly_cost": 5200.00,
      "weeks": 20,
      "total": 104000.00
    },
    {
      "account_code": "MATERIALS-01",
      "description": "Timber & structural",
      "weekly_cost": 3000.00,
      "weeks": 24,
      "total": 72000.00
    }
  ]
}
```

**Expected — 200:**
```json
{
  "id": "budget-uuid",
  "production_id": "{{productionId}}",
  "margin_rate": "0.1200",
  "contracted_weeks": 24,
  "budget_lines": [
    {
      "id": "line-uuid",
      "budget_id": "budget-uuid",
      "account_code": "LABOUR-01",
      "description": "Carpenters (HOD + 4 crew)",
      "weekly_cost": "8500.00",
      "weeks": 24,
      "total": "204000.00",
      "sort_order": 0,
      "created_at": "2026-05-28T..."
    },
    ...
  ]
}
```

> ℹ️ **Budget lines are now stored in a normalised table** (`cost_plus_budget_lines`). Each line now has its own `id`, `budget_id`, and `sort_order`. The request body format is **unchanged** — send the same `budget_lines` array as before. The full list is **replaced** on every save (delete + re-insert).

---

### 7.5 — Get Cost Plus Report (Type 2)

**GET** `{{baseUrl}}/api/cost-reports/{{productionId}}/cost-plus`

**Expected:**
```json
{
  "production": { ... },
  "budget": {
    "id": "budget-uuid",
    "margin_rate": "0.1200",
    "contracted_weeks": 24,
    "budget_lines": [
      { "id": "line-uuid", "account_code": "LABOUR-01", "description": "...", "weekly_cost": "8500.00", "weeks": 24, "total": "204000.00", "sort_order": 0 }
    ]
  },
  "margin_rate": 0.12,
  "margin_percentage": "12%",
  "totals": {
    "total_labour_net": 0,
    "total_materials_net": 2940.00,
    "total_net": 2940.00,
    "total_margin": 352.80,
    "total_to_production": 3292.80
  },
  "materials_to_send": [ ... ],
  "labour_to_send": [ ... ]
}
```

---

## ═══════════════════════════════════════════════
## PHASE 8: FORECASTING (Module 5)
### Accountant + Coordinator both have access | Only MD can update ratios
## ═══════════════════════════════════════════════

---

### 8.1 — Get BECTU Rates

**GET** `{{baseUrl}}/api/forecasting/bectu-rates`

**Expected:** All trade/rank combinations (currently all £0 until rate card filled in)

---

### 8.2 — Get Percentometer Ratios

**GET** `{{baseUrl}}/api/forecasting/percentometer/ratios`

**Expected:**
```json
[
  { "cost_type": "Carpenters", "percentage": "0.4200" },
  { "cost_type": "Painters",   "percentage": "0.1800" },
  ...
]
```

---

### 8.3 — Percentometer Quick Estimate

> You know the Carpenter cost and want to estimate the TOTAL production cost

**POST** `{{baseUrl}}/api/forecasting/percentometer/calculate`  
**Body:**
```json
{
  "carpenter_cost": 204000.00
}
```

**Expected:**
```json
{
  "input_carpenter_cost": 204000,
  "estimated_total": 485714.29,
  "breakdown": {
    "Carpenters":  { "percentage": 42, "amount": 204000.00 },
    "Painters":    { "percentage": 18, "amount": 87428.57 },
    "Stagehands":  { "percentage": 9,  "amount": 43714.29 },
    "Riggers":     { "percentage": 6,  "amount": 29142.86 },
    "Timber":      { "percentage": 9,  "amount": 43714.29 },
    "Plasterwork": { "percentage": 6,  "amount": 29142.86 },
    "Misc":        { "percentage": 3,  "amount": 14571.43 },
    "Sculptors":   { "percentage": 2,  "amount": 9714.29  },
    "Metalwork":   { "percentage": 2,  "amount": 9714.29  },
    "Paint":       { "percentage": 2,  "amount": 9714.29  },
    "Glass":       { "percentage": 1,  "amount": 4857.14  }
  }
}
```

---

### 8.4 — Update Percentometer Ratios (MD only!)

> Switch to MD: `{{accessToken}}` = `{{mdToken}}`

**PUT** `{{baseUrl}}/api/forecasting/percentometer/ratios`  
**Body:**
```json
{
  "ratios": [
    { "cost_type": "Carpenters",  "percentage": 0.44 },
    { "cost_type": "Painters",    "percentage": 0.17 },
    { "cost_type": "Stagehands",  "percentage": 0.09 },
    { "cost_type": "Riggers",     "percentage": 0.06 },
    { "cost_type": "Timber",      "percentage": 0.09 },
    { "cost_type": "Plasterwork", "percentage": 0.05 },
    { "cost_type": "Misc",        "percentage": 0.03 },
    { "cost_type": "Sculptors",   "percentage": 0.02 },
    { "cost_type": "Metalwork",   "percentage": 0.02 },
    { "cost_type": "Paint",       "percentage": 0.02 },
    { "cost_type": "Glass",       "percentage": 0.01 }
  ]
}
```

---

### 8.5 — Get Supplier Catalogue

**GET** `{{baseUrl}}/api/forecasting/catalogue`

---

### 8.6 — Add Catalogue Item (Coordinator or MD)

> Switch to Coordinator: `{{accessToken}}` = `{{coordinatorToken}}`

**POST** `{{baseUrl}}/api/forecasting/catalogue`  
**Body:**
```json
{
  "supplier_name": "Jewson Building Supplies",
  "product_description": "Structural Timber 4x2 C24 (3m length)",
  "unit_of_measure": "length",
  "unit_price": 4.85,
  "notes": "Standard construction grade, available next day"
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("catalogueItemId", r.id);
```

---

### 8.7 — Update Catalogue Item

**PUT** `{{baseUrl}}/api/forecasting/catalogue/{{catalogueItemId}}`  
**Body:**
```json
{
  "unit_price": 5.10,
  "notes": "Price updated June 2026"
}
```

---

### 8.8 — Create Forecast Scenario

> Switch to Accountant: `{{accessToken}}` = `{{accountantToken}}`

**POST** `{{baseUrl}}/api/forecasting/forecasts`  
**Body:**
```json
{
  "name": "Dark Knight S2 — Initial Forecast",
  "production_id": "{{productionId}}",
  "labour_items": [
    {
      "crew_type": "Carpenter HOD",
      "number_of_crew": 1,
      "number_of_weeks": 24,
      "overtime_hours": 5,
      "weekly_rate": 0,
      "overtime_rate": 0
    },
    {
      "crew_type": "Carpenter",
      "number_of_crew": 4,
      "number_of_weeks": 22,
      "overtime_hours": 3,
      "weekly_rate": 0,
      "overtime_rate": 0
    },
    {
      "crew_type": "Scenic Painter HOD",
      "number_of_crew": 1,
      "number_of_weeks": 20,
      "overtime_hours": 2,
      "weekly_rate": 0,
      "overtime_rate": 0
    }
  ],
  "materials_items": [
    {
      "supplier_name": "Jewson",
      "product_description": "Structural Timber 4x2",
      "quantity": 500,
      "unit_price": 5.10
    },
    {
      "supplier_name": "Flints Theatrical",
      "product_description": "Scene paint — assorted",
      "quantity": 100,
      "unit_price": 12.00
    }
  ]
}
```

**📌 Postman Tests:**
```javascript
const r = pm.response.json();
if (r.id) pm.environment.set("forecastId", r.id);
```

---

### 8.9 — Get All Forecasts

**GET** `{{baseUrl}}/api/forecasting/forecasts`

---

### 8.10 — Get Single Forecast

**GET** `{{baseUrl}}/api/forecasting/forecasts/{{forecastId}}`

---

### 8.11 — Update Forecast

**PUT** `{{baseUrl}}/api/forecasting/forecasts/{{forecastId}}`  
**Body:**
```json
{
  "name": "Dark Knight S2 — Revised Forecast (June 2026)"
}
```

---

## ═══════════════════════════════════════════════
## PHASE 9: WARREN'S DASHBOARD (Module 6)
### MD only
## ═══════════════════════════════════════════════

> Switch to MD: `{{accessToken}}` = `{{mdToken}}`

---

### 9.1 — Full Dashboard

**GET** `{{baseUrl}}/api/dashboard`

**Expected:**
```json
{
  "summary": {
    "total_productions": 2,
    "active_productions": 1,
    "total_po_value": 3528.00,
    "total_crew": 2
  },
  "productions": [ ... ],
  "recent_pos": [ ... ],
  "timesheets_pending": 0,
  ...
}
```

---

### 9.2 — PO Spend Dashboard

**GET** `{{baseUrl}}/api/dashboard/po-spend`

**Expected:** PO spend grouped by production, status, and account code

---

### 9.3 — Productions Overview

**GET** `{{baseUrl}}/api/dashboard/productions`

**Expected:** All productions with their set count, crew count, PO total, invoice total

---

## ═══════════════════════════════════════════════
## PHASE 10: ROLE-BASED ACCESS CONTROL TESTS (403 checks)
### These should ALL return 403 — proving RBAC works
## ═══════════════════════════════════════════════

---

### 10.1 — Coordinator tries to access Dashboard → 403

**GET** `{{baseUrl}}/api/dashboard`  
**Auth:** Bearer `{{coordinatorToken}}`

**Expected — 403:**
```json
{ "error": "Access denied for role construction_coordinator on GET /api/dashboard" }
```

---

### 10.2 — Coordinator tries to create a Pay Run → 403

**POST** `{{baseUrl}}/api/pay-runs`  
**Auth:** Bearer `{{coordinatorToken}}`  
**Body:** `{}`

**Expected — 403**

---

### 10.3 — Coordinator tries to view Cost Reports → 403

**GET** `{{baseUrl}}/api/cost-reports/{{productionId}}`  
**Auth:** Bearer `{{coordinatorToken}}`

**Expected — 403**

---

### 10.4 — Coordinator tries to approve a PO → 403

**POST** `{{baseUrl}}/api/purchase-orders/{{poId}}/approve`  
**Auth:** Bearer `{{coordinatorToken}}`

**Expected — 403**

---

### 10.5 — Accountant tries to create a Production → 403

**POST** `{{baseUrl}}/api/productions`  
**Auth:** Bearer `{{accountantToken}}`  
**Body:** `{}`

**Expected — 403**

---

### 10.6 — Accountant tries to update Percentometer Ratios → 403

**PUT** `{{baseUrl}}/api/forecasting/percentometer/ratios`  
**Auth:** Bearer `{{accountantToken}}`  
**Body:** `{ "ratios": [] }`

**Expected — 403**

---

### 10.7 — Accountant tries to create PO → 403

**POST** `{{baseUrl}}/api/purchase-orders`  
**Auth:** Bearer `{{accountantToken}}`  
**Body:** `{}`

**Expected — 403**

---

### 10.8 — Unauthenticated request → 401

**GET** `{{baseUrl}}/api/productions`  
**Auth:** *(remove the Authorization header entirely)*

**Expected — 401:**
```json
{ "error": "Missing or invalid authorization header" }
```

---

### 10.9 — Expired/Invalid Token → 401

**GET** `{{baseUrl}}/api/productions`  
**Auth:** `Bearer this.is.not.a.valid.token`

**Expected — 401:**
```json
{ "error": "Invalid or expired token" }
```

---

## ═══════════════════════════════════════════════
## PHASE 11: LOGOUT
## ═══════════════════════════════════════════════

### 11.1 — Logout (invalidates refresh token)

**POST** `{{baseUrl}}/api/auth/logout`  
**Auth:** Bearer `{{accessToken}}`  
**Body:**
```json
{
  "refresh_token": "{{refreshToken}}"
}
```

**Expected — 200:**
```json
{ "message": "Logged out successfully" }
```

---

### 11.2 — Verify Refresh Token is Invalid After Logout

**POST** `{{baseUrl}}/api/auth/refresh`  
**Body:**
```json
{ "refresh_token": "{{refreshToken}}" }
```

**Expected — 401:** `{ "error": "Invalid or expired refresh token" }`

---

## ═══════════════════════════════════════════════
## FULL ROLE PERMISSIONS SUMMARY
## ═══════════════════════════════════════════════

| Module | Managing Director | Construction Accountant | Construction Coordinator |
|--------|:-----------------:|:-----------------------:|:------------------------:|
| Auth (login/logout/me) | ✅ | ✅ | ✅ |
| **M7 Productions** — Create/Edit | ✅ | ❌ | ✅ |
| **M7 Productions** — Read | ✅ | ✅ (read-only) | ✅ |
| **M7 Sets** — Create/Edit/Delete | ✅ | ❌ | ✅ |
| **M7 Documents** — Upload | ✅ | ❌ | ✅ |
| **M1 POs** — Create/Edit/Delete/Submit | ✅ | ❌ | ✅ |
| **M1 POs** — Approve | ✅ | ❌ | ❌ |
| **M1 POs** — Read + Attach Invoice | ✅ | ✅ | ✅ |
| **M2 Crew** — Create/Edit/Link | ✅ | ✅ | ✅ |
| **M2 Crew** — Documents | ✅ | ✅ | ✅ |
| **M3 Timesheets** — Full manage | ✅ | ✅ | ❌ (read-only) |
| **M3 Pay Runs** — Full manage | ✅ | ✅ | ❌ |
| **M4 Cost Reports** — Full manage | ✅ | ✅ | ❌ |
| **M5 Forecasts** — Create/Edit/Delete | ✅ | ✅ | ❌ |
| **M5 Supplier Catalogue** — Full manage | ✅ | ❌ | ✅ |
| **M5 Percentometer** — Read/Calculate | ✅ | ✅ | ✅ |
| **M5 Percentometer Ratios** — Update | ✅ | ❌ | ❌ |
| **M5 BECTU Rates** — Read | ✅ | ✅ | ✅ |
| **M6 Dashboard** — Full access | ✅ | ❌ | ❌ |

---

## COMMON ERRORS REFERENCE

| Error | Status | Cause |
|-------|--------|-------|
| `Missing or invalid authorization header` | 401 | No Bearer token in request |
| `Invalid or expired token` | 401 | JWT expired (90min) or malformed |
| `Access denied for role X on METHOD /path` | 403 | RBAC policy blocks this role |
| `Crew member not found or not active...` | 400 | Crew must be in Crew DB with is_active = true |
| `A timesheet already exists for this crew member, production, and week` | 409 | Duplicate — one timesheet per crew/prod/week |
| `A pay run already exists for this production and week` | 409 | Can't create two pay runs for same week |
| `File too large. Maximum size is 20 MB.` | 400 | File upload exceeds 20MB limit |
| `File type not allowed` | 400 | Only pdf/jpg/png/doc/docx/xls/xlsx/csv/zip/txt |
| `Route not found` | 404 | Wrong URL path |

---

## POSTMAN COLLECTION STRUCTURE (recommended)

```
📁 CS HQ API
  📁 Auth
    POST Signup — MD
    POST Signup — Accountant
    POST Signup — Coordinator
    POST Login (MD)
    POST Login (Accountant)
    POST Login (Coordinator)
    GET  Me
    POST Refresh Token
    POST Logout
  📁 Productions (M7)
    POST Create Production
    GET  All Productions
    GET  Single Production
    PUT  Update Production
    POST Archive Production
    POST Add Set
    PUT  Update Set
    DELETE Delete Set
    GET  Sets List
    GET  Documents
    POST Upload Document
  📁 Purchase Orders (M1)
    POST Create PO
    PUT  Update PO
    GET  All POs
    GET  Single PO
    POST Submit PO
    POST Attach Invoice
    POST Approve PO
    DELETE Delete PO
  📁 Crew Database (M2)
    GET  Trades
    POST Create Carpenter
    POST Create Scenic Painter
    GET  All Crew
    GET  Single Crew Member
    PUT  Update Crew Member
    POST Link to Production
    POST Upload Document
    DELETE Delete Document
  📁 Timesheets (M3a)
    POST Create Timesheet (Carpenter)
    POST Create Timesheet (Painter)
    PUT  Save Entries
    GET  All Timesheets
    GET  Single Timesheet
    POST Bulk Distribute
    POST Attach Invoice
    POST Chase Invoices
    GET  Verification Pack
    POST Verify Timesheet
  📁 Pay Runs (M3b)
    POST Create Pay Run
    GET  All Pay Runs
    GET  Single Pay Run
    POST Process Pay Run
    GET  Export CSV
  📁 Cost Reports (M4)
    POST Add Invoice
    GET  Cost Report (Type 1)
    POST Set Cost Plus Budget
    GET  Cost Plus Report (Type 2)
  📁 Forecasting (M5)
    GET  BECTU Rates
    GET  Percentometer Ratios
    POST Percentometer Calculate
    PUT  Update Ratios (MD only)
    GET  Catalogue
    POST Add Catalogue Item
    PUT  Update Catalogue Item
    DELETE Delete Catalogue Item
    POST Create Forecast
    GET  All Forecasts
    GET  Single Forecast
    PUT  Update Forecast
    DELETE Delete Forecast
  📁 Dashboard (M6)
    GET  Full Dashboard
    GET  PO Spend
    GET  Productions Overview
  📁 RBAC Tests (403 checks)
    GET  Dashboard as Coordinator → 403
    POST Pay Run as Coordinator → 403
    GET  Cost Report as Coordinator → 403
    POST Approve PO as Coordinator → 403
    POST Create Production as Accountant → 403
    PUT  Percentometer Ratios as Accountant → 403
    POST Create PO as Accountant → 403
    GET  Productions (no token) → 401
    GET  Productions (bad token) → 401
```

---

*Updated for CS HQ v1.1.0 — May 2026 (TypeORM migrations, encryption, 3NF budget lines)*
