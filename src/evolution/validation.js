/**
 * Input Validation for Self-Evolution System
 */

class InputValidator {
  /**
   * Validate a proposal before processing
   */
  static validateProposal(change) {
    const errors = [];
    
    // Required fields
    if (!change.type) {
      errors.push('type is required');
    } else {
      // Valid types
      const validTypes = ['config', 'new_skill', 'update', 'self_modification'];
      if (!validTypes.includes(change.type)) {
        errors.push(`type must be one of: ${validTypes.join(', ')}`);
      }
    }
    
    if (!change.reason) {
      errors.push('reason is required');
    } else if (change.reason.length < 10) {
      errors.push('reason must be at least 10 characters');
    }
    
    // Type-specific validation
    switch (change.type) {
      case 'config':
        if (!change.settings || typeof change.settings !== 'object') {
          errors.push('config changes require settings object');
        }
        break;
        
      case 'new_skill':
        if (!change.skill) {
          errors.push('new_skill requires skill object');
        } else {
          if (!change.skill.name) {
            errors.push('skill.name is required');
          } else if (!/^[a-z0-9-]+$/.test(change.skill.name)) {
            errors.push('skill.name must be lowercase alphanumeric with hyphens');
          }
          if (change.skill.name?.length > 50) {
            errors.push('skill.name must be ≤ 50 characters');
          }
        }
        break;
        
      case 'update':
        if (!change.target) {
          errors.push('update requires target');
        }
        break;
        
      case 'self_modification':
        if (!change.component) {
          errors.push('self_modification requires component');
        }
        if (!change.modification?.safe) {
          errors.push('self_modification must be marked as safe');
        }
        break;
    }
    
    // Impact score validation (if provided)
    if (change.impactScore !== undefined) {
      if (typeof change.impactScore !== 'number') {
        errors.push('impactScore must be a number');
      } else if (change.impactScore < 0 || change.impactScore > 1) {
        errors.push('impactScore must be between 0 and 1');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
  }

  /**
   * Validate ID format
   */
  static isValidId(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9-_]+$/.test(id) && id.length <= 100;
  }
}

module.exports = { InputValidator };
