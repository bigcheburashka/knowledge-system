#!/usr/bin/env node
/**
 * Book Processing with Chapter/Section Support
 * Handles large books by breaking them into sections
 */

const DeepLearningService = require('./scripts/deep-learning.js');

// Book definitions with sections for large books
const BOOKS = [
  {
    name: 'Code Complete - Software Construction',
    type: 'book',
    author: 'Steve McConnell',
    sections: [
      'Code Complete - Part I: Laying the Foundation',
      'Code Complete - Part II: Creating High-Quality Code',
      'Code Complete - Part III: Variables',
      'Code Complete - Part IV: Statements',
      'Code Complete - Part V: Code Improvements',
      'Code Complete - Part VI: System Considerations',
      'Code Complete - Part VII: Software Craftsmanship'
    ]
  },
  {
    name: 'Working Effectively with Legacy Code',
    type: 'book',
    author: 'Michael Feathers',
    sections: [
      'Working with Legacy Code - Part I: The Mechanics of Change',
      'Working with Legacy Code - Part II: Changing Software',
      'Working with Legacy Code - Part III: Dependency-Breaking Techniques'
    ]
  },
  {
    name: 'Clean Code - Robert Martin',
    type: 'book', 
    author: 'Robert C. Martin',
    sections: [
      'Clean Code - Chapter 1: Clean Code',
      'Clean Code - Chapter 2: Meaningful Names',
      'Clean Code - Chapter 3: Functions',
      'Clean Code - Chapter 4: Comments',
      'Clean Code - Chapter 5: Formatting',
      'Clean Code - Chapter 6: Objects and Data Structures',
      'Clean Code - Chapter 7: Error Handling',
      'Clean Code - Chapter 8: Boundaries',
      'Clean Code - Chapter 9: Unit Tests',
      'Clean Code - Chapter 10: Classes',
      'Clean Code - Chapter 11: Systems',
      'Clean Code - Chapter 12: Emergence',
      'Clean Code - Chapter 13: Concurrency',
      'Clean Code - Chapter 14: Successive Refinement',
      'Clean Code - Chapter 15: JUnit Internals',
      'Clean Code - Chapter 16: Refactoring SerialDate',
      'Clean Code - Chapter 17: Smells and Heuristics'
    ]
  },
  {
    name: 'Building Microservices - Sam Newman',
    type: 'book',
    author: 'Sam Newman',
    sections: [
      'Building Microservices - Chapter 1: Microservices',
      'Building Microservices - Chapter 2: The Evolutionary Architect',
      'Building Microservices - Chapter 3: How to Model Services',
      'Building Microservices - Chapter 4: Integration',
      'Building Microservices - Chapter 5: Splitting the Monolith',
      'Building Microservices - Chapter 6: Deployment',
      'Building Microservices - Chapter 7: Testing',
      'Building Microservices - Chapter 8: Monitoring',
      'Building Microservices - Chapter 9: Security',
      'Building Microservices - Chapter 10: Conway’s Law and System Design',
      'Building Microservices - Chapter 11: Microservices at Scale'
    ]
  },
  {
    name: 'Designing Data-Intensive Applications',
    type: 'book',
    author: 'Martin Kleppmann',
    sections: [
      'Designing Data-Intensive Applications - Part I: Foundations of Data Systems',
      'Designing Data-Intensive Applications - Part II: Distributed Data',
      'Designing Data-Intensive Applications - Part III: Derived Data'
    ]
  },
  {
    name: 'The DevOps Handbook',
    type: 'book',
    author: 'Gene Kim',
    sections: [
      'DevOps Handbook - Part I: Introduction',
      'DevOps Handbook - Part II: Where to Start',
      'DevOps Handbook - Part III: The Technical Practices of Flow',
      'DevOps Handbook - Part IV: The Technical Practices of Feedback',
      'DevOps Handbook - Part V: The Technical Practices of Continual Learning'
    ]
  },
  {
    name: 'Release It! - Production-Ready Software',
    type: 'book',
    author: 'Michael T. Nygard',
    sections: [
      'Release It - Part I: Create Stability',
      'Release It - Part II: Design for Production'
    ]
  },
  {
    name: 'Site Reliability Engineering - Google',
    type: 'book',
    author: 'Google',
    sections: [
      'SRE - Part I: Introduction',
      'SRE - Part II: Principles',
      'SRE - Part III: Practices',
      'SRE - Part IV: Management'
    ]
  }
];

const TIMEOUT_MINUTES = 15; // 15 minutes per section

async function processWithTimeout(promise, timeoutMinutes) {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMinutes} minutes`)), timeoutMs)
    )
  ]);
}

async function processSection(service, section, bookName, sectionIndex, totalSections) {
  console.log(`    [${sectionIndex}/${totalSections}] Processing section: ${section}`);
  
  try {
    const result = await processWithTimeout(
      service.expandTopic(section, 'book-section'),
      TIMEOUT_MINUTES
    );
    
    if (result) {
      await service.storeKnowledge({
        ...result,
        parentBook: bookName,
        sectionIndex: sectionIndex
      });
      console.log(`      ✅ Section saved`);
      return true;
    } else {
      console.log(`      ⏩ Section skipped (exists)`);
      return false;
    }
  } catch (err) {
    console.log(`      ❌ Section error: ${err.message}`);
    return false;
  }
}

async function processBook(service, book) {
  console.log(`\n📖 Processing: ${book.name}`);
  console.log(`   Author: ${book.author}`);
  console.log(`   Sections: ${book.sections.length}`);
  
  let sectionsCompleted = 0;
  let sectionsFailed = 0;
  
  for (let i = 0; i < book.sections.length; i++) {
    const success = await processSection(
      service, 
      book.sections[i], 
      book.name, 
      i + 1, 
      book.sections.length
    );
    
    if (success) {
      sectionsCompleted++;
    } else {
      sectionsFailed++;
    }
    
    // Small delay between sections
    if (i < book.sections.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log(`   📊 Book complete: ${sectionsCompleted}/${book.sections.length} sections`);
  
  // Also create a summary entry for the whole book
  try {
    console.log(`   📝 Creating book summary...`);
    const summary = await processWithTimeout(
      service.expandTopic(book.name, 'book'),
      TIMEOUT_MINUTES
    );
    
    if (summary) {
      await service.storeKnowledge({
        ...summary,
        hasSections: true,
        sectionCount: book.sections.length,
        sections: book.sections
      });
      console.log(`   ✅ Book summary saved`);
    }
  } catch (err) {
    console.log(`   ⚠️ Book summary skipped: ${err.message}`);
  }
  
  return { completed: sectionsCompleted, failed: sectionsFailed };
}

async function main() {
  console.log('='.repeat(70));
  console.log('📚 BOOK PROCESSING WITH SECTIONS');
  console.log(`   Timeout per section: ${TIMEOUT_MINUTES} minutes`);
  console.log('='.repeat(70));
  
  const service = new DeepLearningService();
  
  let totalBooks = 0;
  let totalSections = 0;
  
  for (const book of BOOKS) {
    const result = await processBook(service, book);
    totalBooks++;
    totalSections += result.completed;
    
    // Delay between books
    if (BOOKS.indexOf(book) < BOOKS.length - 1) {
      console.log('\n⏳ Waiting 10 seconds before next book...\n');
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('🎉 PROCESSING COMPLETE');
  console.log(`   Books processed: ${totalBooks}`);
  console.log(`   Sections saved: ${totalSections}`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
