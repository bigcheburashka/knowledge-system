#!/usr/bin/env node
// API Key Manager - Secure key rotation and validation

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const KEY_DIR = '/root/.openclaw/workspace/knowledge-state/keys';
const KEY_FILE = path.join(KEY_DIR, 'api-keys.json');

class KeyManager {
  constructor() {
    this.keys = {};
  }

  async init() {
    await fs.mkdir(KEY_DIR, { recursive: true, mode: 0o700 });
    await this.loadKeys();
  }

  async loadKeys() {
    try {
      const data = await fs.readFile(KEY_FILE, 'utf-8');
      this.keys = JSON.parse(data);
    } catch (e) {
      this.keys = {};
    }
  }

  async saveKeys() {
    const encrypted = this.encryptKeys(this.keys);
    await fs.writeFile(KEY_FILE, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
  }

  encryptKeys(keys) {
    // Simple obfuscation (in production use real encryption)
    const obfuscated = {};
    for (const [name, key] of Object.entries(keys)) {
      obfuscated[name] = {
        value: Buffer.from(key).toString('base64'),
        hash: crypto.createHash('sha256').update(key).digest('hex').substring(0, 16),
        updated: new Date().toISOString()
      };
    }
    return obfuscated;
  }

  decryptKeys(encrypted) {
    const decrypted = {};
    for (const [name, data] of Object.entries(encrypted)) {
      decrypted[name] = Buffer.from(data.value, 'base64').toString('utf-8');
    }
    return decrypted;
  }

  getKey(name) {
    // First check environment
    const envKey = process.env[`${name.toUpperCase()}_API_KEY`];
    if (envKey) return envKey;
    
    // Then check stored keys
    return this.keys[name];
  }

  async setKey(name, value) {
    this.keys[name] = value;
    await this.saveKeys();
  }

  async rotateKey(name) {
    console.log(`🔄 Rotating key: ${name}`);
    const oldKey = this.keys[name];
    
    if (!oldKey) {
      console.log(`⚠️  No existing key for ${name}`);
      return false;
    }
    
    // Mark old key as deprecated (in production: revoke)
    this.keys[`${name}_deprecated_${Date.now()}`] = oldKey;
    delete this.keys[name];
    
    await this.saveKeys();
    console.log(`✅ Key ${name} rotated. New key must be set.`);
    return true;
  }

  validateKey(key) {
    // Check if key looks valid
    if (!key || key.length < 20) return false;
    
    // Check for common patterns
    const patterns = [
      /^sk-/,              // OpenAI
      /^hf_/,              // Hugging Face
      /^kimi-/,            // Kimi
      /^[a-zA-Z0-9_-]+$/   // Generic
    ];
    
    return patterns.some(p => p.test(key));
  }

  async audit() {
    const report = {
      timestamp: new Date().toISOString(),
      keys: {},
      issues: []
    };
    
    for (const name of Object.keys(this.keys)) {
      if (name.includes('deprecated')) continue;
      
      const key = this.keys[name];
      const isValid = this.validateKey(key);
      const fromEnv = !!process.env[`${name.toUpperCase()}_API_KEY`];
      
      report.keys[name] = {
        valid: isValid,
        source: fromEnv ? 'environment' : 'file',
        hash: crypto.createHash('sha256').update(key).digest('hex').substring(0, 8) + '...'
      };
      
      if (!isValid) {
        report.issues.push(`Invalid key format: ${name}`);
      }
      if (!fromEnv) {
        report.issues.push(`Key not in environment (security risk): ${name}`);
      }
    }
    
    return report;
  }
}

// CLI
if (require.main === module) {
  const manager = new KeyManager();
  const command = process.argv[2];
  
  manager.init().then(async () => {
    switch (command) {
      case 'audit':
        const report = await manager.audit();
        console.log('🔐 API Key Audit Report');
        console.log('='.repeat(50));
        console.log(JSON.stringify(report, null, 2));
        break;
        
      case 'rotate':
        const keyName = process.argv[3];
        if (!keyName) {
          console.error('Usage: key-manager rotate <key-name>');
          process.exit(1);
        }
        await manager.rotateKey(keyName);
        break;
        
      default:
        console.log('Usage: key-manager [audit|rotate <key>]');
    }
  });
}

module.exports = KeyManager;