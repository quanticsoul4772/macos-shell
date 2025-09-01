// Mock for execa module
export const execa = jest.fn().mockImplementation((command: string, args: string[] = []) => {
  return Promise.resolve({
    stdout: `Mock output for: ${command} ${args.join(' ')}`,
    stderr: '',
    exitCode: 0,
    failed: false,
    killed: false,
    command,
    escapedCommand: command,
    timedOut: false,
  });
});

export const execaSync = jest.fn().mockImplementation((command: string, args: string[] = []) => {
  return {
    stdout: `Mock sync output for: ${command} ${args.join(' ')}`,
    stderr: '',
    exitCode: 0,
    failed: false,
    killed: false,
    command,
    escapedCommand: command,
    timedOut: false,
  };
});

export const execaCommand = jest.fn().mockImplementation((command: string) => {
  return Promise.resolve({
    stdout: `Mock command output for: ${command}`,
    stderr: '',
    exitCode: 0,
    failed: false,
    killed: false,
    command,
    escapedCommand: command,
    timedOut: false,
  });
});

export class ExecaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecaError';
  }
}

export default execa;