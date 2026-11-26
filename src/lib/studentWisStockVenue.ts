/** A student stock venue: the Wis market at home or the 유스 market abroad.
 * Each has its own public documents, own account and own server commands. */
export type StudentWisStockVenueId = "DOMESTIC" | "OVERSEAS";
export interface StudentWisStockVenue {
  id: StudentWisStockVenueId;
  unit: "위스" | "유스";
  label: "국내" | "해외";
  accountCollection: string;
  stateCallable: string;
  historyCallable: string;
  placeCallable: string;
  cancelCallable: string;
}
export const DOMESTIC_STOCK_VENUE: StudentWisStockVenue = Object.freeze({
  id: "DOMESTIC",
  unit: "위스",
  label: "국내",
  accountCollection: "wis_stock_accounts",
  stateCallable: "getStudentWisStockState",
  historyCallable: "getStudentWisStockHistory",
  placeCallable: "placeStudentWisStockOrder",
  cancelCallable: "cancelStudentWisStockOrder",
});
export const OVERSEAS_STOCK_VENUE: StudentWisStockVenue = Object.freeze({
  id: "OVERSEAS",
  unit: "유스",
  label: "해외",
  accountCollection: "wis_stock_overseas_accounts",
  stateCallable: "getStudentWisStockOverseasState",
  historyCallable: "getStudentWisStockOverseasHistory",
  placeCallable: "placeStudentWisStockOverseasOrder",
  cancelCallable: "cancelStudentWisStockOverseasOrder",
});
export const studentWisStockVenue = (
  id: StudentWisStockVenueId = "DOMESTIC",
) => (id === "OVERSEAS" ? OVERSEAS_STOCK_VENUE : DOMESTIC_STOCK_VENUE);
