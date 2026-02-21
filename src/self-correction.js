/**
 * Self-Correction Module
 * Learns from errors and proposes/auto-applies fixes
 */

const fs = require('fs').promises;
const path = require('path');

class SelfCorrection {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge';
    this.errorPatternsPath = path.join(this.basePath, 'error-patterns.json');
    this.patterns = new Map();
    this.autoFixThreshold = options.autoFixThreshold || 0.9;
    this.proposeThreshold = options.proposeThreshold || 0.7;
  }

  async init() {
    await this.loadPatterns();
    console.log('[SelfCorrection] Initialized with', this.patterns.size, 'patterns');
  }

  /**
   * Load known error patterns
   */
  async loadPatterns() {
    try {
      const content = await fs.readFile(this.errorPatternsPath, 'utf8');
      const data = JSON.parse(content);
      this.patterns = new Map(Object.entries(data.patterns || {}));
    } catch {
      this.patterns = new Map();
    }
  }

  /**
   * Save error patterns
   */
  async savePatterns() {
    const data = {
      updatedAt: new Date().toISOString(),
      patterns: Object.fromEntries(this.patterns)
    };
    
    await fs.writeFile(
      this.errorPatternsPath,
      JSON.stringify(data, null, 2)
    );
  }

  /**
   * Analyze error and find/propose fix
   */
  async analyzeError(error, context = {}) {
    const errorSignature = this.createSignature(error);
    
    // Check if we've seen this before
    const existing = this.patterns.get(errorSignature);
    
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = new Date().toISOString();
      
      // If we've fixed it before, propose the same fix
      if (existing.fix && existing.fixSuccessRate > 0.8) {
        return {
          action: 'propose_fix',
          confidence: existing.fixSuccessRate,
          fix: existing.fix,
          reason: `This error occurred ${existing.occurrences} times before. Fix worked ${(existing.fixSuccessRate * 100).toFixed(0)}% of times.`,
          autoApply: existing.fixSuccessRate >= this.autoFixThreshold
        };
      }
    }
    
    // New error - analyze and try to find pattern
    const analysis = await this.analyzeNewError(error, context);
    
    // Store new pattern
    this.patterns.set(errorSignature, {
      signature: errorSignature,
      error: error.message || error,
      occurrences: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      analysis,
      fix: null,
      fixSuccessRate: 0,
      fixAttempts: 0
    });
    
    await this.savePatterns();
    
    return {
      action: 'analyze',
      confidence: analysis.confidence,
      suggestion: analysis.suggestion,
      reason: 'New error pattern detected. Analysis provided.'
    };
  }

  /**
   * Create signature from error
   */
  createSignature(error) {
    const message = (error.message || String(error)).toLowerCase();
    
    // Normalize: remove specific values, keep structure
    return message
      .replace(/['"`][a-z0-9_-]+['"`]/g, '"VAR"')     // String values
      .replace(/\d+/g, 'N')                           // Numbers
      .replace(/[a-f0-9]{8,}/gi, 'ID')               // IDs/hashes
      .replace(/\s+/g, ' ')                           // Normalize spaces
      .trim()
      .substring(0, 200);
  }

  /**
   * Analyze new error type
   */
  async analyzeNewError(error, context) {
    const message = error.message || String(error);
    const suggestions = [];
    let confidence = 0.5;
    
    // Pattern-based analysis
    if (message.includes('Cannot find module') || message.includes('require(')) {
      suggestions.push('Check import/require path');
      suggestions.push('Verify file exists');
      suggestions.push('Check for circular dependencies');
      confidence = 0.8;
    }
    
    if (message.includes('ENOENT') || message.includes('no such file')) {
      suggestions.push('Verify file path exists');
      suggestions.push('Check permissions');
      suggestions.push('Create directory if missing');
      confidence = 0.85;
    }
    
    if (message.includes('SyntaxError') || message.includes('Unexpected token')) {
      suggestions.push('Check for missing quotes/brackets');
      suggestions.push('Verify JSON syntax');
      suggestions.push('Check for unescaped characters');
      confidence = 0.9;
    }
    
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      suggestions.push('Increase timeout value');
      suggestions.push('Check network connectivity');
      suggestions.push('Add retry logic');
      confidence = 0.75;
    }
    
    if (message.includes('EACCES') || message.includes('permission denied')) {
      suggestions.push('Check file permissions');
      suggestions.push('Run with appropriate privileges');
      suggestions.push('Verify ownership');
      confidence = 0.8;
    }
    
    if (message.includes('ECONNREFUSED') || message.includes('Connection refused')) {
      suggestions.push('Verify service is running');
      suggestions.push('Check port configuration');
      suggestions.push('Check firewall rules');
      confidence = 0.85;
    }
    
    // Context-based suggestions
    if (context.component) {
      suggestions.push(`Review ${context.component} configuration`);
    }
    
    if (context.recentChanges) {
      suggestions.push('Review recent changes for regressions');
    }
    
    return {
      confidence,
      suggestion: suggestions[0] || 'Investigate error manually',
      suggestions,
      category: this.categorizeError(message)
    };
  }

  /**
   * Categorize error type
   */
  categorizeError(message) {
    if (message.includes('SyntaxError')) return 'syntax';
    if (message.includes('TypeError')) return 'type';
    if (message.includes('ReferenceError')) return 'reference';
    if (message.includes('ENOENT')) return 'filesystem';
    if (message.includes('ECONN')) return 'network';
    if (message.includes('EACCES')) return 'permission';
    if (message.includes('timeout')) return 'timeout';
    return 'unknown';
  }

  /**
   * Apply fix and track success
   */
  async applyFix(errorSignature, fix) {
    const pattern = this.patterns.get(errorSignature);
    if (!pattern) return false;
    
    pattern.fixAttempts++;
    
    try {
      // Apply the fix (implementation depends on fix type)
      const result = await this.executeFix(fix);
      
      if (result.success) {
        pattern.fix = fix;
        pattern.fixSuccessRate = ((pattern.fixSuccessRate * (pattern.fixAttempts - 1)) + 1) / pattern.fixAttempts;
        
        await this.savePatterns();
        return true;
      } else {
        pattern.fixSuccessRate = (pattern.fixSuccessRate * (pattern.fixAttempts - 1)) / pattern.fixAttempts;
        await this.savePatterns();
        return false;
      }
    } catch (err) {
      pattern.fixSuccessRate = (pattern.fixSuccessRate * (pattern.fixAttempts - 1)) / pattern.fixAttempts;
      await this.savePatterns();
      return false;
    }
  }

  /**
   * Execute fix based on type
   */
  async executeFix(fix) {
    // This would be extended based on fix types
    // For now, just log
    console.log('[SelfCorrection] Executing fix:', fix.type);
    
    switch (fix.type) {
      case 'create_file':
        // Create missing file
        return { success: true };
      case 'create_dir':
        // Create missing directory
        return { success: true };
      case 'fix_permissions':
        // Fix file permissions
        return { success: true };
      case 'restart_service':
        // Restart failed service
        return { success: true };
      default:
        return { success: false, reason: 'Unknown fix type' };
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const patterns = Array.from(this.patterns.values());
    
    return {
      totalPatterns: patterns.length,
      fixedPatterns: patterns.filter(p => p.fix && p.fixSuccessRate > 0.5).length,
      commonErrors: patterns
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 10)
        .map(p => ({
          error: p.error.substring(0, 50),
          occurrences: p.occurrences,
          fixRate: p.fixSuccessRate
        }))
    };
  }
}

module.exports = { SelfCorrection };
