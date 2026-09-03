/* انتیتی و اینترفیس بودجه دسته — بودجه ماهانه هر دسته هزینه
   (مصرف هر ماه تقویمی از صفر محاسبه می‌شود) */

export interface CategoryBudget {
  id: string;
  familyId: string;
  /** id دسته هزینه (ثابت یا سفارشی) */
  category: string;
  /** مبلغ پایه (تومان) */
  amount: number;
  createdAt: string;
}

export interface CategoryBudgetRepository {
  list(): Promise<CategoryBudget[]>;
  /** درج/به‌روزرسانی بودجه یک دسته (upsert) */
  set(category: string, amount: number): Promise<CategoryBudget>;
  remove(category: string): Promise<void>;
}
