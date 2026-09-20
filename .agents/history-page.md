# Chrome 历史记录页面模块

> 最后核对：2026-09-20

> 状态：有效

## 职责与入口

- 职责：以 Manifest V3 扩展覆盖 `chrome://history/`，在本地提供历史记录查询、筛选、分组、打开、复制网址和删除能力，见 `manifest.json`、`history.html`、`history.js`
- 页面入口：`history.html`，由 `manifest.json` 的 `chrome_url_overrides.history` 注册
- 工具栏入口：`background.js` 监听扩展图标点击并打开 `chrome://history/`
- 实现方式：原生 HTML、CSS、JavaScript，无依赖、无构建步骤，见 `history.html`、`history.js`、`styles.css`

## 数据与交互

- 数据流：`history.js` 按当前时间起点调用 `chrome.history.search` 获取最多 5000 条有效 URL，再在前端对标题和解码后 URL 执行不区分大小写的子串匹配；搜索仍受日期范围限制，但输入过程不重复请求历史记录；结果按 `lastVisitTime` 倒序渲染，访问或删除事件触发防抖刷新，见 `history.js`
- 时间范围：首次默认 `today`；今天从本地零点开始，数字范围按最近 N 个 24 小时计算，`all` 从时间戳 0 开始。用户选择通过 `window.localStorage` 的 `historyRange` 保存，初始化时先恢复再查询；点击整个 `#rangePicker` 都可展开菜单，菜单内部点击不会触发容器二次切换，见 `history.html`、`history.js`
- 视图状态：默认 `timeline` 逐条显示；`domain` 按 URL hostname 合并。进入域名视图时清空 `expandedDomains`，所以所有域名组默认折叠，再由用户逐项展开，见 `history.js`
- 选择与删除：选中状态以 URL 为键；`chrome.history.deleteUrl` 会删除该 URL 的全部访问记录，不是单次访问，见 `history.js`
- 行内操作：操作区依次为复制、删除；复制通过 `navigator.clipboard.writeText` 写入历史项的原始完整 URL，不复制经过 `decodeURI` 处理的展示文本，结果通过页面 Toast 反馈，见 `history.js`
- 打开规则：历史标题保持 `button`；左键 `click` 和中键 `mousedown` 都经协议校验后调用 `chrome.tabs.create`，因此两者均在新标签页打开，见 `history.js`
- 展示约定：时间格式固定为 `MM-DD HH:mm:ss 周几`；URL 使用 `decodeURI` 生成易读文本，但打开、选择和删除始终使用原始 URL；右下角固定显示当前日期与搜索条件下的可见记录数，见 `history.html`、`history.js`、`styles.css`
- 高亮：搜索词在标题和显示 URL 中的命中文本标蓝。URL 差异仅比较当前渲染列表中连续且标题完全一致的记录，对解码后的 URL 计算共同前缀和后缀，中间差异段使用 `#EE7A2F` 橙色；较短 URL 没有独有字符时不制造空高亮，搜索命中与差异段重叠时蓝色优先。时间视图按全列表比较，域名视图按各域名组内列表比较，见 `history.js`、`styles.css`
- 快捷键与滚动：`/` 聚焦搜索框，`Home` 和 `End` 在搜索框保持焦点时也会分别平滑滚动到页面顶部和底部，`Escape` 关闭日期菜单；回到顶部按钮在滚动超过 300px 后显示，系统启用减少动态效果时改用直接滚动，见 `history.html`、`history.js`

## 关键约束与决策

- 顶部工具栏保持普通文档流，不使用 fixed、悬浮头部卡片或额外头部边框与占位间距，见 `history.html`、`styles.css`
- 页面保持接近 Chrome 原生历史页的紧凑浅色样式；不恢复标题头部、摘要统计、读取状态板块、暗色模式、刷新按钮、网站筛选、清理时间按钮或详情统计按钮，见 `history.html`、`styles.css`
- URL 位于标题下方，单行省略，悬浮通过 `title` 查看完整的解码地址，见 `history.js`、`styles.css`
- 允许打开的协议仅为 `http:`、`https:`、`ftp:` 和 `file:`；浏览器内部地址不直接打开，见 `history.js`
- 日期记忆不使用 `chrome.storage`；该页面环境曾出现 `chrome.storage` 未注入，当前使用同源 `localStorage`，因此 Manifest 不需要 `storage` 权限，见 `history.js`、`manifest.json`

## 项目代码规范

- 后续在扩展菜单或记录操作区增加按钮时，必须同时设计鼠标悬浮时的背景色和图标高亮色；普通操作使用浅蓝主题背景配深蓝图标，危险操作使用浅红背景配深红图标，保持状态反馈成对且一致，见 `styles.css`、`history.js`

## 非显而易见的依赖或配置

- `manifest.json`：仅申请 `history` 和 `favicon` 权限，最低 Chrome 版本为 115
- `chrome.runtime.getURL('/_favicon/')`：在 `history.js` 中读取历史页面 favicon，不请求外部图标服务
- `icons/history-icon.svg`：扩展图标源文件；PNG 尺寸文件位于 `icons/`

## 相关文件

- `manifest.json`
- `background.js`
- `history.html`
- `history.js`
- `styles.css`
- `icons/history-icon.svg`
