/* انتیتی زیردسته — دائمی برای هر خانواده */

export interface Subcategory {
  id: string;
  familyId: string;
  /** id دسته اصلی (مثل food) */
  category: string;
  name: string;
  createdAt: string;
}

export interface SubcategoryRepository {
  list(): Promise<Subcategory[]>;
  /** افزودن (تکراری، همان موجود را برمی‌گرداند) */
  add(category: string, name: string): Promise<Subcategory>;
  remove(id: string): Promise<void>;
}
