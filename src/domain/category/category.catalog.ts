/* دسته‌بندی‌های هزینه/درآمد — کاتالوگ و قوانین */

import type { TxType } from "../transaction/transaction.types";

export interface Category {
  id: string;
  name: string;
  icon: string;
  type: TxType;
}

export const CATEGORIES: Category[] = [
  /* هزینه */
  { id: "food", name: "خورد و خوراک", icon: "i-food", type: "expense" },
  { id: "shopping", name: "خرید", icon: "i-cart", type: "expense" },
  { id: "transport", name: "حمل و نقل", icon: "i-car", type: "expense" },
  { id: "home", name: "خانه", icon: "i-home-i", type: "expense" },
  { id: "health", name: "سلامت", icon: "i-health", type: "expense" },
  { id: "fun", name: "تفریح", icon: "i-fun", type: "expense" },
  { id: "edu", name: "آموزش", icon: "i-edu", type: "expense" },
  { id: "clothing", name: "پوشاک", icon: "i-cloth", type: "expense" },
  { id: "bills", name: "قبض", icon: "i-bill", type: "expense" },
  { id: "other-e", name: "متفرقه", icon: "i-more", type: "expense" },
  /* درآمد */
  { id: "salary", name: "حقوق", icon: "i-salary", type: "income" },
  { id: "business", name: "کسب‌وکار", icon: "i-briefcase", type: "income" },
  { id: "gift", name: "هدیه", icon: "i-gift", type: "income" },
  { id: "other-i", name: "متفرقه", icon: "i-more", type: "income" },
];

export const FALLBACK_CATEGORY: Category = {
  id: "other-e",
  name: "متفرقه",
  icon: "i-more",
  type: "expense",
};

export function categoriesFor(type: TxType): Category[] {
  return CATEGORIES.filter((c) => c.type === type);
}

export function categoryById(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? FALLBACK_CATEGORY;
}

export function isValidCategory(id: string, type: TxType): boolean {
  return CATEGORIES.some((c) => c.id === id && c.type === type);
}
