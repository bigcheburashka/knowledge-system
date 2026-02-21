/**
 * Unified Audit Logger
 * Centralized audit trail for all Evolution operations
 */

const fs = require('fs').promises;
const path = require('path');

class AuditLogger {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge';
    this.auditLogPath = path.join(this.basePath, 'logs', 'audit.log');
    this.rotationSize = options.rotationSize || 100 * 1024 * 1024; // 100MB (was 10MB)
  }

  async init() {
    const dir = path.dirname(this.auditLogPath);
    
    // Create directory if needed
    await fs.mkdir(dir, { recursive: true });
    
    // Check write permissions
    const testFile = path.join(dir, '.write-test');
    try {
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      console.log('[AuditLogger] Write permissions OK');
    } catch (err) {
      console.error('[AuditLogger] CRITICAL: No write permissions to', dir);
      console.error('[AuditLogger] Error:', err.message);
      throw new Error(`Audit log directory not writable: ${dir}`);
    }
    
    // Check disk space
    const spaceCheck = await this.checkDiskSpace(dir);
    if (!spaceCheck.ok) {
      console.warn(`[AuditLogger] WARNING: Low disk space: ${spaceCheck.availableMB}MB available`);
    }
  }
  
  /**
   * Check available disk space
   */
  async checkDiskSpace(dir) {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`df -BM "${dir}" | tail -1`, { encoding: 'utf8' });
      const parts = output.trim().split(/\s+/);
      const availableMB = parseInt(parts[3].replace('M', ''));
      
      return {
        ok: availableMB > 100, // At least 100MB
        availableMB,
        threshold: 100
      };
    } catch {
      return { ok: true, availableMB: 'unknown' }; // Assume OK if check fails
    }
  }

  /**
   * Log an audit event
   */
  async log(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...event
    };
    
    // Check rotation
    await this.checkRotation();
    
    // Append to log
    await fs.appendFile(
      this.auditLogPath,
      JSON.stringify(entry) + '\n'
    );
    
    return entry;
  }

  /**
   * Log proposal creation
   */
  async logProposal(proposal) {
    return this.log({
      type: 'PROPOSAL_CREATED',
      proposalId: proposal.id,
      level: proposal.level,
      changeType: proposal.type,
      reason: proposal.change?.reason
    });
  }

  /**
   * Log approval
   */
  async logApproval(proposalId, approver, level) {
    return this.log({
      type: 'PROPOSAL_APPROVED',
      proposalId,
      approver,
      level
    });
  }

  /**
   * Log rejection
   */
  async logRejection(proposalId, reason, rejector) {
    return this.log({
      type: 'PROPOSAL_REJECTED',
      proposalId,
      reason,
      rejector
    });
  }

  /**
   * Log change application
   */
  async logChangeApplied(proposalId, changeType, result) {
    return this.log({
      type: 'CHANGE_APPLIED',
      proposalId,
      changeType,
      success: result.success,
      path: result.path
    });
  }

  /**
   * Log skill creation
   */
  async logSkillCreated(skillName, proposalId) {
    return this.log({
      type: 'SKILL_CREATED',
      skillName,
      proposalId
    });
  }

  /**
   * Log config update
   */
  async logConfigUpdated(settings, proposalId) {
    return this.log({
      type: 'CONFIG_UPDATED',
      settings: Object.keys(settings),
      proposalId
    });
  }

  /**
   * Log sync operation
   */
  async logSync(system, operation, result) {
    return this.log({
      type: 'SYNC_OPERATION',
      system,
      operation,
      result
    });
  }

  /**
   * Query audit log
   */
  async query(filters = {}) {
    try {
      const content = await fs.readFile(this.auditLogPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      let entries = lines.map(line => JSON.parse(line));
      
      if (filters.type) {
        entries = entries.filter(e => e.type === filters.type);
      }
      
      if (filters.since) {
        const since = new Date(filters.since);
        entries = entries.filter(e => new Date(e.timestamp) >= since);
      }
      
      if (filters.proposalId) {
        entries = entries.filter(e => e.proposalId === filters.proposalId);
      }
      
      return entries.slice(-(filters.limit || 1000));
    } catch {
      return [];
    }
  }

  /**
   * Get audit trail for specific proposal
   */
  async getProposalTrail(proposalId) {
    return this.query({ proposalId });
  }

  /**
   * Check rotation and rotate if needed
   */
  async checkRotation() {
    try {
      const stats = await fs.stat(this.auditLogPath);
      if (stats.size > this.rotationSize) {
        await this.rotate();
      }
    } catch {
      // File doesn't exist yet
    }
  }

  /**
   * Rotate audit log
   */
  async rotate() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${this.auditLogPath}.${timestamp}`;
    
    await fs.rename(this.auditLogPath, rotatedPath);
    console.log(`[AuditLogger] Rotated to ${rotatedPath}`);
  }

  /**
   * Cleanup old rotated logs
   */
  async cleanup(maxAgeDays = 90) {
    const dir = path.dirname(this.auditLogPath);
    const files = await fs.readdir(dir);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    
    let cleaned = 0;
    for (const file of files) {
      if (file.startsWith('audit.log.')) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtimeMs < cutoff) {
          await fs.unlink(filePath);
          cleaned++;
        }
      }
    }
    
    return { cleaned };
  }
}

module.exports = { AuditLogger };
