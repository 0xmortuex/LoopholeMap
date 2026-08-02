/* =========================================================================
   Scan history — recent analyses, kept in localStorage.

   Each entry stores the full analysis plus any deep dives that were loaded,
   so reopening one restores the whole board (and its detail panels) with no
   network calls. Storage is bounded by both entry count and total bytes, and
   oldest entries are evicted first.
   ========================================================================= */

const STORE_KEY = 'loopholemap_history_v1';
const MAX_ENTRIES = 100;
// Size, not count, is the real limit: localStorage is typically ~5M UTF-16
// chars per origin, shared with this app's other keys. Entries are evicted
// oldest-first once either bound is hit.
const MAX_BYTES = 3_000_000;

function readAll() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(e => e && e.id && e.data) : [];
  } catch {
    return []; // corrupt store: start over rather than breaking the app
  }
}

function writeAll(entries) {
  // Size-prune in a single pass — keep newest entries until the budget is
  // spent. (Re-serializing the whole array once per dropped entry gets
  // expensive at 100 entries of multi-KB analyses.)
  let used = 2; // the enclosing [ ]
  let list = [];
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    const size = JSON.stringify(entry).length + 1; // + separating comma
    if (list.length && used + size > MAX_BYTES) break;
    used += size;
    list.push(entry); // always keep the newest, even if it alone is oversized
  }

  // The browser can still refuse (quota is shared with other keys and other
  // origins' behaviour varies), so drop the oldest and retry until it sticks.
  while (list.length) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return list;
    } catch {
      list = list.slice(0, -1);
    }
  }
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  return [];
}

// Identifies the same analysis across re-opens so history doesn't fill with
// duplicates of one shared link.
function signatureOf(data) {
  return [data.title, data.overallRisk, data.nodes.length, data.nodes.map(n => n.title).join('|')].join('::');
}

function summarize(entry) {
  return {
    id: entry.id,
    title: entry.data.title,
    savedAt: entry.savedAt,
    rpMode: entry.rpMode !== false,
    risk: entry.data.overallRisk,
    nodeCount: entry.data.nodes.length,
    hasDeepDives: Object.keys(entry.deepDives || {}).length > 0,
    // Searchable so a scan can be found by an issue it contains, not just
    // by the bill's title.
    issueTitles: entry.data.nodes.map(n => n.title)
  };
}

function listHistory() {
  return readAll().map(summarize);
}

/**
 * Case-insensitive search over the bill title and its issue titles.
 * Returns matching summaries, each tagged with `matchedIssue` when the hit
 * came from an issue rather than the title.
 */
function searchHistory(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries.map(e => ({ ...e, matchedIssue: null }));

  const results = [];
  entries.forEach(entry => {
    if (entry.title.toLowerCase().includes(q)) {
      results.push({ ...entry, matchedIssue: null });
      return;
    }
    const issue = (entry.issueTitles || []).find(t => t.toLowerCase().includes(q));
    if (issue) results.push({ ...entry, matchedIssue: issue });
  });
  return results;
}

/**
 * Saves (or refreshes) an analysis. Re-saving the same analysis updates its
 * deep dives and moves it to the top instead of adding a duplicate.
 */
function saveToHistory(data, rpMode, deepDives) {
  if (!data || !Array.isArray(data.nodes)) return null;

  const signature = signatureOf(data);
  const existing = readAll();
  const previous = existing.find(e => e.signature === signature);
  const rest = existing.filter(e => e.signature !== signature);

  // Keep deep dives already stored for this analysis if none were passed in.
  const dives = deepDives && deepDives.size
    ? Object.fromEntries(deepDives)
    : (previous ? previous.deepDives : undefined);

  const entry = {
    id: previous ? previous.id : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    signature,
    savedAt: Date.now(),
    rpMode: !!rpMode,
    data,
    ...(dives && Object.keys(dives).length ? { deepDives: dives } : {})
  };

  writeAll([entry, ...rest]);
  return entry.id;
}

function loadHistoryEntry(id) {
  const entry = readAll().find(e => e.id === id);
  if (!entry) return null;
  return {
    data: entry.data,
    rpMode: entry.rpMode !== false,
    deepDives: new Map(Object.entries(entry.deepDives || {}))
  };
}

function deleteHistoryEntry(id) {
  writeAll(readAll().filter(e => e.id !== id));
}

function clearHistory() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

function formatWhen(timestamp) {
  const diff = Date.now() - timestamp;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export {
  listHistory, searchHistory, saveToHistory, loadHistoryEntry, deleteHistoryEntry,
  clearHistory, formatWhen
};
