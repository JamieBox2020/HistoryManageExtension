const MAX_RESULTS = 5000
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
// 最近时间统一以页面打开时刻为基准
const PAGE_OPEN_TIME = Date.now()
const RANGE_STORAGE_KEY = 'historyRange'
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const state = {
  items: [],
  rangeItems: [],
  searchSections: [],
  rangeStartTime: 0,
  rangeEndTime: 0,
  selectedUrls: new Set(),
  expandedDomains: new Set(),
  query: '',
  range: 'today',
  view: 'timeline',
  requestId: 0,
  searchRequestId: 0,
  isLoadingHistory: false,
  reloadTimer: undefined,
  searchTimer: undefined,
  toastTimer: undefined
}

const elements = {
  backToTopButton: document.querySelector('#backToTopButton'),
  deleteSelectedButton: document.querySelector('#deleteSelectedButton'),
  historyCount: document.querySelector('#historyCount'),
  historyGroups: document.querySelector('#historyGroups'),
  rangeLabel: document.querySelector('#rangeLabel'),
  rangeMenu: document.querySelector('#rangeMenu'),
  rangeOptions: document.querySelectorAll('[data-range]'),
  rangePicker: document.querySelector('#rangePicker'),
  rangeTrigger: document.querySelector('#rangeTrigger'),
  searchInput: document.querySelector('#searchInput'),
  selectAllCheckbox: document.querySelector('#selectAllCheckbox'),
  selectionLabel: document.querySelector('#selectionLabel'),
  toast: document.querySelector('#toast'),
  viewButtons: document.querySelectorAll('[data-view]')
}

function initialize() {
  restoreRange()
  bindEvents()
  updateBackToTopButton()
  loadHistory()
}

function bindEvents() {
  elements.backToTopButton.addEventListener('click', scrollToTop)
  elements.searchInput.addEventListener('input', handleSearchInput)
  elements.rangePicker.addEventListener('click', handleRangePickerClick)
  elements.selectAllCheckbox.addEventListener('change', toggleSelectAll)
  elements.deleteSelectedButton.addEventListener('click', deleteSelectedItems)
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleKeyboardShortcut)
  window.addEventListener('scroll', updateBackToTopButton, { passive: true })

  elements.rangeOptions.forEach(function (option) {
    option.addEventListener('click', function () {
      changeRange(option.dataset.range, option.textContent)
    })
  })

  elements.viewButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      changeView(button.dataset.view)
    })
  })

  // 新访问保留当前列表快照，仅在删除历史时自动刷新
  chrome.history.onVisitRemoved.addListener(scheduleHistoryReload)
}

function handleSearchInput(event) {
  window.clearTimeout(state.searchTimer)
  state.searchRequestId += 1
  state.query = event.target.value.trim()
  state.searchTimer = window.setTimeout(applyHistorySearch, 280)
}

function updateBackToTopButton() {
  elements.backToTopButton.hidden = window.scrollY < 300
}

function scrollToTop() {
  scrollToPagePosition(0)
}

function scrollToBottom() {
  scrollToPagePosition(document.documentElement.scrollHeight)
}

function scrollToPagePosition(top) {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  window.scrollTo({ top, left: 0, behavior })
}

function handleRangePickerClick(event) {
  if (event.target.closest('.date-filter__menu') === null) {
    toggleRangeMenu(event)
  }
}

function toggleRangeMenu(event) {
  event.stopPropagation()
  const willOpen = elements.rangeMenu.hidden
  elements.rangeMenu.hidden = willOpen === false
  elements.rangeTrigger.setAttribute('aria-expanded', String(willOpen))
}

function changeRange(range, label) {
  if (range) {
    window.clearTimeout(state.searchTimer)
    updateRange(range, label)
    state.selectedUrls.clear()
    window.localStorage.setItem(RANGE_STORAGE_KEY, range)
    closeRangeMenu()
    loadHistory()
  }
}

function restoreRange() {
  const savedRange = window.localStorage.getItem(RANGE_STORAGE_KEY)
  const savedOption = Array.from(elements.rangeOptions).find(function (option) {
    return option.dataset.range === savedRange
  })

  if (savedOption) {
    updateRange(savedRange, savedOption.textContent)
  }
}

function updateRange(range, label) {
  state.range = range
  elements.rangeLabel.textContent = label

  elements.rangeOptions.forEach(function (option) {
    const isSelected = option.dataset.range === range
    option.classList.toggle('is-selected', isSelected)
    option.setAttribute('aria-selected', String(isSelected))
  })
}

function changeView(view) {
  if (view) {
    state.view = view

    if (view === 'domain') {
      state.expandedDomains.clear()
    }

    elements.viewButtons.forEach(function (button) {
      const isActive = button.dataset.view === view
      button.classList.toggle('is-active', isActive)
      button.setAttribute('aria-pressed', String(isActive))
    })

    renderHistory()
  }
}

function handleDocumentClick(event) {
  if (elements.rangePicker.contains(event.target) === false) {
    closeRangeMenu()
  }
}

function closeRangeMenu() {
  elements.rangeMenu.hidden = true
  elements.rangeTrigger.setAttribute('aria-expanded', 'false')
}

function handleKeyboardShortcut(event) {
  if (event.key === '/' && document.activeElement !== elements.searchInput) {
    event.preventDefault()
    elements.searchInput.focus()
  }

  if (event.key === 'Home') {
    event.preventDefault()
    scrollToTop()
  }

  if (event.key === 'End') {
    event.preventDefault()
    scrollToBottom()
  }

  if (event.key === 'Escape') {
    closeRangeMenu()
  }
}

function getRangeStartTime(range = state.range, endTime = Date.now()) {
  const now = new Date(endTime)

  if (range === 'today') {
    now.setHours(0, 0, 0, 0)
    return now.getTime()
  }

  if (range === 'all') {
    return 0
  }

  return endTime - Number(range) * DAY_IN_MILLISECONDS
}

async function loadHistory() {
  const requestId = state.requestId + 1
  state.requestId = requestId
  state.searchRequestId += 1
  state.isLoadingHistory = true
  const endTime = Date.now()
  const startTime = getRangeStartTime(state.range, endTime)

  try {
    const items = await chrome.history.search({
      text: '',
      startTime,
      endTime,
      maxResults: MAX_RESULTS
    })

    if (requestId === state.requestId) {
      state.isLoadingHistory = false
      state.rangeStartTime = startTime
      state.rangeEndTime = endTime
      state.rangeItems = items.filter(function (item) {
        return Boolean(item.url)
      }).sort(function (firstItem, secondItem) {
        return (secondItem.lastVisitTime || 0) - (firstItem.lastVisitTime || 0)
      })

      await applyHistorySearch()
    }
  } catch (error) {
    if (requestId === state.requestId) {
      state.isLoadingHistory = false
      console.error(error)
      showToast(`读取历史记录失败：${error.message}`)
    }
  }
}

async function applyHistorySearch() {
  if (state.isLoadingHistory) {
    return
  }

  const requestId = state.searchRequestId + 1
  state.searchRequestId = requestId
  const normalizedQuery = state.query.toLowerCase()
  state.searchSections = []

  if (normalizedQuery) {
    state.items = state.rangeItems.filter(function (item) {
      return matchesHistoryQuery(item, normalizedQuery)
    })
  } else {
    state.items = state.rangeItems
  }

  removeUnavailableSelections()
  renderAll()

  if (normalizedQuery && state.range !== 'all') {
    await searchEarlierHistory(requestId, state.query)
  }
}

function matchesHistoryQuery(item, normalizedQuery) {
  const title = (item.title || item.url).toLowerCase()
  const displayUrl = formatUrlForDisplay(item.url).toLowerCase()
  return title.includes(normalizedQuery) || displayUrl.includes(normalizedQuery)
}

// 时间窗口互不重叠，旧查询只补充更早的网址，避免重复出现在多个分段
async function searchEarlierHistory(requestId, query) {
  const ranges = Array.from(elements.rangeOptions)
  const currentRangeIndex = ranges.findIndex(function (option) {
    return option.dataset.range === state.range
  })
  let endTime = state.rangeStartTime
  const seenUrls = new Set(state.items.map(function (item) {
    return item.url
  }))

  for (const option of ranges.slice(currentRangeIndex + 1)) {
    if (requestId !== state.searchRequestId || state.items.length >= MAX_RESULTS) {
      return
    }

    const startTime = getRangeStartTime(option.dataset.range, state.rangeEndTime)

    try {
      const results = await chrome.history.search({
        text: query,
        startTime,
        endTime,
        maxResults: MAX_RESULTS - state.items.length
      })

      if (requestId !== state.searchRequestId) {
        return
      }

      const items = results.filter(function (item) {
        if (item.url && item.lastVisitTime >= startTime && item.lastVisitTime < endTime && seenUrls.has(item.url) === false && matchesHistoryQuery(item, query.toLowerCase())) {
          seenUrls.add(item.url)
          return true
        } else {
          return false
        }
      }).sort(function (firstItem, secondItem) {
        return secondItem.lastVisitTime - firstItem.lastVisitTime
      })

      if (items.length > 0) {
        state.searchSections.push({ label: option.textContent, items })
        state.items.push(...items)
        renderAll()
      }
    } catch (error) {
      if (requestId === state.searchRequestId) {
        showToast(`读取更早的搜索结果失败：${error.message}`)
      }
      return
    }

    endTime = startTime
  }
}

function scheduleHistoryReload() {
  window.clearTimeout(state.reloadTimer)
  state.reloadTimer = window.setTimeout(loadHistory, 450)
}

function removeUnavailableSelections() {
  const availableUrls = new Set(state.items.map(function (item) {
    return item.url
  }))

  state.selectedUrls.forEach(function (url) {
    if (availableUrls.has(url) === false) {
      state.selectedUrls.delete(url)
    }
  })
}

function getDomain(url) {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname || parsedUrl.protocol.replace(':', '') || '其他'
  } catch {
    return '其他'
  }
}

function formatUrlForDisplay(url) {
  try {
    return decodeURIComponent(url)
  } catch {
    return url
  }
}

function getVisibleItems() {
  return state.items
}

function renderAll() {
  renderHistory()
  renderSelectionState()
}

function renderHistory() {
  const items = getVisibleItems()
  elements.historyCount.textContent = `共 ${items.length} 条记录`
  elements.historyGroups.replaceChildren()

  if (items.length > 0) {
    const earlierItemCount = state.searchSections.reduce(function (count, section) {
      return count + section.items.length
    }, 0)
    appendHistoryItems(items.slice(0, items.length - earlierItemCount))

    state.searchSections.forEach(function (section) {
      const divider = document.createElement('div')
      divider.className = 'history-search__divider'
      divider.textContent = section.label
      elements.historyGroups.append(divider)
      appendHistoryItems(section.items)
    })
  }

  renderSelectionState()
}

function appendHistoryItems(items) {
  if (state.view === 'timeline') {
    elements.historyGroups.append(createHistoryTimeline(items))
  } else {
    const groups = groupItemsByDomain(items)

    groups.forEach(function (group) {
      elements.historyGroups.append(createHistoryGroup(group))
    })
  }
}

function createHistoryTimeline(items) {
  const timeline = document.createElement('div')
  timeline.className = 'history-timeline'
  timeline.append(createHistoryRows(items))

  return timeline
}

function createHistoryRows(items) {
  const rows = document.createDocumentFragment()
  const urlDifferences = getAdjacentTitleUrlDifferences(items)

  items.forEach(function (item) {
    rows.append(createHistoryRow(item, urlDifferences.get(item)))
  })

  return rows
}

// 仅比较连续且同标题的记录，避免跨记录匹配造成误导
function getAdjacentTitleUrlDifferences(items) {
  const differences = new Map()
  let groupStart = 0

  while (groupStart < items.length) {
    const title = items[groupStart].title
    let groupEnd = groupStart + 1

    while (groupEnd < items.length && title && items[groupEnd].title === title) {
      groupEnd += 1
    }

    if (title && groupEnd - groupStart > 1) {
      setUrlDifferences(items, groupStart, groupEnd, differences)
    }

    groupStart = groupEnd
  }

  return differences
}

function setUrlDifferences(items, groupStart, groupEnd, differences) {
  const displayUrls = items.slice(groupStart, groupEnd).map(function (item) {
    return formatUrlForDisplay(item.url)
  })
  const prefixLength = getCommonPrefixLength(displayUrls)
  const suffixLength = getCommonSuffixLength(displayUrls, prefixLength)

  displayUrls.forEach(function (displayUrl, index) {
    const differenceEnd = displayUrl.length - suffixLength

    if (differenceEnd > prefixLength) {
      differences.set(items[groupStart + index], {
        start: prefixLength,
        end: differenceEnd
      })
    }
  })
}

function getCommonPrefixLength(values) {
  let prefixLength = 0

  while (prefixLength < values[0].length) {
    const character = values[0][prefixLength]
    const isCommon = values.every(function (value) {
      return value[prefixLength] === character
    })

    if (isCommon) {
      prefixLength += 1
    } else {
      break
    }
  }

  return prefixLength
}

function getCommonSuffixLength(values, prefixLength) {
  const shortestLength = Math.min(...values.map(function (value) {
    return value.length
  }))
  const availableLength = shortestLength - prefixLength
  let suffixLength = 0

  while (suffixLength < availableLength) {
    const character = values[0][values[0].length - suffixLength - 1]
    const isCommon = values.every(function (value) {
      return value[value.length - suffixLength - 1] === character
    })

    if (isCommon) {
      suffixLength += 1
    } else {
      break
    }
  }

  return suffixLength
}

function groupItemsByDomain(items) {
  const groups = new Map()

  items.forEach(function (item) {
    const domain = getDomain(item.url)

    if (groups.has(domain) === false) {
      groups.set(domain, {
        title: domain,
        items: []
      })
    }

    groups.get(domain).items.push(item)
  })

  return Array.from(groups.values()).sort(function (firstGroup, secondGroup) {
    return secondGroup.items.length - firstGroup.items.length || firstGroup.title.localeCompare(secondGroup.title)
  })
}

function createHistoryGroup(group) {
  const section = document.createElement('section')
  section.className = 'history-group'

  const isExpanded = state.expandedDomains.has(group.title)
  const header = document.createElement('button')
  header.className = 'history-group__header'
  header.type = 'button'
  header.title = group.title
  header.setAttribute('aria-expanded', String(isExpanded))
  header.addEventListener('click', function () {
    toggleDomainGroup(group.title)
  })

  const identity = document.createElement('span')
  identity.className = 'history-group__identity'

  const favicon = createFavicon(group.items[0])
  favicon.className = 'history-group__favicon'

  const title = document.createElement('span')
  title.className = 'history-group__title'
  title.textContent = group.title
  identity.append(favicon, title)

  const summary = document.createElement('span')
  summary.className = 'history-group__summary'

  const count = document.createElement('span')
  count.className = 'history-group__count'
  count.textContent = `${group.items.length} 条记录`

  const chevron = createSvgIcon('<path d="m8 10 4 4 4-4"></path>')
  chevron.classList.add('history-group__chevron')
  summary.append(count, chevron)

  const rows = document.createElement('div')
  rows.className = 'history-group__rows'
  rows.hidden = isExpanded === false

  rows.append(createHistoryRows(group.items))

  header.append(identity, summary)
  section.append(header, rows)
  return section
}

function toggleDomainGroup(domain) {
  if (state.expandedDomains.has(domain)) {
    state.expandedDomains.delete(domain)
  } else {
    state.expandedDomains.add(domain)
  }

  renderHistory()
}

function createHistoryRow(item, urlDifference) {
  const row = document.createElement('article')
  row.className = 'history-row'

  const checkbox = document.createElement('input')
  checkbox.className = 'history-row__checkbox'
  checkbox.type = 'checkbox'
  checkbox.checked = state.selectedUrls.has(item.url)
  checkbox.setAttribute('aria-label', `选择 ${item.title || item.url}`)
  checkbox.addEventListener('change', function () {
    toggleItemSelection(item.url, checkbox.checked)
  })

  const time = document.createElement('time')
  time.className = 'history-row__time'
  time.dateTime = new Date(item.lastVisitTime || 0).toISOString()
  time.textContent = formatTime(item.lastVisitTime)

  const recentTimeText = formatRecentTime(item.lastVisitTime)

  if (recentTimeText) {
    const recentTime = document.createElement('span')
    recentTime.className = 'history-row__recent-time'
    recentTime.title = '最近时间'
    recentTime.textContent = recentTimeText
    time.append(recentTime)
  }

  const favicon = createFavicon(item)

  const main = document.createElement('div')
  main.className = 'history-row__main'

  const titleText = item.title || item.url
  const title = document.createElement('button')
  title.className = 'history-row__title'
  title.type = 'button'
  title.title = titleText
  appendHighlightedText(title, titleText)
  title.addEventListener('click', function () {
    openHistoryUrl(item.url)
  })
  title.addEventListener('mousedown', function (event) {
    if (event.button === 1) {
      event.preventDefault()
      openHistoryUrl(item.url, true)
    }
  })

  const url = document.createElement('div')
  const displayUrl = formatUrlForDisplay(item.url)
  url.className = 'history-row__url'
  url.title = displayUrl
  appendHighlightedText(url, displayUrl, urlDifference)
  main.append(title, url)

  const actions = document.createElement('div')
  actions.className = 'history-row__actions'
  actions.append(
    createRowAction('复制完整网址', createCopyIcon(), function () {
      copyHistoryUrl(item.url)
    }),
    createRowAction('删除该网址的全部历史', createTrashIcon(), function () {
      deleteSingleItem(item)
    }, true)
  )

  row.append(checkbox, time, favicon, main, actions)
  return row
}

function appendHighlightedText(element, text, difference) {
  const searchMatches = getSearchMatches(text)
  const boundaries = [0, text.length]

  searchMatches.forEach(function (match) {
    boundaries.push(match.start, match.end)
  })

  if (difference) {
    boundaries.push(difference.start, difference.end)
  }

  const sortedBoundaries = Array.from(new Set(boundaries)).sort(function (firstBoundary, secondBoundary) {
    return firstBoundary - secondBoundary
  })

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index]
    const end = sortedBoundaries[index + 1]
    const content = text.slice(start, end)
    const isSearchMatch = searchMatches.some(function (match) {
      return start >= match.start && end <= match.end
    })
    const isUrlDifference = difference && start >= difference.start && end <= difference.end

    if (isSearchMatch || isUrlDifference) {
      const highlightedText = document.createElement('span')
      highlightedText.className = isSearchMatch ? 'history-row__search-match' : 'history-row__url-difference'
      highlightedText.textContent = content
      element.append(highlightedText)
    } else {
      element.append(document.createTextNode(content))
    }
  }
}

function getSearchMatches(text) {
  const matches = []
  const normalizedText = text.toLowerCase()
  const normalizedQuery = state.query.toLowerCase()

  if (normalizedQuery) {
    let matchStart = normalizedText.indexOf(normalizedQuery)

    while (matchStart !== -1) {
      const matchEnd = matchStart + normalizedQuery.length
      matches.push({ start: matchStart, end: matchEnd })
      matchStart = normalizedText.indexOf(normalizedQuery, matchEnd)
    }
  }

  return matches
}

function createFavicon(item) {
  const wrapper = document.createElement('div')
  wrapper.className = 'history-row__favicon'
  wrapper.textContent = getDomain(item.url).slice(0, 1).toUpperCase()

  const image = document.createElement('img')
  image.addEventListener('load', function () {
    wrapper.replaceChildren(image)
  })
  image.src = getFaviconUrl(item.url)

  return wrapper
}

function getFaviconUrl(pageUrl) {
  const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'))
  faviconUrl.searchParams.set('pageUrl', pageUrl)
  faviconUrl.searchParams.set('size', '32')
  return faviconUrl.toString()
}

function createRowAction(label, icon, handler, isDanger = false) {
  const button = document.createElement('button')
  button.className = isDanger ? 'row-action row-action--danger' : 'row-action'
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.append(icon)
  button.addEventListener('click', handler)
  return button
}

function createTrashIcon() {
  return createSvgIcon('<path fill="#5f6368" stroke="none" d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4zm2 2h6V4H9zM6.074 8l.857 12H17.07l.857-12zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1m4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1"></path>')
}

function createCopyIcon() {
  return createSvgIcon('<g fill="none" stroke="#5f6368" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M14.556 13.218a2.67 2.67 0 0 1-3.774-3.774l2.359-2.36a2.67 2.67 0 0 1 3.628-.135m-.325-3.167a2.669 2.669 0 1 1 3.774 3.774l-2.359 2.36a2.67 2.67 0 0 1-3.628.135"></path><path d="M10.5 3c-3.287 0-4.931 0-6.037.908a4 4 0 0 0-.555.554C3 5.57 3 7.212 3 10.5V13c0 3.771 0 5.657 1.172 6.828S7.229 21 11 21h2.5c3.287 0 4.931 0 6.038-.908q.304-.25.554-.554C21 18.43 21 16.788 21 13.5"></path></g>')
}

function createSvgIcon(content) {
  const namespace = 'http://www.w3.org/2000/svg'
  const template = document.createElementNS(namespace, 'svg')
  template.setAttribute('viewBox', '0 0 24 24')
  template.setAttribute('aria-hidden', 'true')
  template.innerHTML = content
  return template
}

function toggleItemSelection(url, selected) {
  if (selected) {
    state.selectedUrls.add(url)
  } else {
    state.selectedUrls.delete(url)
  }

  renderSelectionState()
}

function toggleSelectAll(event) {
  const items = getVisibleItems()

  items.forEach(function (item) {
    if (event.target.checked) {
      state.selectedUrls.add(item.url)
    } else {
      state.selectedUrls.delete(item.url)
    }
  })

  renderHistory()
}

function renderSelectionState() {
  const visibleUrls = getVisibleItems().map(function (item) {
    return item.url
  })
  const visibleSelectedCount = visibleUrls.filter(function (url) {
    return state.selectedUrls.has(url)
  }).length

  elements.selectAllCheckbox.checked = visibleUrls.length > 0 && visibleSelectedCount === visibleUrls.length
  elements.selectAllCheckbox.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleUrls.length
  elements.selectAllCheckbox.disabled = visibleUrls.length === 0
  elements.selectionLabel.textContent = visibleSelectedCount > 0 ? `已选择 ${visibleSelectedCount} 项` : '全选当前结果'
  elements.deleteSelectedButton.disabled = state.selectedUrls.size === 0
}

async function deleteSingleItem(item) {
  const confirmed = window.confirm(`确定删除“${item.title || item.url}”吗？\n\n这会删除该网址的全部访问记录，且无法撤销。`)

  if (confirmed) {
    try {
      await chrome.history.deleteUrl({ url: item.url })
      showToast('该网址的历史记录已删除')
      await loadHistory()
    } catch (error) {
      showToast(`删除失败：${error.message}`)
    }
  }
}

async function copyHistoryUrl(url) {
  try {
    await navigator.clipboard.writeText(url)
    showToast('完整网址已复制')
  } catch (error) {
    showToast(`复制失败：${error.message}`)
  }
}

async function deleteSelectedItems() {
  const urls = Array.from(state.selectedUrls)

  if (urls.length > 0) {
    const confirmed = window.confirm(`确定删除所选的 ${urls.length} 个网址吗？\n\n每个网址的全部访问记录都会被删除，且无法撤销。`)

    if (confirmed) {
      elements.deleteSelectedButton.disabled = true

      try {
        await Promise.all(urls.map(function (url) {
          return chrome.history.deleteUrl({ url })
        }))
        state.selectedUrls.clear()
        showToast(`已删除 ${urls.length} 个网址的历史记录`)
        await loadHistory()
      } catch (error) {
        showToast(`删除失败：${error.message}`)
        renderSelectionState()
      }
    }
  }
}

function openHistoryUrl(url, openInNewTab = false) {
  try {
    const parsedUrl = new URL(url)
    const allowedProtocols = ['http:', 'https:', 'ftp:', 'file:']

    if (allowedProtocols.includes(parsedUrl.protocol)) {
      if (openInNewTab) {
        chrome.tabs.create({ url, active: false })
      } else {
        window.location.assign(url)
      }
    } else {
      showToast('Chrome 不允许扩展打开这个内部地址')
    }
  } catch {
    showToast('这个历史地址无效，无法打开')
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer)
  elements.toast.textContent = message
  elements.toast.hidden = false
  state.toastTimer = window.setTimeout(function () {
    elements.toast.hidden = true
  }, 3200)
}

// 仅展示页面打开时当天且不超过 12 小时的记录，满一小时后省略秒数
function formatRecentTime(timestamp) {
  const todayStart = new Date(PAGE_OPEN_TIME)
  todayStart.setHours(0, 0, 0, 0)
  const elapsedMilliseconds = PAGE_OPEN_TIME - timestamp

  if (timestamp >= todayStart.getTime() && elapsedMilliseconds >= 0 && elapsedMilliseconds <= DAY_IN_MILLISECONDS / 2) {
    const totalSeconds = Math.floor(elapsedMilliseconds / 1000)
    const totalMinutes = Math.floor(totalSeconds / 60)

    if (totalMinutes < 60) {
      return `${totalMinutes}分${totalSeconds % 60}秒前`
    } else {
      return `${Math.floor(totalMinutes / 60)}时${totalMinutes % 60}分前`
    }
  } else {
    return ''
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp || 0)
  const month = formatTimePart(date.getMonth() + 1)
  const day = formatTimePart(date.getDate())
  const hour = formatTimePart(date.getHours())
  const minute = formatTimePart(date.getMinutes())
  const second = formatTimePart(date.getSeconds())
  const weekday = WEEKDAY_LABELS[date.getDay()]
  return `${month}-${day} ${hour}:${minute}:${second} ${weekday}`
}

function formatTimePart(value) {
  return String(value).padStart(2, '0')
}

initialize()
