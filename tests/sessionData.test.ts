import { describe, expect, it } from 'vitest';
import {
  MAX_PAYLOAD_ANSWERS,
  appliedQuestionsOf,
  deadlineOf,
  mergeAnswers,
  optionOrdersOf,
  parseAnswerPayload,
  progressAnswersOf,
  timeLimitOf,
} from '../functions/src/psychometricTest/sessionData';
import { config, likert, likertScale } from './helpers';

/** Firestore Timestamps only expose toDate(); the helpers must go through it. */
function stamp(date: Date) {
  return { toDate: () => date };
}

describe('parseAnswerPayload', () => {
  it('accepts a well-formed body', () => {
    const parsed = parseAnswerPayload({
      token: 'abc',
      answers: [{ questionId: 'q1', value: 3, responseMs: 900 }],
    });
    expect(parsed?.token).toBe('abc');
    expect(parsed?.answers).toHaveLength(1);
  });

  it('rejects bodies that are not answer payloads', () => {
    expect(parseAnswerPayload(null)).toBeNull();
    expect(parseAnswerPayload('token=abc')).toBeNull();
    expect(parseAnswerPayload({ answers: [] })).toBeNull();
    expect(parseAnswerPayload({ token: '', answers: [] })).toBeNull();
    expect(parseAnswerPayload({ token: 'a', answers: 'no soy arreglo' })).toBeNull();
    expect(parseAnswerPayload({ token: 'x'.repeat(200), answers: [] })).toBeNull();
  });

  it('discards malformed entries instead of the whole request', () => {
    const parsed = parseAnswerPayload({
      token: 'abc',
      answers: [
        { questionId: 'q1', value: 3 },
        { questionId: 'q2', value: 'cuatro' },
        { value: 2 },
        null,
        'basura',
      ],
    });
    expect(parsed?.answers.map((answer) => answer.questionId)).toEqual(['q1']);
  });

  it('caps the number of entries it will read', () => {
    const answers = Array.from({ length: MAX_PAYLOAD_ANSWERS + 100 }, (_, index) => ({
      questionId: `q${index}`,
      value: 1,
    }));
    expect(parseAnswerPayload({ token: 'abc', answers })?.answers).toHaveLength(MAX_PAYLOAD_ANSWERS);
  });
});

describe('mergeAnswers', () => {
  it('lets the incoming payload win over what was saved', () => {
    const merged = mergeAnswers(
      [
        { questionId: 'a', value: 1 },
        { questionId: 'b', value: 2 },
      ],
      [{ questionId: 'b', value: 5 }]
    );
    expect(merged).toEqual([
      { questionId: 'a', value: 1 },
      { questionId: 'b', value: 5 },
    ]);
  });

  it('keeps saved answers the payload does not mention', () => {
    // This is what protects a candidate whose last POST arrives with only part
    // of the state, for instance after a page reload near the deadline.
    const merged = mergeAnswers([{ questionId: 'a', value: 3 }], []);
    expect(merged).toEqual([{ questionId: 'a', value: 3 }]);
  });
});

describe('deadlineOf / timeLimitOf', () => {
  const cfg = config({ timeLimitMinutes: 35 });

  it('measures the deadline from the server-assigned start', () => {
    const startedAt = new Date('2026-07-30T10:00:00Z');
    const deadline = deadlineOf({ startedAt: stamp(startedAt), timeLimitMinutes: 20 }, cfg);
    expect(deadline?.toISOString()).toBe('2026-07-30T10:20:00.000Z');
  });

  it('has no deadline before the session starts', () => {
    expect(deadlineOf({}, cfg)).toBeUndefined();
  });

  it('prefers the session’s own limit and falls back to the config', () => {
    expect(timeLimitOf({ timeLimitMinutes: 15 }, cfg)).toBe(15);
    expect(timeLimitOf({}, cfg)).toBe(35);
    expect(timeLimitOf({ timeLimitMinutes: 0 }, cfg)).toBe(35);
  });
});

describe('appliedQuestionsOf', () => {
  const bank = likertScale('responsabilidad', 4);

  it('uses the session’s own snapshot, ignoring later edits to the bank', () => {
    const snapshot = [likert('frozen_1', 'integridad', false, 0), likert('frozen_2', 'integridad', true, 1)];
    const session = {
      appliedQuestions: snapshot,
      questionOrder: ['frozen_2', 'frozen_1'],
    };

    const applied = appliedQuestionsOf(session, bank);
    // Presentation order is preserved, and the items come from the snapshot even
    // though the bank no longer contains them.
    expect(applied.map((question) => question.id)).toEqual(['frozen_2', 'frozen_1']);
  });

  it('falls back to the current bank for sessions that only stored ids', () => {
    const session = { questionOrder: [bank[2].id, bank[0].id] };
    const applied = appliedQuestionsOf(session, bank);
    expect(applied.map((question) => question.id)).toEqual([bank[2].id, bank[0].id]);
  });

  it('skips ids that no longer resolve to anything', () => {
    const session = { questionOrder: [bank[0].id, 'borrada'] };
    expect(appliedQuestionsOf(session, bank)).toHaveLength(1);
  });

  it('returns nothing for a session that never started', () => {
    expect(appliedQuestionsOf({}, bank)).toEqual([]);
  });
});

describe('reading stored session fields', () => {
  it('tolerates missing or malformed values', () => {
    expect(progressAnswersOf({})).toEqual([]);
    expect(progressAnswersOf({ progressAnswers: 'nope' })).toEqual([]);
    expect(optionOrdersOf({})).toEqual({});
    expect(optionOrdersOf({ optionOrders: 7 })).toEqual({});
    expect(optionOrdersOf({ optionOrders: { a: [1, 0] } })).toEqual({ a: [1, 0] });
  });
});
