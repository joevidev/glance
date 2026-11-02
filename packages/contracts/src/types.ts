import { z } from 'zod'

export const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
export type Box = z.infer<typeof BoxSchema>

/** One clickable thing on screen. Box is in CSS pixels, viewport-relative. Mirrors schema/element.schema.json. */
export const ElementSchema = z.object({
  id: z.number().int().min(0),
  role: z.string(),
  name: z.string().max(80),
  box: BoxSchema,
})
export type Element = z.infer<typeof ElementSchema>

/** One benchmark or training case. Mirrors schema/case.schema.json. */
export const CaseSchema = z.object({
  id: z.string(),
  site: z.string(),
  split: z.enum(['train', 'test']),
  viewport: z.object({ w: z.number().int(), h: z.number().int() }),
  gaze: z.object({ x: z.number(), y: z.number() }),
  sigma: z.number(),
  command: z.string(),
  command_type: z.enum(['deictic', 'role', 'partial_name', 'ordinal']),
  elements: z.array(ElementSchema),
  answer: z.number().int(),
})
export type Case = z.infer<typeof CaseSchema>

/** What the app builds at run time: a Case without the labels. */
export type LiveCase = Pick<Case, 'viewport' | 'gaze' | 'command' | 'elements'>

export const DecisionSchema = z.object({ target: z.number().int().nullable() })
export type Decision = z.infer<typeof DecisionSchema>
