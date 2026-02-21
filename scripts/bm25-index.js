#!/usr/bin/env node
// BM25 Index for MEMORY.md files
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob').glob;

const MEMORY_DIR = '/root/.openclaw/workspace/memory';
const BM25_FILE = '/root/.openclaw/workspace/knowledge-state/bm25-index.json';

class BM25Index {
  constructor() {
    this.documents = [];
    this.termFreq = {}; // term -> { docId -> freq }
    this.docFreq = {};  // term -> number of docs containing term
    this.docLengths = {};
    this.avgDocLength = 0;
    this.N = 0; // total docs
    
    // BM25 parameters
    this.k1 = 1.5;
    this.b = 0.75;
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-zа-яё0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  async loadMemoryFiles() {
    const pattern = path.join(MEMORY_DIR, '*.md');
    const files = await glob(pattern);
    
    const documents = [];
    
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const stats = await fs.stat(file);
        
        documents.push({
          id: path.basename(file, '.md'),
          path: file,
          content: content,
          title: this.extractTitle(content),
          modified: stats.mtime
        });
      } catch (e) {
        console.error(`Error reading ${file}:`, e.message);
      }
    }
    
    return documents;
  }

  extractTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1] : 'Untitled';
  }

  addDocument(doc) {
    const docId = doc.id;
    const tokens = this.tokenize(doc.content);
    
    this.documents.push(doc);
    this.docLengths[docId] = tokens.length;
    this.N++;
    
    // Count term frequencies
    const termCounts = {};
    for (const token of tokens) {
      termCounts[token] = (termCounts[token] || 0) + 1;
    }
    
    // Update indexes
    for (const [term, freq] of Object.entries(termCounts)) {
      if (!this.termFreq[term]) {
        this.termFreq[term] = {};
        this.docFreq[term] = 0;
      }
      this.termFreq[term][docId] = freq;
      this.docFreq[term]++;
    }
  }

  calculateAvgDocLength() {
    const totalLength = Object.values(this.docLengths).reduce((a, b) => a + b, 0);
    this.avgDocLength = totalLength / this.N;
  }

  score(query, docId) {
    const tokens = this.tokenize(query);
    const docLength = this.docLengths[docId];
    let score = 0;
    
    for (const term of tokens) {
      if (!this.docFreq[term]) continue;
      
      const tf = this.termFreq[term]?.[docId] || 0;
      const df = this.docFreq[term];
      
      // BM25 formula
      const idf = Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (tf * (this.k1 + 1)) / 
        (tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength)));
      
      score += idf * tfNorm;
    }
    
    return score;
  }

  search(query, limit = 5) {
    const results = [];
    
    for (const doc of this.documents) {
      const score = this.score(query, doc.id);
      if (score > 0) {
        results.push({
          id: doc.id,
          title: doc.title,
          path: doc.path,
          score: score,
          modified: doc.modified
        });
      }
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async build() {
    console.log('🔨 Building BM25 index...');
    
    const documents = await this.loadMemoryFiles();
    console.log(`📁 Loaded ${documents.length} documents`);
    
    for (const doc of documents) {
      this.addDocument(doc);
    }
    
    this.calculateAvgDocLength();
    
    console.log(`✅ Index built: ${this.N} docs, ${Object.keys(this.termFreq).length} terms`);
    console.log(`📊 Avg doc length: ${this.avgDocLength.toFixed(1)} tokens`);
    
    // Save index
    const indexData = {
      N: this.N,
      avgDocLength: this.avgDocLength,
      docFreq: this.docFreq,
      documents: this.documents.map(d => ({ id: d.id, title: d.title, path: d.path }))
    };
    
    await fs.writeFile(BM25_FILE, JSON.stringify(indexData, null, 2));
    console.log(`💾 Index saved to ${BM25_FILE}`);
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(BM25_FILE, 'utf-8'));
      this.N = data.N;
      this.avgDocLength = data.avgDocLength;
      this.docFreq = data.docFreq;
      
      // Reload documents
      const documents = await this.loadMemoryFiles();
      for (const doc of documents) {
        if (this.documents.find(d => d.id === doc.id)) continue;
        this.addDocument(doc);
      }
      
      console.log(`📂 Loaded index: ${this.N} docs`);
      return true;
    } catch (e) {
      console.log('ℹ️  No existing index, building new...');
      await this.build();
      return true;
    }
  }
}

// CLI
if (require.main === module) {
  const command = process.argv[2] || 'build';
  const index = new BM25Index();
  
  if (command === 'build') {
    index.build().then(() => {
      console.log('\n✅ BM25 index built successfully');
    }).catch(console.error);
  } else if (command === 'search') {
    const query = process.argv[3] || 'error handling';
    index.load().then(() => {
      const results = index.search(query);
      console.log(`\n🔍 Search: "${query}"`);
      console.log('='.repeat(60));
      results.forEach((r, i) => {
        console.log(`${i + 1}. ${r.title} (score: ${r.score.toFixed(3)})`);
        console.log(`   File: ${r.id}.md`);
      });
    }).catch(console.error);
  }
}

module.exports = BM25Index;