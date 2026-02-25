#!/usr/bin/env node
/**
 * Import System Design Topics from system-design.space
 * Добавление всех тем в очередь Knowledge System
 */

const fs = require('fs');
const path = require('path');

const TOPICS_FILE = '/root/.openclaw/workspace/knowledge-system/custom-topics.json';

// Список всех уникальных тем (ru + en, без дубликатов)
const systemDesignTopics = [
  // Interview Preparation
  'System Design Interview Preparation',
  'Hiring Goals for System Design',
  'Hiring Process',
  'Why System Design',
  'Interview Frameworks',
  'Interview Approaches',
  'System Types',
  'Interview Evaluation',
  'Long-term Preparation',
  'Short-term Preparation',
  'Troubleshooting Interview',
  'Troubleshooting Example',
  
  // Design Approaches
  'Design Approaches Overview',
  'Scalable Systems Design',
  'Load Balancing Algorithms',
  'Caching Strategies',
  'Replication and Sharding',
  'Consistency and Idempotency Patterns',
  'Event-Driven Architecture',
  'Resilience Patterns',
  
  // Case Studies
  'Case Studies Overview',
  'URL Shortener Design',
  'Rate Limiter Design',
  'Notification System Design',
  'API Gateway Design',
  'CDN Design',
  'Search System Design',
  'Web Crawler Design',
  'Object Storage Design',
  'Distributed File System Design',
  'Chat System Design',
  'Video Hosting Design',
  'Twitter-like System Design',
  'A/B Testing Platform Design',
  'Google Maps Proximity Design',
  'Real-time Gaming Design',
  'Ticket Booking System Design',
  'Hotel Booking System Design',
  'Airbnb-like System Design',
  'Uber-like System Design',
  'Payment System Design',
  'Key-Value Database Design',
  'Distributed Message Queue Design',
  'Ad Click Event Aggregator Design',
  'Social Media Infrastructure Design',
  'Media Authorization System Design',
  'Top Products Dashboard Design',
  'Interplanetary Distributed Computing Design',
  
  // Books & Resources
  'System Design Books Overview',
  'System Design Primer',
  'Alex Xu System Design Book',
  'Acing System Design Interviews Book',
  'Hacking System Design Interviews Book',
  'LeetCode System Design Course',
  'Machine Learning System Design Book',
  'Documentaries Overview',
  
  // Software Architecture
  'Software Architecture Overview',
  'Architecture Decisions at Scale',
  'T-Bank Architecture Evolution',
  'Fundamentals of Software Architecture Book',
  'Head First Software Architecture Book',
  'Wiegers Requirements Book',
  'Clean Architecture Book',
  'Software Architecture Hard Parts Book',
  'Evolutionary Architecture Book',
  'Evolutionary Architecture Practice',
  'Continuous Architecture Book',
  'Busy Developers Architecture Book',
  'Philosophy of Software Design Book',
  'Booch Architecture Documentary',
  'UML Modeling',
  'C4 Model',
  'BPMN Notation',
  'ArchiMate',
  
  // Foundations
  'Foundations Overview',
  'Structured Computer Organization Book',
  'CPU and GPU Overview',
  'RAM and Storage Overview',
  'Modern Operating Systems Book',
  'Operating System Overview',
  'Linux Overview',
  'Unix Linux Evolution Documentary',
  'Android Overview',
  'Virtualization Overview',
  'Containerization Overview',
  'Computer Networks Book',
  'Computer Networks Principles Book',
  'OSI Model',
  'IPv4 and IPv6',
  'TCP Protocol',
  'UDP Protocol',
  'DNS System',
  'HTTP Protocol',
  'WebSocket Protocol',
  
  // Distributed Systems
  'Distributed Systems Overview',
  'CAP Theorem',
  'PACELC Theorem',
  'Clock Synchronization',
  'Leader Election Patterns',
  'Consensus Protocols',
  'Leslie Lamport Distributed Systems',
  'Distributed Transactions 2PC 3PC',
  'Jepsen Consistency Testing',
  'Testing Distributed Systems',
  'Designing Data-Intensive Applications Book',
  'Tanenbaum Distributed Systems Book',
  'Google Global Network',
  
  // Data Engineering
  'Streaming Data Architecture Book',
  'Kafka Book',
  'Kappa Architecture',
  'Data Pipeline ETL ELT Architecture',
  'Apache Iceberg Architecture',
  'Big Data Book',
  'T-Bank Data Platform',
  'Data Platforms 2025 Documentary',
  'Local First Documentary',
  
  // Data Storage
  'Data Storage Overview',
  'Data Storage Introduction',
  'Database Selection Framework',
  'Database Guide Book',
  'PostgreSQL Overview',
  'MySQL Overview',
  'MongoDB Overview',
  'Cassandra Overview',
  'ClickHouse Overview',
  'Database Internals Book',
  'PostgreSQL Internals Book',
  
  // Microservices
  'Microservices Integration Overview',
  'Decomposition Strategies',
  'Learning Domain-Driven Design Book',
  'Building Microservices Book',
  'Monolith to Microservices Book',
  'Modular Monoliths Documentary',
  'Inter-service Communication Patterns',
  'Remote Call Approaches',
  'Service Discovery',
  'Microservice Patterns Book',
  'Enterprise Integration Patterns Book',
  'Continuous API Book',
  'Web API Design Book',
  'FastAPI Documentary',
  'Customer Friendly API',
  'Learning GraphQL Book',
  'GraphQL Documentary',
  
  // Cloud Native
  'Cloud Native Overview',
  '12-Factor App',
  'Cloud Native Book',
  'Infrastructure as Code',
  'Kubernetes Fundamentals',
  'Kubernetes Patterns Book',
  'Designing Distributed Systems Book',
  'GitOps',
  'ArgoCD Documentary',
  'Service Mesh Architecture',
  'Serverless Patterns',
  'Multi-region Global Systems',
  'Cost Optimization FinOps',
  'Kubernetes Documentary',
  'Envoy Documentary',
  'Fintech Cloud Technologies Documentary',
  'CKA Exam Preparation',
  
  // SRE & Operations
  'SRE Operations Overview',
  'Site Reliability Engineering Book',
  'SRE Workbook',
  'Release It Book',
  'Grokking Continuous Delivery Book',
  'Observability and Monitoring Design',
  'Performance Engineering',
  'Mobile SRE Book',
  'T-Bank SRE AI Assistant Evolution',
  'Prometheus Documentary',
  'eBPF Documentary',
  'Kelsey Hightower Platform Engineering Documentary',
  
  // Security
  'Security Engineering Overview',
  'OWASP Top 10 System Design',
  'Identity Authentication Authorization',
  'Access Control Models ACL RBAC ABAC ReBAC',
  'Encryption Keys TLS',
  'API Security Patterns',
  'Secrets Management Patterns',
  'Zero Trust Approach',
  'Supply Chain Security',
  'Data Governance Compliance',
  'Secure Reliable Systems Book',
  'Log4Shell Documentary',
  
  // AI/ML
  'AI ML Overview',
  'Hunting Electric Sheep Book',
  'AI Engineering Book',
  'Hands-on LLM Book',
  'Prompt Engineering Book',
  'AI Engineering Interviews Book',
  'Precision Recall Basics',
  'Google TPU Evolution',
  'Lovable Startup Architecture',
  'Dyad Architecture',
  'T-Bank ML Platform Interview',
  'AI in SDLC Documentary',
  'PyTorch Documentary',
  'AlphaGo Documentary',
  'Thinking Game Documentary',
  'Programming Meanings Documentary',
  
  // Frontend
  'Frontend Architecture Overview',
  'Frontend Architecture Book',
  'Instagram Feed Frontend Case',
  'Google Docs Collaborative Editor Frontend',
  'Building Micro-frontends Book',
  'Micro-frontends in Action Book',
  'Art of Micro-frontends Book',
  'React Documentary',
  'Angular Documentary',
  'Vite Documentary',
  'Ember Documentary',
  
  // Languages & Platforms
  'Languages Platforms Overview',
  'CSharp TypeScript Documentary',
  'TypeScript Origins Documentary',
  'Python Documentary',
  'Node.js Documentary',
  'Ruby on Rails Documentary',
  'Elixir Documentary',
  'Borland Documentary',
  'Git Two Decades Documentary'
];

function addTopicsToQueue() {
  console.log('🚀 Adding System Design Topics to Knowledge Queue\n');
  console.log(`Total topics: ${systemDesignTopics.length}\n`);
  
  // Load existing topics
  let data;
  try {
    data = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  } catch {
    data = { topics: [] };
  }
  
  const existingNames = new Set(data.topics.map(t => t.name.toLowerCase()));
  let added = 0;
  let skipped = 0;
  
  // Add system design topics
  for (const topic of systemDesignTopics) {
    if (existingNames.has(topic.toLowerCase())) {
      skipped++;
      continue;
    }
    
    data.topics.push({
      name: topic,
      type: 'concept',
      priority: 'high',
      source: 'system-design-space',
      reason: 'System Design Mastery - comprehensive topic from system-design.space',
      addedAt: new Date().toISOString()
    });
    
    existingNames.add(topic.toLowerCase());
    added++;
  }
  
  // Save
  fs.writeFileSync(TOPICS_FILE, JSON.stringify(data, null, 2));
  
  console.log(`✅ Added: ${added} new topics`);
  console.log(`⏩ Skipped: ${skipped} already existed`);
  console.log(`📊 Total in queue: ${data.topics.length}`);
  
  // Show sample of added topics
  console.log('\n📋 Sample of added topics:');
  const newTopics = data.topics
    .filter(t => t.source === 'system-design-space')
    .slice(0, 10);
  newTopics.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
}

addTopicsToQueue();
