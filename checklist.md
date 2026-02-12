# OpenSpec Desktop 功能检查表

## 一、桌面应用框架 (desktop/app.py)

1. [ ] macOS 原生窗口启动（NSWindow + NSSplitView 布局）
2. [ ] 自动启动 Vite 开发服务器并等待就绪
3. [ ] WKWebView 加载 Web App（http://localhost:5173）
4. [ ] 应用退出时自动关闭 Vite 进程和 PTY 进程
5. [ ] 记住上次打开的目录（~/.openspec_desktop.json 持久化）
6. [ ] macOS 菜单栏（Quit / Edit 菜单，支持 Cmd+C/V/X/A）

## 二、PTY 终端管理

7. [ ] 主终端 PTY 会话（zsh -l，支持 256color）
8. [ ] Review 终端 PTY 会话（独立进程，用于 Codex Worker）
9. [ ] Change 终端多会话管理（每个 tab 独立 PTY）
10. [ ] PTY 动态 resize（接收 xterm.js 尺寸变化，TIOCSWINSZ + SIGWINCH）
11. [ ] 终端输出 base64 编码传输到 WebView
12. [ ] 终端进程退出检测与通知

## 三、命令回调机制（Prompt Detection）

13. [ ] Shell prompt 检测（正则匹配 $、%、❯、>）
14. [ ] Droid prompt 检测（正则匹配 > / ❯ / "How can I help"）
15. [ ] ANSI 转义序列过滤（清理后再做 prompt 匹配）
16. [ ] 主终端 runCommandWithCallback（发命令 → 等 prompt → 回调 Web）
17. [ ] Review 终端 runReviewCommandWithCallback
18. [ ] Change 终端 runChangeCommandWithCallback（按 tabId 路由）

## 四、Native Bridge（Web ↔ Python 通信）

19. [ ] WKUserContentController 消息处理（nativeBridge / terminalInput / terminalResize）
20. [ ] 请求-响应模式（requestId + Promise，base64 编码避免转义问题）
21. [ ] 文件系统操作：pickDirectory / readDirectory / readFile / writeFile
22. [ ] Git 操作：status / add / commit / log / diff / branch
23. [ ] JS alert / confirm / prompt 原生对话框代理（WKUIDelegate）

## 五、Hook 通知系统

24. [ ] HTTP 服务器监听 127.0.0.1:18888（接收 droid/codex hook POST）
25. [ ] Hook 事件转发到 WebView（window.__onHookNotify）
26. [ ] Hook 事件按 session_id 路由到对应 tab
27. [ ] SessionStart 事件捕获 session_id
28. [ ] Stop 事件提取 last_result 显示给用户
29. [ ] codex-notify 事件完成检测（isCodexTurnComplete 多策略判断）
30. [ ] PostToolUse / SessionEnd 触发文件树自动刷新

## 六、Web App - 文件树与目录浏览

31. [ ] 目录选择器（原生 NSOpenPanel / 浏览器 File System Access API）
32. [ ] openspec/ 子目录自动识别（specs + changes）
33. [ ] 递归解析 specs 目录（检测 spec.md）
34. [ ] 递归解析 changes 目录（检测 proposal.md / design.md / tasks.md）
35. [ ] Archive 归档目录支持
36. [ ] TreeView 树形展示（Section / Change / Spec / Artifact 图标区分）
37. [ ] 右键上下文菜单（Continue Change / Codex Worker / Reactivate / New Change）
38. [ ] Canvas 卡片视图（可拖拽，自动网格布局）

## 七、Web App - 编辑器面板

39. [ ] Spec / Artifact 文件内容加载与显示
40. [ ] 文本编辑器（textarea）
41. [ ] 保存功能（Cmd+S 快捷键，原生 writeFile / 浏览器 createWritable）
42. [ ] 编辑内容自动保存到历史记录（2 秒防抖）
43. [ ] Markdown Checkbox 渲染与交互（MarkdownWithCheckbox 组件）

## 八、Web App - 输入历史记录

44. [ ] 历史记录持久化（openspec/desktop_chat_history.json）
45. [ ] 历史记录列表展示（按时间倒序，显示来源标签）
46. [ ] 历史记录展开预览 / 加载到编辑器
47. [ ] 单条删除 / 全部清空（带确认）

## 九、Web App - Droid Worker（Change Tab）

48. [ ] 多 tab 支持（每个 tab 独立 PTY + 独立状态）
49. [ ] 自动初始化流程：启动 PTY → cd 项目目录 → 启动 droid
50. [ ] SessionStart hook 捕获 session_id 并标记 initialized
51. [ ] 发送消息到 droid（Send 按钮 / Cmd+Enter）
52. [ ] New Change 命令（/opsx-new）
53. [ ] Continue Change 自动加载（/opsx-continue）
54. [ ] Stop 中断（发送 Ctrl+C）
55. [ ] 对话历史展示（用户/助手消息，含 spinner 等待状态）
56. [ ] tab 关闭时清理 PTY 资源

## 十、Web App - Codex Worker（Codex Tab）

57. [ ] 自动初始化流程：启动 Review PTY → cd → source reviewcmd.sh → 启动 codex
58. [ ] codex-notify hook 完成检测（多种 event_type / status 策略）
59. [ ] 提取 Codex 最终回复（last-assistant-message / last_result）
60. [ ] 发送消息到 Codex
61. [ ] Review 按钮（预设代码评审 prompt）
62. [ ] Stop 中断

## 十一、Web App - 嵌入式终端（EmbeddedTerminal）

63. [ ] xterm.js 终端渲染（256 色主题，50000 行滚动缓冲）
64. [ ] 三种 channel：main / review / change（per-tab）
65. [ ] 键盘输入转发到对应 PTY
66. [ ] Cmd+C 复制选中文本 / Cmd+V 粘贴
67. [ ] ResizeObserver 自适应 + FitAddon + 防抖 resize 通知

## 十二、日志面板（Log Panel）

68. [ ] NSTextView 原生日志面板（深色主题，等宽字体）
69. [ ] 五种日志类型颜色区分（SEND/RECV/CALLBACK/HOOK/INFO）
70. [ ] 毫秒级时间戳
71. [ ] 自动滚动开关
72. [ ] 清空日志
73. [ ] 最多 2000 条，超出自动裁剪旧条目

## 十三、Tab 管理与路由

74. [ ] Viewer / Droid Worker / Codex Worker 三类 tab
75. [ ] 多 Droid Worker tab 并行（独立 PTY + 独立 session_id）
76. [ ] tab 标签显示 spinner（busy 状态）和 session_id 前缀
77. [ ] 关闭 tab 确认对话框 + 资源清理
78. [ ] 空闲 Droid Worker tab 双击重置（resetKey 机制）

## 十四、其他

79. [ ] Reactivate 归档 Change（mv archive → active，带冲突检测）
80. [ ] Codex 通知脚本（openspec/codex-notify.sh）
81. [ ] Review 命令脚本（openspec/reviewcmd.sh）
82. [ ] 相对时间显示工具（timeUtils.ts）
