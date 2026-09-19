jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../services/fileStorage', () => ({ store: jest.fn(), deleteFile: jest.fn() }));
jest.mock('../config/email', () => ({ sendEmail: jest.fn(), templates: { insuranceCertificateExpiryAlert: jest.fn() } }));

const db = require('../config/db');
const fileStorage = require('../services/fileStorage');
const { uploadDocument, replaceDocument } = require('../Controllers/safetyHealthController');
const { sendEmail, templates } = require('../config/email');
const { runAssetReminders } = require('../services/reminderService');
const { getVehicles } = require('../Controllers/assetsHireController');

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
beforeEach(() => jest.resetAllMocks());

test.each(['2026-02-30', 'invalid', '19/09/2026'])('rejects invalid expiry %s before storing a file', async expiry_date => {
  const res = response();
  await uploadDocument({ body: { document_type: 'insurance', expiry_date }, file: { mimetype: 'application/pdf' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(fileStorage.store).not.toHaveBeenCalled();
});

test('uploads insurance expiry and alert preferences', async () => {
  const res = response();
  fileStorage.store.mockResolvedValue({ url: '/insurance.pdf', key: 'insurance.pdf' });
  db.query.mockResolvedValue({ rows: [{ id: 'document-1' }] });
  await uploadDocument({ body: { document_type: 'insurance', expiry_date: '2027-01-01', reminder_enabled: 'false', reminder_days: '14' }, file: { mimetype: 'application/pdf', originalname: 'insurance.pdf', size: 100 }, user: { id: 'user-1' } }, res);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(db.query.mock.calls[0][1].slice(-3)).toEqual(['2027-01-01', false, 14]);
});

test('clears expiry and disables alerts without replacing the file', async () => {
  const res = response();
  db.query.mockResolvedValueOnce({ rows: [{ id: 'document-1', document_type: 'insurance' }] }).mockResolvedValueOnce({ rows: [{ id: 'document-1', expiry_date: null }] });
  await replaceDocument({ params: { id: 'document-1' }, body: { expiry_date: '', reminder_enabled: 'false', reminder_days: '30' } }, res);
  expect(db.query.mock.calls[1][1]).toEqual([null, false, 30, 'document-1']);
  expect(fileStorage.store).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ id: 'document-1', expiry_date: null });
});

test.each(['-1', '1.5', '366', '', 'invalid'])('rejects invalid reminder days %s', async reminder_days => {
  const res = response();
  await uploadDocument({ body: { document_type: 'insurance', reminder_days }, file: { mimetype: 'application/pdf' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});

describe('insurance email reminders', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T12:00:00Z'));
    templates.insuranceCertificateExpiryAlert.mockReturnValue({ subject: 'Insurance renewal', html: '<p>Due</p>' });
  });
  afterEach(() => jest.useRealTimers());

  test.each([
    ['due soon', '2026-09-25', true, 30, false, 1],
    ['due today', '2026-09-19', true, 0, false, 1],
    ['overdue', '2026-09-01', true, 30, false, 1],
    ['outside threshold', '2027-01-01', true, 30, false, 0],
    ['custom threshold', '2026-09-25', true, 3, false, 0],
    ['disabled', '2026-09-25', false, 30, false, 0],
    ['no expiry', null, true, 30, false, 0],
    ['already sent', '2026-09-25', true, 30, true, 0],
  ])('%s', async (_label, expiry_date, reminder_enabled, reminder_days, alreadySent, expectedCount) => {
    db.query.mockImplementation(async sql => {
      if (sql.includes('FROM users')) return { rows: [{ email: 'staff@example.test' }] };
      if (sql.includes('FROM safety_health_documents')) return { rows: [{ id: 'insurance-1', file_name: 'policy.pdf', expiry_date, reminder_enabled, reminder_days }] };
      if (sql.includes('SELECT id FROM asset_reminders_sent')) return { rows: alreadySent ? [{ id: 'sent-1' }] : [] };
      return { rows: [] };
    });
    await runAssetReminders();
    expect(sendEmail).toHaveBeenCalledTimes(expectedCount);
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO asset_reminders_sent'))).toHaveLength(expectedCount);
  });
});

test('vehicle status distinguishes unset, future, and expired deadlines', async () => {
  db.query.mockResolvedValue({ rows: [{ id: 'unset' }, { id: 'future', insurance_renewal_date: '2099-01-01' }, { id: 'expired', insurance_renewal_date: '2000-01-01' }, { id: 'missing-insurance', mot_expiry_date: '2099-01-01' }] });
  const res = response();
  await getVehicles({ query: {} }, res);
  expect(res.json.mock.calls[0][0].vehicles.map(vehicle => vehicle.overall_status)).toEqual(['none', 'compliant', 'overdue', 'none']);
});