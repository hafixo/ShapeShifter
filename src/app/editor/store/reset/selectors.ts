import { getEditorState } from 'app/editor/store/selectors';
import { createSelector } from 'reselect';

const getResetState = createSelector(getEditorState, s => s.reset);
export const isBeingReset = createSelector(getResetState, r => r.isBeingReset);
