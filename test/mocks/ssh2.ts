// Mock for ssh2 module
import { EventEmitter } from 'events';

export class MockClient extends EventEmitter {
  connect(config: any) {
    setTimeout(() => this.emit('ready'), 10);
    return this;
  }
  
  end() {
    this.emit('end');
  }
  
  exec(command: string, callback: (err: Error | null, stream: any) => void) {
    const stream = new EventEmitter();
    (stream as any).write = jest.fn();
    (stream as any).end = jest.fn();
    (stream as any).setWindow = jest.fn();
    
    setTimeout(() => {
      callback(null, stream);
      setTimeout(() => {
        stream.emit('data', Buffer.from(`Mock SSH output: ${command}`));
        stream.emit('close', 0, null);
      }, 10);
    }, 10);
  }
  
  shell(callback: (err: Error | null, stream: any) => void) {
    const stream = new EventEmitter();
    (stream as any).write = jest.fn();
    (stream as any).end = jest.fn();
    (stream as any).setWindow = jest.fn();
    
    setTimeout(() => {
      callback(null, stream);
    }, 10);
  }
}

export const Client = MockClient;
export default { Client };