# DidClaw 第三方依赖许可证清单

> 生成日期：2026-03-31  
> 工具：`license-checker`（npm）、`cargo-license`（Rust）  
> 范围：生产依赖（含间接依赖）

---

## 结论速览

| 风险等级 | 结论 |
|---|---|
| GPL / AGPL 传染性协议 | **零** |
| 需要商业授权的依赖 | **零** |
| 闭源商业发布兼容性 | ✅ 完全兼容 |
| 唯一注意项 | MPL-2.0（文件级 copyleft，见下文） |

---

## 一、前端依赖（npm）

扫描命令：`pnpm exec license-checker --production`

| 包名 | 版本 | 许可证 | 备注 |
|---|---|---|---|
| vue | 3.5.x | MIT | |
| pinia | 3.0.x | MIT | |
| vue-router | 4.6.x | MIT | |
| vue-i18n | 9.14.x | MIT | |
| @tauri-apps/api | 2.10.x | Apache-2.0 OR MIT | |
| @tanstack/vue-virtual | 3.13.x | MIT | |
| @noble/ed25519 | 2.3.x | MIT | |
| markdown-it | 14.1.x | MIT | |
| zod | 4.3.x | MIT | |
| qrcode | 1.5.x | MIT | |
| highlight.js | 11.11.x | BSD-3-Clause | 需保留版权声明 |
| echarts | 6.0.x | Apache-2.0 | Apache 软件基金会出品 |
| dompurify | 3.3.x | MPL-2.0 OR Apache-2.0 | 选 Apache-2.0 使用，无限制 |

**开发依赖**（不进入最终产物，仅供参考）：Vite、vue-tsc、TypeScript、ESLint 均为 MIT。

---

## 二、Rust / Tauri 后端依赖（Cargo）

扫描命令：`cargo license`（cargo-license v0.7.0）

扫描结果共计 400+ 个 crate，按许可证分组汇总：

| 许可证 | crate 数量 | 典型库 | 说明 |
|---|---|---|---|
| Apache-2.0 OR MIT | 368 | tauri、tokio、serde、serde_json、axum、tower-http、reqwest、ureq、regex、chrono、uuid、url、arboard、dirs、tempfile、base64、rand、zip 等绝大多数 | 完全自由使用 |
| MIT | 174 | tokio、axum、rfd、open、rusqlite、hyper、tracing、tower、zip、zbus 等 | 完全自由使用 |
| Apache-2.0 OR MIT OR Zlib | 17 | bytemuck、miniz_oxide、raw-window-handle、xkeysym 等 | 完全自由使用 |
| MIT OR Unlicense | 7 | aho-corasick、memchr、byteorder、walkdir | 完全自由使用（Unlicense 为公有领域）|
| ISC | 4 | libloading、rustls-webpki、untrusted | 完全自由使用 |
| BSD-3-Clause | 3 | alloc-no-stdlib、subtle | 需保留版权声明 |
| BSD-3-Clause AND MIT | 2 | brotli、matchit | 完全自由使用 |
| BSL-1.0（Boost） | 2 | clipboard-win、error-code | 完全自由使用 |
| CDLA-Permissive-2.0 | 2 | webpki-roots | 宽松数据许可，商业友好 |
| Apache-2.0 AND ISC | 1 | ring（密码学库）| 完全自由使用 |
| Apache-2.0 WITH LLVM-exception | 1 | target-lexicon | 完全自由使用 |
| Apache-2.0 OR LGPL-2.1-or-later OR MIT | 2 | r-efi | 选 MIT 或 Apache-2.0 使用，无限制 |
| Unicode-3.0 | 18 | icu_*、zerovec 等（ICU 数据）| 宽松，需保留 Unicode 版权声明 |
| Zlib | 2 | foldhash | 完全自由使用 |
| **MPL-2.0** | **7** | cssparser、selectors、dtoa-short、option-ext、cssparser-macros | **见下方专项说明** |

---

## 三、MPL-2.0 专项说明

涉及 crate（均为 `wry` → Servo CSS 引擎的间接依赖，非直接引用）：

- `cssparser` / `cssparser-macros`
- `selectors`
- `dtoa-short`
- `option-ext`

**MPL-2.0（Mozilla Public License 2.0）规则**：

- 采用**文件级 copyleft**，而非项目级（不同于 GPL/AGPL）。
- 规则核心：**仅当你修改了这些库的源文件时，才需要把修改过的那些文件以 MPL-2.0 开源**。
- 未修改直接使用（作为依赖链接到产品中）：**商业闭源发布完全合规**，无需开源自身代码。
- DidClaw 不直接依赖、也不修改上述 crate，因此**无任何义务**。

---

## 四、发布合规要点

发布二进制包时需满足以下要求（Apache-2.0 / BSD-3-Clause 均明确要求）：

1. **保留版权声明**：在 `NOTICE`、`About` 界面或随附文档中包含第三方版权声明。
2. **附带 Apache-2.0 许可证全文**（或链接）：因使用了 Apache-2.0 授权的依赖。
3. **不得移除原始许可证文件**：打包时保留 `node_modules` / Cargo 构建产物中的 `LICENSE` 文件。

> Tauri 官方工具链在 `tauri build` 时会自动收集依赖的许可证信息，可通过 `tauri info` 查看。
> npm 侧可用 `pnpm exec license-checker --out NOTICES.txt` 自动生成汇总文件。

---

## 五、版本维护建议

- 每次 `pnpm update` 或 `cargo update` 后重新运行扫描，确认无新增 GPL/AGPL 依赖混入。
- 重点关注新增的直接依赖（`package.json` / `Cargo.toml` 新增行），间接依赖由主依赖的许可证审查覆盖。
