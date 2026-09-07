/* بازنشسته (v5.8) — این اینترفیس هیچ‌جا پیاده‌سازی یا استفاده نمی‌شد.
   بودجه ماهانه از طریق FamilyRepository.setMonthlyBudget ذخیره می‌شود و
   بودجه دسته‌ها مخزن جداگانه‌ی خودش را دارد (CategoryBudgetRepository).
   فایل برای جلوگیری از شکستن importهای احتمالی نگه داشته شده است. */

export interface BudgetInfo {
  budget: number;
  spent: number;
}
