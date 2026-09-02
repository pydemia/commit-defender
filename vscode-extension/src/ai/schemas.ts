/** JSON Schemas shared by API-independent structured-output providers. */

export type JsonSchema = Record<string, unknown>;

export const REVIEW_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    blocking: { type: 'boolean' },
    grade: {
      type: 'string',
      enum: ['exceptional', 'proficient', 'adequate', 'insufficient', 'critical'],
    },
    file_comments: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer', minimum: 0 },
          category: {
            type: 'string',
            enum: ['correctness', 'security', 'maintenance', 'optimization', 'review-history', 'setting'],
          },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          comment: { type: 'string' },
        },
        required: ['file', 'line', 'category', 'priority', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'blocking', 'grade', 'file_comments'],
  additionalProperties: false,
};

export const COMMIT_MESSAGE_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    commit_message: { type: 'string' },
  },
  required: ['commit_message'],
  additionalProperties: false,
};
