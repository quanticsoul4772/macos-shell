// Mock for node-pty module
import { EventEmitter } from 'events';

export class MockPTY extends EventEmitter {
  private _pid = 12345;
  private _cols = 80;
  private _rows = 24;
  
  constructor(shell?: string, args?: string[], options?: any) {
    super();
    setTimeout(() => this.emit('spawn'), 0);
  }
  
  get pid() { return this._pid; }
  get cols() { return this._cols; }
  get rows() { return this._rows; }
  
  write(data: string) {
    setTimeout(() => {
      this.emit('data', `Mock PTY output: ${data}`);
    }, 10);
  }
  
  resize(cols: number, rows: number) {
    this._cols = cols;
    this._rows = rows;
  }
  
  kill(signal?: string) {
    this.emit('exit', 0, signal);
  }
  
  destroy() {
    this.removeAllListeners();
  }
}

export const spawn = jest.fn((shell?: string, args?: string[], options?: any) => {
  return new MockPTY(shell, args, options);
});

export default { spawn };