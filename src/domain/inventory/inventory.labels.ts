import type { InventoryCatalogGroup, InventoryCatalogSection } from "./inventory.catalog";

export const INVENTORY_SECTION_LABELS: Record<InventoryCatalogSection, string> = {
  dry: "خشک و ماندگار", fresh: "تازه و تر", chilled: "یخچالی", frozen: "منجمد",
  legumes: "حبوبات", seasonings: "ادویه و سبزی خشک", breakfast: "نان و صبحانه",
  refreshments: "نوشیدنی و تنقلات", household: "مصرفی‌های خانه", maintenance: "تعمیر و نگهداری",
};

export const INVENTORY_GROUP_LABELS: Record<InventoryCatalogGroup, string> = {
  grains: "برنج، غلات و رشته", oils_sauces: "روغن، رب، سس و چاشنی", baking: "آرد و مواد شیرینی‌پزی",
  preserves: "کنسرو و ترشی", vegetables: "سبزی و صیفی تازه", fruit: "میوهٔ تازه",
  refrigerated: "لبنیات و تخم‌مرغ", proteins: "گوشت، مرغ و آبزیان", frozen: "غذاهای منجمد",
  legumes: "حبوبات", seasonings: "ادویه و سبزی خشک", breakfast: "نان و صبحانه",
  drinks: "نوشیدنی و دمنوش", snacks: "آجیل، خشکبار و تنقلات", cleaning: "نظافت و شوینده",
  disposables: "دستمال و مصرفی آشپزخانه", personal_care: "بهداشت شخصی", baby_care: "مراقبت کودک و سالمند",
  first_aid: "کمک‌های اولیه", textile_care: "خیاطی، لباس و کفش", stationery: "نوشت‌افزار و بسته‌بندی",
  pets: "حیوانات خانگی", garden: "گل‌وگیاه و باغبانی", electrical: "برق، روشنایی و باتری",
  plumbing: "لوله‌کشی و شیرآلات", repairs: "یراق، چسب و تعمیرات", appliance_supplies: "فیلتر و یدکی وسایل",
  emergency: "ایمنی و وسایل اضطراری", garage: "خودرو و دوچرخه",
};
