# MiniMax 多模态插件

MiniMax 多模态是 Redou 的内置 Plugin，不是 Skill。当前阶段只实现 Direct HTTP 接入，并注册了三个工具：

- `minimax.health_check`
- `minimax.text_to_audio`
- `minimax.text_to_image`

本阶段暂不支持 CLI Driver、MCP Driver、自制 MCP Server、`video_generate` 或 `music_generate`。

## 配置

在 Redou 插件中心打开“MiniMax 多模态”的配置面板，填写：

- `MINIMAX_API_KEY`
- Region
- Host
- 输出目录
- 默认语音模型和音色
- 默认图片模型和比例

Region 与 Host 的默认对应关系：

- `cn` => `https://api.minimaxi.com`
- `global` => `https://api.minimax.io`
- `advanced` => 手动填写 Host

不要使用 `https://api.minimax.chat` 作为默认 Host。

API Key 会写入本地 Redou 配置，但不会写死在源码中。UI 保存后只显示掩码，例如 `sk-****abcd`；日志和错误信息会脱敏 Authorization、`MINIMAX_API_KEY` 和 `apiKey`。

## 输出目录

默认输出目录是：

```text
.redou/minimax-output
```

相对路径会按当前项目目录解析。语音和图片测试生成的文件都会保存到该目录；目录不存在时会自动创建。

## 测试

“测试连接”只做本地配置校验，不生成语音或图片，也不消耗额度。真实鉴权会在“生成测试语音”或“生成测试图片”时完成。

Token Plan 用户可以先使用 Direct HTTP 测试：

- 测试语音默认文本：`Redou 正在测试 MiniMax 语音生成。`
- 测试图片默认 prompt：`一只橘猫坐在电脑旁，赛博朋克风格，16:9`

这两个测试会调用 MiniMax 付费 API，可能消耗 Token Plan 额度或账户余额。

## 常见错误

- API Key 缺失：在 MiniMax 插件设置中填写 API Key。
- `401` / `1004`：检查 Key 是否有效、Region/Host 是否匹配、Token Plan 是否开通。
- Region/Host 不匹配：国内默认使用 `https://api.minimaxi.com`，Global 默认使用 `https://api.minimax.io`。
- 套餐无额度：检查 MiniMax Token Plan 额度或模型权限。
- 输出目录无权限：换到可写目录，或检查 `.redou/minimax-output` 权限。
- 网络失败：检查代理、防火墙或 MiniMax 服务地址。
