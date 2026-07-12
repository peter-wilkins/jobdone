import { z } from 'zod';

export const PROJECT_SURFACES = ['shiny_art_shop'];
export const ACTOR_ROLES = ['customer', 'builder', 'admin', 'system'];
export const PROJECT_STATUSES = [
  'draft',
  'previewed',
  'quote_configuring',
  'needs_human_review',
  'awaiting_payment',
  'ready_for_workshop',
  'in_production',
  'awaiting_customer_approval',
  'awaiting_balance',
  'ready',
  'complete',
  'requires_human_attention',
  'cancelled',
  'declined',
];

export const QuoteInputSchema = z.object({
  productType: z.enum(['embossed_metal_picture', 'layered_card_artwork']),
  material: z.enum([
    'aluminium',
    'copper_effect',
    'brass_effect',
    'brushed_steel_effect',
    'white_card',
    'black_core_card',
    'coloured_core_card',
    'kraft_card',
  ]),
  finish: z.enum(['natural', 'painted', 'framed']),
  size: z.enum(['A5', 'A4']),
  quantity: z.number().int().min(1).max(100),
  deadline: z.enum(['standard', 'rush_3_5_days', 'next_day']),
  orderNotes: z.string().max(2000).optional().default(''),
});

const ActorSchema = z.object({
  role: z.enum(ACTOR_ROLES),
  userId: z.string().min(1),
  email: z.string().email().optional(),
  anonymous: z.boolean().optional().default(false),
});

const BaseCommandSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  actor: ActorSchema,
  createdAt: z.string().datetime(),
  requestId: z.string().min(1).optional(),
});

export const CommandSchema = z.discriminatedUnion('type', [
  BaseCommandSchema.extend({
    type: z.literal('createProject'),
    title: z.string().min(1).max(200),
    ownerUserId: z.string().min(1),
    productSurface: z.enum(PROJECT_SURFACES),
  }),
  BaseCommandSchema.extend({
    type: z.literal('uploadProjectFile'),
    fileId: z.string().min(1),
    kind: z.enum(['customer_upload', 'generated_preview', 'workshop_photo', 'invoice']),
    filename: z.string().min(1).max(240),
    mimeType: z.string().min(1).max(120),
  }),
  BaseCommandSchema.extend({
    type: z.literal('generatePreview'),
    sourceFileId: z.string().min(1),
  }),
  BaseCommandSchema.extend({
    type: z.literal('configureQuote'),
    quoteInput: QuoteInputSchema,
  }),
  BaseCommandSchema.extend({
    type: z.literal('acceptQuote'),
    quoteSnapshotId: z.string().min(1),
    termsVersion: z.string().min(1),
    termsText: z.string().min(1),
  }),
  BaseCommandSchema.extend({
    type: z.literal('cancelBeforeProduction'),
  }),
  BaseCommandSchema.extend({
    type: z.literal('requestAdjustment'),
    reason: z.string().min(1).max(1000),
  }),
  BaseCommandSchema.extend({
    type: z.literal('approveFinishedPiece'),
    approvalPhotoFileId: z.string().min(1),
  }),
  BaseCommandSchema.extend({
    type: z.literal('offerManualQuote'),
    quoteInput: QuoteInputSchema,
    price: z.number().min(0),
    depositDue: z.number().min(0),
    balanceDue: z.number().min(0),
    explanation: z.array(z.string().min(1)).min(1),
  }),
  BaseCommandSchema.extend({
    type: z.literal('declineProject'),
    reason: z.string().min(1).max(1000),
  }),
  BaseCommandSchema.extend({
    type: z.literal('startProduction'),
    confirmationText: z.string().min(1),
    quoteSnapshotId: z.string().min(1),
  }),
  BaseCommandSchema.extend({
    type: z.literal('uploadWorkshopPhoto'),
    fileId: z.string().min(1),
    filename: z.string().min(1).max(240),
    mimeType: z.string().min(1).max(120),
  }),
  BaseCommandSchema.extend({
    type: z.literal('markReady'),
  }),
  BaseCommandSchema.extend({
    type: z.literal('markComplete'),
  }),
  BaseCommandSchema.extend({
    type: z.literal('resolveHumanAttention'),
    resolution: z.enum(['continue', 'request_more_info', 'supersede_quote', 'refund', 'cancel']),
  }),
  BaseCommandSchema.extend({
    type: z.literal('recordPaymentReceived'),
    paymentId: z.string().min(1),
    quoteSnapshotId: z.string().min(1),
    amount: z.number().min(0),
  }),
  BaseCommandSchema.extend({
    type: z.literal('recordPaymentFailed'),
    paymentId: z.string().min(1),
    quoteSnapshotId: z.string().min(1),
    reason: z.string().min(1).max(1000),
  }),
  BaseCommandSchema.extend({
    type: z.literal('recordRefund'),
    paymentId: z.string().min(1),
    amount: z.number().min(0),
    status: z.enum(['pending', 'completed', 'failed']),
  }),
]);

export function parseProjectCommand(input) {
  return CommandSchema.parse(input);
}

