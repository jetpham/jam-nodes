import { z } from 'zod';
import { defineNode } from '@jam-nodes/core';

// =============================================================================
// Schemas
// =============================================================================

export const SoraVideoInputSchema = z.object({
  /** Detailed description of the video to generate */
  prompt: z.string(),
  /** Sora model to use */
  model: z.enum(['sora-2', 'sora-2-pro']).optional().default('sora-2'),
  /** Video duration in seconds */
  seconds: z.union([z.literal(4), z.literal(8), z.literal(12)]).optional().default(4),
  /** Video dimensions */
  size: z.enum(['720x1280', '1280x720', '1024x1792', '1792x1024']).optional().default('1280x720'),
});

export type SoraVideoInput = z.infer<typeof SoraVideoInputSchema>;

export const SoraVideoOutputSchema = z.object({
  video: z.object({
    url: z.string(),
    durationSeconds: z.number(),
    size: z.string(),
    model: z.string(),
  }),
  processingTimeSeconds: z.number(),
});

export type SoraVideoOutput = z.infer<typeof SoraVideoOutputSchema>;

// =============================================================================
// Node Definition
// =============================================================================

/**
 * Sora Video Generation Node
 *
 * Generates videos using OpenAI Sora 2 API.
 * Requires `context.services.openai` to be provided by the host application.
 *
 * @example
 * ```typescript
 * const result = await soraVideoNode.executor({
 *   prompt: 'A serene ocean sunset with waves gently crashing',
 *   model: 'sora-2',
 *   seconds: 8,
 *   size: '1280x720'
 * }, context);
 * ```
 */
export const soraVideoNode = defineNode({
  type: 'sora_video',
  name: 'Generate Sora Video',
  description: 'Generate AI video using OpenAI Sora 2',
  category: 'integration',
  inputSchema: SoraVideoInputSchema,
  outputSchema: SoraVideoOutputSchema,
  estimatedDuration: 60,
  capabilities: {
    supportsRerun: true,
  },

  executor: async (input, context) => {
    try {
      // Require OpenAI service
      if (!context.services?.openai) {
        return {
          success: false,
          error: 'OpenAI service not configured. Please provide context.services.openai.',
        };
      }

      const startTime = Date.now();

      const result = await context.services.openai.generateVideo({
        prompt: input.prompt,
        model: input.model || 'sora-2',
        seconds: input.seconds || 4,
        size: input.size || '1280x720',
      });

      const processingTimeSeconds = Math.round((Date.now() - startTime) / 1000);

      return {
        success: true,
        output: {
          video: {
            url: result.url,
            durationSeconds: result.durationSeconds,
            size: input.size || '1280x720',
            model: input.model || 'sora-2',
          },
          processingTimeSeconds,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate video',
      };
    }
  },
});
