/**
 * Path Resolver
 * Centralized path management for Knowledge System
 */

const path = require('path');

class PathResolver {
  constructor(options = {}) {
    this.baseDir = options.baseDir || '/root/.openclaw/workspace/knowledge-system';
    
    // Define all system paths
    this.paths = {
      // Core system
      core: {
        base: this.baseDir,
        src: path.join(this.baseDir, 'src'),
        config: path.join(this.baseDir, 'config'),
        scripts: path.join(this.baseDir, 'scripts'),
        tests: path.join(this.baseDir, 'tests'),
        systemd: path.join(this.baseDir, 'systemd')
      },
      
      // Evolution system
      evolution: {
        base: path.join(this.baseDir, 'src', 'evolution'),
        queue: path.join(this.baseDir, 'src', 'evolution', 'queue'),
        lib: path.join(this.baseDir, 'lib')
      },
      
      // Data storage
      data: {
        base: '/var/lib/knowledge',
        queue: '/var/lib/knowledge/queue',
        logs: '/var/lib/knowledge/logs',
        audit: '/var/lib/knowledge/logs/audit.log'
      },
      
      // Skills library
      skills: {
        base: path.join(this.baseDir, 'lib'),
        a2a: path.join(this.baseDir, 'lib', 'a2a-agents'),
        fileQueue: path.join(this.baseDir, 'lib', 'a2a-file-queue'),
        orchestrator: path.join(this.baseDir, 'lib', 'a2a-orchestrator'),
        patternDetector: path.join(this.baseDir, 'lib', 'pattern-detector')
      },
      
      // External systems
      external: {
        openclaw: '/root/.openclaw',
        sessions: '/root/.openclaw/agents/main/sessions',
        workspace: '/root/.openclaw/workspace'
      },
      
      // Services
      services: {
        qdrant: process.env.QDRANT_URL || 'http://localhost:6333',
        memgraph: process.env.MEMGRAPH_URL || 'bolt://localhost:7687'
      }
    };
    
    // Module path mappings
    this.modulePaths = {
      // Core modules
      'SelfEvolution': 'src/evolution/index.js',
      'FileMessageQueue': 'src/evolution/queue/file-queue.js',
      'LearningLog': 'src/evolution/learning-log.js',
      'ApprovalManager': 'src/evolution/approval-manager.js',
      'ChangeApplier': 'src/evolution/change-applier.js',
      'PatternDetector': 'lib/pattern-detector/scripts/detector.js',
      'MemgraphSyncWorker': 'src/evolution/memgraph-sync.js',
      'AuditLogger': 'src/evolution/audit-logger.js',
      
      // Active modules
      'IntentDetector': 'src/intent-detector.js',
      'KnowledgeGraphWalker': 'src/knowledge-graph-walker.js',
      'EpisodicMemory': 'src/episodic-memory.js',
      
      // Continuous learning
      'PostLearningExpander': 'src/post-learning-expander.js',
      'QualityBasedExpansion': 'src/quality-expansion.js',
      
      // Infrastructure
      'CircuitBreaker': 'src/circuit-breaker.js',
      'ConfigValidator': 'src/config-validator.js'
    };
  }

  /**
   * Get absolute path
   */
  resolve(...segments) {
    return path.resolve(this.baseDir, ...segments);
  }

  /**
   * Get module path
   */
  getModule(moduleName) {
    const relativePath = this.modulePaths[moduleName];
    if (!relativePath) {
      throw new Error(`Unknown module: ${moduleName}`);
    }
    return path.join(this.baseDir, relativePath);
  }

  /**
   * Get path category
   */
  get(category, ...subPath) {
    const parts = category.split('.');
    let current = this.paths;
    
    for (const part of parts) {
      if (current[part] === undefined) {
        throw new Error(`Unknown path category: ${category}`);
      }
      current = current[part];
    }
    
    if (subPath.length > 0) {
      return path.join(current, ...subPath);
    }
    
    return current;
  }

  /**
   * Check if path exists
   */
  async exists(checkPath) {
    try {
      await require('fs').promises.access(checkPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure directory exists
   */
  async ensureDir(dirPath) {
    const fs = require('fs').promises;
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return true;
    } catch (err) {
      console.error(`[PathResolver] Failed to create directory: ${dirPath}`, err.message);
      return false;
    }
  }

  /**
   * Get all paths for logging/debugging
   */
  getAllPaths() {
    return {
      baseDir: this.baseDir,
      paths: this.paths,
      modules: Object.keys(this.modulePaths)
    };
  }

  /**
   * Validate all critical paths exist
   */
  async validatePaths() {
    const results = {
      valid: [],
      missing: [],
      errors: []
    };
    
    const criticalPaths = [
      this.paths.core.src,
      this.paths.core.scripts,
      this.paths.data.queue,
      this.paths.data.logs
    ];
    
    for (const checkPath of criticalPaths) {
      try {
        await require('fs').promises.access(checkPath);
        results.valid.push(checkPath);
      } catch {
        results.missing.push(checkPath);
        try {
          await this.ensureDir(checkPath);
          results.valid.push(checkPath);
        } catch (err) {
          results.errors.push({ path: checkPath, error: err.message });
        }
      }
    }
    
    return results;
  }

  /**
   * Get relative path from base
   */
  relative(absolutePath) {
    return path.relative(this.baseDir, absolutePath);
  }

  /**
   * Join paths safely
   */
  join(...paths) {
    return path.join(...paths);
  }
}

// Singleton instance
let instance = null;

function getPathResolver(options) {
  if (!instance) {
    instance = new PathResolver(options);
  }
  return instance;
}

module.exports = { PathResolver, getPathResolver };
