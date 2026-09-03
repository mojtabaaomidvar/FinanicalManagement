/* دسته‌بندی‌های هزینه/درآمد — کاتالوگ و قوانین
   idهای ثابت‌اند و داده‌های قبلی به آنها ارجاع می‌دهند — تغییر ندهید.
   دسته‌های سفارشی خانواده از جدول custom_categories می‌آیند. */

import type { TxType } from "../transaction/transaction.types";

export interface Category {
  id: string;
  name: string;
  icon: string;
  type: TxType;
}

export const CATEGORIES: Category[] = [
  /* ── هزینه (۱۷) ── */
  { id: "food", name: "خورد و خوراک", icon: "i-food", type: "expense" },
  { id: "home", name: "مسکن و خانه", icon: "i-home-i", type: "expense" },
  { id: "bills", name: "قبض‌ها", icon: "i-bill", type: "expense" },
  { id: "transport", name: "حمل و نقل", icon: "i-car", type: "expense" },
  { id: "health", name: "سلامت و درمان", icon: "i-health", type: "expense" },
  { id: "clothing", name: "پوشاک", icon: "i-cloth", type: "expense" },
  { id: "edu", name: "آموزش", icon: "i-edu", type: "expense" },
  { id: "fun", name: "تفریح و سرگرمی", icon: "i-fun", type: "expense" },
  { id: "shopping", name: "خرید و کالاهای شخصی", icon: "i-cart", type: "expense" },
  { id: "comm", name: "ارتباطات", icon: "i-phone", type: "expense" },
  { id: "finance", name: "مالی و بانکی", icon: "i-wallet", type: "expense" },
  { id: "insurance", name: "بیمه", icon: "i-shield", type: "expense" },
  { id: "gifte", name: "هدیه و مناسبت‌ها", icon: "i-gift", type: "expense" },
  { id: "family", name: "خانواده و فرزندان", icon: "i-users", type: "expense" },
  { id: "beauty", name: "بهداشت و زیبایی", icon: "i-heart", type: "expense" },
  { id: "sport", name: "ورزش", icon: "i-dumbbell", type: "expense" },
  { id: "pet", name: "حیوانات خانگی", icon: "i-paw", type: "expense" },

  /* ── درآمد (۵) ── */
  { id: "salary", name: "حقوق", icon: "i-salary", type: "income" },
  { id: "business", name: "کسب‌وکار", icon: "i-briefcase", type: "income" },
  { id: "invest", name: "سرمایه‌گذاری", icon: "i-piggy", type: "income" },
  { id: "sale", name: "فروش دارایی", icon: "i-tag", type: "income" },
  { id: "gift", name: "هدیه دریافتی", icon: "i-gift", type: "income" },

  /* ── انتقال (۱) — جابه‌جایی پول بین حساب‌ها/کیف‌پول‌ها ── */
  { id: "transfer", name: "انتقال وجه", icon: "i-swap", type: "transfer" },
];

/* دسته‌های قدیمی که از UI حذف شده‌اند ولی داده‌های قبلی به آنها ارجاع می‌دهند */
export const LEGACY_CATEGORIES: Category[] = [
  { id: "other-e", name: "متفرقه", icon: "i-more", type: "expense" },
  { id: "other-i", name: "متفرقه", icon: "i-more", type: "income" },
];

/** دسته پیش‌فرض برای فرم جدید — اولین دسته از نوع (متفرقه حذف شده است) */
export function defaultCategoryOf(type: TxType): Category {
  return CATEGORIES.find((c) => c.type === type) ?? LEGACY_CATEGORIES[0];
}

export const CUSTOM_CATEGORY_ICON = "i-tag";

export function categoriesFor(type: TxType): Category[] {
  return CATEGORIES.filter((c) => c.type === type);
}

export function categoryById(id: string): Category {
  return (
    CATEGORIES.find((c) => c.id === id) ??
    LEGACY_CATEGORIES.find((c) => c.id === id) ?? {
      id,
      name: id,
      icon: CUSTOM_CATEGORY_ICON,
      type: "expense",
    }
  );
}

export function isValidCategory(id: string, type: TxType): boolean {
  return CATEGORIES.some((c) => c.id === id && c.type === type);
}
