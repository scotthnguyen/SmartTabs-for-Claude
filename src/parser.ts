export interface Section {
  id: string;
  title: string;
  element: HTMLElement;
  rawText: string;
  contextText?: string;
  selectedText?: string;
  role?: "user" | "assistant";
  scrollTop?: number;
  offsetWithinMessage?: number;
  domOrder: number;
  turnId: string;
  type?: "auto" | "bookmark";
}

export const SELECTORS = {
  scrollContainer: 'div[class*="overflow-y-auto"][class*="overflow-x-hidden"]',
  turnFeed: 'div[class*="flex-1 flex flex-col px-4 max-w-3xl"]',
  // Used to extract text from within a user turn
  userMessage: '[data-testid="user-message"]',
  // Used to extract contextText from an assistant turn
  assistantMessage: 'div[class*="font-claude-response"]',
  // Present in every assistant turn; never in user turns — used to skip assistants
  assistantMarker: '[data-testid="action-bar-retry"]',
} as const;

function normalizeText(text: string): string {
  return text.replace(/^You said:\s*/i, "").replace(/\s+/g, " ").trim();
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function isImageFilename(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename);
}

// 📎 prefix for image/file messages. Uses filename for image-only fallback.
// Truncates long text to first 3 words.
function makePrefixedImageTitle(cleanedText: string, imageFilename: string | null): string {
  if (!cleanedText) {
    return imageFilename ? `📎 ${imageFilename}` : "📎 Image";
  }
  const words = cleanedText.split(/\s+/);
  if (words.length <= 3 || cleanedText.length <= 20) return `📎 ${cleanedText}`;
  return `📎 ${words.slice(0, 3).join(" ")}...`;
}

function makeTitle(
  userText: string,
  imageAttached: boolean,
  attachedFilename: string | null
): string {
  const cleanedText = normalizeText(userText);

  // Non-image file attachment — use the file type as the label
  if (attachedFilename && !isImageFilename(attachedFilename)) {
    return attachedFilename.toLowerCase().endsWith(".pdf") ? "PDF attached" : "File attached";
  }

  if (imageAttached) return makePrefixedImageTitle(cleanedText, attachedFilename);
  if (cleanedText) return cleanedText;
  return "Untitled";
}

export function getScrollContainer(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(SELECTORS.scrollContainer)
  );
  if (!candidates.length) return null;
  return candidates.reduce((tallest, el) =>
    el.scrollHeight > tallest.scrollHeight ? el : tallest
  );
}

// Returns the element 3 levels above [data-testid="user-message"].
// sidebar.ts's getMessageContainer() falls back to node.parentElement, so
// passing this element makes it return the user bubble (4 levels up) as the
// scroll-jump and highlight target.
function getUserBubbleChild(userMessageNode: HTMLElement): HTMLElement {
  let el: HTMLElement = userMessageNode;
  for (let i = 0; i < 3 && el.parentElement; i++) {
    el = el.parentElement;
  }
  return el;
}

export function parseConversation(): Section[] {
  const sections: Section[] = [];

  // Feed can be inside the scroll container or elsewhere in the DOM
  const sc = getScrollContainer();
  const feed =
    sc?.querySelector<HTMLElement>(SELECTORS.turnFeed) ??
    document.querySelector<HTMLElement>(SELECTORS.turnFeed);

  if (!feed) return sections;

  Array.from(feed.children as HTMLCollectionOf<HTMLElement>).forEach((turn, index) => {
    // Assistant turns always contain action-bar-retry; skip them
    if (turn.querySelector(SELECTORS.assistantMarker)) return;

    // Collect all data-testid values anywhere inside this turn
    const testids = Array.from(
      turn.querySelectorAll<HTMLElement>("[data-testid]")
    ).map((el) => el.dataset.testid ?? "");

    const hasUserMessage = testids.includes("user-message");
    // File/image uploads: testid is "<timestamp>_<filename>" e.g. "1778043840687_image.png"
    const fileTestId = testids.find((id) => /^\d+_/.test(id)) ?? null;
    const hasFileAttachment = fileTestId !== null;

    // Skip turns that contain neither user text nor a file attachment
    if (!hasUserMessage && !hasFileAttachment) return;

    const userMessageNode = turn.querySelector<HTMLElement>(SELECTORS.userMessage);
    const rawText = normalizeText(userMessageNode?.textContent ?? "");

    // An img tag anywhere in the turn (lazy-loaded image thumbnails)
    const imgInTurn = turn.querySelector("img") !== null;
    const imageAttached = hasFileAttachment || imgInTurn;

    // Strip the numeric timestamp prefix to get the human-readable filename
    const attachedFilename = fileTestId ? fileTestId.replace(/^\d+_/, "") : null;

    const generatedId = `smart-${index}-${simpleHash(
      rawText || fileTestId || turn.textContent || ""
    )}`;

    // Pair with the immediately following sibling for assistant contextText
    let contextText: string | undefined;
    const nextSibling = turn.nextElementSibling as HTMLElement | null;
    if (nextSibling) {
      const assistantNode = nextSibling.querySelector<HTMLElement>(
        SELECTORS.assistantMessage
      );
      if (assistantNode) {
        contextText = (assistantNode.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1500);
      }
    }

    // For text/mixed messages: getUserBubbleChild gives the precise user bubble
    // target. For image-only (no user-message node): fall back to first child of
    // the turn so getMessageContainer() in sidebar.ts returns the turn itself.
    const elementTarget = userMessageNode
      ? getUserBubbleChild(userMessageNode)
      : ((turn.firstElementChild as HTMLElement) ?? turn);

    sections.push({
      id: generatedId,
      title: makeTitle(rawText, imageAttached, attachedFilename),
      element: elementTarget,
      rawText,
      contextText,
      role: "user",
      domOrder: index,
      turnId: generatedId,
      type: "auto",
    });
  });

  return sections;
}

// Observes the scroll container subtree (falls back to body) for childList
// changes. Returns the observer so the caller can disconnect on route change.
export function observeConversation(onChange: () => void): MutationObserver {
  const target = getScrollContainer() ?? document.body;
  let debounce: number | null = null;

  const observer = new MutationObserver(() => {
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(onChange, 200);
  });

  observer.observe(target, { childList: true, subtree: true });
  return observer;
}
