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

插件注册为 `approval/request` 的第一个 answerer。升级请求会先交给 reviewer；授权只对当前请求生效。

reviewer 会收到待审批请求、你的用户消息、agent 最近的活动和工具结果摘要。在 reviewer 上下文中，只有用户消息能够授权。agent 的 chain of thought 不会发送给 reviewer。原始工具输出默认也不会发送；显式设置 `rawToolResults: true` 后才会额外发送经过长度限制的原始工具结果文本。

无法定位精确工具调用、待审批请求超过 `maxInputChars`、或最新用户授权超过上下文预算时，会在调用 reviewer 之前直接 `rejected`。reviewer error 默认返回 `unavailable`；设置 `denyOnReviewerError: false` 后，这类错误会继续交给下一个 answerer。reviewer 输出无法解析时会进行一次纠正重试，第二次仍失败则按同一套 reviewer-error 规则处理。

`allowRules` 可以按精确工具名和字面操作前缀直接放行请求，不经过 reviewer。只有显式声明 `workspace-write` 时才能直接放行该升级目标；`danger-full-access` 无法通过 `allowRules` 获得授权。

breaker 只统计当前回合。默认配置下，连续 3 次 deny，或 breaker 最近记录的 50 个 approval outcomes 中累计 10 次 deny，会触发 breaker。`allow` 和 `unavailable` 都会中断连续拒绝；reviewer 不可用不会被计为 deny。

每次判定都会写入 `~/.dsh/auto-review-audit.jsonl`。工具输入默认只保存 sha256；`includeToolInput` 设为 true 后才保存原始输入。

`/approve N` 显示一条被拒绝动作的工具、目录、完整参数和 fingerprint；查看记录本身不会产生授权。显示记录后，`/approve N confirm` 才允许该动作原样重试一次；重试仍会经过 reviewer。

## 文档

- [部署指南](./docs/deployment.zh.md) · [Deployment Guide](./docs/deployment.md)
- [配置参考](./docs/configuration.zh.md) · [Configuration Reference](./docs/configuration.md)

## 测试

`npm test` 通过 `test/run-tests.ts` 运行确定性的源码测试，包括 `test/units.test.ts`、`test/behavior/` 下按领域拆分的行为测试、`test/pipeline.test.ts` 和 `test/policy-cases.test.ts`。需要真实 reviewer 的 policy cases 仍由环境变量控制；没有配置 reviewer 端点时会跳过。

`test/behavior/contract.ts` 列出 CI 必须实际执行并通过的 required behaviors，覆盖文档承诺的审批路径、reviewer-error 处理、证据边界、本地查询、breaker、审计、live configuration 和命令行为。它和数值 coverage 是两道独立门槛，避免总覆盖率看起来很高时，某条关键 fallback 或安全路径已经被删掉。

`npm run test:coverage` 用 c8/V8 对同一套确定性测试采集源码 coverage。CI 对 `src/**/*.ts` 要求至少 95% statements、85% branches、100% functions 和 95% lines，并把测试过程中完全没有加载的源码文件也计入。文本、JSON summary 和 LCOV 报告写入 `coverage/`。

`test/policy-matrix.test.ts` 对对抗性策略语料执行 N 轮测量并统计 TP/FP/TN/FN。默认每个 case 30 轮；`AR_MATRIX_ROUNDS` 可调整轮数，`AR_MATRIX_FAIL_ON_FALSE_ALLOW=1` 会让假允许导致测试失败。

`npm run test:e2e` 运行 Cordis/AgentLoop E2E，覆盖沙箱拒绝、`approval/request`、reviewer `allowed-once`、重试执行和 reviewer 拒绝。它只接受显式的 `AR_E2E_API_KEY` 环境变量；`AR_E2E_BASE_URL` 和 `AR_E2E_MODEL` 为可选项。测试通过 tsx 直接运行 TypeScript 源码。

## 开发

代码使用 TypeScript，开启 strict 和 erasable-only 语法。包入口是编译后的 `lib/`，由 `npm run build` 生成。仓库已经提交 `lib/`，所以通过 git 安装时不需要先构建；发布 registry 时由 `prepack` 构建。

Node 不会对 `node_modules` 下的源码执行类型剥离，因此只发布源码入口会导致 pnpm 安装的 profile 无法启动。测试通过 tsx 运行。

安全边界按 `src/` 模块拆分：`index.ts` 是入口；`policy` 保存 reviewer 策略；`evidence` 处理可信、不可信上下文和授权完整性；`facts` 提供只读查询工具；`reviewer` 负责模型调用和判定解析；`approval-answerer` 处理决策流程和 `/approve` 记录；`breaker` 实现熔断；`audit` 写 JSONL 审计；`config` 定义 schema；`util` 保存小型辅助函数。

```bash
npm install
npm run typecheck
npm test
npm run test:coverage
```

测试还会导入 DeepSeek Harness 的相关包。CI 会从 npm 安装固定的 Harness 0.1.0-rc.6 测试依赖集合。本地开发可以用 `--no-save` 安装同版本包，也可以从对应版本的 Harness checkout 建立链接；CI 使用的精确包列表见 `.github/workflows/ci.yml`。

## 许可证

Apache-2.0，见 [LICENSE](./LICENSE)。
