# 配置参考

配置写在 settings 文档的 `dsh-auto-review:` 段中。多数配置修改会立即生效，不需要重启。最小配置只有总开关：

```yaml
dsh-auto-review:
  enabled: true
```

## 完整配置

```yaml
dsh-auto-review:
  enabled: true                      # 总开关

  reviewer:
    baseURL: ''                      # '' = 用 agent 当前模型
    model: ''                        # 端点路径上的模型 ID
    apiKey: ''                       # 密钥方式一：直接写在配置（UI 会脱敏）
    apiKeyEnv: ''                    # 方式二：从环境变量读
    apiKeyFile: ''                   # 方式三：KEY=VALUE 文件（~ 可展开，推荐）
    timeoutMs: 24000
    maxTokens: 1024                  # 判定 JSON 约 100-300 token，这个上限只是防止输出失控
    thinking: default                # default | off；off 的行为取决于 reviewer 调用路径
    extraSystemPrompt: ''            # 追加到 reviewer 策略的额外规则
    factFinding:
      enabled: true                  # 允许 reviewer 先问几个本地小问题
      maxRounds: 2                   # reviewer -> 查询 -> reviewer 的往返次数
      maxFacts: 3                    # 每次请求允许的本地查询总数
      content:
        enabled: false               # 读文件内容：默认关闭；外部端点需显式开启
        maxBytes: 4096

  policy:
    tools: []                        # 空 = 审查所有请求；填列表 = 只审查这些工具
    allowRules: []                   # 不经 reviewer 的直接放行规则；见下文
    maxInputChars: 16000             # 超大的请求会被拒绝，不会被截断
    denyOnReviewerError: true        # reviewer 连不上 -> fail closed
    context:
      enabled: true                  # 发给 reviewer 的上下文
      maxMessages: 10
      maxChars: 6000
      rawToolResults: false          # false = 工具结果只给摘要（长度 + sha256）

  breaker:
    enabled: true
    consecutiveDenyLimit: 3
    windowSize: 50
    windowDenyLimit: 10              # 或 50 次评审里拒绝 10 次
    action: cancel                   # cancel | inject | off

  audit:
    enabled: true
    path: ~/.dsh/auto-review-audit.jsonl
    includeToolInput: false          # 默认只存 sha256 哈希；设为 true 才存原文
```

## 选择 reviewer

### 使用 agent 当前模型

`baseURL` 留空时，reviewer 使用 agent 当前的模型，凭据由 harness 处理，不需要再配置端点和密钥。

这种配置下，agent 和 reviewer 使用同一个模型。两者可能对同一条用户指令产生相同的理解偏差。交互式使用时仍有人工审批作为后续路径；无人值守部署建议配置独立 reviewer。

### 使用独立端点

把 `baseURL` 设为 OpenAI 兼容的 `chat/completions` 端点，并配置 `model` 和密钥。无人值守部署建议使用与 agent 不同提供方或模型族的 reviewer。

使用外部端点时，以下信息会发送到该端点：reviewer 策略、待审批请求的工具名和原始参数、用户消息、agent 最近的操作记录、工具结果摘要、工作区路径和沙箱模式。文件内容默认不会发送。只有开启 `factFinding.content.enabled`，并且 reviewer 请求 `inspect_text_file` 时，指定文件的内容才会进入 reviewer 请求。

工具参数本身也可能包含路径、URL 或代码等敏感内容。外部端点需要能够接受这些数据。

密钥按 `apiKey` → `apiKeyEnv` → `apiKeyFile` 的顺序查找。`apiKeyEnv` 从进程环境变量读取；`apiKeyFile` 读取第一行 `NAME=value`，不支持引号和 `export`。三种方式都没有得到密钥时，reviewer 调用失败，请求按 fail closed 处理。

## thinking

`thinking` 只控制 reviewer 请求是否尝试关闭推理，不参与授权判断。一般保持默认值；需要关闭 reviewer 推理时可以这样配置：

```yaml
dsh-auto-review:
  reviewer:
    thinking: off
```

`default` 不发送额外的推理控制参数，使用模型或提供方的默认行为。`off` 的实际行为取决于 reviewer 从哪条路径调用：

- 配置了 `reviewer.baseURL` 时，插件直接调用 `${baseURL}/chat/completions`，并在请求体中加入 `thinking: { type: disabled }`。这是 DeepSeek 使用的扩展字段；端点不支持该字段时应保持 `default`，否则 reviewer 请求可能失败。
- `reviewer.baseURL` 留空时，reviewer 跟随当前会话模型。如果当前 provider 是 `deepseek-official`，`off` 会传给 harness 的 LLM 适配层，映射为 `reasoningEffort: off`。
- 跟随会话模型但 provider 不是 `deepseek-official` 时，目前不会发送额外的推理控制参数，因此仍使用该 provider 的默认行为。

无论使用哪条路径，插件都只从 reviewer 的最终文本答案读取 allow/deny 判定。chain of thought、reasoning block 或 `reasoning_content` 都不会被当作授权结果。

## 策略

### reviewer 能看到的请求

reviewer 只处理能够对应到精确工具调用的审批请求。请求中的 `callId` 必须能匹配 `tool/call` 事件；匹配不到时直接拒绝。没有 `callId` 的审批请求不按工具请求处理，会继续交给人工 answerer。

`maxInputChars` 限制待审批请求本身。请求超过上限时，在调用 reviewer 之前直接拒绝。最新一条用户消息不会被截断，因为消息后部可能包含收窄或撤销授权的条件。上下文预算无法容纳这条消息时，请求按 fail closed 处理。

发送给 reviewer 的上下文分为可信和不可信两类。只有用户消息能够授权。assistant 文本、工具调用和工具结果只能作为事件上下文。工具结果可能包含 prompt injection，因此默认只发送长度和 sha256 摘要。较新的用户消息优先于较早的消息；后续撤销或收窄授权会覆盖先前授权。较早且过长的消息只保留 sha256 占位符，这类占位符不能作为授权依据。

### 放行规则

`allowRules` 是 reviewer 之前的一条直接放行路径。请求命中规则后会立即返回 `allowed-once`，不会调用 reviewer。因此这里只适合放你愿意自动批准的操作。

例如，下面的规则只对 `bash` 的普通审批生效，并放行命令字符串以 `git status` 或 `git diff` 开头的调用：

```yaml
dsh-auto-review:
  policy:
    allowRules:
      - tool: bash
        operations:
          - "git status"
          - "git diff"
        escalationTarget: ''
```

`tool` 必须和实际工具名完全一致。`operations` 会依次检查工具参数中的 `command`、`operation`、`script`，取其中第一个字符串字段，然后做字面字符串前缀匹配。这里不会解析 shell，也没有参数边界。例如 `git status` 会匹配 `git status --short`。因此不要写 `git` 这类过宽的前缀。

`escalationTarget: ''` 表示这条规则只用于普通审批，也就是工具参数里没有非空 `sandbox_permissions` 的请求。普通审批规则可以把 `operations` 留空，但这会让该 `tool` 的所有普通审批直接通过，包括没有 `command` / `operation` / `script` 字段的调用。除非你确实要对整个工具放行，否则不要这样配。

需要允许一次 `workspace-write` 升级时，要单独写一条升级规则：

```yaml
dsh-auto-review:
  policy:
    allowRules:
      - tool: bash
        operations:
          - "mkdir -p ./dist"
        escalationTarget: workspace-write
```

这条规则只匹配 `sandbox_permissions: workspace-write`，并且操作字符串必须以列出的前缀开头。它不会匹配普通审批。升级规则的 `operations` 不能为空；`escalationTarget` 也只能是空字符串或 `workspace-write`，所以 `danger-full-access` 无法通过 `allowRules` 配置放行。规则不支持正则表达式。

如果没有规则命中，请求才继续交给 reviewer。另一个容易忽略的顺序是 `policy.tools`：当 `tools` 非空时，插件会先按这个列表过滤工具；不在列表中的工具不会进入 `allowRules` 或 reviewer。

### 失败处理

`denyOnReviewerError: true` 是默认值。reviewer 不可达时，结果为 `unavailable`，请求按 fail closed 处理。设为 `false` 后，这类请求会继续交给人工 answerer。

reviewer 返回的判定无法解析时会进行一次纠正重试；第二次仍无法解析则 fail closed。风险等级为 `critical` 的请求不会被 reviewer 放行。即使模型返回 allow，最终结果仍按 deny 处理。

熔断器按当前回合统计。连续三次拒绝，或最近 50 次评审中出现 10 次拒绝时，当前回合被取消。reviewer 不可达不计入拒绝次数；任何非拒绝结果会清零连续拒绝计数。因此 `deny → unavailable → deny → deny` 的连续拒绝数为 2。

### 本地查询

reviewer 可以返回 `need_fact`，先请求本地信息，再给出判定。在 `maxRounds` 轮往返中，查询总数最多为 `maxFacts`。可用工具固定为 `inspect_path`、`inspect_directory`、`inspect_file_metadata`、`inspect_git_remote`、`inspect_git_status`，以及显式开启后的 `inspect_text_file`。`inspect_git_remote` 会移除凭据。

这些工具只能访问工作区。路径通过 realpath 做范围检查；工作区外的路径会被拒绝，不返回文件是否存在等元数据。查询不使用 shell、不访问网络，也不需要沙箱升级。唯一会启动的子进程是 git，调用时关闭 fsmonitor，并使用空的 `hooksPath`。

`inspect_text_file` 是本地查询中唯一可能把工作区文件内容发送给 reviewer 的工具，默认关闭。开启后仍受工作区范围限制，并拒绝二进制文件、超过 `maxBytes` 的文件和已知敏感路径，包括 `.env`、`.ssh/`、`.aws/`、`.kube/`、`.npmrc`、`.pypirc`、`.docker/`、`credentials.*`、`secrets.*` 和密钥文件。敏感文件名无法仅靠静态清单覆盖，因此文件内容查询默认关闭。

## 命令

### /auto-review

不带参数时切换开关状态。`on` 和 `off` 设置状态，`status` 显示当前生效配置，包括外部 reviewer 会收到的信息。

### /approve

`/approve` 列出当前会话最近 10 条拒绝记录。`/approve N` 显示其中一条的工具、目录、完整参数、风险、理由和 fingerprint；查看记录本身不会产生授权。

执行过 `/approve N` 后，可以用 `/approve N confirm` 允许该动作原样重试一次。该批准会作为可信证据发送给 reviewer，重试仍需通过 reviewer 判定。`critical` 动作仍会被拒绝。记录只保存在内存中，每个会话最多 10 条；当前 profile 进程退出后清空。

settings 文档的修改会实时生效。更新插件代码后需要重新启动正在运行的 profile。
