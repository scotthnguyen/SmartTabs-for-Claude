# SmartTabs — Claude.ai Migration

## Project Overview
Chrome extension (Manifest V3, TypeScript) that injects a navigation sidebar 
into Claude.ai conversations. Lets users jump to earlier prompts or bookmarked 
locations instead of scrolling.

## Architecture
- `content.ts` — injects sidebar into Claude.ai pages, handles SPA navigation
- `parser.ts` — parses Claude.ai DOM into Section objects
- `sidebar.ts` — renders sidebar UI and handles interactions
- `styles.css` — sidebar styling
- `manifest.json` — MV3 manifest targeting claude.ai

## Section Model
```typescript
interface Section {
  id: string
  title: string
  element: HTMLElement   // set to getUserBubbleChild(userNode) — see parser.ts
  rawText: string
  domOrder: number
  turnId: string
  type: "auto" | "bookmark"
  contextText?: string
  role?: "user" | "assistant"
  selectedText?: string
  scrollTop?: number
  offsetWithinMessage?: number
}
```

## Verified Claude.ai DOM Selectors (live-inspected)
All selectors are exported as `SELECTORS` from `parser.ts` — never hardcode them.

- **User message**: `[data-testid="user-message"]` ✅ stable
- **Assistant message**: `div[class*="font-claude-response"]` (no testid, class-based)
- **Scroll container**: tallest `div[class*="overflow-y-auto"][class*="overflow-x-hidden"]`
- **Turn feed**: `div[class*="flex-1 flex flex-col px-4 max-w-3xl"]`
- **CRITICAL**: User and assistant are alternating siblings in the feed — NOT 
  wrapped together. Pair user turn[N] with the immediately following sibling for 
  assistant contextText.

## section.element — why it's set 3 levels above user-message

`sidebar.ts`'s `getMessageContainer()` has no Claude.ai-specific selectors; it 
falls back to `node.parentElement`. To make it land on the user bubble 
(`div.group.relative.inline-flex bg-bg-300 rounded-xl`, which is 4 levels above 
`[data-testid="user-message"]`), `section.element` is set to the **direct child 
of the user bubble** (3 levels above user-message via `getUserBubbleChild()`).

This ensures `getMessageContainer(section.element)` returns the user bubble, which 
is the correct target for both scroll-jumping and the flash highlight. The turn 
container (direct child of the feed) is computed separately for sibling-pairing 
only and is NOT stored in `section.element`.

## Key Rules
- Always use the `SELECTORS` const from `parser.ts` — no hardcoded selector strings
- `parser.ts` exports: `SELECTORS`, `Section`, `parseConversation()`, `observeConversation()`, `getScrollContainer()`
- Debounce MutationObserver callbacks 200ms
- Guard against double-injection with `#smarttabs-root` sentinel
- On SPA route change: disconnect observer → remove sidebar instantly → re-init after 400ms
- Sidebar is only shown on `/chat/<uuid>` pages (regex `/\/chat\/[^/]+/`); removed immediately on all other routes
- Bookmarks persisted via `chrome.storage.local`, keyed by chat UUID (not full pathname)
- Bookmark shortcut is **Cmd/Ctrl+Shift+B** (Shift required to avoid Claude.ai conflicts)
- Claude.ai is a React SPA — poll for scroll container before mounting (up to 10s)
- Storage operations (`saveBookmarks`, `loadBookmarks`) are async — fire-and-forget from event handlers is intentional

## Known sidebar.ts limitations on Claude.ai
`sidebar.ts` still contains some ChatGPT-specific selectors that partially work:
- `getMessageRole()` queries `[data-message-author-role]` → returns `undefined` on 
  Claude.ai. Scroll-tracking active-tab still works but skips the role tie-breaker.
- `findLiveElement()` tries `[data-turn-id-container]` before falling back to 
  `section.element.isConnected` — the fallback is what fires on Claude.ai.

## Build
```bash
npm run build   # vite bundle → dist/content.js
npm run watch   # watch mode
```

## Current Known Issues & Status
- Fixed: Teleport scroll fixed — targets getUserBubbleChild level
- Fixed: Highlight color changed to Claude orange `#d97757`
- Fixed: Sidebar position: `left: 310px; top: 60px`
- ⚠️ `getMessageRole()` in sidebar.ts returns undefined on Claude.ai (non-breaking)