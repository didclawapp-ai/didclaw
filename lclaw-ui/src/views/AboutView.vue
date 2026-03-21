<script setup lang="ts">
import { RouterLink } from "vue-router";

const appVersion = __APP_VERSION__;
</script>

<template>
  <div class="about">
    <header class="bar">
      <RouterLink to="/" class="lc-btn lc-btn-ghost lc-btn-sm back">← 返回会话</RouterLink>
      <h1 class="title">关于 LCLAW UI</h1>
    </header>
    <div class="card">
      <p class="ver">版本 <code>{{ appVersion }}</code></p>
      <p>
        本客户端用于连接 <strong>OpenClaw Gateway</strong>：会话列表、聊天、本地/链接预览与诊断信息。
      </p>
      <p class="muted">
        正式使用请用 <strong>Electron 桌面版</strong>：连接助手、填写 AI 密钥、选默认模型等，点顶栏
        <strong>「设置」</strong> 即可，一般不必自己改配置文件。
      </p>
      <p class="muted">
        开发联调可用 <code>pnpm dev:web</code> 仅起 Vite，此时通过环境变量 <code>VITE_GATEWAY_URL</code> 等连接网关；无顶栏「设置」对话框。
      </p>
      <p class="muted">
        外链白名单等见仓库 <code>.env.example</code> 说明。
      </p>
    </div>
  </div>
</template>

<style scoped>
.about {
  min-height: 100vh;
  padding: 20px 24px 32px;
  font-family: var(--lc-font);
  color: var(--lc-text);
  box-sizing: border-box;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.back {
  text-decoration: none;
}
.title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.card {
  max-width: 640px;
  padding: 20px 22px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  line-height: 1.6;
  font-size: 14px;
}
.card p {
  margin: 0 0 12px;
}
.card p:last-child {
  margin-bottom: 0;
}
.ver code {
  font-family: var(--lc-mono);
  font-size: 0.95em;
  color: var(--lc-accent);
}
.muted {
  color: var(--lc-text-muted);
  font-size: 13px;
}
.card code {
  font-family: var(--lc-mono);
  font-size: 12px;
  background: var(--lc-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
