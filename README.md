# dsh-todo-plugin

`@bangbaba0228/dsh-todo-plugin` — DSH 会话里的轻量个人待办插件。右侧待办侧栏与聊天并排，AI 把会话中的材料整理成一张候选卡片，用户确认后才写入全局清单。

## 特点

- 所有会话共享同一份待办，切换会话不影响清单。
- 侧栏显示未完成任务，已完成任务折叠；聊天头部按钮随时开合。
- AI 工具 `todo_list`、`todo_propose`、`todo_apply`、`todo_discard`、`todo_direct`：先读取清单，再集中提案；用户确认后执行，目标明确的指令可直接执行。
- 一次整理只对应输入框上方的一张卡片，后续对话刷新同一张卡片。
- 数据保存在 profile 目录的 `todo-data/state.json`，重启后仍在。

## 安装

从 Releases 下载 `.tgz`，用 DSH 的插件安装方式装入 profile，然后重载窗口。包内已包含构建产物，运行时不需要 TypeScript。

## 开发

```powershell
npm ci
npm test          # 类型检查、构建、冒烟与回归测试
npm run test:browser   # 需要 npx playwright install chromium
```
