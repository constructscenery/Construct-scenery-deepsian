const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../services/fileStorage', () => ({
  validate: jest.fn(),
  store: jest.fn(),
  deleteFile: jest.fn(),
  streamToResponse: jest.fn(),
}));
const storage = require('../services/fileStorage');

const app = makeApp(['/api/unit-lists', require('../routes/unitLists')]);

const unitListId = '33333333-3333-3333-3333-333333333333';
const sampleUnitList = {
  id: unitListId,
  production_id: null,
  file_name: 'Dyson_Unit_List_Oct2026.pdf',
  file_url: 'https://test-bucket.s3.eu-north-1.amazonaws.com/uploads/test.pdf',
  file_key: 'uploads/test.pdf',
  file_size: 1024,
  file_mime_type: 'application/pdf',
  date: '2026-10-08',
  name: 'John Carpenter',
  email: 'john@production.com',
  phone_number: '+44 7700 900123',
  company_name: 'Stunt Coordinators Ltd',
  notes: 'Key rigger and supervisor contact',
  production_name: null,
  uploaded_by_name: 'Admin User',
};

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
  storage.validate.mockReset();
  storage.store.mockReset().mockResolvedValue({ url: sampleUnitList.file_url, key: 'uploads/test.pdf', size: 1024 });
  storage.deleteFile.mockReset().mockResolvedValue();
  storage.streamToResponse.mockImplementation(async (_key, res) => res.type('application/pdf').send('%PDF-mock'));
});

describe('Unit Lists API', () => {
  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/unit-lists');
    expect(res.status).toBe(401);
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can list unit lists', async (role) => {
    dbMock.respond([sampleUnitList]);
    const res = await request(app)
      .get('/api/unit-lists?name=John&company_name=Stunt&date=2026-10-08')
      .set(authHeader(role));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([sampleUnitList]);
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT ul.*'),
      expect.arrayContaining(['%John%', '%Stunt%', '2026-10-08'])
    );
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can upload a unit list PDF with contact metadata', async (role) => {
    dbMock.respond([sampleUnitList]);
    const res = await request(app)
      .post('/api/unit-lists')
      .set(authHeader(role))
      .field('name', 'John Carpenter')
      .field('email', 'john@production.com')
      .field('number', '+44 7700 900123')
      .field('company_name', 'Stunt Coordinators Ltd')
      .field('date', '2026-10-08')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'unit_list.pdf');

    expect(res.status).toBe(201);
    expect(storage.validate).toHaveBeenCalledWith('application/pdf', expect.any(Number));
    expect(storage.store).toHaveBeenCalled();
    expect(res.body.file_name).toBe(sampleUnitList.file_name);
  });

  test('rejects upload without PDF file', async () => {
    const res = await request(app)
      .post('/api/unit-lists')
      .set(authHeader('md'))
      .field('name', 'Alice');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/choose|select a pdf file/i);
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can view/stream a unit list PDF', async (role) => {
    dbMock.respond([{ file_key: 'uploads/test.pdf', file_url: sampleUnitList.file_url, file_name: 'test.pdf', file_mime_type: 'application/pdf' }]);
    const res = await request(app)
      .get(`/api/unit-lists/${unitListId}/view`)
      .set(authHeader(role));

    expect(res.status).toBe(200);
    expect(storage.streamToResponse).toHaveBeenCalled();
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can update unit list metadata', async (role) => {
    dbMock.respond([sampleUnitList]); // existing
    dbMock.respond([{ ...sampleUnitList, name: 'Updated Name', company_name: 'New Co' }]); // updated

    const res = await request(app)
      .put(`/api/unit-lists/${unitListId}`)
      .set(authHeader(role))
      .send({
        name: 'Updated Name',
        company_name: 'New Co',
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can delete a unit list', async (role) => {
    dbMock.respond([sampleUnitList]); // existing
    dbMock.respond([]); // delete query

    const res = await request(app)
      .delete(`/api/unit-lists/${unitListId}`)
      .set(authHeader(role));

    expect(res.status).toBe(200);
    expect(storage.deleteFile).toHaveBeenCalledWith('uploads/test.pdf');
  });
});
