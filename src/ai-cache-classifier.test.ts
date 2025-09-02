/**
 * AI Cache Classifier Tests
 */

import { CacheClassifier, cacheClassifier, CacheStrategy, CacheRule } from './ai-cache-classifier';

describe('CacheClassifier', () => {
  let classifier: CacheClassifier;

  beforeEach(() => {
    classifier = new CacheClassifier();
  });

  describe('classify', () => {
    describe('NEVER cache strategy', () => {
      it('should not cache git status commands', () => {
        const commands = [
          'git status',
          'git diff',
          'git log --oneline',
          'git branch -a',
          'git remote -v',
          'git fetch origin',
          'git pull',
          'git push origin main'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.NEVER);
          expect(result.ttl).toBe(0);
          expect(result.reason).toContain('Git');
        });
      });

      it('should not cache directory listings', () => {
        const result = classifier.classify('ls -la');
        expect(result.strategy).toBe(CacheStrategy.NEVER);
        expect(result.reason).toContain('Directory listings');
      });

      it('should not cache docker status commands', () => {
        const commands = [
          'docker ps',
          'docker stats',
          'docker logs container',
          'docker events',
          'docker top container'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.NEVER);
          expect(result.reason).toContain('Docker');
        });
      });

      it('should not cache process monitoring commands', () => {
        const commands = ['ps aux', 'top', 'htop', 'btop'];
        
        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.NEVER);
        });
      });

      it('should not cache system monitoring commands', () => {
        const commands = [
          'df -h',
          'du -sh',
          'free -m',
          'vmstat',
          'iostat',
          'netstat -an',
          'ss -tuln',
          'lsof -i'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.NEVER);
        });
      });

      it('should not cache time-sensitive commands', () => {
        const commands = ['date', 'date +%s', 'uptime'];
        
        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.NEVER);
        });
      });

      it('should not cache log following commands', () => {
        const result = classifier.classify('tail -f /var/log/system.log');
        expect(result.strategy).toBe(CacheStrategy.NEVER);
        expect(result.reason).toContain('Following logs');
      });

      it('should not cache package management queries', () => {
        const commands = [
          'npm ls',
          'npm list --depth=0',
          'npm outdated',
          'yarn list',
          'yarn outdated',
          'pnpm ls',
          'pnpm list',
          'pnpm outdated'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.NEVER);
          expect(result.reason).toContain('Package listings');
        });
      });

      it('should not cache network commands', () => {
        const commands = [
          'ping google.com',
          'curl https://api.example.com',
          'wget https://example.com/file.zip'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.NEVER);
        });
      });

      it('should not cache watch commands', () => {
        const result = classifier.classify('watch df -h');
        expect(result.strategy).toBe(CacheStrategy.NEVER);
        expect(result.reason).toContain('Watch commands');
      });

      it('should not cache find commands', () => {
        const result = classifier.classify('find . -name "*.js"');
        expect(result.strategy).toBe(CacheStrategy.NEVER);
        expect(result.reason).toContain('File searches');
      });

      it('should not cache journalctl', () => {
        const result = classifier.classify('journalctl -xe');
        expect(result.strategy).toBe(CacheStrategy.NEVER);
        expect(result.reason).toContain('System logs');
      });
    });

    describe('SHORT cache strategy', () => {
      it('should use short cache for pwd', () => {
        const result = classifier.classify('pwd');
        expect(result.strategy).toBe(CacheStrategy.SHORT);
        expect(result.ttl).toBe(30000);
        expect(result.reason).toContain('Working directory');
      });

      it('should use short cache for whoami', () => {
        const result = classifier.classify('whoami');
        expect(result.strategy).toBe(CacheStrategy.SHORT);
        expect(result.ttl).toBe(30000);
        expect(result.reason).toContain('User context');
      });

      it('should use short cache for env', () => {
        const commands = ['env', 'env | grep PATH'];
        
        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.SHORT);
          expect(result.ttl).toBe(30000);
        });
      });

      it('should use short cache for which', () => {
        const result = classifier.classify('which node');
        expect(result.strategy).toBe(CacheStrategy.SHORT);
        expect(result.ttl).toBe(30000);
        expect(result.reason).toContain('PATH');
      });
    });

    describe('MEDIUM cache strategy', () => {
      it('should use medium cache for config files', () => {
        const commands = [
          'cat package.json',
          'cat config.yml',
          'cat settings.yaml',
          'cat app.toml',
          'cat config.ini',
          'cat app.conf',
          'cat settings.cfg'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.MEDIUM);
          expect(result.ttl).toBe(300000);
          expect(result.reason).toContain('Config files');
        });
      });

      it('should use medium cache for build commands', () => {
        const commands = [
          'npm run build',
          'npm test',
          'yarn run dev',
          'yarn test',
          'yarn build'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.MEDIUM);
          expect(result.ttl).toBe(300000);
          expect(result.reason).toContain('Build outputs');
        });
      });

      it('should use medium cache for git object commands', () => {
        const commands = [
          'git show HEAD',
          'git rev-parse HEAD',
          'git describe --tags'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.MEDIUM);
          expect(result.ttl).toBe(300000);
          expect(result.reason).toContain('Git object data');
        });
      });

      it('should use medium cache as default for unknown commands', () => {
        const result = classifier.classify('some-unknown-command --flag');
        expect(result.strategy).toBe(CacheStrategy.MEDIUM);
        expect(result.ttl).toBe(300000);
        expect(result.reason).toContain('Default cache strategy');
      });
    });

    describe('LONG cache strategy', () => {
      it('should use long cache for documentation files', () => {
        const commands = [
          'cat README.md',
          'cat notes.txt',
          'cat error.log'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.LONG);
          expect(result.ttl).toBe(1800000); // 30 minutes
          expect(result.reason).toContain('Documentation rarely changes');
        });
      });

      it('should use long cache for head command', () => {
        const result = classifier.classify('head -n 10 file.txt');
        expect(result.strategy).toBe(CacheStrategy.LONG);
        expect(result.reason).toContain('File headers');
      });

      it('should use long cache for file command', () => {
        const result = classifier.classify('file myfile.txt');
        expect(result.strategy).toBe(CacheStrategy.LONG);
        expect(result.reason).toContain('File types');
      });

      it('should use long cache for wc command', () => {
        const result = classifier.classify('wc -l file.txt');
        expect(result.strategy).toBe(CacheStrategy.LONG);
        expect(result.reason).toContain('File stats');
      });

      it('should use long cache for config commands', () => {
        const commands = ['git config --list', 'npm config list'];
        
        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.LONG);
        });
      });
    });

    describe('PERMANENT cache strategy', () => {
      it('should use permanent cache for system info', () => {
        const commands = ['uname -a', 'hostname', 'sw_vers'];
        
        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.PERMANENT);
          expect(result.ttl).toBe(3600000); // 1 hour
        });
      });

      it('should use permanent cache for version commands', () => {
        const commands = [
          'node --version',
          'npm --version',
          'python --version',
          'ruby --version',
          'go version',
          'java --version'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.PERMANENT);
          expect(result.reason).toContain('version is static');
        });
      });

      it('should use permanent cache for help commands', () => {
        const commands = [
          'git --help',
          'npm --help',
          'docker --help',
          'kubectl --help'
        ];

        commands.forEach(cmd => {
          const result = classifier.classify(cmd);
          expect(result.strategy).toBe(CacheStrategy.PERMANENT);
          expect(result.reason).toContain('Help text is static');
        });
      });

      it('should use permanent cache for man pages', () => {
        const result = classifier.classify('man ls');
        expect(result.strategy).toBe(CacheStrategy.PERMANENT);
        expect(result.reason).toContain('Man pages are static');
      });
    });

    it('should handle commands with leading/trailing whitespace', () => {
      const result = classifier.classify('  git status  ');
      expect(result.strategy).toBe(CacheStrategy.NEVER);
    });
  });

  describe('shouldCache', () => {
    it('should return false for NEVER strategy', () => {
      expect(classifier.shouldCache('git status')).toBe(false);
      expect(classifier.shouldCache('ps aux')).toBe(false);
      expect(classifier.shouldCache('date')).toBe(false);
    });

    it('should return true for cacheable commands', () => {
      expect(classifier.shouldCache('pwd')).toBe(true);
      expect(classifier.shouldCache('cat package.json')).toBe(true);
      expect(classifier.shouldCache('node --version')).toBe(true);
      expect(classifier.shouldCache('unknown-command')).toBe(true);
    });
  });

  describe('getTTL', () => {
    it('should return 0 for NEVER cache', () => {
      expect(classifier.getTTL('git status')).toBe(0);
    });

    it('should return 30000 for SHORT cache', () => {
      expect(classifier.getTTL('pwd')).toBe(30000);
    });

    it('should return 300000 for MEDIUM cache', () => {
      expect(classifier.getTTL('cat package.json')).toBe(300000);
    });

    it('should return 1800000 for LONG cache', () => {
      expect(classifier.getTTL('cat README.md')).toBe(1800000);
    });

    it('should return 3600000 for PERMANENT cache', () => {
      expect(classifier.getTTL('node --version')).toBe(3600000);
    });
  });

  describe('addRule', () => {
    it('should add high priority rule at the beginning', () => {
      const customRule: CacheRule = {
        pattern: /^custom-command/,
        strategy: CacheStrategy.NEVER,
        reason: 'Custom rule'
      };

      classifier.addRule(customRule, 'high');
      const result = classifier.classify('custom-command test');
      
      expect(result.strategy).toBe(CacheStrategy.NEVER);
      expect(result.reason).toBe('Custom rule');
    });

    it('should add low priority rule at the end', () => {
      const customRule: CacheRule = {
        pattern: 'exact-match',
        strategy: CacheStrategy.PERMANENT,
        ttl: 7200000,
        reason: 'Custom exact match'
      };

      classifier.addRule(customRule, 'low');
      const result = classifier.classify('exact-match');
      
      expect(result.strategy).toBe(CacheStrategy.PERMANENT);
      expect(result.ttl).toBe(7200000);
      expect(result.reason).toBe('Custom exact match');
    });

    it('should use high priority rule over existing rules', () => {
      const overrideRule: CacheRule = {
        pattern: /^pwd$/,
        strategy: CacheStrategy.NEVER,
        reason: 'Override pwd'
      };

      classifier.addRule(overrideRule, 'high');
      const result = classifier.classify('pwd');
      
      expect(result.strategy).toBe(CacheStrategy.NEVER);
      expect(result.reason).toBe('Override pwd');
    });
  });

  describe('explainClassification', () => {
    it('should explain NEVER cache classification', () => {
      const explanation = classifier.explainClassification('git status');
      expect(explanation).toContain('Command: "git status"');
      expect(explanation).toContain('Strategy: never');
      expect(explanation).toContain('no cache');
      expect(explanation).toContain('Git status commands');
    });

    it('should explain SHORT cache classification', () => {
      const explanation = classifier.explainClassification('pwd');
      expect(explanation).toContain('Command: "pwd"');
      expect(explanation).toContain('Strategy: short');
      expect(explanation).toContain('30s');
      expect(explanation).toContain('Working directory');
    });

    it('should explain MEDIUM cache classification', () => {
      const explanation = classifier.explainClassification('cat package.json');
      expect(explanation).toContain('Command: "cat package.json"');
      expect(explanation).toContain('Strategy: medium');
      expect(explanation).toContain('300s');
      expect(explanation).toContain('Config files');
    });

    it('should explain LONG cache classification', () => {
      const explanation = classifier.explainClassification('cat README.md');
      expect(explanation).toContain('Command: "cat README.md"');
      expect(explanation).toContain('Strategy: long');
      expect(explanation).toContain('1800s');
    });

    it('should explain PERMANENT cache classification', () => {
      const explanation = classifier.explainClassification('node --version');
      expect(explanation).toContain('Command: "node --version"');
      expect(explanation).toContain('Strategy: permanent');
      expect(explanation).toContain('3600s');
      expect(explanation).toContain('Node version is static');
    });

    it('should explain default classification', () => {
      const explanation = classifier.explainClassification('unknown-command');
      expect(explanation).toContain('Command: "unknown-command"');
      expect(explanation).toContain('Strategy: medium');
      expect(explanation).toContain('Default cache strategy');
    });
  });
});

describe('cacheClassifier singleton', () => {
  it('should be an instance of CacheClassifier', () => {
    expect(cacheClassifier).toBeInstanceOf(CacheClassifier);
  });

  it('should classify commands correctly', () => {
    const result = cacheClassifier.classify('git status');
    expect(result.strategy).toBe(CacheStrategy.NEVER);
  });

  it('should determine caching correctly', () => {
    expect(cacheClassifier.shouldCache('ls')).toBe(false);
    expect(cacheClassifier.shouldCache('pwd')).toBe(true);
  });

  it('should get TTL correctly', () => {
    expect(cacheClassifier.getTTL('node --version')).toBe(3600000);
  });

  it('should explain classification correctly', () => {
    const explanation = cacheClassifier.explainClassification('date');
    expect(explanation).toContain('never');
  });
});
