# CS HQ — Project Rules

These rules apply to EVERY task in this project. Read and follow all of them before writing any code.

## Access Policy

All authenticated application roles have full access to every application module and feature. When adding a route or UI action, add the corresponding policy entry for `managing_director`, `construction_accountant`, and `construction_coordinator`. Do not introduce role-specific restrictions unless explicitly requested.

---

## 1. Sensitive Data Must Always Be Encrypted

**Fields that require AES-256-GCM encryption at rest:**

| Table | Encrypted Fields |
|-------|-----------------|
| `crew_members` | `home_address`, `account_name`, `account_number`, `sort_code`, `emergency_contact_phone` |
| `pay_run_items` | `sort_code`, `account_number`, `account_name` |

**How to encrypt (JavaScript controllers):**
```js
const { encrypt, decrypt } = require('../config/crypto');
// Always encrypt before INSERT/UPDATE, always decrypt after SELECT
```

**How to encrypt (TypeORM entities):**
```ts
import { encryptTransformer } from '../utils/crypto';
@Column({ transformer: encryptTransformer })
accountNumber: string | null;
```

**Rules:**
- Never store plaintext bank details, personal addresses, or personal phone numbers in the DB
- The `config/crypto.js` and `src/utils/crypto.ts` use the same AES-256-GCM algorithm — always use these, never roll your own crypto
- `ENCRYPTION_KEY` must be a 64-char hex string (32 bytes) set in `.env`
- Generate a key with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Email and name fields are NOT encrypted (needed for auth, search, and communication)
- `password_hash` is handled by bcrypt — no additional encryption needed

---

## 2. Type Safety in Migrations

- All migrations live in `backend/src/migrations/` as TypeScript files
- Use `MigrationInterface` and `QueryRunner` types from TypeORM
- Never use `any` type in migration files
- Run migrations with: `npm run migration:run` (from `backend/`)
- Generate a new migration with: `npm run migration:generate`
- Always implement both `up()` and `down()` methods
- Use `IF NOT EXISTS` / `IF EXISTS` in raw SQL migrations to make them re-runnable safely
- After adding new migrations, run `npm run migration:show` to verify the queue

---

## 3. Enums — No Magic Strings

All status values, types, and roles are defined in `backend/src/enums/index.ts`. **Always use the enum constant, never a raw string.**

| Enum | Values |
|------|--------|
| `UserRole` | `MANAGING_DIRECTOR`, `CONSTRUCTION_ACCOUNTANT`, `CONSTRUCTION_COORDINATOR` |
| `ProductionStatus` | `PRE_PRODUCTION`, `ACTIVE_BUILD`, `STRIKE`, `COMPLETE`, `ARCHIVED` |
| `ContractType` | `ON_A_PRICE`, `COST_PLUS` |
| `SetCompletionStatus` | `NOT_STARTED`, `IN_PROGRESS`, `NEARING_COMPLETION`, `COMPLETE`, `HANDED_OVER` |
| `EmploymentStatus` | `PAYE`, `SELF_EMPLOYED` |
| `PurchaseOrderStatus` | `DRAFT`, `SUBMITTED`, `ISSUED`, `INVOICE_RECEIVED`, `APPROVED` |
| `TimesheetStatus` | `DRAFT`, `DISTRIBUTED`, `AMENDMENT_REQUESTED`, `FINALISED` |
| `PayRunStatus` | `DRAFT`, `PROCESSED` |
| `CrewDocumentType` | `GOVERNMENT_ID`, `CONTRACT`, `OTHER` |
| `PaidFrom` | `SUPPLIER_ACCOUNT`, `ARBUTHNOT_CURRENT_ACCOUNT`, `CHARGE_CARD`, `PLEO_CHARGE_CARD` |
| `DayOfWeek` | `MONDAY` … `SUNDAY` |

**In JavaScript controllers**, use the string values directly but document the enum reference with a comment:
```js
// TimesheetStatus.VERIFIED
WHERE t.status = 'verified'
```

**When adding a new status/type**, add it to the enum first, then add it to the CHECK constraint in a new migration.

---

## 4. Database Must Use 3NF — No Repeating Groups or JSONB Arrays

- No JSONB columns that store arrays of structured objects (repeating groups violate 3NF)
- Each fact in one place: if data appears in multiple tables (e.g. bank details in `crew_members` and `pay_run_items`), the second copy is an intentional snapshot (payroll record) — document this clearly
- When adding a new feature with repeated data, create a separate child table with a foreign key
- Aggregate/summary tables are allowed for performance (e.g. `forecasts` totals), but must be kept in sync with source data
- The `cost_plus_budget_lines` table is the normalized replacement for the old `budget_lines JSONB` column

---

## 5. Migration Workflow (for every schema change)

1. Write a new `.ts` migration file in `backend/src/migrations/`
2. Name it `<timestamp>-<PascalCaseName>.ts` — generate the timestamp with `Date.now()`
3. Add the corresponding TypeORM entity change in `backend/src/entities/`
4. Add the enum value to `backend/src/enums/index.ts` if adding a new status/type
5. Update any JS controllers that read/write the changed table
6. If adding an encrypted field, update `ENCRYPTED_FIELDS` in the relevant controller
7. Run `npm run migration:run` and confirm it completes without errors
8. Update `POSTMAN_TESTING_GUIDE.md` if any request/response shape changes

---

## 6. Stack Reference

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Express (JavaScript) |
| Database | PostgreSQL 15 on Render |
| ORM / Migrations | TypeORM (TypeScript) |
| Auth | JWT (access 90m) + refresh tokens (7d) |
| Encryption | AES-256-GCM via `config/crypto.js` |
| File Uploads | Multer → local `uploads/` (temp) |
| Email | Nodemailer + Gmail SMTP |
| RBAC | JSON policy file + roleCheck middleware |

---

## 7. Do Not

- Do not use `synchronize: true` in TypeORM DataSource (destroys data)
- Do not commit `.env` to git (it contains secrets)
- Do not store bank details, addresses, or phone numbers in plaintext
- Do not add new string literals for statuses/types — extend the enums
- Do not drop the `down()` method from migrations
- Do not skip the `ENCRYPTION_KEY` check when running `db:encrypt-existing`
