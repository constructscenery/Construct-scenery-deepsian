# theOffice — Addendum 6: Sales & Quotes — Implementation Plan & User Stories

Prepared by Sabeerah · Revised 10 November 2026 · Source: TheOffice Addendum 6 — Sales & Quotes Module (Nov 2026)

## Summary

Addendum 6 comes down to **21 user stories**: 8 for Sales, 10 for Quotes and 3 shared. Sales is a read-only Xero pull, an invoice list, an allocation panel and one summary table. Quotes is a form, a PDF and a status flow. Neither touches Xero in the write direction.

| Part | What it is | Stories |
| --- | --- | --- |
| Sales | Connect Xero once, pull sales invoices, list and filter them, allocate each to a production, show what each production owes | S-01 to S-08 |
| Quotes | Build a quote from labour, materials, plant hire and misc lines, send a branded PDF, move it through Draft → Invoice Raised | Q-01 to Q-10 |
| Shared | Departments for internal quotes, the production Finance tab, role permissions | X-01 to X-03 |

**What changed from the first version (89 stories):** I had split the Xero plumbing (token refresh, organisation picker, sync log, nightly job, rate limits) into separate stories; it is now acceptance criteria and dev notes inside S-01 and S-02. Each filter had its own story; they are now one. I also removed things the addendum never asked for: duplicate quote, draft preview, expired badge, non-GBP handling, a department rates table, an hourly rate column, a mobile-only story, and schema / test enabler stories. The 66-row audit is now a coverage table at the top of the stories, and 25 questions are down to the 7 that change what gets built.

## How we build it

Everything follows existing CS-HQ patterns: TypeORM migrations + enums, JS controllers and routes, `policies.json`, Next.js pages. The only new external piece is the Xero OAuth client.

### Tables

| Table | Holds |
| --- | --- |
| `xero_connection` | One row: tenant id and name, encrypted tokens, token expiry, last synced at, last error |
| `xero_invoices` | Cached ACCREC invoices: Xero id, number, contact, invoice / due date, total, amount paid, amount due, Xero status, reference, `production_id` (null = unallocated), `quote_id` (optional link) |
| `quotes` | Header fields, recipient, discount, VAT treatment, status, PO reference, share-link token hash |
| `quote_lines` | One row per line: type, description, qty, unit, rate, total, note, sort order |
| `quote_versions` | Each sent PDF: version no., S3 key, sent to, sent at |
| `departments` | Needed for internal quotes (see question 2) |

Sales status (Outstanding / Overdue / Paid) is worked out from amount due and due date, not stored.

### Xero

- Admin connects once in Settings. Request `accounting.invoices.read` + `offline_access`: Xero apps created after 2 March 2026 can't use the broad `accounting.transactions` scope the addendum names ([Apideck](https://apideck.com/blog/xero-scopes)).
- Sync = `GET /Invoices` filtered to ACCREC, upsert into `xero_invoices`. Runs when Sales opens and on Sync Now. Polling only, no webhooks.
- Tokens encrypted with the existing `config/crypto.js`; save the new refresh token every time Xero rotates it.

### Quotes

- Reference `CSL-Q-XXXX` from a Postgres sequence (the PO number's MAX+1 approach can duplicate).
- Totals recalculated on the server on every save.
- PDF built with PDFKit, copying `poPdfService.js`; stored in S3 via `fileStorage.js`; emailed via `config/email.js` like PO PDFs.
- Copy Link reuses the crew-portal token pattern and a `/public/quotes/[token]` page.

### Screens

New: `/sales` (Invoices and What's Owed tabs), `/quotes`, `/quotes/[id]`, `/public/quotes/[token]`, a Xero card in Settings. Changed: the production page gets a Finance tab, and the sidebar gets Sales and Quotes.

## Delivery order

1. Get answers to the 7 questions below (questions 1 and 2 block Quotes and permissions; Sales can start without them).
2. Sales: S-01 → S-08.
3. Quotes: X-01, then Q-01 → Q-10. Can run alongside Sales.
4. X-02 Finance tab, once allocation (S-06) and the quote workflow (Q-09) exist.
5. X-03 permissions, then UAT.

## Questions for the client

Each of these changes what gets built. Everything else in the addendum is clear enough to build as written.

| # | Question | Affects |
| --- | --- | --- |
| 1 | The addendum has 5 roles (Administrator, Coordinator, Production Manager, Finance, Department Head). The app has Managing Director, Accountant, Coordinator, Guest. Map them, or add Production Manager and Department Head? | X-03 |
| 2 | Internal quotes go to a department within a production (Props, Costume, Scenic). The app has no departments. One fixed list, or set per production? Who is the email contact? | X-01, Q-01, Q-07 |
| 3 | Invoice Raised: does the coordinator set it (§9.1), or does it happen when the invoice shows up from Xero (§9)? | Q-09 |
| 4 | A sent quote is "locked for editing", yet each resend keeps a new PDF version. Can a sent quote be changed and resent? | Q-07, Q-09 |
| 5 | Should Sales amounts be inc or ex VAT? The addendum mixes both. | S-03, S-08 |
| 6 | Should draft and voided Xero invoices appear in Sales? | S-02, S-03 |
| 7 | What is the Administrator's "quote approval override"? | Q-09 |

## User stories

Every section of the addendum maps to at least one story:

| Addendum section | Stories |
| --- | --- |
| §2 Xero connection | S-01, S-02 |
| §3 Invoice view | S-03, S-04, S-05 |
| §4 Production allocation | S-06, S-07 |
| §5 What's Owed | S-08 |
| §6–7 Quote types, line items, totals | X-01, Q-01 to Q-05 |
| §8 PDF and sending | Q-06, Q-07, Q-08 |
| §9 Status workflow | Q-09 |
| §10 Quotes list, Finance tab | Q-10, X-02 |
| §11 Permissions | X-03 |
| §12 Technical requirements | Dev notes in S-01, S-02, Q-06, Q-07 |

### Sales

**S-01 · Connect Xero**

As an Administrator, I want to connect our Xero organisation in Settings, so that Sales can read invoices without other users needing Xero.

- Connect is shown to Administrators only and opens Xero's consent screen.
- After consent, Settings shows the organisation name and when it was connected.
- Administrator can disconnect; already-synced invoices stay visible.
- Dev notes: scopes `accounting.invoices.read` + `offline_access`; tokens encrypted at rest and never sent to the browser; save the new refresh token on every refresh.

**S-02 · Sync invoices from Xero**

As a Coordinator, I want invoices pulled from Xero when I open Sales or click Sync Now, so that I see current figures.

- Only sales invoices (ACCREC) are pulled; never purchase invoices.
- Stored per invoice: number, contact, invoice date, due date, total, amount due, status, reference. No line items.
- "Last synced" time shows at the top of Sales.
- If Xero fails, the last synced data stays and a message says the sync failed.

**S-03 · Invoice list**

As a Coordinator, I want all invoices in one table, so that I can see what's been billed.

- Columns: Invoice No., Production (or "Unallocated"), Invoice Date, Due Date, Amount, Status.
- Status: Paid = nothing due; Overdue = amount due and past due date; Outstanding = amount due, not yet due.
- Status badges: Overdue red, Outstanding amber, Paid green.

**S-04 · Filter and search invoices**

As a Coordinator, I want to filter and search the list, so that I can find invoices quickly.

- Filter by status, production (including Unallocated) and date range; filters combine.
- Search by invoice number (partial match).

**S-05 · Open in Xero and export CSV**

As a Coordinator, I want to open an invoice in Xero and export the list, so that I can see full detail and report on it.

- Open in Xero opens that invoice in a new tab.
- Export CSV downloads the current filtered view.

**S-06 · Allocate an invoice to a production**

As a Coordinator, I want to link each invoice to a production, so that it appears against that production's finances.

- Clicking a row opens an allocation panel on the right.
- Pick the production from a dropdown with search by name.
- If the Xero reference matches a production code, that production is pre-selected; the Coordinator still confirms.
- Once confirmed, the invoice shows in that production's Finance tab and in What's Owed. The allocation can be changed later.
- A production can have many invoices.

**S-07 · Reminder for unallocated invoices**

As a Coordinator, I want a reminder at login when invoices have been unallocated for over 7 days, so that none are missed.

- Shows the count with a link to the Unallocated filter.
- Not shown when there are none.

**S-08 · What's Owed summary**

As a Coordinator, I want a per-production summary, so that I see who owes what without opening Xero.

- One row per production: Total Invoiced, Received, Outstanding, Overdue, plus a TOTAL row.
- Updates after every sync.

### Quotes

**Q-01 · Quote header**

As a Coordinator, I want to fill in a quote header, so that the quote is addressed and dated correctly.

- Fields: Title, Quote Date (today, editable), Valid Until (+30 days, editable), Recipient Type, Notes / Introduction (optional).
- Reference `CSL-Q-XXXX` is generated automatically, never repeated, and can't be edited.
- Internal: Production (active productions) and Department, both required.
- External: Recipient Name, Company and Email required; Production link optional.

**Q-02 · Labour lines**

As a Coordinator, I want to add labour by grade or by department, so that labour is priced consistently.

- By grade: pick a grade from the rate card; rate fills in; enter days or hours; total = qty × rate.
- By department: department, quantity, block rate, total.

**Q-03 · Materials, plant hire and misc lines**

As a Coordinator, I want to add materials, plant hire and miscellaneous lines, so that a quote can cover any cost.

- Materials: description, quantity, unit, unit cost; total calculated.
- Plant hire: description, duration, unit rate; total calculated.
- Misc: description and lump sum.
- Any line can carry an optional note.

**Q-04 · Edit, delete and reorder lines**

As a Coordinator, I want to change line order and content before sending, so that the quote is right.

- Lines can be dragged into a new order.
- Lines can be edited or deleted while the quote is Draft; not after it is sent.

**Q-05 · Quote totals**

As a Coordinator, I want totals calculated for me, so that the maths is always right.

- Subtotal = sum of lines; optional discount applied before VAT; VAT at 20%, 0% or Exempt; Total = subtotal − discount + VAT.
- Footer notes field for terms and payment instructions.

**Q-06 · Branded quote PDF**

As a Coordinator, I want a branded A4 PDF of the quote, so that recipients get a professional document.

- Layout per §8.1: logo and company details on a navy header, quote meta, recipient block, introduction, lines grouped by type with subtotals, totals block, footer with payment terms and registered details.
- Dev notes: PDFKit like PO PDFs; stored in S3 against the quote for 7 years.

**Q-07 · Email the quote**

As a Coordinator, I want to email the PDF from theOffice, so that I don't attach it by hand.

- Sends to the external email, or the production / department contact for internal quotes.
- Status moves Draft → Sent; send date and recipient are logged on the quote.
- Each send keeps its PDF as a new version in the quote's history.

**Q-08 · Download PDF and copy link**

As a Coordinator, I want to download the PDF or copy a secure link, so that I can share the quote other ways.

- Download saves the PDF.
- Copy Link gives a link that opens the quote in a browser without logging in.

**Q-09 · Quote status workflow**

As a Coordinator, I want to move a quote through its stages, so that I know where every quote stands.

- Flow: Draft → Sent → Approved or Declined; Approved → Awaiting PO Ref → Invoice Raised. No other moves.
- Declined quotes are archived.
- Invoice Raised needs a PO reference entered first.
- Every status change is logged with user and date.

**Q-10 · Quotes list**

As a Coordinator, I want all quotes in one list, so that I can track them.

- Columns: Reference, Recipient / Production, Total, Status, Notes.
- Filter by status, production, date range and recipient type (internal / external).

### Shared

**X-01 · Departments for internal quotes** (question 2)

As a Coordinator, I want departments available for each production, so that internal quotes can be addressed to them.

- Departments appear in the internal quote Department dropdown for the chosen production.
- Each department has a contact email for sending quotes.

**X-02 · Production Finance tab**

As a Coordinator, I want a Finance tab on each production, so that I see its full financial picture in one place.

- Shows invoices allocated to the production and quotes linked to it, with their status.
- Shows total quoted, total invoiced and total received.
- A Xero invoice can be linked to its quote from here.

**X-03 · Role permissions** (question 1)

As an Administrator, I want each role to see only what the addendum allows, so that access matches §11.

| Role | Sales | Quotes | Notes |
| --- | --- | --- | --- |
| Administrator | Full | Full | Plus Xero setup and approval override |
| Coordinator | Full | Full | Day-to-day user |
| Production Manager | View own productions | View own productions | No edits |
| Finance | View all | None | Read-only |
| Department Head | None | View own department | Read-only |

- Enforced in `policies.json` on the API as well as hidden in the UI.
