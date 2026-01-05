// Documentation RAG Service
// Provides semantic search over command documentation with curated examples

import { getSemanticSearch } from './semantic-search.js';
import { getLogger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('DocumentationRAGService');

export interface CommandDoc {
  command: string;
  category: string;
  description: string;
  usage: string;
  common_options: CommandOption[];
  examples: CommandExample[];
  related_commands: string[];
  troubleshooting?: TroubleshootingTip[];
}

export interface CommandOption {
  flag: string;
  description: string;
}

export interface CommandExample {
  command: string;
  description: string;
  output_example?: string;
}

export interface TroubleshootingTip {
  issue: string;
  solution: string;
}

export interface DocResult {
  command: string;
  relevance_score: number;
  snippet: string;
  category: string;
  full_doc: CommandDoc;
}

/**
 * Curated Command Documentation
 * Pre-populated with essential commands for shell, git, docker, npm/node
 */
const COMMAND_DOCS: Omit<CommandDoc, 'id'>[] = [
  // Shell Commands
  {
    command: 'cd',
    category: 'shell',
    description: 'Change the current working directory',
    usage: 'cd [directory]',
    common_options: [
      { flag: '-', description: 'Change to previous directory' },
      { flag: '~', description: 'Change to home directory' },
      { flag: '..', description: 'Change to parent directory' },
    ],
    examples: [
      { command: 'cd /path/to/directory', description: 'Change to absolute path' },
      { command: 'cd ~/Documents', description: 'Change to Documents in home directory' },
      { command: 'cd -', description: 'Return to previous directory' },
    ],
    related_commands: ['pwd', 'ls'],
  },
  {
    command: 'ls',
    category: 'shell',
    description: 'List directory contents',
    usage: 'ls [options] [directory]',
    common_options: [
      { flag: '-l', description: 'Long format with details' },
      { flag: '-a', description: 'Show hidden files (starting with .)' },
      { flag: '-h', description: 'Human-readable file sizes' },
      { flag: '-t', description: 'Sort by modification time' },
      { flag: '-r', description: 'Reverse sort order' },
    ],
    examples: [
      { command: 'ls -la', description: 'List all files in long format' },
      { command: 'ls -lh', description: 'List with human-readable sizes' },
      { command: 'ls -lt', description: 'List sorted by modification time' },
    ],
    related_commands: ['cd', 'find', 'tree'],
  },
  {
    command: 'mkdir',
    category: 'shell',
    description: 'Create directories',
    usage: 'mkdir [options] directory...',
    common_options: [
      { flag: '-p', description: 'Create parent directories as needed' },
      { flag: '-m', description: 'Set file permissions' },
    ],
    examples: [
      { command: 'mkdir mydir', description: 'Create a directory' },
      { command: 'mkdir -p path/to/nested/dir', description: 'Create nested directories' },
      { command: 'mkdir dir1 dir2 dir3', description: 'Create multiple directories' },
    ],
    related_commands: ['rmdir', 'rm', 'cd'],
  },
  {
    command: 'rm',
    category: 'shell',
    description: 'Remove files or directories',
    usage: 'rm [options] file...',
    common_options: [
      { flag: '-r', description: 'Remove directories recursively' },
      { flag: '-f', description: 'Force removal without prompting' },
      { flag: '-i', description: 'Prompt before each removal' },
    ],
    examples: [
      { command: 'rm file.txt', description: 'Remove a file' },
      { command: 'rm -rf directory', description: 'Remove directory and contents (use with caution!)' },
      { command: 'rm -i *.txt', description: 'Interactively remove .txt files' },
    ],
    related_commands: ['rmdir', 'mv', 'cp'],
    troubleshooting: [
      { issue: 'Permission denied', solution: 'Use sudo or check file ownership with ls -l' },
      { issue: 'Directory not empty', solution: 'Use rm -r to remove directories recursively' },
    ],
  },
  {
    command: 'cp',
    category: 'shell',
    description: 'Copy files and directories',
    usage: 'cp [options] source destination',
    common_options: [
      { flag: '-r', description: 'Copy directories recursively' },
      { flag: '-i', description: 'Prompt before overwriting' },
      { flag: '-p', description: 'Preserve file attributes' },
      { flag: '-v', description: 'Verbose output' },
    ],
    examples: [
      { command: 'cp file.txt backup.txt', description: 'Copy file' },
      { command: 'cp -r dir1 dir2', description: 'Copy directory recursively' },
      { command: 'cp *.txt backup/', description: 'Copy all .txt files to backup directory' },
    ],
    related_commands: ['mv', 'rsync', 'rm'],
  },
  {
    command: 'mv',
    category: 'shell',
    description: 'Move or rename files and directories',
    usage: 'mv [options] source destination',
    common_options: [
      { flag: '-i', description: 'Prompt before overwriting' },
      { flag: '-n', description: 'Do not overwrite existing files' },
      { flag: '-v', description: 'Verbose output' },
    ],
    examples: [
      { command: 'mv old.txt new.txt', description: 'Rename a file' },
      { command: 'mv file.txt directory/', description: 'Move file to directory' },
      { command: 'mv -i *.txt backup/', description: 'Move all .txt files with confirmation' },
    ],
    related_commands: ['cp', 'rm', 'rename'],
  },
  {
    command: 'grep',
    category: 'shell',
    description: 'Search for patterns in files',
    usage: 'grep [options] pattern [files]',
    common_options: [
      { flag: '-i', description: 'Case-insensitive search' },
      { flag: '-r', description: 'Recursive search in directories' },
      { flag: '-n', description: 'Show line numbers' },
      { flag: '-v', description: 'Invert match (show non-matching lines)' },
      { flag: '-c', description: 'Count matching lines' },
    ],
    examples: [
      { command: 'grep "error" logfile.txt', description: 'Find "error" in file' },
      { command: 'grep -ri "TODO" .', description: 'Recursively search for TODO (case-insensitive)' },
      { command: 'grep -n "function" script.js', description: 'Show line numbers with matches' },
    ],
    related_commands: ['find', 'awk', 'sed'],
  },
  {
    command: 'find',
    category: 'shell',
    description: 'Search for files in directory hierarchy',
    usage: 'find [path] [options] [expression]',
    common_options: [
      { flag: '-name', description: 'Search by filename pattern' },
      { flag: '-type', description: 'Search by file type (f=file, d=directory)' },
      { flag: '-mtime', description: 'Search by modification time' },
      { flag: '-size', description: 'Search by file size' },
    ],
    examples: [
      { command: 'find . -name "*.js"', description: 'Find all JavaScript files' },
      { command: 'find / -type d -name "node_modules"', description: 'Find all node_modules directories' },
      { command: 'find . -mtime -7', description: 'Find files modified in last 7 days' },
    ],
    related_commands: ['grep', 'locate', 'ls'],
  },

  // Git Commands
  {
    command: 'git clone',
    category: 'git',
    description: 'Clone a repository into a new directory',
    usage: 'git clone <repository> [directory]',
    common_options: [
      { flag: '--depth N', description: 'Create shallow clone with N commits' },
      { flag: '--branch', description: 'Clone specific branch' },
      { flag: '--recursive', description: 'Clone with submodules' },
    ],
    examples: [
      { command: 'git clone https://github.com/user/repo.git', description: 'Clone repository' },
      { command: 'git clone --depth 1 repo.git', description: 'Shallow clone (faster)' },
      { command: 'git clone --branch develop repo.git', description: 'Clone specific branch' },
    ],
    related_commands: ['git pull', 'git fetch'],
  },
  {
    command: 'git status',
    category: 'git',
    description: 'Show working tree status',
    usage: 'git status [options]',
    common_options: [
      { flag: '-s', description: 'Short format' },
      { flag: '--branch', description: 'Show branch info' },
    ],
    examples: [
      { command: 'git status', description: 'Show full status' },
      { command: 'git status -s', description: 'Show compact status' },
    ],
    related_commands: ['git diff', 'git log', 'git add'],
  },
  {
    command: 'git add',
    category: 'git',
    description: 'Add file contents to the staging area',
    usage: 'git add [options] <pathspec>...',
    common_options: [
      { flag: '-A', description: 'Add all changes (new, modified, deleted)' },
      { flag: '-p', description: 'Interactively stage patches' },
      { flag: '-u', description: 'Add modified and deleted files only' },
    ],
    examples: [
      { command: 'git add file.txt', description: 'Stage specific file' },
      { command: 'git add .', description: 'Stage all changes in current directory' },
      { command: 'git add -A', description: 'Stage all changes in repository' },
    ],
    related_commands: ['git commit', 'git status', 'git reset'],
  },
  {
    command: 'git commit',
    category: 'git',
    description: 'Record changes to the repository',
    usage: 'git commit [options]',
    common_options: [
      { flag: '-m', description: 'Commit message' },
      { flag: '-a', description: 'Automatically stage modified files' },
      { flag: '--amend', description: 'Amend previous commit' },
    ],
    examples: [
      { command: 'git commit -m "Add feature"', description: 'Commit with message' },
      { command: 'git commit -am "Fix bug"', description: 'Stage and commit modified files' },
      { command: 'git commit --amend', description: 'Amend last commit' },
    ],
    related_commands: ['git add', 'git push', 'git log'],
  },
  {
    command: 'git push',
    category: 'git',
    description: 'Update remote refs and objects',
    usage: 'git push [options] [repository] [refspec]',
    common_options: [
      { flag: '-u', description: 'Set upstream branch' },
      { flag: '--force', description: 'Force push (use with caution!)' },
      { flag: '--tags', description: 'Push tags' },
    ],
    examples: [
      { command: 'git push', description: 'Push to default remote' },
      { command: 'git push -u origin main', description: 'Push and set upstream' },
      { command: 'git push --force', description: 'Force push (overwrites remote)' },
    ],
    related_commands: ['git pull', 'git fetch', 'git commit'],
    troubleshooting: [
      { issue: 'Updates were rejected', solution: 'Pull changes first with git pull, then push' },
      { issue: 'Permission denied', solution: 'Check SSH keys or authentication' },
    ],
  },
  {
    command: 'git pull',
    category: 'git',
    description: 'Fetch and merge from remote repository',
    usage: 'git pull [options] [repository] [refspec]',
    common_options: [
      { flag: '--rebase', description: 'Rebase instead of merge' },
      { flag: '--no-commit', description: 'Fetch and merge but don\'t commit' },
    ],
    examples: [
      { command: 'git pull', description: 'Pull from default remote' },
      { command: 'git pull --rebase', description: 'Pull and rebase changes' },
      { command: 'git pull origin main', description: 'Pull specific branch' },
    ],
    related_commands: ['git fetch', 'git merge', 'git push'],
  },

  // Docker Commands
  {
    command: 'docker run',
    category: 'docker',
    description: 'Run a command in a new container',
    usage: 'docker run [options] image [command]',
    common_options: [
      { flag: '-d', description: 'Run in detached mode' },
      { flag: '-p', description: 'Publish container port to host' },
      { flag: '--name', description: 'Assign name to container' },
      { flag: '-v', description: 'Mount volume' },
      { flag: '-e', description: 'Set environment variable' },
      { flag: '--rm', description: 'Remove container after exit' },
    ],
    examples: [
      { command: 'docker run -d -p 80:80 nginx', description: 'Run nginx in background on port 80' },
      { command: 'docker run --rm node:18 node --version', description: 'Run node command and remove container' },
      { command: 'docker run -it ubuntu bash', description: 'Run interactive bash in Ubuntu' },
    ],
    related_commands: ['docker ps', 'docker stop', 'docker exec'],
  },
  {
    command: 'docker ps',
    category: 'docker',
    description: 'List containers',
    usage: 'docker ps [options]',
    common_options: [
      { flag: '-a', description: 'Show all containers (including stopped)' },
      { flag: '-q', description: 'Only show container IDs' },
      { flag: '--filter', description: 'Filter output' },
    ],
    examples: [
      { command: 'docker ps', description: 'List running containers' },
      { command: 'docker ps -a', description: 'List all containers' },
      { command: 'docker ps -q', description: 'List container IDs only' },
    ],
    related_commands: ['docker run', 'docker stop', 'docker rm'],
  },
  {
    command: 'docker build',
    category: 'docker',
    description: 'Build image from Dockerfile',
    usage: 'docker build [options] path',
    common_options: [
      { flag: '-t', description: 'Tag the image' },
      { flag: '-f', description: 'Specify Dockerfile location' },
      { flag: '--no-cache', description: 'Build without cache' },
    ],
    examples: [
      { command: 'docker build -t myapp:latest .', description: 'Build and tag image' },
      { command: 'docker build -f Dockerfile.prod -t myapp:prod .', description: 'Build with custom Dockerfile' },
    ],
    related_commands: ['docker run', 'docker images', 'docker push'],
  },

  // NPM Commands
  {
    command: 'npm install',
    category: 'npm',
    description: 'Install package dependencies',
    usage: 'npm install [package]',
    common_options: [
      { flag: '--save', description: 'Add to dependencies' },
      { flag: '--save-dev', description: 'Add to devDependencies' },
      { flag: '-g', description: 'Install globally' },
      { flag: '--production', description: 'Install production dependencies only' },
    ],
    examples: [
      { command: 'npm install', description: 'Install all dependencies from package.json' },
      { command: 'npm install express', description: 'Install express package' },
      { command: 'npm install -g typescript', description: 'Install TypeScript globally' },
    ],
    related_commands: ['npm start', 'npm test', 'npm run'],
  },
  {
    command: 'npm start',
    category: 'npm',
    description: 'Run the start script',
    usage: 'npm start',
    common_options: [],
    examples: [
      { command: 'npm start', description: 'Run application start script' },
    ],
    related_commands: ['npm run', 'npm test', 'npm build'],
  },
  {
    command: 'npm test',
    category: 'npm',
    description: 'Run test script',
    usage: 'npm test',
    common_options: [],
    examples: [
      { command: 'npm test', description: 'Run all tests' },
      { command: 'npm test -- --coverage', description: 'Run tests with coverage' },
    ],
    related_commands: ['npm run', 'npm start'],
  },
];

/**
 * Documentation RAG Service
 * Provides semantic search over curated command documentation
 * FAIL-FAST: All operations throw on error
 */
export class DocumentationRAGService {
  private semanticSearch = getSemanticSearch();
  private initialized = false;
  private documentCount = 0;

  /**
   * Initialize documentation service and index all docs
   * FAIL-FAST: Throws if indexing fails
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('Documentation RAG service already initialized');
      return;
    }

    try {
      const startTime = Date.now();

      // Prepare documentation documents for indexing
      const docDocuments = COMMAND_DOCS.flatMap(doc => {
        const chunks: any[] = [];

        // Main document chunk
        chunks.push({
          id: `doc-${uuidv4()}`,
          content: `${doc.command}: ${doc.description}. Usage: ${doc.usage}. Category: ${doc.category}`,
          metadata: {
            command: doc.command,
            category: doc.category,
            section: 'overview',
            full_doc: JSON.stringify(doc),
          },
        });

        // Examples chunk
        if (doc.examples.length > 0) {
          const exampleText = doc.examples
            .map(ex => `${ex.command}: ${ex.description}`)
            .join('. ');
          chunks.push({
            id: `doc-${uuidv4()}`,
            content: `${doc.command} examples: ${exampleText}`,
            metadata: {
              command: doc.command,
              category: doc.category,
              section: 'examples',
              full_doc: JSON.stringify(doc),
            },
          });
        }

        // Options chunk
        if (doc.common_options.length > 0) {
          const optionsText = doc.common_options
            .map(opt => `${opt.flag}: ${opt.description}`)
            .join('. ');
          chunks.push({
            id: `doc-${uuidv4()}`,
            content: `${doc.command} options: ${optionsText}`,
            metadata: {
              command: doc.command,
              category: doc.category,
              section: 'options',
              full_doc: JSON.stringify(doc),
            },
          });
        }

        return chunks;
      });

      // Batch index all documentation
      await this.semanticSearch.indexBatch(docDocuments, {
        excludeCheck: true, // Allow indexing documentation
      });

      this.documentCount = COMMAND_DOCS.length;
      const duration = Date.now() - startTime;
      this.initialized = true;

      logger.info('Documentation RAG service initialized', {
        commandCount: this.documentCount,
        chunkCount: docDocuments.length,
        duration,
      });
    } catch (error: any) {
      logger.error('FATAL: Failed to initialize documentation RAG service', {
        error: error.message,
      });
      throw new Error(`FATAL: Documentation RAG initialization failed: ${error.message}`);
    }
  }

  /**
   * Search documentation semantically
   * FAIL-FAST: Throws if search fails
   */
  public async searchDocumentation(
    query: string,
    options?: {
      limit?: number;
      minSimilarity?: number;
      commandFilter?: string;
    }
  ): Promise<DocResult[]> {
    if (!this.initialized) {
      throw new Error('FATAL: Documentation RAG service not initialized');
    }

    try {
      const results = await this.semanticSearch.search(query, {
        limit: (options?.limit || 5) * 3, // Get more for filtering
        minSimilarity: options?.minSimilarity || 0.3, // Lowered for query/document inputType difference
      });

      // Group by command and take best result per command
      const commandResults = new Map<string, any>();
      for (const result of results) {
        const command = result.metadata.command as string;
        if (options?.commandFilter && command !== options.commandFilter) {
          continue;
        }

        if (!commandResults.has(command) || result.similarity > commandResults.get(command).similarity) {
          commandResults.set(command, result);
        }
      }

      // Convert to doc results
      const docResults: DocResult[] = Array.from(commandResults.values())
        .slice(0, options?.limit || 5)
        .map(result => {
          const fullDoc = JSON.parse(result.metadata.full_doc as string);
          return {
            command: result.metadata.command as string,
            relevance_score: result.similarity,
            snippet: result.content.substring(0, 200),
            category: result.metadata.category as string,
            full_doc: fullDoc,
          };
        });

      logger.debug('Documentation search completed', {
        query: query.substring(0, 50),
        resultsFound: docResults.length,
      });

      return docResults;
    } catch (error: any) {
      logger.error('FATAL: Failed to search documentation', {
        query: query.substring(0, 50),
        error: error.message,
      });
      throw new Error(`FATAL: Documentation search failed: ${error.message}`);
    }
  }

  /**
   * Get documentation for specific command
   */
  public async getCommandDocs(command: string): Promise<CommandDoc | null> {
    const doc = COMMAND_DOCS.find(d => d.command === command);
    return doc || null;
  }

  /**
   * Get documentation statistics
   */
  public getStats() {
    return {
      initialized: this.initialized,
      commandCount: this.documentCount,
      categories: [...new Set(COMMAND_DOCS.map(d => d.category))],
    };
  }
}

// Singleton instance
let documentationRAGServiceInstance: DocumentationRAGService | null = null;

/**
 * Get the singleton documentation RAG service instance
 */
export function getDocumentationRAGService(): DocumentationRAGService {
  if (!documentationRAGServiceInstance) {
    documentationRAGServiceInstance = new DocumentationRAGService();
  }
  return documentationRAGServiceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetDocumentationRAGService(): void {
  documentationRAGServiceInstance = null;
}
