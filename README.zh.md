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

reviewer 会收到待审批请求、你的用户消息、agent 最近的操作记录和工具结果摘要。只有用户消息可以授权操作。agent 的 chain of thought 不会发送给 reviewer。原始工具输出默认不发送；设置 `rawToolResults: true` 后会额外发送原始工具输出，单条工具结果最多保留 400 个字符。

无法定位精确工具调用、待审批请求超过 `maxInputChars`，或最新用户消息超过上下文预算时，会在调用 reviewer 之前直接 `rejected`。reviewer 调用或结果处理出错时，默认返回 `unavailable`；设置 `denyOnReviewerError: false` 后，这类请求会交给下一个 answerer。reviewer 输出无法解析时会重试一次；第二次仍无法解析时也按 `denyOnReviewerError` 处理。

`allowRules` 可以按精确工具名和字符串前缀直接放行请求，不经过 reviewer。只有规则显式声明 `workspace-write` 时才能放行该升级目标；`danger-full-access` 无法通过 `allowRules` 获得授权。

熔断器只统计当前回合。默认连续 3 次 deny，或最近 50 次审批结果中出现 10 次 deny 时触发。`allow` 和 `unavailable` 都会清零连续 deny 计数；`unavailable` 不计为 deny。

每次判定都会写入 `~/.dsh/auto-review-audit.jsonl`。工具输入默认只保存 sha256；`includeToolInput` 设为 true 后才保存原始输入。

`/approve N` 显示一条被拒绝动作的工具、目录、完整参数和 fingerprint。查看记录不会授权任何操作。显示记录后，`/approve N confirm` 才允许该动作重试一次；重试仍会经过 reviewer。

## 文档

- [部署指南](./docs/deployment.zh.md) · [Deployment Guide](./docs/deployment.md)
- [配置参考](./docs/configuration.zh.md) · [Configuration Reference](./docs/configuration.md)

## 测试

`npm test` 通过 `test/run-tests.ts` 运行测试，包括 `test/units.test.ts`、`test/behavior/` 下按功能拆分的行为测试、`test/pipeline.test.ts` 和 `test/policy-cases.test.ts`。需要真实 reviewer 的用例由环境变量控制；没有配置 reviewer 端点时会跳过。

`test/behavior/required-behaviors.ts` 列出 CI 必须执行并通过的行为检查。CI 会分别检查这些行为和覆盖率阈值，避免只看总覆盖率而漏掉文档规定的主要行为或回退路径。

`npm run test:coverage` 用 c8/V8 对同一套测试采集 coverage。CI 对 `src/**/*.ts` 要求至少 95% statements、85% branches、100% functions 和 95% lines；没有被测试加载的源码文件也计入覆盖率。文本、JSON summary 和 LCOV 报告写入 `coverage/`。

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

测试还会导入 DeepSeek Harness 的相关包。CI 会从 npm 安装固定版本的 Harness 0.1.0-rc.6 测试依赖。本地开发可以用 `--no-save` 安装同版本包，也可以从对应版本的 Harness checkout 建立链接；具体依赖和版本见 `.github/workflows/ci.yml`。

## 许可证

Apache-2.0，见 [LICENSE](./LICENSE)。
