/**
 * Skill Generator with Quality Standards
 * Генератор скиллов с human-readable названиями и описаниями
 */

const fs = require('fs').promises;
const path = require('path');

class SkillGenerator {
  constructor(basePath) {
    this.basePath = basePath || '/root/.openclaw/workspace/knowledge-system';
    this.pendingIndex = null;
  }

  /**
   * Generate a human-readable skill name
   * Формат: [action]-[component]-[purpose]
   * Примеры: monitor-cron-health, validate-learning-data, fix-sync-issues
   */
  generateSkillName(category, subcategory, action = 'monitor') {
    // Map categories to readable components
    const componentMap = {
      'cron': 'scheduler',
      'deep-learning': 'learning-pipeline',
      'hybrid-search': 'search-system',
      'learning-log': 'log-monitor',
      'system-monitor': 'health-checker',
      'knowledge': 'knowledge-base',
      'queue': 'queue-manager',
      'sync': 'sync-service',
      'n': 'system-core'  // fallback for 'n' category
    };

    const component = componentMap[category] || category;
    
    // Clean up subcategory
    const cleanSub = subcategory
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Generate name based on context
    if (subcategory && subcategory.length > 2) {
      return `${action}-${component}-${cleanSub}`.toLowerCase();
    }
    
    return `${action}-${component}`.toLowerCase();
  }

  /**
   * Generate detailed description with structure
   */
  generateDescription(skillName, category, detectedIssues = []) {
    const parts = [];
    
    // 1. What it does
    parts.push(`Скрипт для автоматического обнаружения и устранения проблем в ${category}.`);
    
    // 2. Specific functionality
    parts.push(`Выполняет проверку состояния, диагностику ошибок и автоматическое восстановление.`);
    
    // 3. Benefits
    if (detectedIssues.length > 0) {
      parts.push(`Решает типичные проблемы: ${detectedIssues.slice(0, 3).join(', ')}.`);
    }
    
    // 4. When to use
    parts.push(`Запускается автоматически при обнаружении аномалий или по расписанию.`);
    
    return parts.join(' ');
  }

  /**
   * Validate proposal quality
   * Отклоняет proposals с плохими названиями/описаниями
   */
  validateProposal(name, description, level) {
    const errors = [];
    
    // Name quality checks
    if (name.length < 10) {
      errors.push('Название слишком короткое (минимум 10 символов)');
    }
    
    if (name.includes('prevent-n-') || name.match(/prevent-\w-\w/)) {
      errors.push('Название неинформативное (prevent-X-Y формат)');
    }
    
    if (name.split('-').length > 4) {
      errors.push('Название слишком сложное (максимум 4 части)');
    }
    
    // Description quality checks
    if (!description || description.length < 80) {
      errors.push('Описание слишком короткое (минимум 80 символов)');
    }
    
    if (description && !description.includes('. ')) {
      errors.push('Описание должно содержать полные предложения');
    }
    
    // Level-specific checks
    if (level === 'L2' && (!description || !description.match(/польза|benefit|решает|исправляет/i))) {
      errors.push('L2 скилл должен описывать конкретную пользу');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Generate skill file content
   */
  generateSkillFile(skillName, description) {
    return `/**
 * ${skillName}
 * 
 * ${description}
 * 
 * Generated: ${new Date().toISOString()}
 * Level: L2 (new_skill)
 * Category: quality_improvement
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class ${this.toClassName(skillName)} {
  constructor() {
    this.name = '${skillName}';
    this.logPath = path.join(process.env.KNOWLEDGE_LOG_PATH || '/var/log/knowledge', '${skillName}.log');
  }

  /**
   * Main execution
   */
  async run() {
    console.log(\`[\${this.name}] Starting...\`);
    
    try {
      // Check current state
      const state = await this.checkState();
      
      // Detect issues
      const issues = await this.detectIssues(state);
      
      if (issues.length === 0) {
        console.log(\`[\${this.name}] ✅ No issues detected\`);
        return { status: 'ok', issues: 0 };
      }
      
      // Fix issues
      const fixed = await this.fixIssues(issues);
      
      console.log(\`[\${this.name}] ✅ Fixed \${fixed} issues\`);
      return { status: 'fixed', issues: fixed };
      
    } catch (error) {
      console.error(\`[\${this.name}] ❌ Error: \${error.message}\`);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Check current system state
   */
  async checkState() {
    // TODO: Implement state checking
    return {};
  }

  /**
   * Detect issues
   */
  async detectIssues(state) {
    const issues = [];
    // TODO: Implement issue detection
    return issues;
  }

  /**
   * Fix detected issues
   */
  async fixIssues(issues) {
    let fixed = 0;
    for (const issue of issues) {
      try {
        await this.fixIssue(issue);
        fixed++;
      } catch (e) {
        console.error(\`Failed to fix issue: \${e.message}\`);
      }
    }
    return fixed;
  }

  /**
   * Fix single issue
   */
  async fixIssue(issue) {
    // TODO: Implement issue fixing
    console.log(\`Fixing: \${issue.description}\`);
  }

  /**
   * Log action
   */
  log(action, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      data
    };
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\\n');
  }
}

// Helper to convert skill name to class name
function toClassName(name) {
  return name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// Run if called directly
if (require.main === module) {
  const skill = new ${this.toClassName(skillName)}();
  skill.run().then(result => {
    process.exit(result.status === 'error' ? 1 : 0);
  });
}

module.exports = { ${this.toClassName(skillName)} };
`;
  }

  toClassName(name) {
    return name
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  /**
   * Create proposal with quality checks
   */
  async createProposal(category, subcategory, options = {}) {
    const action = options.action || 'monitor';
    const detectedIssues = options.detectedIssues || [];
    
    // Generate quality name and description
    const skillName = this.generateSkillName(category, subcategory, action);
    const description = this.generateDescription(skillName, category, detectedIssues);
    
    // Validate
    const validation = this.validateProposal(skillName, description, options.level || 'L2');
    
    if (!validation.valid) {
      console.log(`❌ Proposal rejected for ${category}/${subcategory}:`);
      validation.errors.forEach(e => console.log(`   - ${e}`));
      return null;
    }
    
    // Generate content
    const content = this.generateSkillFile(skillName, description);
    
    return {
      id: `prop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: options.type || 'new_skill',
      level: options.level || 'L2',
      skill: {
        name: skillName,
        type: 'preventive',
        description,
        content,
        files: [{
          name: `${skillName}.js`,
          content
        }]
      },
      detectedIssues,
      proposedAt: new Date().toISOString(),
      status: 'pending'
    };
  }
}

module.exports = { SkillGenerator };
