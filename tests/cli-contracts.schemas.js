const { z } = require('zod');

const jsonEnvelopeSchema = z
  .object({
    success: z.boolean(),
    command: z.string().min(1),
    exitCode: z.number().int(),
  })
  .passthrough();

const doctorReportSchema = z
  .object({
    success: z.literal(true),
    timestamp: z.string(),
    node: z.record(z.any()),
    dependencies: z.record(z.any()),
  })
  .passthrough();

const errorEnvelopeSchema = jsonEnvelopeSchema.extend({
  success: z.literal(false),
  error: z.string().min(1),
});

const doctorSchema = jsonEnvelopeSchema
  .extend({
    success: z.literal(true),
    command: z.literal('doctor'),
    exitCode: z.literal(0),
  })
  .and(doctorReportSchema);

const skillVerifySchema = jsonEnvelopeSchema.extend({
  success: z.literal(true),
  command: z.literal('skill'),
  exitCode: z.literal(0),
  doctor: doctorReportSchema,
  skills: z
    .object({
      workflows: z.array(z.any()),
      recipes: z.array(z.any()),
    })
    .passthrough(),
});

const migrateMcpMapSchema = jsonEnvelopeSchema.extend({
  success: z.literal(true),
  command: z.literal('migrate'),
  exitCode: z.literal(0),
  map: z.array(z.any()),
});

const hintsSchema = jsonEnvelopeSchema.extend({
  command: z.literal('hints'),
  exitCode: z.literal(0),
  hints: z.union([z.string(), z.record(z.any())]),
  type: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const contextSchema = jsonEnvelopeSchema.extend({
  command: z.literal('context'),
  exitCode: z.literal(0),
  compactedContent: z.string(),
  metadata: z.record(z.any()).optional(),
  usage: z.string().optional(),
});

const debugSchema = jsonEnvelopeSchema.extend({
  command: z.literal('debug'),
  exitCode: z.literal(0),
  errors: z.array(z.any()),
  matches: z.array(z.any()),
  summary: z
    .object({
      errorCount: z.number(),
      matchCount: z.number(),
      uniqueFiles: z.number(),
      topMatches: z.array(z.any()),
    })
    .passthrough(),
});

const frontendSchema = jsonEnvelopeSchema.extend({
  command: z.literal('frontend'),
  exitCode: z.literal(0),
  content: z
    .array(
      z
        .object({
          type: z.string(),
          text: z.string(),
        })
        .passthrough()
    )
    .min(1),
});

const grepSchema = jsonEnvelopeSchema.extend({
  command: z.literal('grep'),
  exitCode: z.literal(0),
  matches: z.array(z.any()),
  totalMatches: z.number(),
  executionTime: z.number(),
  pattern: z.string(),
  language: z.string().optional(),
  engineUsed: z.enum(['ast-grep', 'text-fallback']).optional(),
  degraded: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  error: z.string().optional(),
});

const embeddingsStatusSchema = jsonEnvelopeSchema.extend({
  command: z.literal('embeddings'),
  exitCode: z.literal(0),
  projectId: z.string().optional(),
  projectPath: z.string().optional(),
});

const summarySchema = jsonEnvelopeSchema.extend({
  command: z.literal('summary'),
  exitCode: z.literal(0),
  summary: z.string(),
  metadata: z.record(z.any()).optional(),
});

const packsCreateSchema = jsonEnvelopeSchema.extend({
  command: z.literal('packs'),
  exitCode: z.literal(0),
  pack: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .passthrough(),
});

const packsListSchema = jsonEnvelopeSchema.extend({
  command: z.literal('packs'),
  exitCode: z.literal(0),
  packs: z.array(z.any()),
});

const packsGetSchema = jsonEnvelopeSchema.extend({
  command: z.literal('packs'),
  exitCode: z.literal(0),
  pack: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .passthrough(),
});

const packsDeleteSchema = jsonEnvelopeSchema.extend({
  command: z.literal('packs'),
  exitCode: z.literal(0),
  deleted: z.boolean(),
});

const packsTemplateSchema = jsonEnvelopeSchema.extend({
  command: z.literal('packs'),
  exitCode: z.literal(0),
  template: z
    .object({
      version: z.number(),
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      context: z
        .object({
          query: z.string(),
        })
        .passthrough(),
    })
    .passthrough(),
});

module.exports = {
  jsonEnvelopeSchema,
  doctorReportSchema,
  errorEnvelopeSchema,
  doctorSchema,
  skillVerifySchema,
  migrateMcpMapSchema,
  hintsSchema,
  contextSchema,
  debugSchema,
  frontendSchema,
  grepSchema,
  embeddingsStatusSchema,
  summarySchema,
  packsCreateSchema,
  packsListSchema,
  packsGetSchema,
  packsDeleteSchema,
  packsTemplateSchema,
};
