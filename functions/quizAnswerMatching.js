"use strict";

// Keep the browser helper's behavior in parity; never split a student's answer.
const getAcceptedQuizAnswers = expected => String(expected ?? "")
  .split(",").map(value => value.trim()).filter(Boolean);
const isQuizAnswerCorrect = (type, actual, expected) => {
  const normalize = value => String(value ?? "").replace(/\s+/g, "");
  const answer = normalize(actual);
  if (!answer) return false;
  const accepted = type === "short" || type === "word"
    ? getAcceptedQuizAnswers(expected) : [String(expected ?? "")];
  return accepted.some(value => answer === normalize(value));
};
const isValidShortAnswerKey = expected => {
  const accepted = getAcceptedQuizAnswers(expected);
  return accepted.length > 0 && accepted.every(value => value.replace(/\s+/g, "").length <= 20);
};
module.exports = { getAcceptedQuizAnswers, isQuizAnswerCorrect, isValidShortAnswerKey };
