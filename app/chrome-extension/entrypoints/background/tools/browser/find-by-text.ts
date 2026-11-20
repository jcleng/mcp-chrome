import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { ERROR_MESSAGES } from '@/common/constants';

interface FindByTextParams {
  text: string; // the words to look for, as shown on the page
  exact?: boolean; // require the text as written, no partial/fuzzy matches
  tag?: string; // only consider this tag, e.g. "button"
  maxResults?: number; // 1-50, default 5
  minScore?: number; // lowest fuzzy similarity accepted, 0-1
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
}

/**
 * Finds elements by the text they show and returns their refs.
 *
 * This is the cheap alternative to chrome_read_page when the agent already knows what it is
 * looking for: instead of pulling the whole outline into the context, it gets back the few
 * elements whose text matches, each with a ready-to-use ref for click / fill / computer.
 */
class FindByTextTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FIND_BY_TEXT;

  async execute(args: FindByTextParams): Promise<ToolResult> {
    const text = typeof args?.text === 'string' ? args.text.trim() : '';
    if (!text) {
      return createErrorResponse(`${ERROR_MESSAGES.INVALID_PARAMETERS}: text is required`);
    }

    const maxResults =
      args?.maxResults === undefined ? 5 : Math.max(1, Math.min(Number(args.maxResults) || 5, 50));
    const tag = typeof args?.tag === 'string' && args.tag.trim() ? args.tag.trim() : undefined;
    const minScore =
      typeof args?.minScore === 'number' && Number.isFinite(args.minScore)
        ? args.minScore
        : undefined;

    try {
      const explicit = await this.tryGetTab(args?.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }

      // The helper also registers the refs it returns, so click/fill can use them directly.
      await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);

      const resp = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.FIND_BY_TEXT,
        text,
        exact: args?.exact === true,
        tag,
        maxResults,
        minScore,
      });

      if (!resp || resp.success !== true) {
        return createErrorResponse(resp?.error || `Failed to find text "${text}" on the page`);
      }

      const matches: any[] = Array.isArray(resp.matches) ? resp.matches : [];
      const payload = {
        success: true,
        query: {
          text,
          exact: args?.exact === true,
          tag: tag || 'any',
          maxResults,
        },
        count: matches.length,
        matches,
        scanned: typeof resp.scanned === 'number' ? resp.scanned : undefined,
        tips:
          matches.length > 0
            ? 'Pass a match\'s ref to click / fill / computer. Refs stay valid until the page navigates; if one goes stale, call this tool again.'
            : 'Nothing matched. Try a shorter or more literal fragment of the text, drop the tag filter, or use chrome_read_page to inspect the page.',
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (error) {
      console.error('Error in find by text:', error);
      return createErrorResponse(
        `Error finding text on the page: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const findByTextTool = new FindByTextTool();
