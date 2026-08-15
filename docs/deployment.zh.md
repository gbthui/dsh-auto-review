# 部署指南

dsh-auto-review 通过 DeepSeek Harness 的 bundle 机制接入。`dsh-base`、`dsh-web-app` 等内置插件使用同一机制；这是当前支持的接入方式。

## 前置条件

插件在 DeepSeek Harness 0.1.0-rc.6 的 web profile 上开发和验证。通过 CLI 安装需要 Node.js，并要求 pnpm 在 PATH 中。

## 快速安装

把已发布的包加入 web profile：

```bash
npx @deepseek-ai/dsh plugin --profile web add @gbthui/dsh-auto-review
```

`dsh plugin` 会把安装参数交给 pnpm，因此 registry、git 和 file spec 都可以使用。包会安装到 profile 的 `node_modules`。由于 `@gbthui/dsh-auto-review` 声明了 `dsh.bundle`，CLI 还会把它合并到 `dsh.profile.bundles`。

安装命令只修改 profile 的依赖和 bundle 配置，不控制已经运行的 Harness 进程。新安装的 bundle 会在 profile 下次启动时加载。如果 web profile 已经运行，停止当前进程后按原来的方式重新启动。DeepSeek Harness 官方 README 的 npm 启动方式是：

```bash
npx @deepseek-ai/dsh web
```

从 Harness 源码运行时，官方对应命令是 `pnpm dsh web`。

配置是可选的。默认 reviewer 跟随会话当前模型；需要独立端点时，在 `~/.dsh/settings.yaml` 中增加 `dsh-auto-review:` 段。

## 手动安装

### 1. 确认 bundle 声明

包的 `package.json` 包含：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

`cordis.patch.yml` 中包含插件行：

```yaml
- insert:
    - id: auto-review
      name: '@gbthui/dsh-auto-review'
```

### 2. 加入 profile

编辑 `~/.dsh/profiles/web/package.json`：

```json
{
  "dependencies": { "@gbthui/dsh-auto-review": "file:/path/to/dsh-auto-review" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@gbthui/dsh-auto-review"] } }
}
```

也可以运行：

```bash
npx @deepseek-ai/dsh plugin --profile web add /path/to/dsh-auto-review
```

该命令需要 pnpm 在 PATH。它会安装依赖，并把声明 bundle 的依赖合并到 `bundles`。没有 pnpm 时可直接编辑上面的 profile 文件。

### 3. 满足两个解析位置

加载过程中，包会分别从两个位置解析。两个位置都必须可用：

| 解析点 | 查找顺序 | 做法 |
| --- | --- | --- |
| bundle 目录 | 先找 harness 的 `node_modules`，再找 profile 目录 | 在 harness 安装目录下放置或链接 `node_modules/@gbthui/dsh-auto-review` |
| 插件行 `import()` | 从 profile 目录沿 Node 的模块解析路径向上查找 | 在 `~/.dsh/profiles/node_modules/@gbthui/dsh-auto-review` 放置同一个包。dsh 启动时只维护自身依赖的回退链接，第三方包需要自行放置 |

第二个位置缺失时，启动日志会出现：

```text
failed to import loader entry auto-review ... Cannot find package ... imported from /home/example/.dsh/profiles/web/
```

这类错误会使 profile 在启动阶段退出。日志位置取决于你实际使用的启动方式或进程管理器。

### 4. 配置 reviewer

在 `~/.dsh/settings.yaml` 中增加 `dsh-auto-review:` 段。配置项见 [configuration.zh.md](./configuration.zh.md)。修改 settings 后不需要重启。

无人值守或安全敏感部署建议配置独立 reviewer，不使用会话模型。设置 `reviewer.baseURL`、`reviewer.model` 和 `reviewer.apiKeyFile`，并优先选择与 agent 不同提供方或模型族的模型。保留默认的 `denyOnReviewerError: true` 后，reviewer 故障会使请求 fail closed，不会把审批留给无人处理的交互式提示。

使用外部 reviewer 会发送用户请求、工具参数、agent 最近的活动以及工作区和沙箱信息。开启 `factFinding.content.enabled` 后，reviewer 请求的工作区文件内容也可能被发送。完整范围见配置参考。

### 5. 重新启动并验证

安装或更新插件代码后，需要重新启动正在运行的 profile 才会加载新代码。停止旧进程后，按你原来的方式启动；官方 npm 方式为：

```bash
npx @deepseek-ai/dsh web
```

如果从 Harness 源码运行，则使用：

```bash
pnpm dsh web
```

启动后新建会话，并在会话中执行：

```text
/auto-review status
```

它会显示 `enabled`、reviewer、thinking 和 context 等当前配置。触发一次需要审批的操作后，也可以检查审计文件：

```bash
tail -f ~/.dsh/auto-review-audit.jsonl
```

## 排障

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| profile 启动失败，日志含 `failed to import loader entry auto-review` | 插件行没有进入 bundle 层，或第二条查找路径缺失 | 检查 bundle 声明、`dsh.profile.bundles` 和 profiles 回退链接 |
| 升级请求被拒，`source: reviewer-error` | reviewer 端点、密钥或模型配置有误 | 查看审计记录的 `reason`；直接测试端点；检查 `apiKeyFile` 的 `KEY=VALUE` 格式 |
| 判定落在 `reasoning_content` 导致误拒（旧版本） | 旧版本行为；当前版本只读取最终答案 | 升级插件，或设置 `thinking: off` |
| 拒绝理由为 `credential manipulation ... human execution only` | 凭据文件改动仅允许人工执行 | 用户自行执行，或运行 `/auto-review off` 后走人工审批 |

## 卸载

通过 CLI 安装时，可以运行：

```bash
npx @deepseek-ai/dsh plugin --profile web remove @gbthui/dsh-auto-review
```

删除 settings 中的 `dsh-auto-review:` 段（如果配置过），然后重新启动正在运行的 profile。手动安装的部署还需要删除手动创建的 bundle 条目和符号链接。
