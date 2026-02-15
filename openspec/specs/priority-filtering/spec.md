## ADDED Requirements

### Requirement: P0/P1 优先级过滤
系统 SHALL 提供 `filterP0P1Items` 函数，从 checkbox 项列表中过滤出 P0 和 P1 优先级的项目。

#### Scenario: 过滤包含 P0/P1 项的列表
- **WHEN** 输入包含 "P0 严重的空指针异常", "P1 缺少错误处理", "P2 代码风格建议" 的 checkbox 项
- **THEN** 返回仅包含 "P0 严重的空指针异常" 和 "P1 缺少错误处理" 的列表

#### Scenario: 过滤无 P0/P1 项的列表
- **WHEN** 输入仅包含 "P2 代码风格建议", "P2 变量命名优化" 的 checkbox 项
- **THEN** 返回空列表

#### Scenario: 大小写不敏感匹配
- **WHEN** 输入包含 "p0 问题描述" 或 "P0 问题描述" 的 checkbox 项
- **THEN** 两者都 SHALL 被识别为 P0 优先级

### Requirement: Auto Fix 完成判定
系统 SHALL 基于 P0/P1 过滤结果判定 Auto Fix 是否完成。

#### Scenario: 仅剩 P2 问题时判定完成
- **WHEN** Re-review 结果中所有未勾选项均为 P2 或更低优先级
- **THEN** 判定 Auto Fix 完成
- **THEN** 触发庆祝动画

#### Scenario: 仍有 P0 问题时继续循环
- **WHEN** Re-review 结果中存在未勾选的 P0 项
- **THEN** 判定 Auto Fix 未完成
- **THEN** 继续发送修复项给 Droid Worker
