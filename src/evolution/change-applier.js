/**
 * Change Applier - Applies approved changes to the system
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { SelfCorrection } = require('../self-correction');

class ChangeApplier {
  constructor(options = {}) {
    this.basePath = options.basePath || '/root/.openclaw/workspace/knowledge-system';
    this.configPath = options.configPath || '/root/.openclaw/workspace/knowledge-system/config';
    // OpenClaw skills path - must match OpenClaw workspace
    this.skillsPath = options.skillsPath || '/root/.openclaw/workspace/skills';
    this.backupPath = options.backupPath || '/var/lib/knowledge/backups';
    this.selfCorrection = null;
  }

  async init() {
    await fs.mkdir(this.backupPath, { recursive: true });
    await fs.mkdir(this.configPath, { recursive: true });
    
    // Initialize Self Correction
    try {
      this.selfCorrection = new SelfCorrection();
      await this.selfCorrection.init();
      console.log('[ChangeApplier] Self Correction initialized');
    } catch (err) {
      console.warn('[ChangeApplier] Self Correction not available:', err.message);
      this.selfCorrection = null;
    }
  }

  /**
   * Apply a change based on its type
   */
  async apply(proposal) {
    const { type, change } = proposal;
    
    console.log(`[ChangeApplier] Applying ${type}:`, proposal.id);
    
    // Create backup before applying (for L3/L4)
    if (proposal.level === 'L3' || proposal.level === 'L4') {
      await this.createBackup(proposal);
    }
    
    try {
      switch (type) {
        case 'config':
          return await this.applyConfig(change);
        case 'new_skill':
          return await this.applyNewSkill(change, proposal);
        case 'update':
          return await this.applyUpdate(change, proposal);
        case 'self_modification':
          return await this.applySelfModification(change, proposal);
        default:
          throw new Error(`Unknown change type: ${type}`);
      }
    } catch (err) {
      // Attempt rollback for L3/L4
      if (proposal.level === 'L3' || proposal.level === 'L4') {
        await this.rollback(proposal);
      }
      
      // Analyze error with Self Correction for potential fixes
      if (this.selfCorrection) {
        try {
          const analysis = await this.selfCorrection.analyzeError(err, {
            component: 'ChangeApplier',
            changeType: type,
            proposalId: proposal.id
          });
          
          if (analysis.action === 'propose_fix' && analysis.autoApply) {
            console.log(`[ChangeApplier] Auto-applying fix for error: ${analysis.reason}`);
            await this.selfCorrection.applyFix(analysis.fix);
            
            // Retry the operation once after fix
            console.log('[ChangeApplier] Retrying after auto-fix...');
            return await this.apply(proposal);
          } else if (analysis.action === 'propose_fix') {
            console.log(`[ChangeApplier] Suggested fix: ${analysis.reason}`);
            // Include fix suggestion in error for upstream handling
            err.fixSuggestion = analysis;
          }
        } catch (correctionErr) {
          console.error('[ChangeApplier] Self correction failed:', correctionErr.message);
        }
      }
      
      throw err;
    }
  }

  /**
   * Apply config changes
   */
  async applyConfig(change) {
    const configFile = path.join(this.configPath, 'evolution.yml');
    
    // Read existing or create new
    let config = {};
    try {
      const content = await fs.readFile(configFile, 'utf8');
      config = require('js-yaml').load(content) || {};
    } catch {
      // File doesn't exist, start fresh
    }
    
    // Apply changes
    Object.assign(config, change.settings || {});
    
    // Write back
    const yaml = require('js-yaml').dump(config);
    await fs.writeFile(configFile, yaml);
    
    console.log(`[ChangeApplier] Config updated:`, change.settings);
    
    return { applied: true, type: 'config', path: configFile };
  }

  /**
   * Apply new skill creation
   */
  async applyNewSkill(change, proposal) {
    const { skill } = change;
    if (!skill || !skill.name) {
      throw new Error('Skill name is required');
    }
    
    const skillDir = path.join(this.skillsPath, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    
    // Create SKILL.md (OpenClaw format - single-line frontmatter)
    const skillMd = `---
name: ${skill.name}
description: ${skill.description || 'Auto-generated skill for ' + skill.name + '. Triggers on relevant topics and patterns.'}
---

# ${skill.name}

${skill.description || 'This skill provides assistance with ' + skill.name + '.'}

## When to Use

This skill auto-triggers when the user asks about:
${skill.triggers ? skill.triggers.map(t => '- ' + t).join('\n') : '- ' + skill.name + '\n- Related concepts and topics'}

## How to Help

When this skill is active:

1. **Understand the user's situation**
   - What specific problem or question do they have?
   - What's their current context and experience level?

2. **Provide structured guidance**
   - Break down complex problems into steps
   - Explain the "why" behind recommendations
   - Offer concrete examples when helpful

3. **Apply domain knowledge**
   - Use best practices for ${skill.name}
   - Warn about common pitfalls
   - Suggest optimal approaches

4. **Enable further learning**
   - If the topic is complex, suggest deeper resources
   - Connect related concepts when relevant
   - Encourage exploration of the knowledge base

## Background

This skill was auto-generated by the Self-Evolution System based on:
- Pattern analysis from user sessions
- Identified knowledge gaps
- Common questions and challenges

*Created: ${new Date().toISOString()} | Source: Self-Evolution | Approved: ${proposal?.id || 'auto'}*
`;
    
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMd);
    
    // Phase 1: Static instructions only - no scripts needed
    
    // Phase 1: No executable scripts - OpenClaw uses SKILL.md instructions directly
    
    // Phase 1: No test files needed
    
    // Phase 1: No package.json - OpenClaw skills don't need NPM packages
    
    // Update skills index (for backward compatibility)
    await this.updateSkillsIndex(skill.name);
    
    // Git commit
    try {
      await execAsync(
        `cd ${this.basePath} && git add ${skillDir} && git commit -m "feat(skill): add ${skill.name} - ${skill.description?.substring(0, 50) || 'auto-generated'}"`,
        { timeout: 30000 }
      );
      console.log(`[ChangeApplier] Git commit created for ${skill.name}`);
    } catch (err) {
      console.warn(`[ChangeApplier] Git commit failed (non-critical): ${err.message}`);
    }
    
    console.log(`[ChangeApplier] Skill created:`, skillDir);
    
    return { 
      applied: true, 
      type: 'new_skill', 
      path: skillDir,
      skill: skill.name 
    };
  }

  /**
   * Apply update to existing component
   */
  async applyUpdate(change, proposal) {
    const { target, updates } = change;
    
    if (!target) {
      throw new Error('Update target is required');
    }
    
    // Find target file
    const targetPath = await this.findTarget(target);
    if (!targetPath) {
      throw new Error(`Target not found: ${target}`);
    }
    
    // Read current content
    const content = await fs.readFile(targetPath, 'utf8');
    
    // Apply updates (simple key-value replacement for now)
    let newContent = content;
    if (updates?.replacements) {
      for (const [oldStr, newStr] of Object.entries(updates.replacements)) {
        newContent = newContent.replace(oldStr, newStr);
      }
    }
    
    // Write updated content
    await fs.writeFile(targetPath, newContent);
    
    console.log(`[ChangeApplier] Updated:`, targetPath);
    
    return { applied: true, type: 'update', path: targetPath };
  }

  /**
   * Apply self-modification (critical)
   */
  async applySelfModification(change, proposal) {
    const { component, modification } = change;
    
    console.log(`[ChangeApplier] SELF-MODIFICATION:`, component);
    
    // Extra safety: validate modification
    if (!modification || !modification.safe) {
      throw new Error('Self-modification must be marked as safe');
    }
    
    // Apply based on component
    switch (component) {
      case 'approval-manager':
        return await this.modifyApprovalManager(modification);
      case 'learning-log':
        return await this.modifyLearningLog(modification);
      default:
        throw new Error(`Unknown component for self-modification: ${component}`);
    }
  }

  /**
   * Create backup before applying
   */
  async createBackup(proposal) {
    const backupDir = path.join(this.backupPath, proposal.id);
    await fs.mkdir(backupDir, { recursive: true });
    
    // Backup config
    try {
      await fs.copyFile(
        path.join(this.configPath, 'evolution.yml'),
        path.join(backupDir, 'evolution.yml')
      );
    } catch {}
    
    // Backup relevant source files
    const filesToBackup = await this.getFilesToBackup(proposal);
    for (const file of filesToBackup) {
      try {
        const backupFile = path.join(backupDir, path.basename(file));
        await fs.copyFile(file, backupFile);
      } catch {}
    }
    
    console.log(`[ChangeApplier] Backup created:`, backupDir);
    
    return backupDir;
  }

  /**
   * Rollback changes on failure
   */
  async rollback(proposal) {
    const backupDir = path.join(this.backupPath, proposal.id);
    
    try {
      // Restore from backup
      const files = await fs.readdir(backupDir);
      for (const file of files) {
        const backupFile = path.join(backupDir, file);
        const targetFile = path.join(this.configPath, file);
        await fs.copyFile(backupFile, targetFile);
      }
      
      console.log(`[ChangeApplier] Rollback completed:`, proposal.id);
      return { rolledBack: true };
    } catch (err) {
      console.error(`[ChangeApplier] Rollback failed:`, err.message);
      return { rolledBack: false, error: err.message };
    }
  }

  /**
   * Find target file for update
   */
  async findTarget(target) {
    const possiblePaths = [
      path.join(this.basePath, 'src', target + '.js'),
      path.join(this.basePath, 'src', 'evolution', target + '.js'),
      path.join(this.basePath, 'scripts', target + '.js'),
      path.join(this.basePath, 'config', target + '.yml'),
    ];
    
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch {}
    }
    
    return null;
  }

  /**
   * Get files to backup for proposal
   */
  async getFilesToBackup(proposal) {
    const files = [];
    
    switch (proposal.type) {
      case 'config':
        files.push(path.join(this.configPath, 'evolution.yml'));
        break;
      case 'new_skill':
        // No need to backup, creating new
        break;
      case 'update':
        const target = await this.findTarget(proposal.change.target);
        if (target) files.push(target);
        break;
      case 'self_modification':
        // Backup all evolution files
        const evolutionDir = path.join(this.basePath, 'src', 'evolution');
        try {
          const evoFiles = await fs.readdir(evolutionDir);
          for (const f of evoFiles) {
            if (f.endsWith('.js')) {
              files.push(path.join(evolutionDir, f));
            }
          }
        } catch {}
        break;
    }
    
    return files;
  }

  /**
   * Convert skill name to class name
   */
  toClassName(name) {
    return name
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  /**
   * Update skills index file
   */
  async updateSkillsIndex(skillName) {
    const indexPath = path.join(this.skillsPath, 'index.js');
    
    let indexContent = '';
    try {
      indexContent = await fs.readFile(indexPath, 'utf8');
    } catch {
      // Create new index file
      indexContent = '/**\n * Skills Index\n * Auto-generated by Self-Evolution System\n */\n\n';
    }
    
    // Add export for new skill if not exists
    const exportLine = `module.exports.${this.toClassName(skillName)} = require('./${skillName}/scripts/${skillName}').${this.toClassName(skillName)};`;
    
    if (!indexContent.includes(skillName)) {
      indexContent += exportLine + '\n';
      await fs.writeFile(indexPath, indexContent);
      console.log(`[ChangeApplier] Updated skills index: ${skillName}`);
    }
  }

  /**
   * Modify approval manager (self-mod)
   */
  async modifyApprovalManager(modification) {
    // This is dangerous - only allow specific safe changes
    if (modification.type === 'update_thresholds') {
      // Safe: just update threshold values
      const configFile = path.join(this.configPath, 'approval-levels.yml');
      let config = {};
      try {
        const content = await fs.readFile(configFile, 'utf8');
        config = require('js-yaml').load(content) || {};
      } catch {}
      
      Object.assign(config, modification.thresholds || {});
      
      const yaml = require('js-yaml').dump(config);
      await fs.writeFile(configFile, yaml);
      
      return { applied: true, type: 'self_modification', component: 'approval-manager' };
    }
    
    throw new Error('Unsupported self-modification type');
  }

  /**
   * Modify learning log (self-mod)
   */
  async modifyLearningLog(modification) {
    if (modification.type === 'update_retention') {
      // Safe: just update retention days
      const configFile = path.join(this.configPath, 'evolution.yml');
      let config = {};
      try {
        const content = await fs.readFile(configFile, 'utf8');
        config = require('js-yaml').load(content) || {};
      } catch {}
      
      config.retentionDays = modification.days || 30;
      
      const yaml = require('js-yaml').dump(config);
      await fs.writeFile(configFile, yaml);
      
      return { applied: true, type: 'self_modification', component: 'learning-log' };
    }
    
    throw new Error('Unsupported self-modification type');
  }
}

module.exports = { ChangeApplier };
