const { HttpsError } = require('firebase-functions/v2/https');

// The menu editor writes this projection with menu_config in one transaction.
// Keep it on config: Yut rules already read that document and have no spare
// document-access budget for a second menu-settings document.
const studentMenuVisible = (config, keys) => {
  if (!config || !Object.hasOwn(config, 'studentMenuVisibility')) return true;
  const visibility = config.studentMenuVisibility;
  return !!visibility && typeof visibility === 'object' && !Array.isArray(visibility)
    && keys.every(key => !Object.hasOwn(visibility, key) || visibility[key] === true);
};

const assertStudentMenuVisible = (config, keys) => {
  if (!studentMenuVisible(config, keys)) {
    throw new HttpsError('permission-denied', '지금은 이 메뉴를 이용할 수 없습니다.', { reason: 'STUDENT_MENU_HIDDEN' });
  }
};

const readStudentMenuAccess = async (reader, db, keys) => {
  const ref = db.doc('site_settings/config');
  const snapshot = reader ? await reader.get(ref) : await ref.get();
  assertStudentMenuVisible(snapshot.data(), keys);
};

// /student/wispi is an independently controlled interface menu. A market
// halt never changes this setting; personal account/history reads deliberately
// do not call this guard. New transfers/orders must still check market launch
// and halt state in their authoritative transaction.
const STUDENT_WISPI_MENU_KEYS = Object.freeze(['wispi']);
const assertStudentWispiMenuVisible = config => assertStudentMenuVisible(config, STUDENT_WISPI_MENU_KEYS);

module.exports = { studentMenuVisible, assertStudentMenuVisible, readStudentMenuAccess,
  STUDENT_WISPI_MENU_KEYS, assertStudentWispiMenuVisible };
