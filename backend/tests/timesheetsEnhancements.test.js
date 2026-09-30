const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../services/fileStorage', () => ({
  validate: jest.fn(),
  store: jest.fn().mockResolvedValue({ url: 'https://s3.aws/uploads/paper-timesheet.pdf', key: 'uploads/paper-timesheet.pdf', size: 1024 }),
  deleteFile: jest.fn().mockResolvedValue(),
  streamToResponse: jest.fn(),
}));

const app = makeApp(['/api/timesheets', require('../routes/timesheets')]);
const prodId = '11111111-1111-1111-1111-111111111111';
const tsId = '22222222-2222-2222-2222-222222222222';
const docId = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
});

describe('Timesheets enhancements API', () => {
  describe('DELETE /api/timesheets/:id', () => {
    test('Deletes timesheet successfully when not in processed pay run', async () => {
      // 1. SELECT timesheet
      // 2. SELECT processed pay runs (empty)
      // 3. DELETE pay_run_items
      // 4. DELETE timesheet_entries
      // 5. DELETE timesheets
      dbMock.respond(
        [{ id: tsId, week_ending_date: '2026-10-04', production_id: prodId, status: 'draft', first_name: 'John', last_name: 'Doe', crew_number: 'CSC-1001' }],
        [],
        [],
        [],
        []
      );

      const res = await request(app)
        .delete(`/api/timesheets/${tsId}`)
        .set(authHeader('md'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('deleted successfully');
    });

    test('Rejects deletion if timesheet is in a processed pay run', async () => {
      dbMock.respond(
        [{ id: tsId, week_ending_date: '2026-10-04', production_id: prodId, status: 'finalised', first_name: 'John', last_name: 'Doe' }],
        [{ id: 'pr-1', week_ending_date: '2026-10-04' }]
      );

      const res = await request(app)
        .delete(`/api/timesheets/${tsId}`)
        .set(authHeader('md'));

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CANNOT_DELETE_PROCESSED_TIMESHEET');
    });

    test('Returns 404 if timesheet not found', async () => {
      dbMock.respond([]);

      const res = await request(app)
        .delete(`/api/timesheets/${tsId}`)
        .set(authHeader('md'));

      expect(res.status).toBe(404);
    });
  });

  describe('Weekly Hard Copies Documents', () => {
    test('GET /api/timesheets/weekly-documents returns documents for week', async () => {
      const mockDocs = [
        {
          id: docId,
          production_id: prodId,
          week_ending_date: '2026-10-04',
          file_url: 'https://s3.aws/uploads/paper-timesheet.pdf',
          file_name: 'paper-timesheet.pdf',
          file_size: 1024,
        },
      ];
      dbMock.respond(mockDocs);

      const res = await request(app)
        .get(`/api/timesheets/weekly-documents?production_id=${prodId}&week_ending_date=2026-10-04`)
        .set(authHeader('coordinator'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockDocs);
    });

    test('POST /api/timesheets/weekly-documents uploads PDF hard copy', async () => {
      const insertedDoc = {
        id: docId,
        production_id: prodId,
        week_ending_date: '2026-10-04',
        file_url: 'https://s3.aws/uploads/paper-timesheet.pdf',
        file_name: 'scanned_sheet.pdf',
        file_size: 1024,
      };
      dbMock.respond([insertedDoc]);

      const res = await request(app)
        .post('/api/timesheets/weekly-documents')
        .set(authHeader('accountant'))
        .field('production_id', prodId)
        .field('week_ending_date', '2026-10-04')
        .attach('file', Buffer.from('%PDF-1.4 test'), 'scanned_sheet.pdf');

      expect(res.status).toBe(201);
      expect(res.body.file_name).toBe('scanned_sheet.pdf');
    });

    test('DELETE /api/timesheets/weekly-documents/:id deletes document', async () => {
      dbMock.respond(
        [{ id: docId, production_id: prodId, week_ending_date: '2026-10-04', file_name: 'scanned_sheet.pdf' }],
        []
      );

      const res = await request(app)
        .delete(`/api/timesheets/weekly-documents/${docId}`)
        .set(authHeader('coordinator'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
