// sidepanel.js

// Ensure the DOM is fully loaded before rendering the list
// A small timeout helps ensure chrome.storage and other APIs are fully ready
document.addEventListener('DOMContentLoaded', () => setTimeout(() => renderList(false), 100));

// Add listeners to automatically update the list when structural changes occur
chrome.tabs.onCreated.addListener(() => renderList(true));
chrome.tabs.onRemoved.addListener(() => renderList(true));
chrome.tabs.onMoved.addListener(() => renderList(true));
chrome.windows.onCreated.addListener(() => renderList(true));
chrome.windows.onRemoved.addListener(() => renderList(true));
chrome.tabGroups.onCreated.addListener(() => renderList(true));
chrome.tabGroups.onRemoved.addListener(() => renderList(true));
chrome.tabGroups.onUpdated.addListener(() => renderList(true));

// Listeners for focus/active changes - these should NOT trigger a full re-render
chrome.windows.onFocusChanged.addListener(updateActiveStates);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only update active states if the 'active' property changed
    if (changeInfo.active !== undefined) {
        updateActiveStates();
    }
    // If title or favicon changes, a full re-render might be desired to update text/icon
    if (changeInfo.title || changeInfo.favIconUrl) {
        renderList(true);
    }
});


const container = document.getElementById('sidebar-content');
let windowTitles = {}; // Stores user-defined custom titles for windows
let collapsedState = {}; // Stores the collapsed/expanded state for windows and tab groups

// --- Persistence Functions (chrome.storage.local) ---

/**
 * Loads custom window titles from Chrome's local storage.
 */
async function loadWindowTitles() {
    const data = await chrome.storage.local.get('customWindowTitles');
    windowTitles = data.customWindowTitles || {};
}

/**
 * Saves a custom window title to Chrome's local storage.
 * @param {number} windowId - The ID of the window.
 * @param {string} title - The custom title to save.
 */
async function saveWindowTitle(windowId, title) {
    windowTitles[windowId] = title;
    await chrome.storage.local.set({ customWindowTitles: windowTitles });
    // After saving, re-render to ensure title updates (and potential re-sorting based on custom title)
    // Adding a small delay to allow the blur event to fully process before DOM rebuild
    setTimeout(() => renderList(true), 50); 
}

/**
 * Loads the collapsed state of sections (windows/groups) from Chrome's local storage.
 */
async function loadCollapsedState() {
    const data = await chrome.storage.local.get('collapsedState');
    collapsedState = data.collapsedState || {};
}

/**
 * Saves the collapsed state of a section to Chrome's local storage.
 * @param {string} key - A unique key for the section (e.g., 'window-content-123', 'group-content-456').
 * @param {boolean} isCollapsed - True if the section is collapsed, false otherwise.
 */
async function saveCollapsedState(key, isCollapsed) {
    collapsedState[key] = isCollapsed;
    await chrome.storage.local.set({ collapsedState: collapsedState });
}

// --- UI Element Creation / Update Functions ---

/**
 * Captures the current scroll position of the sidebar content.
 * @returns {number} The current scroll top.
 */
function captureScrollPosition() {
    return container.scrollTop;
}

/**
 * Restores the scroll position of the sidebar content.
 * @param {number} position - The scroll position to restore.
 */
function restoreScrollPosition(position) {
    // Use a small timeout to allow DOM to render before attempting to scroll
    setTimeout(() => {
        container.scrollTop = position;
    }, 0); 
}


/**
 * Creates and returns a toggle arrow element for expanding/collapsing sections.
 * @param {string} key - The unique ID of the collapsible content element.
 * @returns {HTMLSpanElement} The created arrow element.
 */
function createToggleArrow(key) {
    const arrow = document.createElement('span');
    arrow.className = 'toggle-arrow';
    
    // Set initial state based on stored collapsedState
    // If state is undefined or false, it should be expanded.
    if (!collapsedState[key]) { 
        arrow.classList.add('expanded');
    }

    arrow.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent the click from propagating to the parent window/group header
        const targetElement = document.getElementById(key); // Get the element to collapse/expand
        if (targetElement) {
            const isNowCollapsed = !targetElement.classList.contains('collapsed'); // Check current visual state
            arrow.classList.toggle('expanded', !isNowCollapsed); // Arrow points down if content is expanded
            targetElement.classList.toggle('collapsed', isNowCollapsed); // Hide/show content
            saveCollapsedState(key, isNowCollapsed); // Persist the state
        }
    });
    return arrow;
}

/**
 * Creates and returns an unordered list of tabs.
 * @param {Array<chrome.tabs.Tab>} tabs - An array of tab objects.
 * @param {number} windowId - The ID of the parent window.
 * @param {string} className - Additional CSS class for the list (e.g., for indentation).
 * @returns {HTMLUListElement} The created list of tabs.
 */
function createTabList(tabs, windowId, className) {
    const tabList = document.createElement('ul');
    tabList.className = className;

    for (const tab of tabs) {
        const tabItem = document.createElement('li');
        const tabLink = document.createElement('div');
        tabLink.className = 'tab-item';
        tabLink.dataset.tabId = tab.id; // Add tabId for easier lookup during active state updates

        const favicon = document.createElement('img');
        favicon.className = 'item-icon';
        favicon.src = (typeof tab.favIconUrl === 'string' && (tab.favIconUrl.startsWith('http://') || tab.favIconUrl.startsWith('https://'))) 
                      ? tab.favIconUrl 
                      : 'icons/icon16.png';
        favicon.onerror = () => { favicon.src = 'icons/icon16.png'; };

        const title = document.createElement('span');
        title.className = 'item-title';
        title.textContent = (tab.title || tab.url || '');

        tabLink.appendChild(favicon);
        tabLink.appendChild(title);

        // If tab is pinned, prepend a small glyph marker (U+25F8) before the title
        if (tab.pinned) {
            const marker = document.createElement('span');
            marker.className = 'pinned-marker';
            marker.textContent = '\u25B4'; // small glyph
            marker.setAttribute('aria-hidden', 'true');

            const sr = document.createElement('span');
            sr.className = 'sr-only';
            sr.textContent = ' (pinned)';

            // Insert marker right before the title element for visual prepending
            tabLink.insertBefore(marker, title);
            // Append the screen-reader-only label after the title so readers hear "Title (pinned)"
            tabLink.appendChild(sr);
        }

        tabLink.addEventListener('click', () => {
            chrome.windows.update(windowId, { focused: true }, () => {
                chrome.tabs.update(tab.id, { active: true });
            });
        });
        
        tabItem.appendChild(tabLink);
        tabList.appendChild(tabItem);
    }
    return tabList;
}

/**
 * Updates the 'active-window' and 'active-tab' CSS classes without re-rendering the entire list.
 * This is crucial for preventing unwanted re-sorting when just switching focus.
 */
async function updateActiveStates() {
    // Correctly get the last focused window using getLastFocused
    const currentWindow = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });

    // Remove active-window class from all window items
    document.querySelectorAll('.window-item.active-window').forEach(el => el.classList.remove('active-window'));
    // Remove active-tab class from all tab items
    document.querySelectorAll('.tab-item.active-tab').forEach(el => el.classList.remove('active-tab'));

    if (currentWindow) {
        // Find and apply active-window class to the currently focused window
        const windowHeader = document.querySelector(`.window-item[data-window-id='${currentWindow.id}']`);
        if (windowHeader) {
            windowHeader.classList.add('active-window');
        }

        // Find and apply active-tab class to the currently active tab in that window
        const activeTab = currentWindow.tabs.find(tab => tab.active);
        if (activeTab) {
            const tabLink = document.querySelector(`.tab-item[data-tab-id='${activeTab.id}']`);
            if (tabLink) {
                tabLink.classList.add('active-tab');
            }
        }
    }
}


// --- Main Rendering Function ---

/**
 * Fetches all window, tab group, and tab data, then renders the sidebar content.
 * @param {boolean} shouldRestoreScroll - If true, attempts to restore the previous scroll position.
 */
async function renderList(shouldRestoreScroll = false) {
    const initialScrollPosition = shouldRestoreScroll ? captureScrollPosition() : 0;

    // Clear existing content to prepare for re-render
    container.innerHTML = '';
    
    // Load persisted data (titles and collapse states) concurrently
    await Promise.all([loadWindowTitles(), loadCollapsedState()]);

    // Fetch all live browser data concurrently
    // Removed 'focused: true' as it's not a valid option for getAll
    const [windows, tabGroups] = await Promise.all([
        chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
        chrome.tabGroups.query({})
    ]);

    // --- SORT WINDOWS HERE ---
    windows.sort((a, b) => {
        // Prioritize focused window (must be checked against fetched windows, not in query)
        if (a.focused && !b.focused) return -1;
        if (!a.focused && b.focused) return 1;

        // Get custom titles or default to "Window ID" if no custom title
        const titleA = windowTitles[a.id] || `Window ${a.id}`;
        const titleB = windowTitles[b.id] || `Window ${b.id}`;

        // Alphanumeric comparison of titles
        return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Create a map for quick lookup of tab group details by ID
    const groupMap = new Map(tabGroups.map(group => [group.id, group]));

    // Main UL element to hold all window items
    const windowList = document.createElement('ul');
    windowList.className = 'window-list';

    // Iterate through each Chrome window
    for (const win of windows) {
        const windowItem = document.createElement('li');
        
        // --- Window Header (contains arrow, title, and handles window focus) ---
        const windowHeader = document.createElement('div');
        windowHeader.className = 'window-item';
        windowHeader.dataset.windowId = win.id; // Add windowId for easier lookup during active state updates

        // Create the collapsible content div for this window *before* the arrow,
        // so its ID is available when createToggleArrow is called.
        const windowContentId = `window-content-${win.id}`;
        const windowContent = document.createElement('div');
        windowContent.id = windowContentId;
        if (collapsedState[windowContentId]) {
            windowContent.classList.add('collapsed');
        }

        const windowArrow = createToggleArrow(windowContentId);
        windowHeader.appendChild(windowArrow);

        // This div is clickable to focus the window, and contains the editable title span
        const windowTitleArea = document.createElement('div');
        windowTitleArea.className = 'window-title-area';
        windowTitleArea.addEventListener('click', (e) => {
            // Click to switch window, unless directly on the editable span
            if (e.target.classList.contains('editable-title')) {
                e.stopPropagation(); // Prevent the main header click from triggering window focus
            } else {
                chrome.windows.update(win.id, { focused: true });
            }
        });
        
        // Editable span for the custom window title
        const windowTitleSpan = document.createElement('span');
        windowTitleSpan.className = 'item-title editable-title';
        windowTitleSpan.contentEditable = "true";
        windowTitleSpan.dataset.windowId = win.id; // Store window ID on the element
        windowTitleSpan.textContent = windowTitles[win.id] || `Window ${win.id}`;
        //        windowTitleSpan.textContent = windowTitles[win.id] || `Window ${win.id} (${win.tabs.length} tabs)`;
        
        // Save title when focus leaves the editable span
        windowTitleSpan.addEventListener('blur', (e) => {
            saveWindowTitle(win.id, e.target.textContent.trim());
        });
        // Save title on Enter key press
        windowTitleSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent new line in contenteditable
                e.target.blur(); // Trigger blur event to save the title
            }
        });

        windowTitleArea.appendChild(windowTitleSpan);
        windowHeader.appendChild(windowTitleArea);
        windowItem.appendChild(windowHeader);
        
        // Render tabs and groups in the exact sequence they appear in the browser
        // We'll iterate win.tabs (which is already in browser order) and emit
        // either a group header (the first time we encounter a group's tab)
        // or a single tab item for ungrouped tabs.
        
        // Keep track of which groups we've already rendered for this window
        const renderedGroups = new Set();

        // Iterate through the window's tabs in order
        for (const tab of win.tabs) {
            const groupId = tab.groupId > -1 ? tab.groupId : 'none';

            if (groupId === 'none') {
                // Ungrouped tab: render as a single tab list item
                const singleTabList = createTabList([tab], win.id, 'tab-list-no-group');
                windowContent.appendChild(singleTabList);
            } else {
                // Tab belongs to a group. If we haven't rendered the group header yet,
                // render the group header and then render all the tabs in that group
                // (in order) by filtering win.tabs for that group.
                if (!renderedGroups.has(groupId)) {
                    const groupInfo = groupMap.get(groupId);
                    // Only render groups that belong to this window and exist
                    if (!groupInfo || groupInfo.windowId !== win.id) {
                        // Fallback: render the tab as ungrouped if group meta is missing
                        const singleTabList = createTabList([tab], win.id, 'tab-list-no-group');
                        windowContent.appendChild(singleTabList);
                    } else {
                        const groupList = document.createElement('ul');
                        groupList.className = 'group-list';

                        const groupItem = document.createElement('li');
                        const groupHeader = document.createElement('div');
                        groupHeader.className = 'group-item';

                        // Create collapsible content div for this group *before* arrow
                        const groupContentId = `group-content-${groupId}`;
                        const tabsInGroupContainer = document.createElement('div');
                        tabsInGroupContainer.id = groupContentId;
                        if (collapsedState[groupContentId]) {
                            tabsInGroupContainer.classList.add('collapsed');
                        }

                        const groupArrow = createToggleArrow(groupContentId);
                        groupHeader.appendChild(groupArrow);

                        const groupTitleArea = document.createElement('div');
                        groupTitleArea.className = 'group-title-area';
                        groupTitleArea.innerHTML = `
                            <span class="group-color-dot" style="background-color: ${groupInfo.color};"></span>
                            <span class="item-title">${groupInfo.title || 'Untitled Group'}</span>
                        `;
                        groupTitleArea.addEventListener('click', () => {
                            chrome.windows.update(win.id, { focused: true }, () => {
                                // Focus the first tab in the group (if any)
                                const firstTab = win.tabs.find(t => t.groupId === groupId);
                                if (firstTab) chrome.tabs.update(firstTab.id, { active: true });
                            });
                        });
                        groupHeader.appendChild(groupTitleArea);
                        groupItem.appendChild(groupHeader);

                        // Collect tabs for this group in the original order
                        const tabsInGroup = win.tabs.filter(t => t.groupId === groupId);
                        const tabsInGroupList = createTabList(tabsInGroup, win.id, 'tab-list-in-group');
                        tabsInGroupContainer.appendChild(tabsInGroupList);
                        groupItem.appendChild(tabsInGroupContainer);

                        groupList.appendChild(groupItem);
                        windowContent.appendChild(groupList);
                    }
                    renderedGroups.add(groupId);
                }
                // If group already rendered, skip — its tabs were added when rendering the group
            }
        }

        windowItem.appendChild(windowContent);
        windowList.appendChild(windowItem);
    }

    container.appendChild(windowList);

    if (shouldRestoreScroll) {
        restoreScrollPosition(initialScrollPosition);
    }

    // After a full render, ensure active states are correctly set
    updateActiveStates();
}