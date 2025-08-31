import { jest } from '@jest/globals';
import type { ExecaChildProcess } from 'execa';
import type { Pseudoterminal } from 'node-pty';

export const mockExeca = {
  command: jest.fn(),
  commandSync: jest.fn(),
  $ : jest.fn()
};

export const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  rm: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
  access: jest.fn()
};

export const mockNodePty = {
  spawn: jest.fn()
};

export function createMockChildProcess(overrides?: Partial<ExecaChildProcess>): ExecaChildProcess {
  return {
    stdout: null,
    stderr: null,
    stdin: null,
    all: undefined,
    pid: 1234,
    kill: jest.fn(),
    cancel: jest.fn(),
    pipeStdout: jest.fn(),
    pipeStderr: jest.fn(),
    pipeAll: jest.fn(),
    unpipe: jest.fn(),
    ...overrides
  } as unknown as ExecaChildProcess;
}

export function createMockPty(overrides?: Partial<Pseudoterminal>): Pseudoterminal {
  return {
    pid: 5678,
    cols: 80,
    rows: 24,
    process: 'mock-process',
    handleFlowControl: false,
    on: jest.fn(),
    resize: jest.fn(),
    clear: jest.fn(),
    write: jest.fn(),
    kill: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    ...overrides
  } as unknown as Pseudoterminal;
}