import type { Member } from "@/domain/family/family.types";

type WalletViewer = Pick<Member, "id" | "familyId" | "role">;

export function canViewFamilyWallets(viewer: WalletViewer | null): boolean {
  return !!viewer?.id && !!viewer.familyId && (viewer.role === "owner" || viewer.role === "admin");
}

/** Wallet-page assets only; transactions are calculated by their account endpoints. */
export function walletItemsForViewer<T extends { familyId: string; memberId: string }>(items: T[], viewer: WalletViewer | null): T[] {
  if (!viewer?.id || !viewer.familyId) return [];
  const familyView = canViewFamilyWallets(viewer);
  return items.filter(item => item.familyId === viewer.familyId && (familyView || item.memberId === viewer.id));
}
