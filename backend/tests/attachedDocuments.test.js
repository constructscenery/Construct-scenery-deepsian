const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');
jest.mock('../services/fileStorage', () => ({ validate: jest.fn(), store: jest.fn(), deleteFile: jest.fn(), streamToResponse: jest.fn() }));
const storage = require('../services/fileStorage');
const app = makeApp(['/api/buildings', require('../routes/buildings')], ['/api/crew', require('../routes/crew')]);
const parentId = '11111111-1111-1111-1111-111111111111';
const docId = '22222222-2222-2222-2222-222222222222';
const document = { id: docId, file_name: 'document.pdf', file_size: 10, file_mime_type: 'application/pdf' };

beforeEach(() => {
  dbMock.reset();
  jest.clearAllMocks();
  storage.validate.mockReset();
  storage.store.mockReset().mockResolvedValue({ key: 'uploads/test.pdf', size: 10 });
  storage.deleteFile.mockReset().mockResolvedValue();
  storage.streamToResponse.mockImplementation(async (_key, res) => res.type('application/pdf').send('preview'));
});

describe.each(['/api/buildings', '/api/crew/freelancers'])('%s attachments', base => {
  const url = `${base}/${parentId}/documents`;
  test.each(['md', 'accountant', 'coordinator'])('%s can upload, list, view and delete', async role => {
    dbMock.respond([{ id: parentId }], [document]);
    const upload = await request(app).post(url).set(authHeader(role)).attach('file', Buffer.from('%PDF-test'), 'document.pdf');
    expect(upload.status).toBe(201);
    expect(storage.validate).toHaveBeenCalledWith('application/pdf', 9);
    dbMock.respond([{ id: parentId }], [document]);
    expect((await request(app).get(url).set(authHeader(role))).body).toEqual([document]);
    dbMock.respond([{ ...document, file_key: 'uploads/test.pdf' }]);
    const view = await request(app).get(`${url}/${docId}/view`).set(authHeader(role));
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('private, no-store');
    expect(dbMock.query.mock.calls.at(-1)[1]).toEqual([docId, parentId]);
    dbMock.respond([{ file_key: 'uploads/test.pdf' }], []);
    expect((await request(app).delete(`${url}/${docId}`).set(authHeader(role))).status).toBe(204);
    expect(storage.deleteFile).toHaveBeenCalledWith('uploads/test.pdf', { strict: true });
  });
  test('requires authentication', async () => {
    expect((await request(app).get(url)).status).toBe(401);
  });
  test('rejects missing and unsupported files', async () => {
    expect((await request(app).post(url).set(authHeader())).status).toBe(400);
    storage.validate.mockImplementation(() => { throw Object.assign(new Error('Unsupported file'), { status: 400 }); });
    expect((await request(app).post(url).set(authHeader()).attach('file', Buffer.from('text'), 'notes.txt')).status).toBe(400);
    expect(storage.store).not.toHaveBeenCalled();
  });
  test('does not store a file for a missing parent', async () => {
    expect((await request(app).post(url).set(authHeader()).attach('file', Buffer.from('test'), 'document.pdf')).status).toBe(404);
    expect(storage.store).not.toHaveBeenCalled();
  });
  test('does not expose or delete a document belonging to another record', async () => {
    expect((await request(app).get(`${url}/${docId}/view`).set(authHeader())).status).toBe(404);
    expect((await request(app).delete(`${url}/${docId}`).set(authHeader())).status).toBe(404);
    expect(storage.streamToResponse).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });
  test('retains metadata when storage deletion fails', async () => {
    dbMock.respond([{ file_key: 'uploads/test.pdf' }]);
    storage.deleteFile.mockRejectedValueOnce(new Error('S3 unavailable'));
    expect((await request(app).delete(`${url}/${docId}`).set(authHeader())).status).toBe(500);
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });
  test('cleans up uploaded file after database failure', async () => {
    dbMock.respond([{ id: parentId }]);
    dbMock.query.mockImplementationOnce(async () => ({ rows: [{ id: parentId }] })).mockRejectedValueOnce(new Error('Insert failed'));
    expect((await request(app).post(url).set(authHeader()).attach('file', Buffer.from('test'), 'document.pdf')).status).toBe(500);
    expect(storage.deleteFile).toHaveBeenCalledWith('uploads/test.pdf');
  });
  test('invalid IDs return 400', async () => {
    expect((await request(app).get(`${base}/bad/documents`).set(authHeader())).status).toBe(400);
  });
  test('parent deletion reports attached documents', async () => {
    dbMock.query.mockRejectedValueOnce(Object.assign(new Error('FK constraint'), { code: '23503' }));
    expect((await request(app).delete(`${base}/${parentId}`).set(authHeader())).status).toBe(409);
  });
});