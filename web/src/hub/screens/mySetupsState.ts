import type { UpdateMySetupInput } from '../data/platform';

export type MySetupDraft = UpdateMySetupInput;

const MY_SETUP_TEXT_LIMIT = { name: 80, memo: 500 } as const;

// The API validates Unicode runes. Array.from iterates JavaScript strings by
// code point, unlike the native maxLength attribute's UTF-16 code-unit count.
// Rejecting an attempted over-limit replacement leaves the existing draft intact.
export function replaceMySetupDraftText(draft: MySetupDraft, field: keyof typeof MY_SETUP_TEXT_LIMIT, value: string): MySetupDraft {
  return Array.from(value).length <= MY_SETUP_TEXT_LIMIT[field] ? { ...draft, [field]: value } : draft;
}

export interface MySetupsSelectionState {
  selectedId: string | null;
  generation: number;
  draft: MySetupDraft | null;
}

export type MySetupsSelectionAction =
  | { type: 'select'; id: string }
  | { type: 'clear' }
  | { type: 'retry' }
  | { type: 'metadata'; id: string; generation: number; draft: MySetupDraft }
  | { type: 'draft'; draft: MySetupDraft };

export type MySetupsRefreshOutcome = 'ready' | 'unauthorized' | 'forbidden' | 'not-found' | 'network';

// A tiny pure state machine makes stale async responses testable without a DOM.
// Metadata responses only apply to the account/setup generation that requested
// them; selection transitions always discard the prior edit draft.
export function reduceMySetupsSelection(
  state: MySetupsSelectionState,
  action: MySetupsSelectionAction,
): MySetupsSelectionState {
  switch (action.type) {
    case 'select':
      return { selectedId: action.id, generation: state.generation + 1, draft: null };
    case 'clear':
      return { selectedId: null, generation: state.generation + 1, draft: null };
    case 'retry':
      return state.selectedId ? { ...state, generation: state.generation + 1 } : state;
    case 'metadata':
      return action.id === state.selectedId && action.generation === state.generation
        ? { ...state, draft: action.draft }
        : state;
    case 'draft':
      return state.selectedId ? { ...state, draft: action.draft } : state;
  }
}

// Save refreshes issue two independent GETs. Keep their failure handling
// deterministic: credentials outrank permission, permission must clear private
// data, and only then can a disappeared setup or a transient failure be shown.
export function resolveMySetupsRefreshOutcome(reasons: readonly (string | null)[]): MySetupsRefreshOutcome {
  if (reasons.includes('unauthorized')) return 'unauthorized';
  if (reasons.includes('forbidden')) return 'forbidden';
  if (reasons.includes('not-found')) return 'not-found';
  return reasons.every((reason) => reason === null) ? 'ready' : 'network';
}
