import { Injectable, Logger } from '@nestjs/common';
import FirecrawlApp from '@mendable/firecrawl-js';

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private firecrawl: FirecrawlApp | null = null;

  constructor() {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (apiKey) {
      this.firecrawl = new FirecrawlApp({ apiKey });
    } else {
      this.logger.warn('FIRECRAWL_API_KEY is not set. CrawlerService will not work.');
    }
  }

  async crawl(url: string): Promise<string> {
    this.logger.log(`Starting crawl for URL: ${url}`);
    
    if (!this.firecrawl) {
      throw new Error('Firecrawl API key is missing. Cannot crawl.');
    }

    try {
      const response = await this.firecrawl.scrapeUrl(url, {
        formats: ['markdown'],
      }) as any;



      const markdown = response.markdown;
      
      if (!markdown) {
         throw new Error(`Firecrawl returned no markdown content.`);
      }

      // Limit response length to prevent token overflows (e.g. 40k chars)
      const maxLength = 40000;
      if (markdown.length > maxLength) {
        return markdown.substring(0, maxLength) + '\n\n... [TRUNCATED]';
      }

      return markdown;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Crawling failed for ${url}: ${errMsg}`);
      throw new Error(`Failed to crawl website: ${errMsg}`);
    }
  }
}
