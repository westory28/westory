const isPlainContainer = (value: object) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Structural equality for server-confirmed settings documents.
 * It may only answer "same" for values that are indistinguishable to readers:
 * plain objects (key order ignored), arrays and primitives are compared by
 * content, Firestore value classes through their own `isEqual`. Every other
 * object compares by identity, so an unknown kind is reported as different.
 */
export const isSameSettingValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  )
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    )
      return false;
    return left.every((item, index) => isSameSettingValue(item, right[index]));
  }
  if (!isPlainContainer(left) || !isPlainContainer(right)) {
    const comparable = left as { isEqual?: (other: unknown) => unknown };
    return (
      Object.getPrototypeOf(left) === Object.getPrototypeOf(right) &&
      typeof comparable.isEqual === "function" &&
      comparable.isEqual(right) === true
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      isSameSettingValue(leftRecord[key], rightRecord[key]),
  );
};

/**
 * Keeps the object that consumers already hold when a newer server snapshot
 * carries the same content. A reconnect or a repeated read then no longer
 * looks like a settings change to effects keyed on object identity.
 */
export function keepSameSetting<T>(previous: T, next: T): T {
  return isSameSettingValue(previous, next) ? previous : next;
}
