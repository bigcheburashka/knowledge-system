#!/usr/bin/env node
// Enrich stub records with full LLM-generated content

const axios = require('axios');
const { getEmbedding } = require('../src/embedding-service');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';

class EnrichStubs {
  async log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  // Find stub records (empty related or bestPractices)
  async findStubs() {
    await this.log('🔍 Finding stub records...');
    
    const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
      limit: 100,
      with_payload: true
    });
    
    const points = response.data.result.points;
    
    // Find stubs: empty related OR empty bestPractices
    const stubs = points.filter(p => {
      const payload = p.payload;
      return (
        payload.source === 'deep-learning' &&
        (payload.related?.length === 0 || payload.bestPractices?.length === 0)
      );
    });
    
    await this.log(`Found ${stubs.length} stub records`);
    
    return stubs.map(p => ({
      id: p.id,
      name: p.payload.name,
      type: p.payload.type
    }));
  }

  // Generate full content via LLM
  async generateFullContent(topic, type) {
    await this.log(`📝 Generating content for: ${topic}`);
    
    const prompt = `Analyze "${topic}" from software development context.

Create a detailed JSON object with real content:
{
  "name": "${topic}",
  "type": "${type}",
  "description": "Detailed 2-3 sentence description of what ${topic} is and when to use it",
  "related": ["5-7 real related technologies"],
  "bestPractices": ["5-7 specific best practices for using ${topic}"],
  "commonMistakes": ["5-7 common mistakes developers make with ${topic}"]
}

Provide REAL specific content. Respond ONLY with valid JSON.`;

    try {
      const response = await axios.post(
        `${process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding'}/v1/messages`,
        {
          model: 'kimi-k2-5',
          messages: [
            { role: 'system', content: 'Respond with valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 1000
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY || ''}`,
            'User-Agent': 'OpenClaw/2026.2.17'
          },
          timeout: 60000
        }
      );
      
      const content = response.data.content?.[0]?.text || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        await this.log(`✅ Generated content for ${topic}`);
        return parsed;
      }
      
      return null;
    } catch (e) {
      await this.log(`❌ Failed to generate for ${topic}: ${e.message}`);
      return null;
    }
  }

  // Update Qdrant record
  async updateQdrant(id, entry) {
    await this.log(`💾 Updating Qdrant ID ${id}: ${entry.name}`);
    
    try {
      const text = `${entry.name}. ${entry.description}. Best practices: ${entry.bestPractices?.join(', ') || ''}`;
      const embedding = await getEmbedding(text);
      
      await axios.put(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
        points: [{
          id: id,
          vector: embedding,
          payload: {
            name: entry.name,
            type: entry.type,
            text: entry.description,
            related: entry.related || [],
            bestPractices: entry.bestPractices || [],
            commonMistakes: entry.commonMistakes || [],
            source: 'deep-learning',
            enriched: true,
            createdAt: entry.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }]
      });
      
      await this.log(`✅ Updated Qdrant ID ${id}`);
      return true;
    } catch (e) {
      await this.log(`❌ Failed to update Qdrant ${id}: ${e.message}`);
      return false;
    }
  }

  // Update Memgraph
  async updateMemgraph(entry) {
    try {
      const neo4j = require('neo4j-driver');
      const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('', ''));
      const session = driver.session();
      
      try {
        // Update entity
        await session.run(`
          MERGE (e:Entity {name: $name})
          SET e.type = $type,
          e.description = $description,
              e.enriched = true,
              e.createdAt = coalesce(e.createdAt, datetime()),
              e.updatedAt = datetime()
        `, {
          name: entry.name,
          type: entry.type,
          description: entry.description
        });
        
        // Create relationships
        if (entry.related?.length > 0) {
          for (const relatedName of entry.related) {
            await session.run(`
              MERGE (e:Entity {name: $entityName})
              MERGE (r:Entity {name: $relatedName})
              ON CREATE SET r.type = 'technology', r.source = 'auto-created'
              MERGE (e)-[rel:RELATED_TO]->(r)
              SET rel.enriched = true
            `, {
              entityName: entry.name,
              relatedName: relatedName
            });
          }
        }
        
        // Create best practices
        if (entry.bestPractices?.length > 0) {
          // First delete old ones
          await session.run(`
            MERGE (e:Entity {name: $name})
          SET e.type = $type,-[:HAS_BEST_PRACTICE]->(p)
            DELETE p
          `, { name: entry.name });
          
          // Create new ones
          for (let i = 0; i < entry.bestPractices.length; i++) {
            await session.run(`
              MATCH (e:Entity {name: $entityName})
              CREATE (p:BestPractice {
                description: $practice,
                order: $order,
                source: 'enriched'
              })
              CREATE (e)-[:HAS_BEST_PRACTICE]->(p)
            `, {
              entityName: entry.name,
              practice: entry.bestPractices[i],
              order: i + 1
            });
          }
        }
        
        // Create common mistakes
        if (entry.commonMistakes?.length > 0) {
          for (let i = 0; i < entry.commonMistakes.length; i++) {
            await session.run(`
              MATCH (e:Entity {name: $entityName})
              CREATE (m:CommonMistake {
                description: $mistake,
                order: $order,
                source: 'enriched'
              })
              CREATE (e)-[:HAS_COMMON_MISTAKE]->(m)
            `, {
              entityName: entry.name,
              mistake: entry.commonMistakes[i],
              order: i + 1
            });
          }
        }
        
        await this.log(`✅ Updated Memgraph: ${entry.name}`);
      } finally {
        await session.close();
        await driver.close();
      }
    } catch (e) {
      await this.log(`⚠️  Memgraph update failed: ${e.message}`);
    }
  }

  // Main enrichment process
  async run() {
    await this.log('='.repeat(60));
    await this.log('🔄 ENRICHING STUB RECORDS');
    await this.log('='.repeat(60));
    
    const stubs = await this.findStubs();
    
    if (stubs.length === 0) {
      await this.log('No stubs found! All records are already enriched.');
      return;
    }
    
    let enriched = 0;
    
    for (const stub of stubs) {
      await this.log(`\n--- Processing: ${stub.name} (ID: ${stub.id}) ---`);
      
      const content = await this.generateFullContent(stub.name, stub.type);
      
      if (content) {
        const qdrantOk = await this.updateQdrant(stub.id, content);
        if (qdrantOk) {
          await this.updateMemgraph(content);
          enriched++;
        }
      }
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 1000));
    }
    
    await this.log('\n' + '='.repeat(60));
    await this.log(`✅ ENRICHMENT COMPLETE: ${enriched}/${stubs.length} records enriched`);
    await this.log('='.repeat(60));
  }
}

// Run
const enricher = new EnrichStubs();
enricher.run().catch(console.error);
