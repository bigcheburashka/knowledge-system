#!/usr/bin/env node
// Create Memgraph entities for already-enriched Qdrant records

const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';

async function createMemgraphForEnriched() {
  console.log('=== СОЗДАНИЕ MEMGRAPH ДЛЯ ОБОГАЩЁННЫХ ЗАПИСЕЙ ===\n');
  
  // Get all enriched records from Qdrant
  const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
    limit: 100,
    with_payload: true
  });
  
  const points = response.data.result.points;
  
  // Find enriched records (ID >= 10000 and enriched=true)
  const enriched = points.filter(p => 
    p.id >= 10000 && p.payload.enriched === true
  );
  
  console.log(`Найдено ${enriched.length} обогащённых записей\n`);
  
  if (enriched.length === 0) {
    console.log('Нет обогащённых записей для обработки');
    return;
  }
  
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('', ''));
  const session = driver.session();
  
  let created = 0;
  
  try {
    for (const p of enriched) {
      const entry = p.payload;
      console.log(`\n--- ${entry.name} (ID: ${p.id}) ---`);
      
      // Create or update entity
      await session.run(`
        MERGE (e:Entity {name: $name})
        SET e.type = $type,
            e.description = $description,
            e.source = 'deep-learning',
            e.enriched = true,
            e.createdAt = datetime()
      `, {
        name: entry.name,
        type: entry.type,
        description: entry.text
      });
      
      console.log('  ✅ Entity создана/обновлена');
      
      // Create relationships
      if (entry.related?.length > 0) {
        for (const relatedName of entry.related) {
          await session.run(`
            MERGE (e:Entity {name: $entityName})
            MERGE (r:Entity {name: $relatedName})
            ON CREATE SET r.type = 'technology', r.source = 'auto-created'
            MERGE (e)-[rel:RELATED_TO]->(r)
          `, {
            entityName: entry.name,
            relatedName: relatedName
          });
        }
        console.log(`  ✅ ${entry.related.length} связей создано`);
      }
      
      // Create best practices
      if (entry.bestPractices?.length > 0) {
        for (let i = 0; i < entry.bestPractices.length; i++) {
          await session.run(`
            MATCH (e:Entity {name: $entityName})
            CREATE (p:BestPractice {
              description: $practice,
              order: $order,
              source: 'deep-learning'
            })
            CREATE (e)-[:HAS_BEST_PRACTICE]->(p)
          `, {
            entityName: entry.name,
            practice: entry.bestPractices[i],
            order: i + 1
          });
        }
        console.log(`  ✅ ${entry.bestPractices.length} best practices создано`);
      }
      
      // Create common mistakes
      if (entry.commonMistakes?.length > 0) {
        for (let i = 0; i < entry.commonMistakes.length; i++) {
          await session.run(`
            MATCH (e:Entity {name: $entityName})
            CREATE (m:CommonMistake {
              description: $mistake,
              order: $order,
              source: 'deep-learning'
            })
            CREATE (e)-[:HAS_COMMON_MISTAKE]->(m)
          `, {
            entityName: entry.name,
            mistake: entry.commonMistakes[i],
            order: i + 1
          });
        }
        console.log(`  ✅ ${entry.commonMistakes.length} common mistakes создано`);
      }
      
      created++;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ ГОТОВО: ${created}/${enriched.length} записей обработано`);
    console.log('='.repeat(60));
    
  } finally {
    await session.close();
    await driver.close();
  }
}

createMemgraphForEnriched().catch(console.error);
