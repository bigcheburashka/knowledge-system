/**
 * Config Validator
 * Schema validation for Evolution system configuration
 */

const fs = require('fs').promises;
const path = require('path');

class ConfigValidator {
  constructor() {
    this.schema = {
      timeout: { type: 'number', min: 1000, max: 60000, default: 10000 },
      maxRetries: { type: 'number', min: 1, max: 10, default: 3 },
      retryDelay: { type: 'number', min: 100, max: 10000, default: 1000 },
      batchSize: { type: 'number', min: 1, max: 100, default: 10 },
      logLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
      features: {
        type: 'object',
        properties: {
          autoExtract: { type: 'boolean', default: true },
          deepLearning: { type: 'boolean', default: true },
          telegramBot: { type: 'boolean', default: true },
          memgraphSync: { type: 'boolean', default: true }
        }
      }
    };
  }

  /**
   * Validate configuration object against schema
   */
  validate(config) {
    const errors = [];
    const validated = {};
    
    for (const [key, schema] of Object.entries(this.schema)) {
      const value = config[key];
      const result = this.validateField(key, value, schema);
      
      if (result.error) {
        errors.push(result.error);
        validated[key] = schema.default;
      } else {
        validated[key] = result.value;
      }
    }
    
    // Check for unknown fields
    for (const key of Object.keys(config)) {
      if (!this.schema[key]) {
        console.warn(`[ConfigValidator] Unknown config field: ${key}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      config: validated
    };
  }

  validateField(key, value, schema) {
    // Use default if value is undefined
    if (value === undefined) {
      return { value: schema.default };
    }
    
    // Type validation
    if (schema.type === 'number') {
      if (typeof value !== 'number' || isNaN(value)) {
        return { 
          error: `${key}: expected number, got ${typeof value}`,
          value: schema.default 
        };
      }
      
      if (schema.min !== undefined && value < schema.min) {
        return { 
          error: `${key}: value ${value} is below minimum ${schema.min}`,
          value: schema.min 
        };
      }
      
      if (schema.max !== undefined && value > schema.max) {
        return { 
          error: `${key}: value ${value} is above maximum ${schema.max}`,
          value: schema.max 
        };
      }
    }
    
    if (schema.type === 'string') {
      if (typeof value !== 'string') {
        return { 
          error: `${key}: expected string, got ${typeof value}`,
          value: schema.default 
        };
      }
      
      if (schema.enum && !schema.enum.includes(value)) {
        return { 
          error: `${key}: value "${value}" is not in allowed values: ${schema.enum.join(', ')}`,
          value: schema.default 
        };
      }
    }
    
    if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        return { 
          error: `${key}: expected boolean, got ${typeof value}`,
          value: schema.default 
        };
      }
    }
    
    if (schema.type === 'object') {
      if (typeof value !== 'object' || value === null) {
        return { 
          error: `${key}: expected object, got ${typeof value}`,
          value: schema.default || {} 
        };
      }
      
      // Validate nested properties
      if (schema.properties) {
        for (const [propKey, propSchema] of Object.entries(schema.properties)) {
          const propResult = this.validateField(
            `${key}.${propKey}`,
            value[propKey],
            propSchema
          );
          
          if (propResult.error) {
            return { error: propResult.error, value: schema.default };
          }
          
          value[propKey] = propResult.value;
        }
      }
    }
    
    return { value };
  }

  /**
   * Load and validate config from file
   */
  async loadConfig(configPath) {
    try {
      const content = await fs.readFile(configPath, 'utf8');
      
      // Simple YAML parser (for evolution.yml format)
      const config = this.parseSimpleYaml(content);
      
      return this.validate(config);
    } catch (err) {
      console.error('[ConfigValidator] Failed to load config:', err.message);
      
      // Return defaults on error
      const defaults = {};
      for (const [key, schema] of Object.entries(this.schema)) {
        defaults[key] = schema.default;
      }
      
      return {
        valid: false,
        errors: [err.message],
        config: defaults
      };
    }
  }

  parseSimpleYaml(content) {
    const config = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        
        // Try to parse as number
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          config[key] = numValue;
        } else if (value === 'true') {
          config[key] = true;
        } else if (value === 'false') {
          config[key] = false;
        } else {
          config[key] = value;
        }
      }
    }
    
    return config;
  }
}

module.exports = { ConfigValidator };
