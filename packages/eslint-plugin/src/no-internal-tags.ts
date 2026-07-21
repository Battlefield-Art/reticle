/**
 * Rule: no-internal-tags.
 *
 * Bans design-doc reference codes and internal version strings from comments, so a reader of the source
 * never meets a token that only means something in a document they cannot see.
 *
 * This rule exists because the prose version of it did not hold. An audit of the codebase found the
 * machine-checked rules at ~100% compliance and every prose-only rule violated — 59 tracking codes
 * across the library packages alone, including in the contract package and in test descriptions, plus
 * codes that leaked into user-facing docs. The gap was enforcement, not intent, so the rule is now a
 * lint error rather than a paragraph.
 *
 * Deliberately narrow, to avoid punishing legitimate prose:
 *   - a bare `W11`, `B37`, `N5`, `M8` style token (one or two capitals + digits) standing alone;
 *   - a section reference like `§4.3`;
 *   - an internal version string like `v2.2.0`.
 * Ordinary technical prose that happens to contain a letter and digits inside a larger word (`UTF-8`,
 * `H2`, `Welford M2` when part of a sentence) is matched only when it stands alone as a tag.
 */

import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import { DOCS_URL_ROOT } from './constants.js';

const createRule = ESLintUtils.RuleCreator((name) => `${DOCS_URL_ROOT}#${name}`);

export const INTERNAL_TAG_MESSAGE =
  "Internal reference '{{tag}}' does not belong in source. It means nothing to a reader without the design doc — describe the behaviour instead.";

/** `(W11)`, `B37`, `W10.3`, `N5:` — a short capital-prefixed code used as a label. */
const TRACKING_CODE = /(?<![A-Za-z0-9])[A-Z]{1,2}\d{1,2}(?:\.\d{1,2})?(?![A-Za-z0-9])/g;
/** `§4.3`, `§5` — a design-doc section reference. */
const SECTION_REF = /§\s?\d+(?:\.\d+)*/g;
/** `v2.2.0` — an internal version string. */
const VERSION_STRING = /(?<![A-Za-z0-9])v\d+\.\d+\.\d+(?![A-Za-z0-9])/g;

/** Tokens that look like codes but are established technical terms. */
/** Test-block callees whose first argument is a human-readable description. */
const TEST_BLOCKS = new Set(['describe', 'it', 'test', 'suite', 'bench']);

const ALLOWED = new Set(['M2', 'H1', 'H2', 'H3', 'P2', 'P3', 'S3', 'I18', 'L1', 'L2', 'UTF8']);

export const noInternalTags = createRule({
  name: 'no-internal-tags',
  meta: {
    type: 'problem',
    docs: { description: 'Ban design-doc codes and internal version strings from comments.' },
    schema: [],
    messages: { internalTag: INTERNAL_TAG_MESSAGE },
  },
  defaultOptions: [],
  create(context) {
    /** Every banned token in a piece of text. */
    const tagsIn = (text: string): Set<string> => {
      const found = new Set<string>();
      for (const pattern of [TRACKING_CODE, SECTION_REF, VERSION_STRING]) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
          const tag = match[0].trim();
          if (!ALLOWED.has(tag.replace(/[^A-Za-z0-9]/g, ''))) found.add(tag);
        }
      }
      return found;
    };

    return {
      Program(): void {
        for (const comment of context.sourceCode.getAllComments()) {
          for (const tag of tagsIn(comment.value)) {
            context.report({ node: comment, messageId: 'internalTag', data: { tag } });
          }
        }
      },

      /**
       * TEST DESCRIPTIONS are string literals, not comments, so a comment-only rule could not see them
       * — and the project rule names them explicitly. Seven violations survived a repo-wide cleanup that
       * claimed to have removed them, precisely because nothing mechanical was looking here.
       */
      CallExpression(node): void {
        const callee = node.callee;
        const name =
          callee.type === AST_NODE_TYPES.Identifier
            ? callee.name
            : callee.type === AST_NODE_TYPES.MemberExpression &&
                callee.object.type === AST_NODE_TYPES.Identifier
              ? callee.object.name
              : undefined;
        if (name === undefined || !TEST_BLOCKS.has(name)) return;
        const first = node.arguments[0];
        if (first?.type !== AST_NODE_TYPES.Literal || typeof first.value !== 'string') return;
        for (const tag of tagsIn(first.value)) {
          context.report({ node: first, messageId: 'internalTag', data: { tag } });
        }
      },
    };
  },
});
