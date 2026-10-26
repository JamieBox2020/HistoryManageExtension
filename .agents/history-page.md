# Chrome 历史记录页面模块

## 职责与入口

- Manifest V3 扩展覆盖 `chrome://history/`；`manifest.json` 注册 `history.html`，`background.js` 点击扩展图标打开历史页
- 页面使用原生 HTML、CSS、JavaScript，无第三方依赖和构建步骤；`history.html` 定义页面骨架，`history.js` 处理数据和动态记录行，`styles.css` 管理样式
- `manifest.json` 仅申请 `history`、`favicon` 权限，最低 Chrome 版本为 115

## 公共能力与复用

- 时间视图和域名视图共用 `createHistoryRows`、`createHistoryRow`，新增行内展示或交互应在此接入；域名按 hostname 分组，进入域名视图会清空展开状态，见 `history.js`
- `formatUrlForDisplay` 解码展示 URL；打开、复制、选择和删除始终使用原始 URL。`createFavicon`、`getFaviconUrl` 使用扩展 `/_favicon/`，不请求外部图标服务，见 `history.js`
- `appendHighlightedText` 统一处理搜索命中与 URL 差异。`getAdjacentTitleUrlDifferences` 只比较当前列表中连续且同标题的记录，以解码后 URL 的共同前后缀确定差异；无独有字符不制造空高亮，搜索蓝色优先于差异橙色，见 `history.js`、`styles.css`
- `createRowAction` 统一创建行内按钮，现有顺序为复制、删除；反馈复用 `showToast`，见 `history.js`

## 关键约定

- `loadHistory` 调用 `chrome.history.search`，最多读取 5000 个有效 URL，按 `lastVisitTime` 倒序排列；每项表示一个网址的最后访问情况，并非每次访问的独立记录。`requestId` 避免旧请求覆盖新结果，见 `history.js`
- 列表保留当前查询快照：不监听 `onVisited`，再次访问网址不会使原记录移到顶部，也不会新增顶部记录，便于连续中键打开。页面初始化、切换日期范围及删除操作会重新查询；外部删除通过 `onVisitRemoved` 防抖刷新。因此删除也可能带入最新访问数据，见 `history.js` 的 `bindEvents`、`scheduleHistoryReload`
- 搜索只过滤已读取的 `state.rangeItems`，匹配标题和解码 URL，不区分大小写且不重新请求；切换视图也只重新渲染，见 `history.js` 的 `applyHistorySearch`、`changeView`
- 日期范围默认 `today`，从本地零点开始；数字范围为最近 N 个 24 小时，`all` 从时间戳 0 开始。`historyRange` 使用同源 `localStorage` 保存，初始化先恢复再查询；不依赖 `chrome.storage`，见 `history.js`
- 标题保持 `button`；左键通过 `window.location.assign` 在当前页打开，中键 `mousedown` 使用 `chrome.tabs.create({ url, active: false })` 在后台标签页打开，历史页保持选中。只允许 `http:`、`https:`、`ftp:`、`file:`，见 `history.js` 的 `createHistoryRow`、`openHistoryUrl`
- 选择以 URL 为键；`chrome.history.deleteUrl` 删除该 URL 的全部访问记录，单条删除和批量删除均需确认。复制通过 `navigator.clipboard.writeText` 写入原始完整 URL，见 `history.js`
- 绝对时间格式为 `MM-DD HH:mm:ss 周几`。其下的最近时间由 `formatRecentTime` 换算：记录属于页面打开时的本地当天，且距打开时刻在 0 至 12 小时内才显示；不足一小时为“分秒前”，满一小时为“时分前”，向下取整，见 `history.js`
- 最近时间统一使用脚本加载时固定的 `PAGE_OPEN_TIME`，不使用计时器；搜索、切换视图、重新查询都不重置该基准，仅刷新或重新打开页面时更新。日期查询边界仍由查询时的当前时间计算，见 `history.js` 的 `formatRecentTime`、`getRangeStartTime`、`loadHistory`
- 搜索框保留 `type="search"` 的原生清空行为；叉号通过 `::-webkit-search-cancel-button` 的 SVG 数据 URL 替换，不另加按钮或清空事件，见 `history.html`、`styles.css`

## 特别强调的写法

- 搜索框提示为“搜索历史记录”，通过 `history.html` 的原生 `autofocus` 在打开页面时自动聚焦；聚焦时保持浅灰背景，不添加蓝色边框或切换白底，避免与页面背景混在一起，见 `styles.css` 的 `.search-field`
- 最近时间与上方日期保持同一灰色，继承 `.history-row__time` 的颜色；字号稍小并留出上方间距，避免削弱右侧历史条目的视觉重点，见 `styles.css` 的 `.history-row__recent-time`
- 保持接近 Chrome 原生历史页的紧凑浅色样式；搜索栏和记录列表共用 `styles.css` 的 `.history-main` 控制整体宽度；顶部工具栏保持普通文档流，URL 在标题下单行省略，通过 `title` 查看完整解码地址，不恢复已移除的头部、统计板块和额外操作入口，见 `history.html`、`styles.css`
- 扩展菜单及记录操作按钮的悬浮背景与图标高亮应成对设计：普通操作使用浅蓝背景和深蓝图标，危险操作使用浅红背景和深红图标，见 `styles.css`、`history.js`
