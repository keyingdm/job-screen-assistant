# AI 辅助接入约定

0.3.0 仅预留本地 JavaScript 接口 `JobScreenAI`，没有服务地址、密钥、远程调用或自动推荐。总台按钮保持“待配置”。

## 注册服务

由后续扩展代码在总台注册 provider；Manifest V3 不允许下载并执行远程脚本。服务实现负责自身认证和请求取消。

```js
JobScreenAI.register({
  name: '服务名称',
  async run({ operation, jobs, profile, signal }) {
    // 使用自己配置的服务；不得在发布资源中硬编码密钥。
    return { items: [] };
  }
});
```

`operation` 为 `extract`、`explain` 或 `recommend`。输入岗位最多100条，只包含 `key`、`name`、`requirements`、`majorRequirements`、`description`、`city`，不附带链接、收藏库或任意对象字段。`profile` 仅在调用者明确传入时附带；后续产品接入应逐项选择允许发送的个人条件。

## 主动调用与返回值

后续界面应先让用户选择岗位范围、个人条件和服务，再确认本次请求；目前的 `consent` 是调用契约参数，不等于已经完成真实的用户确认界面。

```js
const result = await JobScreenAI.run({
  operation: 'recommend',
  jobs: selectedJobs,
  // 只有用户选择发送个人条件时才添加 profile。
  consent: true,
  signal: controller.signal
});
```

provider 返回：

```js
{
  items: [{
    key: '输入岗位的 key',
    reason: '建议及适用范围',
    evidence: ['输入岗位原文中的连续片段'],
    score: 0.7 // 可省略；只作辅助排序
  }]
}
```

接口校验岗位 key 属于本次输入，且每条 evidence 非空并逐字存在于该岗位要求、独立专业字段或职责中。输出统一附带 `source: 'ai'` 和 `needsReview: true`；分数限于0至1。缺少原文依据或引用其他岗位的结果会拒绝。

这只能验证引用确实存在，不能证明模型解释正确。后续界面应把辅助建议与本地规则、原文并列，不能自动覆盖明确冲突或持久保存未收藏岗位。任何联网服务接入、请求界面及评估均尚未实现。

## 已验证

单元检查覆盖默认未配置、未确认不调用 provider、输入字段白名单、个人条件未主动传入则缺省、原文依据校验。本版只用离线虚构 provider 检查契约，没有发送真实资料。
