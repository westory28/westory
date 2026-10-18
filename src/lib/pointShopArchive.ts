import {
  collection,
  getDocs,
  query,
  limit,
  orderBy,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { archiveScope, isSemesterArchive } from "./semesterArchive";
import type { PointProduct, PointOrder } from "../types";

// Keep the archive's global callable/write fences intact. Rules grant teachers
// only bounded reads of past shop snapshots; accounts and ledger stay closed.
const readArchiveRows = async (
  name:
    | "point_products"
    | "point_orders"
    | "semester_wis_inventory"
    | "semester_wis_orders",
) => {
  if (!isSemesterArchive || !archiveScope)
    throw new Error("조회할 학기를 확인해 주세요.");
  const owner = auth.currentUser;
  if (!owner) throw new Error("현재 창에서 로그인 상태를 확인해 주세요.");
  const canonical = name.startsWith("semester_");
  const semesterId = archiveScope.year + "-" + archiveScope.semester;
  const path = canonical
    ? name
    : "years/" +
      archiveScope.year +
      "/semesters/" +
      archiveScope.semester +
      "/" +
      name;
  const rows: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await getDocs(
      query(
        collection(db, path),
        ...(canonical ? [where("semesterId", "==", semesterId)] : []),
        orderBy("__name__"),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(200),
      ),
    );
    if (auth.currentUser !== owner)
      throw new Error("로그인 계정이 바뀌었습니다.");
    rows.push(...page.docs);
    if (page.size < 200) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return rows;
};

export const readArchivedShopProducts = async (): Promise<PointProduct[]> => {
  const canonical = await readArchiveRows("semester_wis_inventory");
  const rows: PointProduct[] = canonical.length
    ? canonical.map((snapshot) => {
        const row = snapshot.data();
        return {
          id: String(row.productId || snapshot.id),
          name: String(row.productName || ""),
          description: String(row.productDescription || ""),
          price: Number(row.price || 0),
          stock: Number(row.stock || 0),
          availableStock: Number(row.available || 0),
          reservedStock: Number(row.reserved || 0),
          soldStock: Number(row.sold || 0),
          isActive: row.active === true,
          sortOrder: Number(row.productSortOrder || 0),
          imageUrl: String(row.productImageUrl || ""),
          previewImageUrl: String(row.productPreviewImageUrl || ""),
          readOnly: true,
        };
      })
    : (await readArchiveRows("point_products")).map((snapshot) => {
        const row = snapshot.data();
        return {
          ...row,
          id: snapshot.id,
          name: String(row.name || ""),
          description: String(row.description || ""),
          price: Number(row.price || 0),
          stock: Number(row.stock || 0),
          availableStock: Number(row.stock || 0),
          isActive: row.isActive !== false,
          sortOrder: Number(row.sortOrder || 0),
          imageUrl: String(row.imageUrl || ""),
          previewImageUrl: String(row.previewImageUrl || ""),
          readOnly: true,
        } as PointProduct;
      });
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ko"),
  );
};

export const readArchivedShopOrders = async (): Promise<PointOrder[]> => {
  const canonical = await readArchiveRows("semester_wis_orders");
  const rows: PointOrder[] = canonical.length
    ? canonical.map((snapshot) => {
        const row = snapshot.data();
        return {
          id: snapshot.id,
          uid: String(row.studentUid || ""),
          studentName: String(row.studentName || ""),
          grade: String(row.grade || ""),
          class: String(row.class || ""),
          number: String(row.number || ""),
          productId: String(row.productId || ""),
          productName: String(row.productName || ""),
          productImageUrl: String(row.productImageUrl || ""),
          priceSnapshot: Number(row.totalPrice || 0),
          quantity: Number(row.quantity || 1),
          unitPrice: Number(row.unitPrice || 0),
          status: String(
            row.status || "REQUESTED",
          ).toLowerCase() as PointOrder["status"],
          requestedAt: row.createdAt,
          reviewedAt: row.reviewedAt,
          approvedAt: row.approvedAt,
          readyAt: row.readyAt,
          fulfilledAt: row.fulfilledAt,
          cancelledAt: row.cancelledAt,
          reviewedBy: String(row.reviewedBy || ""),
          memo: String(row.memo || ""),
          reviewReason: String(row.reviewReason || ""),
          readOnly: true,
        };
      })
    : (await readArchiveRows("point_orders")).map((snapshot) => {
        const row = snapshot.data();
        return {
          ...row,
          id: snapshot.id,
          uid: String(row.uid || ""),
          studentName: String(row.studentName || ""),
          productId: String(row.productId || ""),
          productName: String(row.productName || ""),
          priceSnapshot: Number(row.priceSnapshot || 0),
          quantity: Number(row.quantity || 1),
          status: row.status || "requested",
          reviewedBy: String(row.reviewedBy || ""),
          memo: String(row.memo || ""),
          readOnly: true,
        } as PointOrder;
      });
  return rows.sort(
    (a, b) =>
      Number(b.requestedAt?.seconds || b.requestedAt?._seconds || 0) -
      Number(a.requestedAt?.seconds || a.requestedAt?._seconds || 0),
  );
};
