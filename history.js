const MAX_RESULTS = 5000
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const RANGE_STORAGE_KEY = 'historyRange'

const state = {
  items: [],
  rangeItems: [],
  selectedUrls: new Set(),
  expandedDomains: new Set(),
  query: '',
  range: 'today',
  view: 'timeline',
  requestId: 0,
  reloadTimer: undefined,
  searchTimer: undefined,
  toastTimer: undefined
}

const elements = {
  backToTopButton: document.querySelector('#backToTopButton'),
  deleteSelectedButton: document.querySelector('#deleteSelectedButton'),
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

  chrome.history.onVisited.addListener(scheduleHistoryReload)
  chrome.history.onVisitRemoved.addListener(scheduleHistoryReload)
}

function handleSearchInput(event) {
  window.clearTimeout(state.searchTimer)
  state.query = event.target.value.trim()
  state.searchTimer = window.setTimeout(applyHistorySearch, 280)
}

function updateBackToTopButton() {
  elements.backToTopButton.hidden = window.scrollY < 300
}

function scrollToTop() {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  window.scrollTo({ top: 0, left: 0, behavior })
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

  if (event.key === 'Escape') {
    closeRangeMenu()
  }
}

function getRangeStartTime() {
  const now = new Date()

  if (state.range === 'today') {
    now.setHours(0, 0, 0, 0)
    return now.getTime()
  }

  if (state.range === 'all') {
    return 0
  }

  return Date.now() - Number(state.range) * DAY_IN_MILLISECONDS
}

async function loadHistory() {
  const requestId = state.requestId + 1
  state.requestId = requestId

  try {
    const items = await chrome.history.search({
      text: '',
      startTime: getRangeStartTime(),
      endTime: Date.now(),
      maxResults: MAX_RESULTS
    })

    if (requestId === state.requestId) {
      state.rangeItems = items.filter(function (item) {
        return Boolean(item.url)
      }).sort(function (firstItem, secondItem) {
        return (secondItem.lastVisitTime || 0) - (firstItem.lastVisitTime || 0)
      })

      applyHistorySearch()
    }
  } catch (error) {
    if (requestId === state.requestId) {
      console.error(error)
      showToast(`读取历史记录失败：${error.message}`)
    }
  }
}

function applyHistorySearch() {
  const normalizedQuery = state.query.toLowerCase()

  if (normalizedQuery) {
    state.items = state.rangeItems.filter(function (item) {
      const title = (item.title || item.url).toLowerCase()
      const displayUrl = formatUrlForDisplay(item.url).toLowerCase()
      return title.includes(normalizedQuery) || displayUrl.includes(normalizedQuery)
    })
  } else {
    state.items = state.rangeItems
  }

  removeUnavailableSelections()
  renderAll()
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
    return decodeURI(url)
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
  elements.historyGroups.replaceChildren()

  if (items.length > 0) {
    if (state.view === 'timeline') {
      elements.historyGroups.append(createHistoryTimeline(items))
    } else {
      const groups = groupItemsByDomain(items)

      groups.forEach(function (group) {
        elements.historyGroups.append(createHistoryGroup(group))
      })
    }
  }

  renderSelectionState()
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
      openHistoryUrl(item.url)
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
  actions.append(createRowAction('删除该网址的全部历史', createTrashIcon(), function () {
    deleteSingleItem(item)
  }, true))

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
  return createSvgIcon('<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>')
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

function openHistoryUrl(url) {
  try {
    const parsedUrl = new URL(url)
    const allowedProtocols = ['http:', 'https:', 'ftp:', 'file:']

    if (allowedProtocols.includes(parsedUrl.protocol)) {
      chrome.tabs.create({ url })
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

function formatTime(timestamp) {
  const date = new Date(timestamp || 0)
  const month = formatTimePart(date.getMonth() + 1)
  const day = formatTimePart(date.getDate())
  const hour = formatTimePart(date.getHours())
  const minute = formatTimePart(date.getMinutes())
  const second = formatTimePart(date.getSeconds())
  return `${month}-${day} ${hour}:${minute}:${second}`
}

function formatTimePart(value) {
  return String(value).padStart(2, '0')
}

initialize()
