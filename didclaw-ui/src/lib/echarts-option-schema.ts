import { z } from "zod";

const MAX_STR = 256;
const MAX_AXIS = 500;
const MAX_SERIES = 12;

const barLineSeries = z.object({
  type: z.union([z.literal("bar"), z.literal("line")]),
  name: z.string().max(MAX_STR).optional(),
  data: z.array(z.number()).max(MAX_AXIS),
  smooth: z.boolean().optional(),
});

const pieSeries = z.object({
  type: z.literal("pie"),
  name: z.string().max(MAX_STR).optional(),
  data: z
    .array(
      z.object({
        name: z.string().max(MAX_STR),
        value: z.number(),
      }),
    )
    .max(200),
  radius: z.tuple([z.string().max(32), z.string().max(32)]).optional(),
});

/**
 * 右栏 ```echarts-json``` 允许的 ECharts option 子集（严格字段，防任意 JSON 注入）。
 */
export const echartsJsonSchema = z
  .object({
    title: z.object({ text: z.string().max(MAX_STR) }).optional(),
    legend: z.object({ data: z.array(z.string().max(MAX_STR)).max(64) }).optional(),
    tooltip: z.object({ trigger: z.enum(["item", "axis"]).optional() }).optional(),
    xAxis: z
      .union([
        z.object({
          type: z.literal("category"),
          data: z.array(z.union([z.string(), z.number()])).max(MAX_AXIS),
        }),
        z.object({ type: z.literal("value") }),
      ])
      .optional(),
    yAxis: z
      .union([z.object({ type: z.literal("category") }), z.object({ type: z.literal("value") })])
      .optional(),
    series: z.array(z.union([barLineSeries, pieSeries])).min(1).max(MAX_SERIES),
  })
  .strict();

export type EChartsJsonPayload = z.infer<typeof echartsJsonSchema>;
