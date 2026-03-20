import { z } from "zod";

/** Minimal validation for `connect` success payload (extend as needed). */
export const gatewayHelloOkSchema = z
  .object({
    type: z.literal("hello-ok").optional(),
    protocol: z.number().optional(),
    server: z
      .object({
        version: z.string().optional(),
        connId: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();
