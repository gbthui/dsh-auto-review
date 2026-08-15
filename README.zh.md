# dsh-auto-review

[English](README.md) | 中文

dsh-auto-review 是一个 DeepSeek Harness 插件，用 reviewer 模型回答审批请求。它的工作方式接近 Codex 的 `approvals_reviewer = "auto_review"`：agent 请求执行沙箱不允许的操作时，通常是 sandbox escalation，reviewer 会先判断是否放行；没有得到插件答复的请求再进入交互式审批。

插件不会修改沙箱配置，只处理审批请求。

## 安装

安装 Node.js，并确保 pnpm 在 PATH 中，然后把插件加入 web profile：

```bash
npx @deepseek-ai/dsh plugin --profile web add https://github.com/gbthui/dsh-auto-review.git
```

`dsh plugin` 会通过 pnpm 安装插件，并把它加入 profile 的 bundle 配置。安装后插件默认启用，reviewer 跟随当前会话模型，不需要修改 settings。

新安装的 bundle 会在 profile 下次启动时加载。如果 web profile 正在运行，先停止当前进程，再按原来的方式重新启动。DeepSeek Harness 官方 README 的 npm 启动方式是：

```bash
npx @deepseek-ai/dsh web
```

新建会话后可用 `/auto-review status` 检查状态。其他 profile、file/registry 安装和手动接入方式见[部署指南](./docs/deployment.zh.md)。

## 配置

只有需要指定独立 reviewer 时才需要配置。例如使用 OpenAI 兼容端点：

```yaml
# ~/.dsh/settings.yaml
dsh-auto-review:
  reviewer:
    baseURL: https://api.deepseek.com/v1
    model: deepseek-v4-flash
    apiKeyFile: ~/.dsh/reviewer.env   # KEY=VALUE 文件，也可以用 apiKey / apiKeyEnv
    thinking: off
```

全部配置项见[配置参考](./docs/configuration.zh.md)。

## 工作流程

```
agent 尝试沙箱不允许的动作
        |
        v
harness 请求审批
        |
        v
dsh-auto-review 先回答
        +-- 放行 -> allowed-once -> 重试执行
        +-- 拒绝 -> rejected    -> agent 收到拒绝结果
```

## 功能

插件注册为 `approval/request` 事件的第一个 answerer。升级请求会先交给 reviewer；授权只对当前请求生效。

reviewer 会收到待审批请求、你的用户消息、agent 最近的活动和工具结果摘要。只有用户消息可以作为授权依据。agent 的 chain of thought 不会发送给 reviewer；原始工具输出默认也不会发送，除非显式开启。

默认采用 fail closed。无法定位精确工具调用、请求超过大小限制、reviewer 不可达时，请求都会被拒绝。reviewer 返回的结果无法解析时会重试一次，第二次仍失败则拒绝请求。

`allowRules` 可以按工具名和操作前缀直接放行请求，不经过 reviewer。它不会对 `danger-full-access` 生效。

熔断器在连续三次拒绝，或最近五十次评审中出现十次拒绝时取消当前回合，避免 agent 反复尝试同一类操作。

每次判定都会写入 `~/.dsh/auto-review-audit.jsonl`。工具输入默认只保存 sha256 哈希；`includeToolInput` 设为 true 后保存原文。

`/approve N` 显示一条被拒绝动作的工具、目录、完整参数和 fingerprint。`/approve N confirm` 允许该动作原样重试一次；重试仍会经过 reviewer。

## 文档

- [部署指南](./docs/deployment.zh.md) · [Deployment Guide](./docs/deployment.md)
- [配置参考](./docs/configuration.zh.md) · [Configuration Reference](./docs/configuration.md)

## 测试

项目包含四个测试套件。`test/units.test.ts` 覆盖判定解析、四分类判别、敏感路径匹配、只读查询工具及加固 git 探针、结构化证据、API 密钥解析、reviewer 请求格式，以及由环境变量控制的 live round-trip。

`test/pipeline.test.ts` 用 mock 上下文覆盖 answerer 流程，包括类型化放行规则、熔断器、注入策略、配置校验、composer 命令和本地查询循环。

`test/policy-cases.test.ts` 是对抗性策略语料，包含授权撤销、授权收窄、提示注入和灾难操作。通过 `AR_REVIEWER_BASE_URL` / `AR_REVIEWER_MODEL` / `AR_REVIEWER_API_KEY` 可以对真实端点运行。

`test/policy-matrix.test.ts` 对同一语料执行 N 轮测量并统计 TP/FP/TN/FN。默认每个 case 30 轮；`AR_MATRIX_ROUNDS` 可调整轮数，`AR_MATRIX_FAIL_ON_FALSE_ALLOW=1` 会让假允许导致测试失败。

`npm run test:e2e` 运行 Cordis/AgentLoop E2E，覆盖沙箱拒绝、`approval/request`、reviewer `allowed-once`、重试执行和 reviewer 拒绝。它只接受显式的 `AR_E2E_API_KEY` 环境变量；`AR_E2E_BASE_URL` 和 `AR_E2E_MODEL` 为可选项。测试通过 tsx 直接运行 TypeScript 源码。

## 开发

代码使用 TypeScript，开启 strict 和 erasable-only 语法。包入口是编译后的 `lib/`，由 `npm run build` 生成。仓库已经提交 `lib/`，所以通过 git 安装时不需要先构建；发布 registry 时由 `prepack` 构建。

Node 不会对 `node_modules` 下的源码执行类型剥离，因此只发布源码入口会导致 pnpm 安装的 profile 无法启动。测试通过 tsx 运行。

安全边界按 `src/` 模块拆分：`index.ts` 是入口；`policy` 保存 reviewer 策略；`evidence` 处理可信、不可信上下文和授权完整性；`facts` 提供只读查询工具；`reviewer` 负责模型调用和判定解析；`approval-answerer` 处理决策流程和 `/approve` 记录；`breaker` 实现熔断；`audit` 写 JSONL 审计；`config` 定义 schema；`util` 保存小型辅助函数。

```bash
npm install --save-dev typescript @types/node tsx
npm run typecheck  # src（strict）加 test/src 双配置类型检查
npm test          # tsx test/*.test.ts：units + pipeline + 策略语料
```

类型检查会从本地 DeepSeek Harness 的 `node_modules` 解析 `@deepseek-ai/*` 类型包。需要把这些包链接到 `node_modules/@deepseek-ai/`；它们没有列为 npm 依赖。`npm install` 会清理这些符号链接，安装后需要重新创建。

## 许可证

Apache-2.0，见 [LICENSE](./LICENSE)。
