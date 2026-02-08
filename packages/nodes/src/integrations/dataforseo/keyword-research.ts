import { z } from 'zod';
import { defineNode } from '@jam-nodes/core';

// =============================================================================
// Schemas
// =============================================================================

export const SeoKeywordResearchInputSchema = z.object({
  /** Seed keywords to research */
  seedKeywords: z.array(z.string()),
  /** Location code (default: 2840 = US) */
  locationCode: z.number().optional().default(2840),
  /** Language code (default: 'en') */
  languageCode: z.string().optional().default('en'),
  /** Maximum keywords to return per seed */
  limit: z.number().optional().default(30),
});

export type SeoKeywordResearchInput = z.infer<typeof SeoKeywordResearchInputSchema>;

export const SeoKeywordResearchOutputSchema = z.object({
  keywords: z.array(z.object({
    keyword: z.string(),
    searchVolume: z.number(),
    keywordDifficulty: z.number(),
    cpc: z.string(),
    searchIntent: z.enum(['informational', 'commercial', 'navigational', 'transactional']),
  })),
  totalResearched: z.number(),
});

export type SeoKeywordResearchOutput = z.infer<typeof SeoKeywordResearchOutputSchema>;

// =============================================================================
// Node Definition
// =============================================================================

/**
 * SEO Keyword Research Node
 *
 * Takes seed keywords and enriches them with search volume, keyword difficulty,
 * CPC, and search intent data using DataForSEO API.
 *
 * Requires `context.services.dataForSeo` to be provided by the host application.
 *
 * @example
 * ```typescript
 * const result = await seoKeywordResearchNode.executor({
 *   seedKeywords: ['typescript tutorial', 'nodejs best practices'],
 *   locationCode: 2840, // US
 *   limit: 20
 * }, context);
 * ```
 */
export const seoKeywordResearchNode = defineNode({
  type: 'seo_keyword_research',
  name: 'Keyword Research',
  description: 'Research keywords to get search volume, difficulty, and intent data',
  category: 'integration',
  inputSchema: SeoKeywordResearchInputSchema,
  outputSchema: SeoKeywordResearchOutputSchema,
  estimatedDuration: 10,
  capabilities: {
    supportsRerun: true,
  },

  executor: async (input, context) => {
    try {
      // Require DataForSEO service
      if (!context.services?.dataForSeo) {
        return {
          success: false,
          error: 'DataForSEO service not configured. Please provide context.services.dataForSeo.',
        };
      }

      const researchedKeywords: SeoKeywordResearchOutput['keywords'] = [];
      const processedKeywords = new Set<string>();

      // Research each seed keyword
      for (const seedKeyword of input.seedKeywords) {
        if (!seedKeyword.trim()) continue;

        try {
          const results = await context.services.dataForSeo.getRelatedKeywords(
            [seedKeyword],
            {
              locationCode: input.locationCode ?? 2840,
              languageCode: input.languageCode ?? 'en',
              limit: input.limit ?? 30,
            }
          );

          for (const kw of results) {
            // Skip duplicates
            if (processedKeywords.has(kw.keyword.toLowerCase())) continue;
            processedKeywords.add(kw.keyword.toLowerCase());

            researchedKeywords.push({
              keyword: kw.keyword,
              searchVolume: kw.searchVolume,
              keywordDifficulty: kw.keywordDifficulty,
              cpc: kw.cpc.toString(),
              searchIntent: kw.searchIntent,
            });
          }
        } catch (kwError) {
          // Continue with other keywords on individual failures
          console.warn(`Error researching keyword "${seedKeyword}":`, kwError);
        }
      }

      // Sort by search volume descending
      researchedKeywords.sort((a, b) => b.searchVolume - a.searchVolume);

      return {
        success: true,
        output: {
          keywords: researchedKeywords,
          totalResearched: researchedKeywords.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to research keywords',
      };
    }
  },
});
