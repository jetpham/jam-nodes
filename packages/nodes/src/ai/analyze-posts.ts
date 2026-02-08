import { defineNode } from '@jam-nodes/core';
import {
  SocialAiAnalyzeInputSchema,
  SocialAiAnalyzeOutputSchema,
  type SocialPost,
  type AnalyzedPost,
} from '../schemas/ai';
import {
  buildAnalysisPrompt,
  normalizeSentiment,
  normalizeUrgency,
  MIN_RELEVANCE_SCORE,
  ANALYSIS_BATCH_SIZE,
} from '../prompts/analyze-posts';

// Re-export schemas and types for convenience
export {
  SocialAiAnalyzeInputSchema,
  SocialAiAnalyzeOutputSchema,
  type SocialAiAnalyzeInput,
  type SocialAiAnalyzeOutput,
  type SocialPost,
  type AnalyzedPost,
} from '../schemas/ai';

/**
 * Social AI Analyze Node
 *
 * Uses Claude to analyze social media posts for relevance, sentiment,
 * complaint detection, and urgency. Batches posts to stay within context limits.
 *
 * Requires `context.services.anthropic` to be provided by the host application.
 * Optionally uses `context.services.analyzedPosts` to store results.
 *
 * @example
 * ```typescript
 * const result = await socialAiAnalyzeNode.executor({
 *   twitterPosts: [...],
 *   redditPosts: [...],
 *   topic: 'Project management software',
 *   userIntent: 'Find people frustrated with current tools'
 * }, context);
 * ```
 */
export const socialAiAnalyzeNode = defineNode({
  type: 'social_ai_analyze',
  name: 'Social AI Analyze',
  description: 'Analyze social media posts for relevance, sentiment, and urgency using AI',
  category: 'action',
  inputSchema: SocialAiAnalyzeInputSchema,
  outputSchema: SocialAiAnalyzeOutputSchema,
  estimatedDuration: 60,
  capabilities: {
    supportsRerun: true,
    supportsBulkActions: true,
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

      // Combine posts from all platforms
      const allPosts: SocialPost[] = [
        ...(input.twitterPosts || []),
        ...(input.redditPosts || []),
        ...(input.linkedinPosts || []),
        ...(input.posts || []),
      ];

      if (allPosts.length === 0) {
        return {
          success: true,
          output: {
            analyzedPosts: [],
            highPriorityPosts: [],
            complaints: [],
            totalAnalyzed: 0,
            highPriorityCount: 0,
            complaintCount: 0,
            averageRelevance: 0,
          },
        };
      }

      // Batch posts for Claude (to stay within context limits)
      const allAnalyzedPosts: AnalyzedPost[] = [];

      for (let i = 0; i < allPosts.length; i += ANALYSIS_BATCH_SIZE) {
        const batch = allPosts.slice(i, i + ANALYSIS_BATCH_SIZE);

        const prompt = buildAnalysisPrompt(input.topic, input.userIntent, batch);

        const responseText = await context.services.anthropic.generateText({
          prompt,
          model: 'claude-sonnet-4-20250514',
          maxTokens: 4000,
        });

        // Parse JSON from response
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          continue;
        }

        try {
          const analyzed = JSON.parse(jsonMatch[0]) as Array<{
            id: string;
            relevanceScore: number;
            sentiment: string;
            isComplaint: boolean;
            urgencyLevel: string;
            aiSummary: string;
            matchedKeywords: string[];
          }>;

          // Merge analysis with original post data
          for (const analysis of analyzed) {
            const originalPost = batch.find((p) => p.id === analysis.id);
            if (originalPost && analysis.relevanceScore >= MIN_RELEVANCE_SCORE) {
              allAnalyzedPosts.push({
                ...originalPost,
                relevanceScore: analysis.relevanceScore,
                sentiment: normalizeSentiment(analysis.sentiment),
                isComplaint: Boolean(analysis.isComplaint),
                urgencyLevel: normalizeUrgency(analysis.urgencyLevel),
                aiSummary: analysis.aiSummary || '',
                matchedKeywords: analysis.matchedKeywords || [],
              });
            }
          }
        } catch {
          continue;
        }
      }

      // Sort by relevance (highest first)
      allAnalyzedPosts.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Filter high priority and complaints
      const highPriorityPosts = allAnalyzedPosts.filter(
        (p) => p.urgencyLevel === 'high' || p.relevanceScore >= 80
      );
      const complaints = allAnalyzedPosts.filter((p) => p.isComplaint);

      // Calculate average relevance
      const averageRelevance =
        allAnalyzedPosts.length > 0
          ? Math.round(
              allAnalyzedPosts.reduce((sum, p) => sum + p.relevanceScore, 0) /
                allAnalyzedPosts.length
            )
          : 0;

      // Store analyzed posts if service available
      if (context.services?.analyzedPosts && input.monitoringConfigId && allAnalyzedPosts.length > 0) {
        await context.services.analyzedPosts.storePosts({
          monitoringConfigId: input.monitoringConfigId,
          posts: allAnalyzedPosts.map(post => ({
            platform: post.platform,
            externalId: post.id,
            url: post.url,
            text: post.text,
            authorName: post.authorName,
            authorHandle: post.authorHandle,
            authorUrl: post.authorUrl,
            authorFollowers: post.authorFollowers,
            engagement: post.engagement,
            relevanceScore: post.relevanceScore,
            sentiment: post.sentiment,
            isComplaint: post.isComplaint,
            urgencyLevel: post.urgencyLevel,
            aiSummary: post.aiSummary,
            matchedKeywords: post.matchedKeywords,
            postedAt: new Date(post.postedAt),
          })),
        });
      }

      // Optional: send notification if service available
      if (context.services?.notifications && allAnalyzedPosts.length > 0) {
        await context.services.notifications.send({
          userId: context.userId,
          title: 'Social Posts Analyzed',
          message: `Analyzed ${allAnalyzedPosts.length} posts (${highPriorityPosts.length} high priority)`,
          data: {
            totalAnalyzed: allAnalyzedPosts.length,
            highPriority: highPriorityPosts.length,
            complaints: complaints.length,
          },
        });
      }

      return {
        success: true,
        output: {
          analyzedPosts: allAnalyzedPosts,
          highPriorityPosts,
          complaints,
          totalAnalyzed: allAnalyzedPosts.length,
          highPriorityCount: highPriorityPosts.length,
          complaintCount: complaints.length,
          averageRelevance,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze posts',
      };
    }
  },
});
