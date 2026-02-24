/**
 * Web Research Module
 * Поиск и анализ веб-источников для Deep Learning
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { execSync } = require('child_process');
const { ContentFetcher } = require('../content-fetcher');

class WebResearch {
  constructor() {
    this.braveApiKey = process.env.BRAVE_API_KEY;
    this.ddgFallback = true;
    this.contentFetcher = new ContentFetcher({
      maxSites: 20,
      timeout: 15000,
      maxContentLength: 10000,
      maxSummaryLength: 2000,
      concurrency: 5
    });
  }

  /**
   * DuckDuckGo search via Python library (most reliable)
   * Option 1: Python duckduckgo-search
   */
  async searchDuckDuckGoPython(query, limit = 20) {
    const { spawn } = require('child_process');
    const path = require('path');
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../scripts/ddg_search.py');
      const python = spawn('python3', [scriptPath, query, limit.toString()], {
        timeout: 30000
      });
      
      let output = '';
      let error = '';
      
      python.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      python.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      python.on('close', (code) => {
        if (code !== 0) {
          console.warn(`[WebResearch] Python DDG failed: ${error}`);
          reject(new Error('Python script failed'));
          return;
        }
        
        try {
          const result = JSON.parse(output);
          if (result.success) {
            console.log(`[WebResearch] Python DDG: ${result.count} results`);
            resolve(result.results);
          } else {
            reject(new Error(result.error));
          }
        } catch (e) {
          reject(new Error('Invalid JSON from Python'));
        }
      });
      
      python.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Main search - tries multiple methods in order
   * Order: Python DDG -> HTML DDG -> DDG Lite -> StackExchange -> Reddit -> Wikipedia -> YouTube -> Brave
   */
  async search(query, options = {}) {
    const limit = options.limit || 20;
    const methods = [
      { name: 'Python DDG', fn: () => this.searchDuckDuckGoPython(query, limit) },
      { name: 'DDG HTML', fn: () => this.searchDuckDuckGo(query, limit) },
      { name: 'DDG Lite', fn: () => this.searchDuckDuckGoLite(query, limit) },
      { name: 'StackExchange', fn: () => this.searchStackExchange(query, limit) },
      { name: 'Reddit', fn: () => this.searchReddit(query, limit) },
      { name: 'Wikipedia', fn: () => this.searchWikipedia(query, limit) },
      { name: 'YouTube', fn: () => this.searchYouTube(query, limit) },
    ];
    
    // Add Brave if API key available
    if (this.braveApiKey) {
      methods.push({
        name: 'Brave',
        fn: () => this.searchBrave(query, limit)
      });
    }
    
    for (const method of methods) {
      try {
        const results = await method.fn();
        if (results.length >= 3) { // Lower threshold for diverse sources
          console.log(`[WebResearch] Using ${method.name}: ${results.length} results`);
          return results.slice(0, limit);
        }
      } catch (e) {
        console.warn(`[WebResearch] ${method.name} failed: ${e.message}`);
      }
    }
    
    console.warn('[WebResearch] All search methods failed');
    return [];
  }

  /**
   * Brave Search API
   */
  async searchBrave(query, limit = 20) {
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      headers: {
        'X-Subscription-Token': this.braveApiKey,
        'Accept': 'application/json'
      },
      params: {
        q: query,
        count: limit,
        offset: 0,
        mkt: 'en-US',
        safesearch: 'off',
        freshness: 'py' // Past year
      },
      timeout: 15000
    });

    return response.data.web?.results?.map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      source: 'brave',
      age: r.age,
      page_age: r.page_age
    })) || [];
  }

  /**
   * DuckDuckGo fallback (using duckduckgo-lite)
   */
  async searchDuckDuckGo(query, limit = 20) {
    // Use ddgr CLI tool or scrape HTML
    try {
      const cmd = `ddgr --np --json "${query.replace(/"/g, '\\"')}" 2>/dev/null | head -${limit}`;
      const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
      
      const results = [];
      const lines = output.trim().split('\n').filter(l => l);
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          results.push({
            title: data.title,
            url: data.url,
            description: data.abstract,
            source: 'ddg'
          });
        } catch {}
      }
      
      return results;
    } catch {
      // If ddgr not available, return empty
      return [];
    }
  }

  /**
   * Fetch and parse webpage content
   */
  async fetchPage(url, options = {}) {
    try {
      const response = await axios.get(url, {
        timeout: options.timeout || 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        maxRedirects: 3
      });

      const $ = cheerio.load(response.data);
      
      // Remove script/style/nav/footer
      $('script, style, nav, footer, header, aside, .ads, .cookie-banner').remove();
      
      // Extract main content
      let content = '';
      
      // Try to find main content area
      const mainSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.documentation',
        '#content',
        '.main-content'
      ];
      
      for (const selector of mainSelectors) {
        const text = $(selector).text().trim();
        if (text.length > 500) {
          content = text;
          break;
        }
      }
      
      // Fallback to body
      if (!content) {
        content = $('body').text().trim();
      }
      
      // Clean up
      content = content
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .substring(0, 15000); // Limit to 15k chars

      return {
        url,
        title: $('title').text().trim() || url,
        content,
        length: content.length
      };
    } catch (error) {
      console.warn(`[WebResearch] Failed to fetch ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Search GitHub repositories
   * Топ-20 репозиториев
   */
  async searchGitHub(query, limit = 20) {
    const searchQuery = `${query} stars:>100 language:JavaScript OR language:TypeScript OR language:Python`;
    
    try {
      const response = await axios.get('https://api.github.com/search/repositories', {
        headers: process.env.GITHUB_TOKEN ? {
          'Authorization': `token ${process.env.GITHUB_TOKEN}`
        } : {},
        params: {
          q: searchQuery,
          sort: 'stars',
          order: 'desc',
          per_page: limit
        },
        timeout: 15000
      });

      return response.data.items?.map(repo => ({
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description,
        stars: repo.stargazers_count,
        language: repo.language,
        topics: repo.topics || [],
        source: 'github'
      })) || [];
    } catch (error) {
      console.warn('[WebResearch] GitHub search failed:', error.message);
      return [];
    }
  }

  /**
   * Analyze GitHub repository structure
   */
  async analyzeRepo(fullName) {
    try {
      // Get README
      const readmeResponse = await axios.get(
        `https://api.github.com/repos/${fullName}/readme`,
        {
          headers: process.env.GITHUB_TOKEN ? {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`
          } : {},
          timeout: 10000
        }
      );
      
      const readme = Buffer.from(readmeResponse.data.content, 'base64').toString('utf8');
      
      // Get repo info
      const infoResponse = await axios.get(
        `https://api.github.com/repos/${fullName}`,
        {
          headers: process.env.GITHUB_TOKEN ? {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`
          } : {},
          timeout: 10000
        }
      );

      return {
        fullName,
        readme: readme.substring(0, 10000),
        description: infoResponse.data.description,
        stars: infoResponse.data.stargazers_count,
        language: infoResponse.data.language,
        topics: infoResponse.data.topics || [],
        hasWiki: infoResponse.data.has_wiki,
        hasPages: infoResponse.data.has_pages
      };
    } catch (error) {
      console.warn(`[WebResearch] Failed to analyze ${fullName}:`, error.message);
      return null;
    }
  }

  /**
   * Find official documentation URL
   */
  async findDocumentation(technology) {
    const commonPatterns = [
      `https://docs.${technology.toLowerCase()}.io`,
      `https://docs.${technology.toLowerCase()}.com`,
      `https://${technology.toLowerCase()}.dev/docs`,
      `https://${technology.toLowerCase()}.org/docs`,
      `https://docs.${technology.toLowerCase()}.dev`,
      `https://www.${technology.toLowerCase()}.com/docs`,
      `https://doc.${technology.toLowerCase()}.org`,
      `https://developer.${technology.toLowerCase()}.org`
    ];

    for (const url of commonPatterns) {
      try {
        const response = await axios.head(url, {
          timeout: 5000,
          maxRedirects: 2,
          validateStatus: status => status < 400
        });
        
        if (response.status < 400) {
          return url;
        }
      } catch {
        // Try next
      }
    }

    return null;
  }

  /**
   * StackExchange API search (StackOverflow, etc.)
   * Q&A for technical topics
   */
  async searchStackExchange(query, limit = 20) {
    try {
      // Try StackOverflow first
      const response = await axios.get('https://api.stackexchange.com/2.3/search', {
        params: {
          order: 'desc',
          sort: 'relevance',
          intitle: query,
          site: 'stackoverflow',
          pagesize: Math.min(limit, 30)
        },
        timeout: 15000
      });

      const results = response.data.items?.map(item => ({
        title: item.title,
        url: item.link,
        description: `Score: ${item.score}, Answers: ${item.answer_count}, Tags: ${item.tags?.join(', ')}`,
        source: 'stackoverflow',
        score: item.score,
        answerCount: item.answer_count
      })) || [];

      console.log(`[WebResearch] StackExchange: ${results.length} results`);
      return results;
    } catch (error) {
      console.warn('[WebResearch] StackExchange failed:', error.message);
      return [];
    }
  }

  /**
   * Reddit API search
   * Discussions and opinions
   */
  async searchReddit(query, limit = 20) {
    try {
      const response = await axios.get('https://www.reddit.com/search.json', {
        params: {
          q: query,
          limit: Math.min(limit, 25),
          sort: 'relevance',
          t: 'year' // Last year
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)'
        },
        timeout: 15000
      });

      const results = response.data.data?.children?.map(child => {
        const post = child.data;
        return {
          title: post.title,
          url: `https://reddit.com${post.permalink}`,
          description: post.selftext?.substring(0, 200) || `Subreddit: r/${post.subreddit}`,
          source: 'reddit',
          subreddit: post.subreddit,
          score: post.score,
          comments: post.num_comments
        };
      }) || [];

      console.log(`[WebResearch] Reddit: ${results.length} results`);
      return results;
    } catch (error) {
      console.warn('[WebResearch] Reddit failed:', error.message);
      return [];
    }
  }

  /**
   * Wikipedia API search
   * Facts and definitions
   */
  async searchWikipedia(query, limit = 10) {
    try {
      // First, search for pages
      const searchResponse = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          format: 'json',
          origin: '*',
          srlimit: Math.min(limit, 10)
        },
        timeout: 15000
      });

      const searchResults = searchResponse.data.query?.search || [];
      
      if (searchResults.length === 0) {
        return [];
      }

      // Get extract for the first/best result
      const titles = searchResults.map(r => r.title).join('|');
      const extractResponse = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          prop: 'extracts',
          titles: titles,
          format: 'json',
          origin: '*',
          exintro: true,
          explaintext: true,
          exlimit: Math.min(limit, 10)
        },
        timeout: 15000
      });

      const pages = extractResponse.data.query?.pages || {};
      const results = [];

      for (const [pageId, page] of Object.entries(pages)) {
        if (pageId === '-1') continue; // Missing page
        
        results.push({
          title: page.title,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
          description: page.extract?.substring(0, 500) || '',
          source: 'wikipedia'
        });
      }

      console.log(`[WebResearch] Wikipedia: ${results.length} results`);
      return results;
    } catch (error) {
      console.warn('[WebResearch] Wikipedia failed:', error.message);
      return [];
    }
  }

  /**
   * YouTube Data API search
   * Video tutorials and talks
   */
  async searchYouTube(query, limit = 10) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    
    if (!apiKey) {
      console.log('[WebResearch] YouTube API key not set, skipping');
      return [];
    }

    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          q: query,
          type: 'video',
          maxResults: Math.min(limit, 10),
          order: 'relevance',
          videoEmbeddable: true,
          key: apiKey
        },
        timeout: 15000
      });

      const results = response.data.items?.map(item => ({
        title: item.snippet.title,
        url: `https://youtube.com/watch?v=${item.id.videoId}`,
        description: item.snippet.description?.substring(0, 300) || '',
        source: 'youtube',
        channel: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt
      })) || [];

      console.log(`[WebResearch] YouTube: ${results.length} results`);
      return results;
    } catch (error) {
      console.warn('[WebResearch] YouTube failed:', error.message);
      return [];
    }
  }

  /**
   * Collect research data only (no generation)
   * Сбор данных без генерации контента - УЛУЧШЕННАЯ ВЕРСИЯ с топ-20 сайтами
   */
  async collectResearchData(topicName, options = {}) {
    console.log(`[WebResearch] Collecting data for: ${topicName}`);
    
    const results = {
      topic: topicName,
      searchResults: [],
      githubRepos: [],
      documentation: null,
      fetchedSites: [],
      aggregatedContent: null,
      llmContext: '',
      collectedAt: new Date().toISOString()
    };

    // 1. Web search (top 20)
    if (options.webSearch !== false) {
      results.searchResults = await this.search(topicName, { limit: 20 });
      console.log(`[WebResearch]  - Web search: ${results.searchResults.length} results`);
    }

    // 2. GitHub repos (top 20)
    if (options.githubSearch !== false) {
      results.githubRepos = await this.searchGitHub(topicName, 20);
      console.log(`[WebResearch]  - GitHub: ${results.githubRepos.length} repos`);
    }

    // 3. Find documentation
    if (options.findDocs !== false) {
      results.documentation = await this.findDocumentation(topicName);
      console.log(`[WebResearch]  - Docs: ${results.documentation || 'not found'}`);
    }

    // 4. ENHANCED: Fetch top 20 sites with content extraction
    if (options.fetchContent !== false && results.searchResults.length > 0) {
      console.log(`[WebResearch]  - Fetching top 20 sites...`);
      
      const fetchResult = await this.contentFetcher.fetchTopSites(
        results.searchResults,
        { limit: 20 }
      );
      
      results.fetchedSites = fetchResult.fetched;
      results.fetchErrors = fetchResult.errors;
      
      console.log(`[WebResearch]    ✓ Successfully fetched: ${fetchResult.fetched.length}`);
      console.log(`[WebResearch]    ✗ Failed: ${fetchResult.errors.length}`);
      
      // 5. Aggregate content from all fetched sites
      if (results.fetchedSites.length > 0) {
        console.log(`[WebResearch]  - Aggregating content...`);
        
        results.aggregatedContent = this.contentFetcher.aggregateContent(
          results.fetchedSites,
          { maxTotalLength: 50000, minRelevance: 0.3 }
        );
        
        console.log(`[WebResearch]    Sources: ${results.aggregatedContent.sources.length}`);
        console.log(`[WebResearch]    Total words: ${results.aggregatedContent.totalWordCount}`);
        console.log(`[WebResearch]    Key points: ${results.aggregatedContent.allKeyPoints.length}`);
        
        // 6. Generate LLM-ready context
        results.llmContext = this.contentFetcher.generateLLMContext(
          results.aggregatedContent,
          topicName
        );
        
        console.log(`[WebResearch]    LLM context size: ${results.llmContext.length} chars`);
      }
    }

    console.log(`[WebResearch] Collection complete for: ${topicName}`);
    return results;
  }

  /**
   * Generate content using collected research data
   * Генерация контента на основе собранных данных (для 2-hop)
   */
  async generateFromResearch(researchData, options = {}) {
    console.log(`[WebResearch] Generating content from research for: ${researchData.topic}`);
    
    // Используем новый LLM контекст если доступен
    if (researchData.llmContext && researchData.llmContext.length > 0) {
      const githubContext = researchData.githubRepos
        .slice(0, 5)
        .map(r => `Repo: ${r.fullName} (${r.stars}⭐)\nDescription: ${r.description}`)
        .join('\n');

      const prompt = `Based on the following comprehensive research data about "${researchData.topic}", generate detailed knowledge:

${researchData.llmContext.substring(0, 15000)}

GITHUB REPOSITORIES:
${githubContext}

OFFICIAL DOCUMENTATION: ${researchData.documentation || 'N/A'}

Generate structured content with:
1. Detailed description (2-3 paragraphs)
2. Best practices (8-10 specific items)
3. Common mistakes (6-8 items with explanations)
4. Tools and ecosystem (8-10 items)
5. Deployment considerations
6. Current trends and recommendations

Use factual information from sources. Be specific and actionable. Avoid generic advice.`;

      return {
        prompt,
        sources: {
          web: researchData.searchResults?.length || 0,
          github: researchData.githubRepos?.length || 0,
          fetchedSites: researchData.fetchedSites?.length || 0,
          aggregatedSources: researchData.aggregatedContent?.sources?.length || 0
        },
        keyPoints: researchData.aggregatedContent?.allKeyPoints || []
      };
    }
    
    // Fallback на старый формат
    if (!researchData || (!researchData.fetchedPages?.length && !researchData.fetchedSites?.length)) {
      console.log(`[WebResearch] No research data, skipping generation`);
      return null;
    }

    // Prepare context from research (legacy format)
    const webContext = researchData.fetchedPages
      ?.map(p => `Source: ${p.url}\nTitle: ${p.title}\nContent: ${p.content?.substring(0, 2000) || ''}`)
      .join('\n\n---\n\n') || '';
    
    const githubContext = researchData.githubRepos
      ?.slice(0, 5)
      .map(r => `Repo: ${r.fullName} (${r.stars}⭐)\nDescription: ${r.description}`)
      .join('\n') || '';

    const prompt = `Based on the following research data about "${researchData.topic}", generate comprehensive knowledge:

WEB SOURCES:
${webContext.substring(0, 10000)}

GITHUB REPOSITORIES:
${githubContext}

OFFICIAL DOCUMENTATION: ${researchData.documentation || 'N/A'}

Generate structured content with:
1. Detailed description
2. Best practices (8-10 items)
3. Common mistakes (6-8 items)
4. Tools and ecosystem (8-10 items)
5. Deployment considerations
6. Current trends

Use only factual information from sources.`;

    return {
      prompt,
      sources: {
        web: researchData.searchResults?.length || 0,
        github: researchData.githubRepos?.length || 0,
        pages: researchData.fetchedPages?.length || 0
      }
    };
  }
}

module.exports = { WebResearch };
