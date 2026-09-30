const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const app = makeApp(['/api/timesheets', require('../routes/timesheets')]);
const prodId = '11111111-1111-1111-1111-111111111111';
const crewId = '22222222-2222-2222-2222-222222222222';
const tsId = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
});

describe('Timesheets CSV Import API', () => {
  describe('GET /api/timesheets/import/template', () => {
    test('returns CSV template file with headers and example row', async () => {
      const res = await request(app)
        .get('/api/timesheets/import/template')
        .set(authHeader('coordinator'));

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toContain('timesheets_import_template.csv');
      expect(res.text).toContain('Production');
      expect(res.text).toContain('Crew Number');
      expect(res.text).toContain('Week Ending Date');
      expect(res.text).toContain('Mon Worked');
      expect(res.text).toContain('Fri Worked');
    });
  });

  describe('POST /api/timesheets/import/preview', () => {
    test('returns 400 when no CSV file is provided', async () => {
      const res = await request(app)
        .post('/api/timesheets/import/preview')
        .set(authHeader('coordinator'));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No CSV file provided');
    });

    test('validates CSV and returns preview with financial calculations', async () => {
      // 1. productions
      dbMock.respond([{ id: prodId, name: 'Wicked (Part 1)', status: 'active_build' }]);
      // 2. crew_members
      dbMock.respond([{
        id: crewId,
        crew_number: 'CS-0001',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john@constructscenery.co.uk',
        crew_trade: 'Carpenters',
        crew_rank: 'Carpenter',
        employment_status: 'self_employed',
        vat_registration_number: 'GB123456789',
        is_active: true,
      }]);
      // 3. bectu_rates
      dbMock.respond([{
        trade: 'Carpenters',
        rank: 'Carpenter',
        rate_year: '2026/27',
        daily_rate: 300.00,
        overtime_rate: 45.00,
        effective_from: '2026-07-01',
      }]);
      // 4. existingTimesheets
      dbMock.respond([]);
      // 5. processedItems
      dbMock.respond([]);

      const csvContent =
        'Production,Crew Number,First Name,Last Name,Week Ending Date,Rank Override,Rate Override,Mon Worked,Mon OT,Mon Set,Tue Worked,Tue OT,Tue Set,Wed Worked,Wed OT,Wed Set,Thu Worked,Thu OT,Thu Set,Fri Worked,Fri OT,Fri Set,Sat Worked,Sat OT,Sat Set,Sun Worked,Sun OT,Sun Set,Travel,Mileage,Per Diem,Ad Hoc Reimbursement,Meal Breakfast Count,Meal Lunch Count,Meal Supper Count,Notes\n' +
        '"Wicked (Part 1)","CS-0001","John","Smith","2026-10-04","","","Y","0","Main Stage","Y","2.0","Main Stage","Y","0","","Y","0","","Y","0","","N","0","","N","0","","10.00","0.00","0.00","0.00","0","5","0","Test row"';

      const res = await request(app)
        .post('/api/timesheets/import/preview')
        .set(authHeader('md'))
        .attach('csv', Buffer.from(csvContent), 'test_preview.csv');

      expect(res.status).toBe(200);
      expect(res.body.total_rows).toBe(1);
      expect(res.body.valid_rows).toBe(1);
      expect(res.body.invalid_rows).toBe(0);

      const row = res.body.preview[0];
      expect(row.valid).toBe(true);
      expect(row.action).toBe('create');
      expect(row.crew_name).toBe('John Smith');
      expect(row.crew_number).toBe('CS-0001');
      expect(row.production_name).toBe('Wicked (Part 1)');
      expect(row.week_ending_date).toBe('2026-10-04');
      expect(row.days_worked).toBe(5);
      expect(row.overtime_hours).toBe(2);
      expect(row.daily_rate).toBe(300);
      expect(row.weekly_rate).toBe(1500); // 5 std days * 300
      expect(row.overtime_amount).toBe(90); // 2 hrs * 45
      expect(row.meal_allowance_total).toBe(70); // 5 lunches * 14.00 = 70.00
      expect(row.mileage_and_travel).toBe(10); // travel 10.00
      expect(row.gross_total).toBe(1670); // 1500 + 90 + 70 + 10 = 1670
      expect(row.vat).toBe(334); // 20% VAT on 1670 = 334
      expect(row.grand_total).toBe(2004); // 1670 + 334
    });

    test('flags invalid rows with clear error messages (non-Sunday date, inactive crew, unknown production)', async () => {
      // 1. productions
      dbMock.respond([{ id: prodId, name: 'Active Prod', status: 'active_build' }]);
      // 2. crew_members
      dbMock.respond([{
        id: crewId,
        crew_number: 'CS-9999',
        first_name: 'Inactive',
        last_name: 'Person',
        is_active: false,
      }]);
      // 3. bectu_rates
      dbMock.respond([]);
      // 4. existingTimesheets
      dbMock.respond([]);
      // 5. processedItems
      dbMock.respond([]);

      // 2026-10-02 is a Friday, not a Sunday!
      const csvContent =
        'Production,Crew Number,First Name,Last Name,Week Ending Date\n' +
        '"Unknown Prod","CS-0001","John","Smith","2026-10-04"\n' +
        '"Active Prod","CS-9999","Inactive","Person","2026-10-02"';

      const res = await request(app)
        .post('/api/timesheets/import/preview')
        .set(authHeader('coordinator'))
        .attach('csv', Buffer.from(csvContent), 'invalid.csv');

      expect(res.status).toBe(200);
      expect(res.body.total_rows).toBe(2);
      expect(res.body.valid_rows).toBe(0);
      expect(res.body.invalid_rows).toBe(2);

      const r1 = res.body.preview[0];
      expect(r1.valid).toBe(false);
      expect(r1.errors.some(e => e.includes('Production "Unknown Prod" not found'))).toBe(true);

      const r2 = res.body.preview[1];
      expect(r2.valid).toBe(false);
      expect(r2.errors.some(e => e.includes('is inactive'))).toBe(true);
      expect(r2.errors.some(e => e.includes('not a Sunday'))).toBe(true);
    });
  });

  describe('POST /api/timesheets/import', () => {
    test('commits valid rows to database and creates daily timesheet entries', async () => {
      // 1. productions
      dbMock.respond([{ id: prodId, name: 'Wicked (Part 1)', status: 'active_build' }]);
      // 2. crew_members
      dbMock.respond([{
        id: crewId,
        crew_number: 'CS-0001',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john@constructscenery.co.uk',
        crew_trade: 'Carpenters',
        crew_rank: 'Carpenter',
        employment_status: 'paye',
        is_active: true,
      }]);
      // 3. bectu_rates
      dbMock.respond([{
        trade: 'Carpenters',
        rank: 'Carpenter',
        rate_year: '2026/27',
        daily_rate: 300.00,
        overtime_rate: 45.00,
        effective_from: '2026-07-01',
      }]);
      // 4. existingTimesheets
      dbMock.respond([]);
      // 5. processedItems
      dbMock.respond([]);

      // Transaction queries:
      // BEGIN
      dbMock.respond([]);
      // INSERT INTO timesheets RETURNING id
      dbMock.respond([{ id: tsId }]);
      // INSERT INTO timesheet_entries
      dbMock.respond([]);
      // COMMIT
      dbMock.respond([]);

      const csvContent =
        'Production,Crew Number,First Name,Last Name,Week Ending Date,Mon Worked,Tue Worked,Wed Worked,Thu Worked,Fri Worked,Sat Worked,Sun Worked\n' +
        '"Wicked (Part 1)","CS-0001","John","Smith","2026-10-04","Y","Y","Y","Y","Y","N","N"';

      const res = await request(app)
        .post('/api/timesheets/import')
        .set(authHeader('md'))
        .attach('csv', Buffer.from(csvContent), 'import.csv');

      expect(res.status).toBe(201);
      expect(res.body.total_rows).toBe(1);
      expect(res.body.created).toBe(1);
      expect(res.body.updated).toBe(0);
      expect(res.body.skipped).toBe(0);
      expect(res.body.created_records[0].timesheet_id).toBe(tsId);
      expect(res.body.created_records[0].crew_name).toBe('John Smith');
    });

    test('updates existing non-finalised timesheet when row already exists', async () => {
      // 1. productions
      dbMock.respond([{ id: prodId, name: 'Wicked (Part 1)', status: 'active_build' }]);
      // 2. crew_members
      dbMock.respond([{
        id: crewId,
        crew_number: 'CS-0001',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john@constructscenery.co.uk',
        crew_trade: 'Carpenters',
        crew_rank: 'Carpenter',
        employment_status: 'paye',
        is_active: true,
      }]);
      // 3. bectu_rates
      dbMock.respond([{
        trade: 'Carpenters',
        rank: 'Carpenter',
        rate_year: '2026/27',
        daily_rate: 320.00,
        overtime_rate: 48.00,
        effective_from: '2026-07-01',
      }]);
      // 4. existingTimesheets - exists with status draft
      dbMock.respond([{
        id: tsId,
        crew_member_id: crewId,
        production_id: prodId,
        week_ending_date: '2026-10-04',
        status: 'draft',
      }]);
      // 5. processedItems
      dbMock.respond([]);

      // Transaction queries:
      // BEGIN
      dbMock.respond([]);
      // UPDATE timesheets
      dbMock.respond([]);
      // DELETE FROM timesheet_entries
      dbMock.respond([]);
      // INSERT INTO timesheet_entries
      dbMock.respond([]);
      // COMMIT
      dbMock.respond([]);

      const csvContent =
        'Production,Crew Number,First Name,Last Name,Week Ending Date,Mon Worked,Tue Worked,Wed Worked,Thu Worked,Fri Worked\n' +
        '"Wicked (Part 1)","CS-0001","John","Smith","2026-10-04","Y","Y","Y","Y","Y"';

      const res = await request(app)
        .post('/api/timesheets/import')
        .set(authHeader('accountant'))
        .attach('csv', Buffer.from(csvContent), 'import_update.csv');

      expect(res.status).toBe(201);
      expect(res.body.total_rows).toBe(1);
      expect(res.body.created).toBe(0);
      expect(res.body.updated).toBe(1);
      expect(res.body.skipped).toBe(0);
      expect(res.body.updated_records[0].timesheet_id).toBe(tsId);
    });
  });
});
