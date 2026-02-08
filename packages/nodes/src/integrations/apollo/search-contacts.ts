import { z } from 'zod';
import { defineNode } from '@jam-nodes/core';

// =============================================================================
// Schemas
// =============================================================================

export const SearchContactsInputSchema = z.object({
  /** Job titles to search for */
  personTitles: z.array(z.string()).optional(),
  /** Person locations (cities/countries) */
  personLocations: z.array(z.string()).optional(),
  /** Organization locations */
  organizationLocations: z.array(z.string()).optional(),
  /** Company employee count ranges (e.g., "1-10", "11-50") */
  employeeRanges: z.array(z.string()).optional(),
  /** Keywords for search */
  keywords: z.string().optional(),
  /** Maximum number of contacts to return */
  limit: z.number().optional().default(10),
  /** Include similar job titles */
  includeSimilarTitles: z.boolean().optional(),
  /** Seniority levels (e.g., "vp", "director", "manager") */
  personSeniorities: z.array(z.string()).optional(),
  /** Technologies used by the company */
  technologies: z.array(z.string()).optional(),
  /** Industry tag IDs */
  industryTagIds: z.array(z.string()).optional(),
  /** Departments (e.g., "engineering", "sales") */
  departments: z.array(z.string()).optional(),
});

export type SearchContactsInput = z.infer<typeof SearchContactsInputSchema>;

export const SearchContactsOutputSchema = z.object({
  contacts: z.array(z.object({
    id: z.string(),
    name: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string(),
    title: z.string().optional(),
    company: z.string(),
    linkedinUrl: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
  })),
  totalFound: z.number(),
});

export type SearchContactsOutput = z.infer<typeof SearchContactsOutputSchema>;

// =============================================================================
// Node Definition
// =============================================================================

/**
 * Search Contacts Node
 *
 * Searches for contacts using Apollo.io API with email enrichment.
 * Requires `context.services.apollo` to be provided by the host application.
 *
 * Process:
 * 1. Search Apollo for contacts matching criteria
 * 2. Enrich contacts to reveal email addresses
 * 3. Return contacts with verified emails
 *
 * @example
 * ```typescript
 * const result = await searchContactsNode.executor({
 *   personTitles: ['CTO', 'VP Engineering'],
 *   personLocations: ['San Francisco'],
 *   limit: 25
 * }, context);
 * ```
 */
export const searchContactsNode = defineNode({
  type: 'search_contacts',
  name: 'Search Contacts',
  description: 'Search for contacts using Apollo.io People Search API',
  category: 'integration',
  inputSchema: SearchContactsInputSchema,
  outputSchema: SearchContactsOutputSchema,
  estimatedDuration: 5,
  capabilities: {
    supportsEnrichment: true,
    supportsBulkActions: true,
    supportsRerun: true,
  },

  executor: async (input, context) => {
    try {
      // Require Apollo service
      if (!context.services?.apollo) {
        return {
          success: false,
          error: 'Apollo service not configured. Please provide context.services.apollo.',
        };
      }

      // Search contacts
      const results = await context.services.apollo.searchContacts({
        personTitles: input.personTitles,
        personLocations: input.personLocations,
        organizationLocations: input.organizationLocations,
        keywords: input.keywords,
        limit: Math.min(input.limit || 10, 100),
        personSeniorities: input.personSeniorities,
        technologies: input.technologies,
      });

      if (results.length === 0) {
        return {
          success: true,
          output: {
            contacts: [],
            totalFound: 0,
          },
        };
      }

      // Enrich contacts to get emails
      const enrichedContacts: Array<{
        id: string;
        name: string;
        firstName?: string;
        lastName?: string;
        email: string;
        title?: string;
        company?: string;
        linkedinUrl?: string;
        location?: string;
      }> = [];

      for (const contact of results) {
        if (contact.id) {
          try {
            const enriched = await context.services.apollo.enrichContact(contact.id);
            if (enriched.email) {
              enrichedContacts.push({
                id: enriched.id,
                name: enriched.name,
                firstName: enriched.firstName,
                lastName: enriched.lastName,
                email: enriched.email,
                title: enriched.title,
                company: enriched.company,
                linkedinUrl: enriched.linkedinUrl,
                location: enriched.location,
              });
            }
          } catch {
            // Skip contacts that fail to enrich
          }
        }
      }

      // Transform to output format
      const contacts = enrichedContacts.map(person => ({
        id: person.id,
        name: person.name,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        title: person.title,
        company: person.company || 'Unknown',
        linkedinUrl: person.linkedinUrl || null,
        location: person.location || null,
      }));

      return {
        success: true,
        output: {
          contacts,
          totalFound: results.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search contacts',
      };
    }
  },
});
