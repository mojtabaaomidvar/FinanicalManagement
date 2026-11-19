/* Generated from mehrnet/IranianBanks; source and MIT license are in
   backend/app/data/iranian-banks. Values are stored bank names; labels are editable copy. */
export interface BankEntry {
  id: string;
  value: string;
  label: string;
  bins: string[];
  parentId: string | null;
}
export const BANK_CATALOG: BankEntry[] = [
  {"id": "wepod", "value": "ویپاد (ترابانک پاسارگاد)", "label": "ویپاد (ترابانک پاسارگاد)", "bins": ["502229"], "parentId": "pasargad"},
  {"id": "blubank", "value": "بلوبانک (نئوبانک سامان)", "label": "بلوبانک (نئوبانک سامان)", "bins": ["62198618", "62198619"], "parentId": "saman"},
  {"id": "bankino", "value": "بانکینو (نئوبانک خاورمیانه)", "label": "بانکینو (نئوبانک خاورمیانه)", "bins": ["505785"], "parentId": "khavarmianeh"},
  {"id": "banket", "value": "بانکت (نئوبانک مهر ایران)", "label": "بانکت (نئوبانک مهر ایران)", "bins": [], "parentId": "mehr-iran"},
  {"id": "tobank", "value": "توبانک (نئوبانک گردشگری)", "label": "توبانک (نئوبانک گردشگری)", "bins": [], "parentId": "gardeshgari"},
  {"id": "omidbank", "value": "امیدبانک (بانک دیجیتال سپه)", "label": "امیدبانک (بانک دیجیتال سپه)", "bins": [], "parentId": "sepah"},
  {"id": "abank", "value": "آبانک (بانک دیجیتال آینده)", "label": "آبانک (بانک دیجیتال آینده)", "bins": [], "parentId": "ayandeh"},
  {"id": "cbi", "value": "بانک مرکزی جمهوری اسلامی ایران", "label": "بانک مرکزی جمهوری اسلامی ایران", "bins": [], "parentId": null},
  {"id": "melli", "value": "بانک ملی ایران", "label": "بانک ملی ایران", "bins": ["603799", "170019"], "parentId": null},
  {"id": "sepah", "value": "بانک سپه", "label": "بانک سپه", "bins": ["589210", "627381", "639599", "504172", "627760"], "parentId": null},
  {"id": "mellat", "value": "بانک ملت", "label": "بانک ملت", "bins": ["610433", "991975"], "parentId": null},
  {"id": "saderat", "value": "بانک صادرات ایران", "label": "بانک صادرات ایران", "bins": ["603769", "903769"], "parentId": null},
  {"id": "tejarat", "value": "بانک تجارت", "label": "بانک تجارت", "bins": ["585983", "627353"], "parentId": null},
  {"id": "keshavarzi", "value": "بانک کشاورزی", "label": "بانک کشاورزی", "bins": ["603770", "639217"], "parentId": null},
  {"id": "maskan", "value": "بانک مسکن", "label": "بانک مسکن", "bins": ["628023"], "parentId": null},
  {"id": "refah", "value": "بانک رفاه کارگران", "label": "بانک رفاه کارگران", "bins": ["589463"], "parentId": null},
  {"id": "pasargad", "value": "بانک پاسارگاد", "label": "بانک پاسارگاد", "bins": ["639347", "502229"], "parentId": null},
  {"id": "saman", "value": "بانک سامان", "label": "بانک سامان", "bins": ["621986"], "parentId": null},
  {"id": "parsian", "value": "بانک پارسیان", "label": "بانک پارسیان", "bins": ["622106", "639194", "627884"], "parentId": null},
  {"id": "eghtesad-novin", "value": "بانک اقتصاد نوین", "label": "بانک اقتصاد نوین", "bins": ["627412"], "parentId": null},
  {"id": "karafarin", "value": "بانک کارآفرین", "label": "بانک کارآفرین", "bins": ["627488", "502910"], "parentId": null},
  {"id": "sina", "value": "بانک سینا", "label": "بانک سینا", "bins": ["639346"], "parentId": null},
  {"id": "sarmayeh", "value": "بانک سرمایه", "label": "بانک سرمایه", "bins": ["639607"], "parentId": null},
  {"id": "shahr", "value": "بانک شهر", "label": "بانک شهر", "bins": ["502806", "504706"], "parentId": null},
  {"id": "dey", "value": "بانک دی", "label": "بانک دی", "bins": ["502938"], "parentId": null},
  {"id": "ayandeh", "value": "بانک آینده", "label": "بانک آینده", "bins": ["636214"], "parentId": null},
  {"id": "gardeshgari", "value": "بانک گردشگری", "label": "بانک گردشگری", "bins": ["505416", "505426"], "parentId": null},
  {"id": "iran-zamin", "value": "بانک ایران زمین", "label": "بانک ایران زمین", "bins": ["505785"], "parentId": null},
  {"id": "khavarmianeh", "value": "بانک خاورمیانه", "label": "بانک خاورمیانه", "bins": ["585947"], "parentId": null},
  {"id": "mehr-iran", "value": "بانک قرض‌الحسنه مهر ایران", "label": "بانک قرض‌الحسنه مهر ایران", "bins": ["606373"], "parentId": null},
  {"id": "resalat", "value": "بانک قرض‌الحسنه رسالت", "label": "بانک قرض‌الحسنه رسالت", "bins": ["504172"], "parentId": null},
  {"id": "post", "value": "پست بانک ایران", "label": "پست بانک ایران", "bins": ["627760"], "parentId": null},
  {"id": "tosee-taavon", "value": "بانک توسعه تعاون", "label": "بانک توسعه تعاون", "bins": ["502908"], "parentId": null},
  {"id": "tosee-saderat", "value": "بانک توسعه صادرات ایران", "label": "بانک توسعه صادرات ایران", "bins": ["627648", "207177"], "parentId": null},
  {"id": "sanat-madan", "value": "بانک صنعت و معدن", "label": "بانک صنعت و معدن", "bins": ["627961"], "parentId": null},
  {"id": "melal", "value": "موسسه اعتباری ملل", "label": "موسسه اعتباری ملل", "bins": ["606256"], "parentId": null},
  {"id": "noor", "value": "موسسه اعتباری نور", "label": "موسسه اعتباری نور", "bins": ["507677"], "parentId": "melli"},
];
