import { z } from 'zod';
import { defineNode } from '@jam-nodes/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Twitter/X post in unified social format
 */
export interface TwitterPost {
  id: string;
  platform: 'twitter';
  url: string;
  text: string;
  authorName: string;
  authorHandle: string;
  authorUrl: string;
  authorFollowers: number;
  engagement: {
    likes: number;
    comments: number;
    shares: number;
    views: number;
  };
  postedAt: string;
}

// =============================================================================
// Schemas
// =============================================================================

export const TwitterMonitorInputSchema = z.object({
  /** Keywords to search for */
  keywords: z.array(z.string()),
  /** Exclude retweets from results */
  excludeRetweets: z.boolean().optional().default(true),
  /** Minimum likes filter */
  minLikes: z.number().optional(),
  /** Maximum number of results */
  maxResults: z.number().optional().default(50),
  /** Language filter (e.g., 'en') */
  lang: z.string().optional(),
  /** Search tweets from last N days */
  sinceDays: z.number().optional(),
});

export type TwitterMonitorInput = z.infer<typeof TwitterMonitorInputSchema>;

export const TwitterMonitorOutputSchema = z.object({
  posts: z.array(z.object({
    id: z.string(),
    platform: z.literal('twitter'),
    url: z.string(),
    text: z.string(),
    authorName: z.string(),
    authorHandle: z.string(),
    authorUrl: z.string(),
    authorFollowers: z.number(),
    engagement: z.object({
      likes: z.number(),
      comments: z.number(),
      shares: z.number(),
      views: z.number(),
    }),
    postedAt: z.string(),
  })),
  totalFound: z.number(),
  hasMore: z.boolean(),
  cursor: z.string().optional(),
});

export type TwitterMonitorOutput = z.infer<typeof TwitterMonitorOutputSchema>;

// =============================================================================
// Query Builder
// =============================================================================

/**
 * Build Twitter search query with proper syntax
 */
function buildTwitterSearchQuery(
  keywords: string[],
  options: {
    excludeRetweets?: boolean;
    minLikes?: number;
    since?: string;
    lang?: string;
  } = {}
): string {
  // Join keywords with OR
  const keywordQuery = keywords
    .map((k) => (k.includes(' ') ? `"${k}"` : k))
    .join(' OR ');

  let query = `(${keywordQuery})`;

  if (options.excludeRetweets) {
    query += ' -is:retweet';
  }

  if (options.minLikes) {
    query += ` min_faves:${options.minLikes}`;
  }

  if (options.since) {
    query += ` since:${options.since}`;
  }

  if (options.lang) {
    query += ` lang:${options.lang}`;
  }

  return query;
}

// =============================================================================
// Node Definition
// =============================================================================

/**
 * Twitter Monitor Node
 *
 * Searches Twitter/X for posts matching keywords.
 * Requires `context.services.twitter` to be provided by the host application.
 *
 * @example
 * ```typescript
 * const result = await twitterMonitorNode.executor({
 *   keywords: ['typescript', 'nodejs'],
 *   excludeRetweets: true,
 *   maxResults: 25,
 *   sinceDays: 7
 * }, context);
 * ```
 */
export const twitterMonitorNode = defineNode({
  type: 'twitter_monitor',
  name: 'Twitter Monitor',
  description: 'Search Twitter/X for posts matching keywords',
  category: 'integration',
  inputSchema: TwitterMonitorInputSchema,
  outputSchema: TwitterMonitorOutputSchema,
  estimatedDuration: 15,
  capabilities: {
    supportsRerun: true,
  },

  executor: async (input, context) => {
    try {
      if (!input.keywords || input.keywords.length === 0) {
        return {
          success: false,
          error: 'No keywords provided for Twitter search',
        };
      }

      // Require Twitter service
      if (!context.services?.twitter) {
        return {
          success: false,
          error: 'Twitter service not configured. Please provide context.services.twitter.',
        };
      }

      // Build the search query
      const sinceDate = input.sinceDays
        ? new Date(Date.now() - input.sinceDays * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0]
        : undefined;

      const query = buildTwitterSearchQuery(input.keywords, {
        excludeRetweets: input.excludeRetweets ?? true,
        minLikes: input.minLikes,
        since: sinceDate,
        lang: input.lang,
      });

      // Search tweets
      const tweets = await context.services.twitter.searchTweets(query, {
        maxResults: input.maxResults || 50,
        sinceDays: input.sinceDays,
      });

      // Transform to unified format
      const posts: TwitterPost[] = tweets.map((tweet) => ({
        id: tweet.id,
        platform: 'twitter' as const,
        url: tweet.url,
        text: tweet.text,
        authorName: tweet.authorName,
        authorHandle: tweet.authorHandle,
        authorUrl: `https://twitter.com/${tweet.authorHandle}`,
        authorFollowers: tweet.authorFollowers,
        engagement: {
          likes: tweet.likes,
          comments: tweet.replies,
          shares: tweet.retweets,
          views: tweet.views || 0,
        },
        postedAt: tweet.createdAt,
      }));

      // Optional: send notification if service available
      if (context.services?.notifications && posts.length > 0) {
        await context.services.notifications.send({
          userId: context.userId,
          title: 'Twitter Monitor Complete',
          message: `Found ${posts.length} tweets`,
          data: { posts: posts.slice(0, 5) },
        });
      }

      return {
        success: true,
        output: {
          posts,
          totalFound: posts.length,
          hasMore: false, // Simplified - pagination handled by service
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to monitor Twitter',
      };
    }
  },
});
