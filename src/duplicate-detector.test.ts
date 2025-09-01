import { DuplicateDetector } from './duplicate-detector.js';

describe('DuplicateDetector', () => {
    let detector: DuplicateDetector;
    
    beforeEach(() => {
        detector = new DuplicateDetector();
    });
    
    afterEach(() => {
        detector.clearHistory();
    });
    
    describe('checkDuplicate', () => {
        it('should not detect duplicate on first execution', () => {
            const result = {
                stdout: 'test output',
                stderr: '',
                exitCode: 0
            };
            
            const isDuplicate = detector.checkDuplicate('echo test', '/home/user', result);
            expect(isDuplicate).toBe(false);
        });
        
        it('should detect duplicate when same command has identical results', () => {
            const result = {
                stdout: 'same output',
                stderr: '',
                exitCode: 0
            };
            
            // First execution
            detector.checkDuplicate('ls -la', '/home/user', result);
            
            // Second execution with same result should trigger duplicate detection
            const isDuplicate = detector.checkDuplicate('ls -la', '/home/user', result);
            expect(isDuplicate).toBe(true);
        });
        
        it('should not detect duplicate for different results', () => {
            const result1 = {
                stdout: 'output 1',
                stderr: '',
                exitCode: 0
            };
            
            const result2 = {
                stdout: 'output 2',
                stderr: '',
                exitCode: 0
            };
            
            detector.checkDuplicate('echo test', '/home/user', result1);
            const isDuplicate = detector.checkDuplicate('echo test', '/home/user', result2);
            expect(isDuplicate).toBe(false);
        });
        
        it('should consider cwd when checking duplicates', () => {
            const result = {
                stdout: 'same output',
                stderr: '',
                exitCode: 0
            };
            
            // Same command, different directories
            detector.checkDuplicate('ls', '/home/user', result);
            const isDuplicate = detector.checkDuplicate('ls', '/home/other', result);
            expect(isDuplicate).toBe(false);
        });
        
        it('should emit duplicate-detected event when duplicate found', (done) => {
            const result = {
                stdout: 'test',
                stderr: '',
                exitCode: 0
            };
            
            detector.once('duplicate-detected', (event) => {
                expect(event.command).toBe('test-cmd');
                expect(event.cwd).toBe('/test');
                expect(event.duplicateCount).toBe(2);
                done();
            });
            
            detector.checkDuplicate('test-cmd', '/test', result);
            detector.checkDuplicate('test-cmd', '/test', result);
        });
        
        it('should not detect duplicates outside detection window', (done) => {
            const result = {
                stdout: 'test',
                stderr: '',
                exitCode: 0
            };
            
            // Set a short detection window for testing
            (detector as any).detectionWindow = 100; // 100ms
            
            detector.checkDuplicate('cmd', '/dir', result);
            
            // Wait beyond detection window
            setTimeout(() => {
                const isDuplicate = detector.checkDuplicate('cmd', '/dir', result);
                expect(isDuplicate).toBe(false);
                done();
            }, 150);
        });
    });
    
    describe('clearHistory', () => {
        it('should clear all history when called without arguments', () => {
            const result = {
                stdout: 'test',
                stderr: '',
                exitCode: 0
            };
            
            detector.checkDuplicate('cmd1', '/dir1', result);
            detector.checkDuplicate('cmd2', '/dir2', result);
            
            detector.clearHistory();
            
            const stats = detector.getStats();
            expect(stats.totalTrackedCommands).toBe(0);
        });
        
        it('should clear history for specific command and cwd', () => {
            const result = {
                stdout: 'test',
                stderr: '',
                exitCode: 0
            };
            
            detector.checkDuplicate('cmd1', '/dir1', result);
            detector.checkDuplicate('cmd2', '/dir2', result);
            
            detector.clearHistory('cmd1', '/dir1');
            
            const stats = detector.getStats();
            expect(stats.totalTrackedCommands).toBe(1);
        });
        
        it('should clear all history for a command across all directories', () => {
            const result = {
                stdout: 'test',
                stderr: '',
                exitCode: 0
            };
            
            detector.checkDuplicate('cmd', '/dir1', result);
            detector.checkDuplicate('cmd', '/dir2', result);
            detector.checkDuplicate('other', '/dir3', result);
            
            detector.clearHistory('cmd');
            
            const stats = detector.getStats();
            expect(stats.totalTrackedCommands).toBe(1);
        });
    });
    
    describe('getStats', () => {
        it('should return correct statistics', () => {
            const result = {
                stdout: 'test',
                stderr: '',
                exitCode: 0
            };
            
            // Add some history
            detector.checkDuplicate('cmd1', '/dir1', result);
            detector.checkDuplicate('cmd1', '/dir1', result);
            detector.checkDuplicate('cmd2', '/dir2', result);
            
            const stats = detector.getStats();
            expect(stats.totalTrackedCommands).toBe(2);
            expect(stats.commandsWithHistory).toBe(2);
            expect(stats.totalHistoryEntries).toBeGreaterThan(0);
        });
        
        it('should return zero stats for empty detector', () => {
            const stats = detector.getStats();
            expect(stats.totalTrackedCommands).toBe(0);
            expect(stats.commandsWithHistory).toBe(0);
            expect(stats.totalHistoryEntries).toBe(0);
        });
    });
    
    describe('hashResult', () => {
        it('should create same hash for identical results', () => {
            const detector2 = new DuplicateDetector();
            const result = {
                stdout: 'output',
                stderr: 'error',
                exitCode: 1
            };
            
            // Use the private method indirectly by checking duplicate detection
            detector.checkDuplicate('cmd', '/dir', result);
            detector2.checkDuplicate('cmd', '/dir', result);
            
            // Both should have same history
            const stats1 = detector.getStats();
            const stats2 = detector2.getStats();
            expect(stats1.totalTrackedCommands).toBe(stats2.totalTrackedCommands);
        });
        
        it('should create different hashes for different results', () => {
            const result1 = {
                stdout: 'output1',
                stderr: '',
                exitCode: 0
            };
            
            const result2 = {
                stdout: 'output2',
                stderr: '',
                exitCode: 0
            };
            
            detector.checkDuplicate('cmd', '/dir', result1);
            const isDuplicate = detector.checkDuplicate('cmd', '/dir', result2);
            expect(isDuplicate).toBe(false);
        });
    });
    
    describe('memory management', () => {
        it('should limit history size to prevent memory growth', () => {
            // Add many results to the same command
            for (let i = 0; i < 20; i++) {
                const result = {
                    stdout: `output ${i}`,
                    stderr: '',
                    exitCode: 0
                };
                detector.checkDuplicate('cmd', '/dir', result);
            }
            
            // History should be limited
            const stats = detector.getStats();
            expect(stats.totalHistoryEntries).toBeLessThanOrEqual(10);
        });
    });
});
