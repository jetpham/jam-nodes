import { defineNode } from '@jam-nodes/core';
import {
  SocialKeywordGeneratorInputSchema,
  SocialKeywordGeneratorOutputSchema,
  type SocialKeywordGeneratorOutput,
} from '../schemas/ai';
import { buildKeywordPrompt } from '../prompts/keyword-generator';

// Re-export schemas for convenience
export {
  SocialKeywordGeneratorInputSchema,
  SocialKeywordGeneratorOutputSchema,
  type SocialKeywordGeneratorInput,
  type SocialKeywordGeneratorOutput,
} from '../schemas/ai';

/**
 * Social Keyword Generator Node
 *
 * Uses Claude to generate platform-specific search keywords from a user's
 * natural language topic description. Outputs ready-to-use search queries
 * for Twitter, Reddit, and LinkedIn.
 *
 * Requires `context.services.anthropic` to be provided by the host application.
 *
 * @example
 * ```typescript
 * const result = await socialKeywordGeneratorNode.executor({
 *   topic: 'People frustrated with project management tools',
 *   userKeywords: ['asana', 'monday.com']
 * }, context);
 * ```
 */
export const socialKeywordGeneratorNode = defineNode({
  type: 'social_keyword_generator',
  name: 'Social Keyword Generator',
  description: 'Generate platform-specific search keywords using AI for social monitoring',
  category: 'action',
  inputSchema: SocialKeywordGeneratorInputSchema,
  outputSchema: SocialKeywordGeneratorOutputSchema,
  estimatedDuration: 15,
  capabilities: {
    supportsRerun: true,
  },

  executor: async (input, context) => {
    try {
      // Require Anthropic service
      if (!context.services?.anthropic) {
        return {
          success: false,
          error: 'Anthropic service not configured. Please provide context.services.anthropic.',
        };
      }

      // Build prompt using helper
      const prompt = buildKeywordPrompt(input.topic, input.userKeywords);

      // Call Claude to generate keywords
      const responseText = await context.services.anthropic.generateText({
        prompt,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 2000,
      });

      // Parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'Could not parse keyword response' };
      }

      let parsed: {
        twitter: { keywords: string[]; searchQuery: string };
        reddit: { keywords: string[] };
        linkedin: { keywords: string[]; searchQueries: string[] };
      };

      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return { success: false, error: 'Failed to parse keyword JSON response' };
      }

      // Merge user keywords into generated keywords (deduplicated)
      const mergedTwitterKeywords = [...new Set([
        ...parsed.twitter.keywords,
        ...(input.userKeywords || []),
      ])];

      const mergedRedditKeywords = [...new Set([
        ...parsed.reddit.keywords,
        ...(input.userKeywords || []),
      ])];

      const mergedLinkedInKeywords = [...new Set([
        ...parsed.linkedin.keywords,
        ...(input.userKeywords || []),
      ])];

      // Collect all unique keywords
      const allKeywords = [...new Set([
        ...mergedTwitterKeywords,
        ...mergedRedditKeywords,
        ...mergedLinkedInKeywords,
      ])];

      const output: SocialKeywordGeneratorOutput = {
        topic: input.topic,
        twitter: {
          keywords: mergedTwitterKeywords,
          searchQuery: parsed.twitter.searchQuery,
        },
        reddit: {
          keywords: mergedRedditKeywords,
        },
        linkedin: {
          keywords: mergedLinkedInKeywords,
          searchQueries: parsed.linkedin.searchQueries,
        },
        allKeywords,
      };

      // Optional: send notification if service available
      if (context.services?.notifications) {
        await context.services.notifications.send({
          userId: context.userId,
          title: 'Keywords Generated',
          message: `Generated ${allKeywords.length} keywords for "${input.topic}"`,
          data: {
            totalKeywords: allKeywords.length,
            twitterKeywords: mergedTwitterKeywords.length,
            redditKeywords: mergedRedditKeywords.length,
            linkedinKeywords: mergedLinkedInKeywords.length,
          },
        });
      }

      return {
        success: true,
        output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate keywords',
      };
    }
  },
});
