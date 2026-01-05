// Error Knowledge Base
// Pre-populated database of common shell errors with solutions

import { getSemanticSearch } from './semantic-search.js';
import { getLogger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('ErrorKnowledgeBase');

export interface ErrorPattern {
  id: string;
  error: string;
  category: string;
  solution: string;
  examples: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Common shell/tool errors with solutions
 * FAIL-FAST: Initialization throws if embedding fails
 */
const COMMON_ERRORS: Omit<ErrorPattern, 'id'>[] = [
  // Permission Errors
  {
    error: 'Permission denied',
    category: 'permissions',
    solution: 'Check file/directory permissions with `ls -la`. Use `chmod` to fix permissions or run with appropriate privileges (sudo if needed).',
    examples: [
      'bash: ./script.sh: Permission denied',
      'mkdir: cannot create directory: Permission denied',
      'cp: cannot create regular file: Permission denied',
    ],
    severity: 'high',
  },
  {
    error: 'Operation not permitted',
    category: 'permissions',
    solution: 'Requires elevated privileges. Use `sudo` or check if System Integrity Protection (SIP) is blocking the operation on macOS.',
    examples: [
      'rm: cannot remove: Operation not permitted',
      'chown: changing ownership: Operation not permitted',
    ],
    severity: 'high',
  },

  // File/Directory Not Found
  {
    error: 'No such file or directory',
    category: 'filesystem',
    solution: 'Verify the path exists with `ls` or `find`. Check for typos in the path. Use absolute paths or ensure you\'re in the correct working directory.',
    examples: [
      'cat: file.txt: No such file or directory',
      'cd: /nonexistent: No such file or directory',
      'bash: ./script.sh: No such file or directory',
    ],
    severity: 'medium',
  },
  {
    error: 'command not found',
    category: 'path',
    solution: 'The command is not in your PATH. Install the missing package (brew install, apt install, etc.) or add the directory to PATH. Check spelling.',
    examples: [
      'bash: kubectl: command not found',
      'zsh: command not found: docker',
      'command not found: npm',
    ],
    severity: 'medium',
  },

  // npm/node Errors
  {
    error: 'EACCES: permission denied',
    category: 'npm',
    solution: 'Fix npm permissions by changing npm\'s default directory: `mkdir ~/.npm-global && npm config set prefix \'~/.npm-global\'`. Then add `~/.npm-global/bin` to PATH.',
    examples: [
      'npm ERR! code EACCES',
      'npm ERR! EACCES: permission denied, access \'/usr/local/lib/node_modules\'',
    ],
    severity: 'high',
  },
  {
    error: 'MODULE_NOT_FOUND',
    category: 'npm',
    solution: 'Missing node module. Run `npm install` to install dependencies, or `npm install <package-name>` for specific package. Check package.json.',
    examples: [
      'Error: Cannot find module \'express\'',
      'MODULE_NOT_FOUND',
    ],
    severity: 'medium',
  },
  {
    error: 'EADDRINUSE',
    category: 'npm',
    solution: 'Port already in use. Find process using the port: `lsof -ti:<port>` then kill it: `kill -9 <pid>`. Or use a different port.',
    examples: [
      'Error: listen EADDRINUSE: address already in use :::3000',
      'EADDRINUSE: address already in use 127.0.0.1:8080',
    ],
    severity: 'medium',
  },

  // Docker Errors
  {
    error: 'Cannot connect to the Docker daemon',
    category: 'docker',
    solution: 'Docker daemon is not running. Start Docker Desktop on macOS or run `sudo systemctl start docker` on Linux.',
    examples: [
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
      'docker: Cannot connect to the Docker daemon',
    ],
    severity: 'high',
  },
  {
    error: 'docker: Error response from daemon: pull access denied',
    category: 'docker',
    solution: 'Image not found or access denied. Check image name/tag spelling. Login with `docker login` if it\'s a private image.',
    examples: [
      'pull access denied for myimage, repository does not exist',
    ],
    severity: 'medium',
  },
  {
    error: 'docker: no space left on device',
    category: 'docker',
    solution: 'Docker disk space exhausted. Clean up with `docker system prune -a` to remove unused images/containers.',
    examples: [
      'write /var/lib/docker: no space left on device',
    ],
    severity: 'critical',
  },

  // Git Errors
  {
    error: 'fatal: not a git repository',
    category: 'git',
    solution: 'Not inside a git repository. Initialize with `git init` or navigate to a git repository directory.',
    examples: [
      'fatal: not a git repository (or any of the parent directories): .git',
    ],
    severity: 'medium',
  },
  {
    error: 'fatal: remote origin already exists',
    category: 'git',
    solution: 'Remote already configured. View remotes with `git remote -v`. Remove with `git remote remove origin` or use `git remote set-url origin <url>`.',
    examples: [
      'fatal: remote origin already exists',
    ],
    severity: 'low',
  },
  {
    error: 'error: failed to push some refs',
    category: 'git',
    solution: 'Remote has changes not in your local. Pull first with `git pull origin <branch>` then push. Or force push with `git push -f` (careful!).',
    examples: [
      'error: failed to push some refs to \'https://github.com/user/repo.git\'',
      'Updates were rejected because the remote contains work that you do not have locally',
    ],
    severity: 'medium',
  },
  {
    error: 'CONFLICT (content): Merge conflict',
    category: 'git',
    solution: 'Manual merge required. Open conflicted files, resolve conflicts between <<<<<<< and >>>>>>>, then `git add <file>` and `git commit`.',
    examples: [
      'CONFLICT (content): Merge conflict in file.txt',
      'Automatic merge failed; fix conflicts and then commit the result',
    ],
    severity: 'high',
  },

  // Kubernetes/kubectl Errors
  {
    error: 'The connection to the server was refused',
    category: 'kubernetes',
    solution: 'Cannot reach Kubernetes API server. Check if cluster is running, verify kubeconfig with `kubectl config view`, and ensure correct context with `kubectl config use-context <name>`.',
    examples: [
      'The connection to the server localhost:8080 was refused',
      'Unable to connect to the server: dial tcp: connect: connection refused',
    ],
    severity: 'high',
  },
  {
    error: 'Error from server (NotFound): pods not found',
    category: 'kubernetes',
    solution: 'Resource doesn\'t exist. Check resource name and namespace. List resources with `kubectl get <resource> -A` (all namespaces).',
    examples: [
      'Error from server (NotFound): pods "my-pod" not found',
    ],
    severity: 'medium',
  },
  {
    error: 'Error from server (Forbidden): pods is forbidden',
    category: 'kubernetes',
    solution: 'Insufficient RBAC permissions. Check your role/rolebindings with `kubectl auth can-i <verb> <resource>`. Contact cluster admin for permissions.',
    examples: [
      'Error from server (Forbidden): pods is forbidden: User "user@example.com" cannot list resource "pods"',
    ],
    severity: 'high',
  },

  // Python Errors
  {
    error: 'ModuleNotFoundError: No module named',
    category: 'python',
    solution: 'Missing Python package. Install with `pip install <package>` or `pip3 install <package>`. Check if you\'re in the correct virtual environment.',
    examples: [
      'ModuleNotFoundError: No module named \'requests\'',
      'ImportError: No module named flask',
    ],
    severity: 'medium',
  },
  {
    error: 'SyntaxError: invalid syntax',
    category: 'python',
    solution: 'Python syntax error. Check line number in error message. Common causes: missing colons, incorrect indentation, mismatched parentheses/brackets.',
    examples: [
      'SyntaxError: invalid syntax',
      'IndentationError: unexpected indent',
    ],
    severity: 'high',
  },

  // SSH Errors
  {
    error: 'Permission denied (publickey)',
    category: 'ssh',
    solution: 'SSH key authentication failed. Check if public key is in ~/.ssh/authorized_keys on remote. Verify private key with `ssh-add -l`. Generate new key with `ssh-keygen` if needed.',
    examples: [
      'Permission denied (publickey)',
      'Permission denied (publickey,gssapi-keyex,gssapi-with-mic)',
    ],
    severity: 'high',
  },
  {
    error: 'Connection refused',
    category: 'ssh',
    solution: 'Cannot connect to SSH server. Verify server is running (`sudo systemctl status sshd`), check firewall rules, confirm correct hostname/IP and port (default 22).',
    examples: [
      'ssh: connect to host example.com port 22: Connection refused',
    ],
    severity: 'high',
  },

  // Disk Space Errors
  {
    error: 'No space left on device',
    category: 'filesystem',
    solution: 'Disk full. Check disk usage with `df -h` and find large files/directories with `du -h --max-depth=1 | sort -hr`. Clean up unnecessary files or expand disk.',
    examples: [
      'No space left on device',
      'write error: No space left on device',
    ],
    severity: 'critical',
  },

  // Build/Compile Errors
  {
    error: 'gcc: command not found',
    category: 'build',
    solution: 'C compiler not installed. On macOS: `xcode-select --install`. On Linux: `sudo apt install build-essential` (Ubuntu/Debian) or `sudo yum groupinstall "Development Tools"` (RHEL/CentOS).',
    examples: [
      'gcc: command not found',
      'make: gcc: Command not found',
    ],
    severity: 'high',
  },
];

/**
 * Error Knowledge Base Service
 * Pre-populates vector database with common errors and solutions
 * FAIL-FAST: Initialization throws if embedding fails
 */
export class ErrorKnowledgeBase {
  private semanticSearch = getSemanticSearch();
  private initialized = false;

  /**
   * Initialize the error knowledge base
   * Indexes all common errors with embeddings
   * FAIL-FAST: Throws if indexing fails
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('Error knowledge base already initialized');
      return;
    }

    try {
      const startTime = Date.now();

      // Prepare error documents for indexing
      const errorDocuments = COMMON_ERRORS.map(error => {
        const id = `error-${uuidv4()}`;

        // Build searchable content from error + examples
        const searchableContent = [
          error.error,
          ...error.examples,
          `category: ${error.category}`,
        ].join(' ');

        return {
          id,
          content: searchableContent,
          metadata: {
            error: error.error,
            category: error.category,
            solution: error.solution,
            severity: error.severity,
            examples: JSON.stringify(error.examples),
          },
        };
      });

      // Batch index all errors
      await this.semanticSearch.indexBatch(errorDocuments, {
        excludeCheck: true, // Allow indexing error messages
      });

      const duration = Date.now() - startTime;
      this.initialized = true;

      logger.info('Error knowledge base initialized', {
        errorCount: COMMON_ERRORS.length,
        duration,
      });
    } catch (error: any) {
      logger.error('FATAL: Failed to initialize error knowledge base', {
        error: error.message,
      });
      throw new Error(`FATAL: Error knowledge base initialization failed: ${error.message}`);
    }
  }

  /**
   * Find similar errors from the knowledge base
   * FAIL-FAST: Throws if search fails
   */
  public async findSimilarErrors(
    errorMessage: string,
    options?: {
      limit?: number;
      minSimilarity?: number;
    }
  ): Promise<ErrorPattern[]> {
    if (!this.initialized) {
      throw new Error('FATAL: Error knowledge base not initialized. Call initialize() first.');
    }

    try {
      const results = await this.semanticSearch.search(errorMessage, {
        limit: options?.limit || 3,
        minSimilarity: options?.minSimilarity || 0.6, // 60% similarity threshold
      });

      // Convert to error patterns
      const errors: ErrorPattern[] = results.map(result => ({
        id: result.id,
        error: result.metadata.error as string,
        category: result.metadata.category as string,
        solution: result.metadata.solution as string,
        examples: JSON.parse(result.metadata.examples as string),
        severity: result.metadata.severity as ErrorPattern['severity'],
      }));

      logger.debug('Similar errors found', {
        query: errorMessage.substring(0, 50),
        matchesFound: errors.length,
      });

      return errors;
    } catch (error: any) {
      logger.error('FATAL: Failed to find similar errors', {
        query: errorMessage.substring(0, 50),
        error: error.message,
      });
      throw new Error(`FATAL: Error search failed: ${error.message}`);
    }
  }

  /**
   * Get error statistics
   */
  public getStats() {
    return {
      errorCount: COMMON_ERRORS.length,
      categories: [...new Set(COMMON_ERRORS.map(e => e.category))],
      initialized: this.initialized,
    };
  }
}

// Singleton instance
let errorKnowledgeBaseInstance: ErrorKnowledgeBase | null = null;

/**
 * Get the singleton error knowledge base instance
 */
export function getErrorKnowledgeBase(): ErrorKnowledgeBase {
  if (!errorKnowledgeBaseInstance) {
    errorKnowledgeBaseInstance = new ErrorKnowledgeBase();
  }
  return errorKnowledgeBaseInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetErrorKnowledgeBase(): void {
  errorKnowledgeBaseInstance = null;
}
