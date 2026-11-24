import type { AskUserAnswer, AskUserQuestion } from '@cairn/shared';
import { HttpError } from '../lib/errors.js';

export function validateQuestionAnswers(
  questions: readonly AskUserQuestion[],
  answers: readonly AskUserAnswer[],
): AskUserAnswer[] {
  if (answers.length !== questions.length) {
    throw new HttpError(400, `expected ${questions.length} answers, got ${answers.length}`);
  }
  return answers.map((answer, i) => {
    const question = questions[i];
    if (question === undefined) throw new HttpError(400, `answer ${i} has no matching question`);
    const labels = question.options.map((o) => o.label);
    if (labels.length === 0) {
      if (answer.choices !== undefined || (answer.text ?? '').trim() === '') {
        throw new HttpError(400, `question ${i} expects a non-empty text answer`);
      }
      return { header: question.header, text: (answer.text ?? '').trim() };
    }
    if (answer.text !== undefined || answer.choices === undefined || answer.choices.length === 0) {
      throw new HttpError(400, `question ${i} expects choices`);
    }
    if (answer.choices.length > 1 && question.multiSelect !== true) {
      throw new HttpError(400, `question ${i} is single-select`);
    }
    const custom = answer.choices.filter((choice) => !labels.includes(choice));
    if (custom.length > 1) {
      throw new HttpError(
        400,
        `question ${i}: at most one custom (其他) answer, got ${custom.length}`,
      );
    }
    return { header: question.header, choices: answer.choices };
  });
}
