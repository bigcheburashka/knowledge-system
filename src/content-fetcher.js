/**
 * Enhanced Content Fetcher
 * Фетчинг топ-20 сайтов с интеллектуальной выжимкой контента
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

class ContentFetcher {
  constructor(options = {}) {
    this.maxSites = options.maxSites || 20;
    this.timeout = options.timeout || 15000;
    this.maxContentLength = options.maxContentLength || 10000;
    this.maxSummaryLength = options.maxSummaryLength || 2000;
    this.concurrency = options.concurrency || 5;
    this.minContentLength = options.minContentLength || 500;
  }

  /**
   * Фетчинг топ-N сайтов с параллельной обработкой
   */
  async fetchTopSites(searchResults, options = {}) {
    const limit = options.limit || this.maxSites;
    const sitesToFetch = searchResults.slice(0, limit);
    
    console.log(`[ContentFetcher] Fetching ${sitesToFetch.length} sites with concurrency ${this.concurrency}`);
    
    const results = [];
    const errors = [];
    
    // Обрабатываем батчами для контроля concurrency
    for (let i = 0; i < sitesToFetch.length; i += this.concurrency) {
      const batch = sitesToFetch.slice(i, i + this.concurrency);
      const batchPromises = batch.map(site => this.fetchAndProcess(site));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, idx) => {
        const site = batch[idx];
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        } else {
          errors.push({
            url: site.url,
            error: result.reason?.message || 'Unknown error'
          });
        }
      });
      
      // Небольшая задержка между батчами
      if (i + this.concurrency < sitesToFetch.length) {
        await this.sleep(500);
      }
    }
    
    console.log(`[ContentFetcher] Successfully fetched: ${results.length}, Failed: ${errors.length}`);
    
    return {
      fetched: results,
      errors: errors,
      totalAttempted: sitesToFetch.length
    };
  }

  /**
   * Фетчинг и обработка одного сайта
   */
  async fetchAndProcess(site) {
    try {
      // Проверяем URL
      const url = new URL(site.url);
      
      // Пропускаем нежелательные домены
      if (this.isBlockedDomain(url.hostname)) {
        console.log(`[ContentFetcher] Skipping blocked domain: ${url.hostname}`);
        return null;
      }
      
      const fetchResult = await this.fetchPage(site.url);
      if (!fetchResult || fetchResult.content.length < this.minContentLength) {
        return null;
      }
      
      // Создаём выжимку контента
      const summary = this.createSummary(fetchResult.content);
      
      // Извлекаем ключевые моменты
      const keyPoints = this.extractKeyPoints(fetchResult.content);
      
      // Определяем тип контента
      const contentType = this.detectContentType(fetchResult.content, fetchResult.url);
      
      return {
        url: fetchResult.url,
        title: fetchResult.title,
        originalContent: fetchResult.content.substring(0, this.maxContentLength),
        summary: summary,
        keyPoints: keyPoints,
        contentType: contentType,
        wordCount: fetchResult.content.split(/\s+/).length,
        charCount: fetchResult.content.length,
        fetchedAt: new Date().toISOString(),
        source: site.source || 'web',
        siteDescription: site.description || '',
        relevanceScore: this.calculateRelevance(fetchResult, site)
      };
      
    } catch (error) {
      console.warn(`[ContentFetcher] Failed to process ${site.url}:`, error.message);
      throw error;
    }
  }

  /**
   * Фетчинг страницы
   */
  async fetchPage(url) {
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        maxRedirects: 3,
        responseType: 'text'
      });

      const $ = cheerio.load(response.data);
      
      // Удаляем ненужные элементы
      this.removeNoise($);
      
      // Извлекаем контент
      const content = this.extractMainContent($);
      const title = this.extractTitle($);
      
      return {
        url,
        title,
        content,
        html: response.data.substring(0, 50000) // Сохраняем часть HTML для анализа
      };
      
    } catch (error) {
      console.warn(`[ContentFetcher] Failed to fetch ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Удаление шума из страницы
   */
  removeNoise($) {
    const selectorsToRemove = [
      'script',
      'style',
      'nav',
      'header',
      'footer',
      'aside',
      '.advertisement',
      '.ads',
      '.cookie-banner',
      '.newsletter',
      '.social-share',
      '.comments',
      '#comments',
      '.related-posts',
      '.sidebar',
      '.widget',
      '.popup',
      '.modal',
      '[role="banner"]',
      '[role="navigation"]',
      '[role="complementary"]'
    ];
    
    selectorsToRemove.forEach(selector => $(selector).remove());
  }

  /**
   * Извлечение основного контента
   */
  extractMainContent($) {
    // Пробуем найти основной контент по приоритету
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.documentation',
      '.docs-content',
      '#content',
      '#main-content',
      '.main',
      '.body'
    ];
    
    let bestContent = '';
    let bestLength = 0;
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = element.text().trim();
        if (text.length > bestLength && text.length > this.minContentLength) {
          bestContent = text;
          bestLength = text.length;
        }
      }
    }
    
    // Fallback на body если ничего не нашли
    if (!bestContent) {
      bestContent = $('body').text().trim();
    }
    
    // Очистка текста
    return this.cleanText(bestContent);
  }

  /**
   * Извлечение заголовка
   */
  extractTitle($) {
    // Пробуем разные варианты заголовков
    const titleSelectors = [
      'h1',
      'article h1',
      '.entry-title',
      '.post-title',
      'title'
    ];
    
    for (const selector of titleSelectors) {
      const title = $(selector).first().text().trim();
      if (title && title.length > 5 && title.length < 200) {
        return title;
      }
    }
    
    return '';
  }

  /**
   * Очистка текста
   */
  cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .replace(/\t+/g, ' ')
      .replace(/\r/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\[.*?\]/g, '') // Удаляем [edit], [citation needed] и т.п.
      .replace(/\(.*?\)/g, match => match.length > 100 ? '' : match) // Удаляем длинные скобки
      .trim();
  }

  /**
   * Создание выжимки контента
   */
  createSummary(content) {
    const sentences = this.splitIntoSentences(content);
    
    if (sentences.length <= 5) {
      return content.substring(0, this.maxSummaryLength);
    }
    
    // Выбираем наиболее информативные предложения
    const scoredSentences = sentences.map((sentence, index) => ({
      text: sentence,
      score: this.scoreSentence(sentence, index, sentences.length),
      index
    }));
    
    // Сортируем по score и берём топ-5
    scoredSentences.sort((a, b) => b.score - a.score);
    const topSentences = scoredSentences.slice(0, 5);
    
    // Возвращаем в оригинальном порядке
    topSentences.sort((a, b) => a.index - b.index);
    
    const summary = topSentences.map(s => s.text).join(' ');
    
    return summary.substring(0, this.maxSummaryLength);
  }

  /**
   * Разбиение на предложения
   */
  splitIntoSentences(text) {
    // Упрощённое разбиение на предложения
    return text
      .replace(/([.!?])\s+/g, "$1|")
      .split("|")
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 500);
  }

  /**
   * Оценка важности предложения
   */
  scoreSentence(sentence, index, total) {
    let score = 0;
    
    // Предложения в начале и конце важнее
    if (index < 3) score += 3;
    if (index > total - 3) score += 2;
    
    // Длина предложения (не слишком короткое, не слишком длинное)
    const words = sentence.split(/\s+/).length;
    if (words >= 10 && words <= 30) score += 2;
    
    // Ключевые индикаторы важности
    const importantPatterns = [
      /\b(important|key|critical|essential|main|primary|major|crucial)\b/i,
      /\b(best practice|recommend|should|must|need to|avoid|never|always)\b/i,
      /\b(advantage|benefit|drawback|limitation|issue|problem|solution)\b/i,
      /\b(how to|guide|tutorial|example|step|tip|trick)\b/i
    ];
    
    importantPatterns.forEach(pattern => {
      if (pattern.test(sentence)) score += 2;
    });
    
    // Числа и технические термины добавляют информативности
    if (/\d+/.test(sentence)) score += 1;
    if (/[A-Z][a-z]+[A-Z]/.test(sentence)) score += 1; // CamelCase (вероятно, технический термин)
    
    return score;
  }

  /**
   * Извлечение ключевых моментов
   */
  extractKeyPoints(content) {
    const keyPoints = [];
    const lines = content.split('\n');
    
    // Ищем списки и важные пункты
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Пропускаем короткие строки
      if (trimmed.length < 30 || trimmed.length > 300) continue;
      
      // Ищем маркеры списков
      const isListItem = /^[\s]*[-•*\d\.]\s+/.test(trimmed);
      
      // Ищем ключевые фразы
      const hasKeyPhrase = /\b(note|important|tip|warning|caution|remember|key point)\b/i.test(trimmed);
      
      // Ищем структурированные данные
      const hasStructure = /:\s+/.test(trimmed) && trimmed.split(/:\s+/)[0].length < 50;
      
      if (isListItem || hasKeyPhrase || hasStructure) {
        const cleanPoint = trimmed
          .replace(/^[\s]*[-•*\d\.]\s+/, '')
          .replace(/\b(note|important|tip|warning|caution|remember):\s*/i, '');
        
        if (cleanPoint.length > 20 && !keyPoints.includes(cleanPoint)) {
          keyPoints.push(cleanPoint);
        }
      }
    }
    
    return keyPoints.slice(0, 10);
  }

  /**
   * Определение типа контента
   */
  detectContentType(content, url) {
    const lowerContent = content.toLowerCase();
    const lowerUrl = url.toLowerCase();
    
    // Проверяем URL паттерны
    if (/docs?\./.test(lowerUrl) || /documentation/.test(lowerUrl)) return 'documentation';
    if (/blog/.test(lowerUrl)) return 'blog';
    if (/github\.com/.test(lowerUrl)) return 'github';
    if (/stackoverflow\.com/.test(lowerUrl)) return 'q&a';
    if (/medium\.com/.test(lowerUrl) || /dev\.to/.test(lowerUrl)) return 'article';
    if (/youtube\.com/.test(lowerUrl) || /youtu\.be/.test(lowerUrl)) return 'video';
    
    // Проверяем контент
    if (/\b(API|endpoint|endpoint|request|response|parameter)\b/i.test(content)) return 'api-docs';
    if (/\b(tutorial|guide|step|how to|walkthrough)\b/i.test(content)) return 'tutorial';
    if (/\b(example|code|snippet|function|class)\b/i.test(content)) return 'code-reference';
    if (/\b(news|announcing|released|version|update)\b/i.test(content)) return 'news';
    
    return 'article';
  }

  /**
   * Расчёт релевантности
   */
  calculateRelevance(fetchResult, site) {
    let score = 0.5; // Базовый score
    
    // Длина контента
    const contentLength = fetchResult.content.length;
    if (contentLength > 5000) score += 0.2;
    else if (contentLength > 2000) score += 0.1;
    
    // Наличие заголовка
    if (fetchResult.title && fetchResult.title.length > 10) score += 0.1;
    
    // Источник
    const url = site.url || fetchResult.url;
    if (/docs\./.test(url)) score += 0.1;
    if (/github\.com/.test(url)) score += 0.05;
    if (/stackoverflow\.com/.test(url)) score += 0.05;
    
    return Math.min(score, 1.0);
  }

  /**
   * Проверка заблокированных доменов
   */
  isBlockedDomain(hostname) {
    const blockedPatterns = [
      /facebook\.com/,
      /twitter\.com/,
      /x\.com/,
      /instagram\.com/,
      /tiktok\.com/,
      /pinterest\.com/,
      /linkedin\.com/,
      /\.pdf$/,
      /\.doc$/,
      /\.docx$/
    ];
    
    return blockedPatterns.some(pattern => pattern.test(hostname));
  }

  /**
   * Агрегация контента из нескольких источников
   */
  aggregateContent(fetchResults, options = {}) {
    const maxTotalLength = options.maxTotalLength || 50000;
    const minRelevance = options.minRelevance || 0.3;
    
    // Фильтруем по релевантности
    const relevantResults = fetchResults
      .filter(r => r.relevanceScore >= minRelevance)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // Собираем агрегированный контент
    let aggregated = {
      sources: [],
      combinedSummary: '',
      allKeyPoints: [],
      contentByType: {},
      totalWordCount: 0,
      totalCharCount: 0
    };
    
    let currentLength = 0;
    
    for (const result of relevantResults) {
      // Добавляем источник
      aggregated.sources.push({
        url: result.url,
        title: result.title,
        type: result.contentType,
        relevance: result.relevanceScore,
        wordCount: result.wordCount
      });
      
      // Добавляем выжимку
      const summaryToAdd = result.summary;
      if (currentLength + summaryToAdd.length <= maxTotalLength) {
        aggregated.combinedSummary += `\n\n--- ${result.title} ---\n${summaryToAdd}`;
        currentLength += summaryToAdd.length;
      }
      
      // Собираем ключевые моменты
      aggregated.allKeyPoints.push(...result.keyPoints);
      
      // Группируем по типу контента
      if (!aggregated.contentByType[result.contentType]) {
        aggregated.contentByType[result.contentType] = [];
      }
      aggregated.contentByType[result.contentType].push({
        url: result.url,
        title: result.title,
        summary: result.summary
      });
      
      aggregated.totalWordCount += result.wordCount;
      aggregated.totalCharCount += result.charCount;
    }
    
    // Уникальные ключевые моменты
    aggregated.allKeyPoints = [...new Set(aggregated.allKeyPoints)].slice(0, 20);
    
    return aggregated;
  }

  /**
   * Генерация LLM-контекста из агрегированных данных
   */
  generateLLMContext(aggregatedData, topic) {
    const sections = [];
    
    sections.push(`# Research Data for: ${topic}\n`);
    
    // Сводка
    sections.push(`## Summary\n`);
    sections.push(`Sources analyzed: ${aggregatedData.sources.length}`);
    sections.push(`Total word count: ${aggregatedData.totalWordCount}`);
    sections.push(`Content types: ${Object.keys(aggregatedData.contentByType).join(', ')}\n`);
    
    // Ключевые моменты
    if (aggregatedData.allKeyPoints.length > 0) {
      sections.push(`## Key Points\n`);
      aggregatedData.allKeyPoints.forEach((point, i) => {
        sections.push(`${i + 1}. ${point}`);
      });
      sections.push('');
    }
    
    // Контент по источникам
    sections.push(`## Content from Sources\n`);
    
    // Сначала документация
    if (aggregatedData.contentByType['documentation']) {
      sections.push(`### Official Documentation\n`);
      aggregatedData.contentByType['documentation'].forEach(doc => {
        sections.push(`**${doc.title}** (${doc.url})`);
        sections.push(doc.summary.substring(0, 1000));
        sections.push('');
      });
    }
    
    // Затем туториалы
    if (aggregatedData.contentByType['tutorial']) {
      sections.push(`### Tutorials & Guides\n`);
      aggregatedData.contentByType['tutorial'].forEach(tut => {
        sections.push(`**${tut.title}** (${tut.url})`);
        sections.push(tut.summary.substring(0, 800));
        sections.push('');
      });
    }
    
    // Остальной контент
    const otherTypes = Object.keys(aggregatedData.contentByType)
      .filter(t => !['documentation', 'tutorial'].includes(t));
    
    for (const type of otherTypes) {
      sections.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s\n`);
      aggregatedData.contentByType[type].forEach(item => {
        sections.push(`**${item.title}** (${item.url})`);
        sections.push(item.summary.substring(0, 600));
        sections.push('');
      });
    }
    
    return sections.join('\n');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { ContentFetcher };
