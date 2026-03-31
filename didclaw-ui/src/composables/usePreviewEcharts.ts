import type { ECharts, EChartsCoreOption } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  CanvasRenderer,
]);

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * 在已消毒的预览 HTML 中挂载 `.didclaw-chart[data-didclaw-chart]` 占位节点上的 ECharts 实例。
 */
export function usePreviewEcharts(container: Ref<HTMLElement | null>, html: Ref<string>): void {
  const instances = new Map<HTMLElement, ECharts>();

  function disposeAll(): void {
    for (const ch of instances.values()) {
      ch.dispose();
    }
    instances.clear();
  }

  function mountCharts(root: HTMLElement): void {
    const nodes = root.querySelectorAll<HTMLElement>(".didclaw-chart[data-didclaw-chart]");
    nodes.forEach((el) => {
      const b64 = el.dataset.didclawChart?.trim();
      if (!b64) {
        return;
      }
      let opt: EChartsCoreOption;
      try {
        opt = JSON.parse(base64ToUtf8(b64)) as EChartsCoreOption;
      } catch {
        return;
      }
      const inst = echarts.init(el, undefined, { renderer: "canvas" });
      inst.setOption(opt, { notMerge: true });
      instances.set(el, inst);
    });
  }

  watch(
    () => [container.value, html.value] as const,
    async () => {
      await nextTick();
      disposeAll();
      const root = container.value;
      if (!root) {
        return;
      }
      mountCharts(root);
    },
    { flush: "post" },
  );

  const onResize = (): void => {
    for (const ch of instances.values()) {
      ch.resize();
    }
  };
  window.addEventListener("resize", onResize);
  onBeforeUnmount(() => {
    window.removeEventListener("resize", onResize);
    disposeAll();
  });
}
