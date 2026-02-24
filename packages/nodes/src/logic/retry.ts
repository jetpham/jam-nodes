import { z } from 'zod';
import { defineNode, type NodeDefinition } from '@jam-nodes/core';

/**
 * Configuration schema for retry functionality
 */
export const RetryConfigSchema = z.object({
  /** Max retry attempts */
  maxRetries: z.number().int().min(1).max(10).default(3),
  /** Initial delay in milliseconds */
  initialDelayMs: z.number().min(0).optional().default(1000),
  /** Maximum delay cap in milliseconds */
  maxDelayMs: z.number().min(0).optional().default(30000),
  /** Exponential backoff multiplier */
  backoffMultiplier: z.number().min(1).optional().default(2),
});

export type RetryConfig = z.infer<typeof RetryConfigSchema>;

/**
 * Metadata added to successful retry execution outputs
 */
export const RetryMetadataSchema = z.object({
  retriesAttempted: z.number(),
  totalDurationMs: z.number(),
});

export type RetryMetadata = z.infer<typeof RetryMetadataSchema>;

/**
 * Higher-order node factory that wraps an existing node definition
 * with exponential backoff retry logic.
 *
 * @param node The node definition to wrap
 * @returns A new node definition with retry configuration and metadata schemas merged
 */
export function createRetryNode<TInput, TOutput>(
  node: NodeDefinition<TInput, TOutput>
): NodeDefinition<TInput & RetryConfig, TOutput & RetryMetadata> {
  return defineNode({
    type: `${node.type}_with_retry`,
    name: `${node.name} (Retry)`,
    description: `Retries execution on failure. ${node.description}`,
    category: node.category,

    // Intersect the schemas
    inputSchema: node.inputSchema.and(RetryConfigSchema) as unknown as z.ZodSchema<
      TInput & RetryConfig
    >,
    outputSchema: node.outputSchema.and(RetryMetadataSchema) as unknown as z.ZodSchema<
      TOutput & RetryMetadata
    >,
    capabilities: node.capabilities,

    executor: async (input, context) => {
      let attempt = 0;
      const start = Date.now();
      let lastError: string | undefined;

      while (attempt <= input.maxRetries) {
        try {
          // input satisfies TInput because of the intersection
          const result = await node.executor(input as unknown as TInput, context);

          if (result.success && result.output !== undefined) {
            return {
              success: true,
              output: {
                ...result.output,
                retriesAttempted: attempt,
                totalDurationMs: Date.now() - start,
              } as TOutput & RetryMetadata,
            };
          }

          lastError = result.error;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }

        if (attempt >= input.maxRetries) break;

        const delay = Math.min(
          (input.initialDelayMs || 1000) * Math.pow(input.backoffMultiplier || 2, attempt),
          input.maxDelayMs || 30000
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
      }

      return {
        success: false,
        error: `Failed after ${attempt} attempts. Last error: ${lastError}`,
      };
    },
  });
}
