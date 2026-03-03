// Mock for better-sqlite3 module
const mockStatement = {
  run: jest.fn().mockReturnValue({ changes: 0 }),
  get: jest.fn().mockReturnValue(undefined),
  all: jest.fn().mockReturnValue([]),
  bind: jest.fn().mockReturnThis(),
};

const mockDatabase = {
  prepare: jest.fn().mockReturnValue(mockStatement),
  exec: jest.fn(),
  close: jest.fn(),
  pragma: jest.fn(),
  transaction: jest.fn((fn: any) => fn),
};

function Database(_path: string, _options?: any) {
  return mockDatabase;
}

Database.prototype = mockDatabase;

export default Database;
