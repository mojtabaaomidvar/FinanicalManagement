/* فانری use-cases — دسترسی یکجا برای UI (بدون نشت infrastructure) */

import { AssistantCapabilitiesUseCase, AnalyzeHouseholdUseCase, AssistantDraftUseCase, AssistantSaveStateUseCase, ContextualHouseholdUseCase } from "./assistant/assistant.usecases";
import type { Container } from "@/infrastructure/repositories/container";
import { WalletCorrectionUseCase } from "./account/wallet.usecases";
import { ListGoalsUseCase, GetGoalUseCase, AddGoalUseCase, UpdateGoalUseCase, DeleteGoalUseCase } from "./goal/goal.usecases";
import { ListActivitiesUseCase, GetActivityUseCase, AddActivityUseCase, UpdateActivityUseCase, DeleteActivityUseCase } from "./activity/activity.usecases";
import { ListChildrenUseCase, GetChildUseCase, AddChildUseCase, UpdateChildUseCase } from "./child/child.usecases";
import { ListPetsUseCase, GetPetUseCase, AddPetUseCase, UpdatePetUseCase, DeletePetUseCase, AddPetCareUseCase } from "./pet/pet.usecases";
import {
  ListVehiclesUseCase, AddVehicleUseCase, UpdateVehicleUseCase,
  DeleteVehicleUseCase, ListVehicleServicesUseCase, AddVehicleServiceUseCase,
} from "./vehicle/vehicle.usecases";
import {
  ListEquipmentUseCase, AddEquipmentUseCase, UpdateEquipmentUseCase,
  DeleteEquipmentUseCase, ListMaintenanceUseCase, AddMaintenanceUseCase,
} from "./equipment/equipment.usecases";
import {
  ListDishesUseCase, AddDishUseCase, UpdateDishUseCase, DeleteDishUseCase,
  GetMealPlanUseCase, AddMealEntryUseCase, UpdateMealEntryUseCase,
  DeleteMealEntryUseCase, AddMealIngredientsToShoppingUseCase,
} from "./meal/meal.usecases";
import {
  ListDocumentsUseCase, AddDocumentUseCase, UpdateDocumentUseCase,
  DeleteDocumentUseCase, DownloadDocumentUseCase,
} from "./document/document.usecases";
import {
  ListTasksUseCase, AddTaskUseCase, UpdateTaskUseCase,
  SetTaskCompletedUseCase, DeleteTaskUseCase,
} from "./task/task.usecases";
import {
  AcceptInviteUseCase,
  JoinByCodeUseCase,
  ChangePasswordUseCase,
  CheckPasswordUseCase,
  CheckPreRegisteredUseCase,
  ConfirmPasswordResetUseCase,
  CreateInviteUseCase,
  GetInviteUseCase,
  GetPublicConfigUseCase,
  LoginWithOtpUseCase,
  LogoutAllUseCase,
  LogoutUseCase,
  RegisterUseCase,
  RequestOtpUseCase,
  RequestPasswordResetUseCase,
  RestoreSessionUseCase,
  SaveSessionUseCase,
  UploadAvatarUseCase,
} from "./auth/auth.usecases";
import {
  AddEventUseCase,
  DeleteEventUseCase,
  ListEventsUseCase,
  SyncBirthdaysUseCase,
} from "./event/event.usecases";
import {
  AddTransactionUseCase,
  DeleteTransactionUseCase,
  DeleteTxPhotoUseCase,
  AddTxPhotoUseCase,
  ListTransactionsUseCase,
  QuoteTransferFeeUseCase,
  MarkRecurringOccurrenceUseCase,
  UpdateRecurringUseCase,
  SettleOccurrenceUseCase,
  UpdateTransactionUseCase,
  UpdateTxPhotoCaptionUseCase,
  UploadTxPhotoUseCase,
} from "./transaction/transaction.usecases";
import {
  GetDashboardUseCase,
  GetMonthlyReportUseCase,
} from "./report/report.usecases";
import {
  AddSmsBatchUseCase,
  IgnoreSmsUseCase,
  IngestRawSmsUseCase,
  ListPendingSmsUseCase,
  ParseSmsImportUseCase,
  RecordSmsUseCase,
} from "./sms/sms.usecases";
import {
  AddSmsNumberUseCase,
  AddSmsSenderUseCase,
  ListSmsNumbersUseCase,
  ListSmsSendersUseCase,
  RemoveSmsNumberUseCase,
  RemoveSmsSenderUseCase,
  ResetAccountSmsUseCase,
  SetAccountSmsEnabledUseCase,
  SetSmsNumberActiveUseCase,
} from "./sms/sms-settings.usecases";
import { CreateBridgeUseCase, GetBridgeUseCase } from "./sms/bridge.usecases";
import {
  BuildBackupJsonUseCase,
  CheckBudgetStatusUseCase,
  GetFamilyUseCase,
  GetMembersUseCase,
  GetHomePreferencesUseCase,
  SetHomePreferencesUseCase,
  RemoveMemberUseCase,
  SetMonthlyBudgetUseCase,
  AddMemberByManagerUseCase,
  UpdateOwnProfileUseCase,
  SetThemeUseCase,
  SetCurrencyUseCase,
  SetMemberRelationUseCase,
  ListJoinRequestsUseCase,
  ApproveJoinRequestUseCase,
  RejectJoinRequestUseCase,
} from "./family/family.usecases";
import {
  AddAccountUseCase,
  DeleteAccountUseCase,
  ListAccountsUseCase,
  UpdateAccountUseCase,
} from "./account/account.usecases";
import {
  AddSubcategoryUseCase,
  DeleteSubcategoryUseCase,
  ListSubcategoriesUseCase,
} from "./category/subcategory.usecases";
import {
  AddCustomCategoryUseCase,
  DeleteCustomCategoryUseCase,
  ListCustomCategoriesUseCase,
} from "./category/custom-category.usecases";
import {
  DeleteCategoryBudgetUseCase,
  ListCategoryBudgetsUseCase,
  SetCategoryBudgetUseCase,
} from "./budget/category-budget.usecases";
import {
  GetMarketSnapshotUseCase,
  SearchStocksUseCase,
} from "./market/market.usecases";
import {
  AddHoldingUseCase,
  DeleteHoldingUseCase,
  ListHoldingsUseCase,
  UpdateHoldingUseCase,
} from "./holding/holding.usecases";
import {
  DismissNotificationUseCase,
  GetNotificationStateUseCase,
  UndismissNotificationUseCase,
  UpdateNotificationPrefsUseCase,
} from "./notification/notification.usecases";
import {
  AddBillUseCase,
  CancelBillUseCase,
  DeleteBillUseCase,
  ListBillsUseCase,
  PayBillUseCase,
  UnpayBillUseCase,
  UpdateBillUseCase,
} from "./bill/bill.usecases";
import {
  AddInventoryItemUseCase,
  AddShoppingItemUseCase,
  AddShoppingListUseCase,
  AdjustInventoryUseCase,
  CheckShoppingItemUseCase,
  CompleteTripUseCase,
  DeleteInventoryItemUseCase,
  DeleteShoppingItemUseCase,
  DeleteShoppingListUseCase,
  ListInventoryUseCase,
  ListShoppingListsUseCase,
  RenameShoppingListUseCase,
  UpdateInventoryItemUseCase,
  UpdateShoppingItemUseCase,
} from "./shopping/shopping.usecases";

export interface UseCases {
  assistantCapabilities: AssistantCapabilitiesUseCase;
  analyzeHousehold: AnalyzeHouseholdUseCase;
  contextualHousehold: ContextualHouseholdUseCase;
  assistantDraft: AssistantDraftUseCase;
  assistantSaveState: AssistantSaveStateUseCase;

  listPets: ListPetsUseCase;
  getPet: GetPetUseCase;
  addPet: AddPetUseCase;
  updatePet: UpdatePetUseCase;
  deletePet: DeletePetUseCase;
  addPetCare: AddPetCareUseCase;
  listChildren: ListChildrenUseCase;
  getChild: GetChildUseCase;
  addChild: AddChildUseCase;
  updateChild: UpdateChildUseCase;
  listActivities: ListActivitiesUseCase;
  getActivity: GetActivityUseCase;
  addActivity: AddActivityUseCase;
  updateActivity: UpdateActivityUseCase;
  deleteActivity: DeleteActivityUseCase;
  listGoals: ListGoalsUseCase;
  getGoal: GetGoalUseCase;
  addGoal: AddGoalUseCase;
  updateGoal: UpdateGoalUseCase;
  deleteGoal: DeleteGoalUseCase;
  listVehicles: ListVehiclesUseCase;
  addVehicle: AddVehicleUseCase;
  updateVehicle: UpdateVehicleUseCase;
  deleteVehicle: DeleteVehicleUseCase;
  listVehicleServices: ListVehicleServicesUseCase;
  addVehicleService: AddVehicleServiceUseCase;
  listEquipment: ListEquipmentUseCase;
  addEquipment: AddEquipmentUseCase;
  updateEquipment: UpdateEquipmentUseCase;
  deleteEquipment: DeleteEquipmentUseCase;
  listMaintenance: ListMaintenanceUseCase;
  addMaintenance: AddMaintenanceUseCase;
  listDishes: ListDishesUseCase;
  addDish: AddDishUseCase;
  updateDish: UpdateDishUseCase;
  deleteDish: DeleteDishUseCase;
  getMealPlan: GetMealPlanUseCase;
  addMealEntry: AddMealEntryUseCase;
  updateMealEntry: UpdateMealEntryUseCase;
  deleteMealEntry: DeleteMealEntryUseCase;
  addMealIngredientsToShopping: AddMealIngredientsToShoppingUseCase;
  listDocuments: ListDocumentsUseCase;
  addDocument: AddDocumentUseCase;
  updateDocument: UpdateDocumentUseCase;
  deleteDocument: DeleteDocumentUseCase;
  downloadDocument: DownloadDocumentUseCase;
  listTasks: ListTasksUseCase;
  addTask: AddTaskUseCase;
  updateTask: UpdateTaskUseCase;
  setTaskCompleted: SetTaskCompletedUseCase;
  deleteTask: DeleteTaskUseCase;
  getPublicConfig: GetPublicConfigUseCase;
  checkPreRegistered: CheckPreRegisteredUseCase;
  uploadAvatar: UploadAvatarUseCase;
  requestOtp: RequestOtpUseCase;
  checkPassword: CheckPasswordUseCase;
  loginWithOtp: LoginWithOtpUseCase;
  register: RegisterUseCase;
  acceptInvite: AcceptInviteUseCase;
  joinByCode: JoinByCodeUseCase;
  getInvite: GetInviteUseCase;
  createInvite: CreateInviteUseCase;
  saveSession: SaveSessionUseCase;
  restoreSession: RestoreSessionUseCase;
  logout: LogoutUseCase;
  logoutAll: LogoutAllUseCase;
  changePassword: ChangePasswordUseCase;
  requestPasswordReset: RequestPasswordResetUseCase;
  confirmPasswordReset: ConfirmPasswordResetUseCase;

  listTransactions: ListTransactionsUseCase;
  quoteTransferFee: QuoteTransferFeeUseCase;
  addTransaction: AddTransactionUseCase;
  updateTransaction: UpdateTransactionUseCase;
  deleteTransaction: DeleteTransactionUseCase;
  markRecurringOccurrence: MarkRecurringOccurrenceUseCase;
  updateRecurring: UpdateRecurringUseCase;
  settleOccurrence: SettleOccurrenceUseCase;

  uploadTxPhoto: UploadTxPhotoUseCase;
  addTxPhoto: AddTxPhotoUseCase;
  updateTxPhotoCaption: UpdateTxPhotoCaptionUseCase;
  deleteTxPhoto: DeleteTxPhotoUseCase;

  getDashboard: GetDashboardUseCase;
  getMonthlyReport: GetMonthlyReportUseCase;

  parseSmsImport: ParseSmsImportUseCase;
  addSmsBatch: AddSmsBatchUseCase;
  ingestRawSms: IngestRawSmsUseCase;
  listPendingSms: ListPendingSmsUseCase;
  ignoreSms: IgnoreSmsUseCase;
  recordSms: RecordSmsUseCase;

  setAccountSmsEnabled: SetAccountSmsEnabledUseCase;
  resetAccountSms: ResetAccountSmsUseCase;
  listSmsSenders: ListSmsSendersUseCase;
  addSmsSender: AddSmsSenderUseCase;
  removeSmsSender: RemoveSmsSenderUseCase;
  listSmsNumbers: ListSmsNumbersUseCase;
  addSmsNumber: AddSmsNumberUseCase;
  setSmsNumberActive: SetSmsNumberActiveUseCase;
  removeSmsNumber: RemoveSmsNumberUseCase;

  getFamily: GetFamilyUseCase;
  getMembers: GetMembersUseCase;
  getHomePreferences: GetHomePreferencesUseCase;
  setHomePreferences: SetHomePreferencesUseCase;
  setMonthlyBudget: SetMonthlyBudgetUseCase;
  removeMember: RemoveMemberUseCase;
  listJoinRequests: ListJoinRequestsUseCase;
  approveJoinRequest: ApproveJoinRequestUseCase;
  rejectJoinRequest: RejectJoinRequestUseCase;
  updateOwnProfile: UpdateOwnProfileUseCase;
  addMemberByManager: AddMemberByManagerUseCase;
  setTheme: SetThemeUseCase;
  setCurrency: SetCurrencyUseCase;
  setMemberRelation: SetMemberRelationUseCase;
  checkBudgetStatus: CheckBudgetStatusUseCase;
  buildBackupJson: BuildBackupJsonUseCase;

  listEvents: ListEventsUseCase;
  addEvent: AddEventUseCase;
  deleteEvent: DeleteEventUseCase;
  syncBirthdays: SyncBirthdaysUseCase;

  listAccounts: ListAccountsUseCase;
  walletCorrections: WalletCorrectionUseCase;
  addAccount: AddAccountUseCase;
  updateAccount: UpdateAccountUseCase;
  deleteAccount: DeleteAccountUseCase;

  getBridge: GetBridgeUseCase;
  createBridge: CreateBridgeUseCase;

  listSubcategories: ListSubcategoriesUseCase;
  addSubcategory: AddSubcategoryUseCase;
  deleteSubcategory: DeleteSubcategoryUseCase;

  listCustomCategories: ListCustomCategoriesUseCase;
  addCustomCategory: AddCustomCategoryUseCase;
  deleteCustomCategory: DeleteCustomCategoryUseCase;

  listCategoryBudgets: ListCategoryBudgetsUseCase;
  setCategoryBudget: SetCategoryBudgetUseCase;
  deleteCategoryBudget: DeleteCategoryBudgetUseCase;

  getMarketSnapshot: GetMarketSnapshotUseCase;
  searchStocks: SearchStocksUseCase;

  listHoldings: ListHoldingsUseCase;
  addHolding: AddHoldingUseCase;
  updateHolding: UpdateHoldingUseCase;
  deleteHolding: DeleteHoldingUseCase;

  /* §۷ — ساختِ فهرستِ اعلان use-case ندارد: تابعِ خالصِ
     domain/notification/deriveNotifications است. این چهار تا فقط ماندگاری‌اند. */
  getNotificationState: GetNotificationStateUseCase;
  updateNotificationPrefs: UpdateNotificationPrefsUseCase;
  dismissNotification: DismissNotificationUseCase;
  undismissNotification: UndismissNotificationUseCase;

  /* §۱.۹ قبوض — «پرداخت» و «برگرداندنِ پرداخت» تراکنش هم دست می‌زنند، پس
     فراخوان باید بعدشان refreshData بزند. */
  listBills: ListBillsUseCase;
  addBill: AddBillUseCase;
  updateBill: UpdateBillUseCase;
  deleteBill: DeleteBillUseCase;
  payBill: PayBillUseCase;
  unpayBill: UnpayBillUseCase;
  cancelBill: CancelBillUseCase;

  /* §۱.۸ خرید و انبار — «خرید انجام شد» هم تراکنش می‌سازد و هم موجودیِ
     انبار را بالا می‌برد، پس فراخوانش هم refreshData می‌خواهد. */
  listShoppingLists: ListShoppingListsUseCase;
  addShoppingList: AddShoppingListUseCase;
  renameShoppingList: RenameShoppingListUseCase;
  deleteShoppingList: DeleteShoppingListUseCase;
  addShoppingItem: AddShoppingItemUseCase;
  updateShoppingItem: UpdateShoppingItemUseCase;
  checkShoppingItem: CheckShoppingItemUseCase;
  deleteShoppingItem: DeleteShoppingItemUseCase;
  completeTrip: CompleteTripUseCase;
  listInventory: ListInventoryUseCase;
  addInventoryItem: AddInventoryItemUseCase;
  updateInventoryItem: UpdateInventoryItemUseCase;
  adjustInventory: AdjustInventoryUseCase;
  deleteInventoryItem: DeleteInventoryItemUseCase;
}

export function createUseCases(c: Container): UseCases {
  return {
    assistantCapabilities: new AssistantCapabilitiesUseCase(c.repos.assistant),
    analyzeHousehold: new AnalyzeHouseholdUseCase(c.repos.assistant),
    contextualHousehold: new ContextualHouseholdUseCase(c.repos.assistant),
    assistantDraft: new AssistantDraftUseCase(c.storage),
    assistantSaveState: new AssistantSaveStateUseCase(c.shoppingOffline),

    listActivities: new ListActivitiesUseCase(c.repos.activities),
    listChildren: new ListChildrenUseCase(c.repos.children),
    listPets: new ListPetsUseCase(c.repos.pets),
    getPet: new GetPetUseCase(c.repos.pets),
    addPet: new AddPetUseCase(c.repos.pets),
    updatePet: new UpdatePetUseCase(c.repos.pets),
    deletePet: new DeletePetUseCase(c.repos.pets),
    addPetCare: new AddPetCareUseCase(c.repos.pets),
    getChild: new GetChildUseCase(c.repos.children),
    addChild: new AddChildUseCase(c.repos.children),
    updateChild: new UpdateChildUseCase(c.repos.children),
    getActivity: new GetActivityUseCase(c.repos.activities),
    addActivity: new AddActivityUseCase(c.repos.activities),
    updateActivity: new UpdateActivityUseCase(c.repos.activities),
    deleteActivity: new DeleteActivityUseCase(c.repos.activities),
    listGoals: new ListGoalsUseCase(c.repos.goals),
    getGoal: new GetGoalUseCase(c.repos.goals),
    addGoal: new AddGoalUseCase(c.repos.goals),
    updateGoal: new UpdateGoalUseCase(c.repos.goals),
    deleteGoal: new DeleteGoalUseCase(c.repos.goals),
    listVehicles: new ListVehiclesUseCase(c.repos.vehicles),
    addVehicle: new AddVehicleUseCase(c.repos.vehicles),
    updateVehicle: new UpdateVehicleUseCase(c.repos.vehicles),
    deleteVehicle: new DeleteVehicleUseCase(c.repos.vehicles),
    listVehicleServices: new ListVehicleServicesUseCase(c.repos.vehicles),
    addVehicleService: new AddVehicleServiceUseCase(c.repos.vehicles),
    listEquipment: new ListEquipmentUseCase(c.repos.equipment),
    addEquipment: new AddEquipmentUseCase(c.repos.equipment),
    updateEquipment: new UpdateEquipmentUseCase(c.repos.equipment),
    deleteEquipment: new DeleteEquipmentUseCase(c.repos.equipment),
    listMaintenance: new ListMaintenanceUseCase(c.repos.equipment),
    addMaintenance: new AddMaintenanceUseCase(c.repos.equipment),
    listDishes: new ListDishesUseCase(c.repos.meals),
    addDish: new AddDishUseCase(c.repos.meals),
    updateDish: new UpdateDishUseCase(c.repos.meals),
    deleteDish: new DeleteDishUseCase(c.repos.meals),
    getMealPlan: new GetMealPlanUseCase(c.repos.meals),
    addMealEntry: new AddMealEntryUseCase(c.repos.meals),
    updateMealEntry: new UpdateMealEntryUseCase(c.repos.meals),
    deleteMealEntry: new DeleteMealEntryUseCase(c.repos.meals),
    addMealIngredientsToShopping: new AddMealIngredientsToShoppingUseCase(c.repos.meals),
    listDocuments: new ListDocumentsUseCase(c.repos.documents),
    addDocument: new AddDocumentUseCase(c.repos.documents),
    updateDocument: new UpdateDocumentUseCase(c.repos.documents),
    deleteDocument: new DeleteDocumentUseCase(c.repos.documents),
    downloadDocument: new DownloadDocumentUseCase(c.repos.documents),
    listTasks: new ListTasksUseCase(c.repos.tasks),
    addTask: new AddTaskUseCase(c.repos.tasks),
    updateTask: new UpdateTaskUseCase(c.repos.tasks),
    setTaskCompleted: new SetTaskCompletedUseCase(c.repos.tasks),
    deleteTask: new DeleteTaskUseCase(c.repos.tasks),
    getPublicConfig: new GetPublicConfigUseCase(c.repos.auth),
    checkPreRegistered: new CheckPreRegisteredUseCase(c.repos.auth),
    uploadAvatar: new UploadAvatarUseCase(c.repos.auth),
    requestOtp: new RequestOtpUseCase(c.repos.auth),
    checkPassword: new CheckPasswordUseCase(c.repos.auth),
    loginWithOtp: new LoginWithOtpUseCase(c.repos.auth),
    register: new RegisterUseCase(c.repos.auth),
    acceptInvite: new AcceptInviteUseCase(c.repos.auth),
    joinByCode: new JoinByCodeUseCase(c.repos.auth),
    getInvite: new GetInviteUseCase(c.repos.auth),
    createInvite: new CreateInviteUseCase(c.repos.auth),
    saveSession: new SaveSessionUseCase(c.session),
    restoreSession: new RestoreSessionUseCase(c.session, c.repos.auth, c.shoppingOffline),
    logout: new LogoutUseCase(c.session, c.repos.auth, c.offlineCache),
    logoutAll: new LogoutAllUseCase(c.session, c.repos.auth, c.offlineCache),
    changePassword: new ChangePasswordUseCase(c.session, c.repos.auth),
    requestPasswordReset: new RequestPasswordResetUseCase(c.repos.auth),
    confirmPasswordReset: new ConfirmPasswordResetUseCase(
      c.session,
      c.repos.auth,
    ),

    listTransactions: new ListTransactionsUseCase(c.repos.transactions),
    quoteTransferFee: new QuoteTransferFeeUseCase(c.repos.transactions),
    updateRecurring: new UpdateRecurringUseCase(c.repos.transactions),
    settleOccurrence: new SettleOccurrenceUseCase(c.repos.transactions),
    addTransaction: new AddTransactionUseCase(c.repos.transactions),
    updateTransaction: new UpdateTransactionUseCase(c.repos.transactions),
    deleteTransaction: new DeleteTransactionUseCase(c.repos.transactions),
    markRecurringOccurrence: new MarkRecurringOccurrenceUseCase(
      c.repos.transactions,
    ),

    uploadTxPhoto: new UploadTxPhotoUseCase(c.repos.transactions),
    addTxPhoto: new AddTxPhotoUseCase(c.repos.transactions),
    updateTxPhotoCaption: new UpdateTxPhotoCaptionUseCase(c.repos.transactions),
    deleteTxPhoto: new DeleteTxPhotoUseCase(c.repos.transactions),

    getDashboard: new GetDashboardUseCase(c.repos.transactions),
    getMonthlyReport: new GetMonthlyReportUseCase(c.repos.transactions),

    parseSmsImport: new ParseSmsImportUseCase(),
    addSmsBatch: new AddSmsBatchUseCase(c.repos.sms),
    ingestRawSms: new IngestRawSmsUseCase(c.repos.sms),
    listPendingSms: new ListPendingSmsUseCase(c.repos.sms),
    ignoreSms: new IgnoreSmsUseCase(c.repos.sms),
    recordSms: new RecordSmsUseCase(
      c.repos.sms,
    ),

    setAccountSmsEnabled: new SetAccountSmsEnabledUseCase(c.repos.smsSettings),
    resetAccountSms: new ResetAccountSmsUseCase(c.repos.smsSettings),
    listSmsSenders: new ListSmsSendersUseCase(c.repos.smsSettings),
    addSmsSender: new AddSmsSenderUseCase(c.repos.smsSettings),
    removeSmsSender: new RemoveSmsSenderUseCase(c.repos.smsSettings),
    listSmsNumbers: new ListSmsNumbersUseCase(c.repos.smsSettings),
    addSmsNumber: new AddSmsNumberUseCase(c.repos.smsSettings),
    setSmsNumberActive: new SetSmsNumberActiveUseCase(c.repos.smsSettings),
    removeSmsNumber: new RemoveSmsNumberUseCase(c.repos.smsSettings),

    getFamily: new GetFamilyUseCase(c.repos.family),
    getMembers: new GetMembersUseCase(c.repos.family),
    getHomePreferences: new GetHomePreferencesUseCase(c.repos.family),
    setHomePreferences: new SetHomePreferencesUseCase(c.repos.family),
    setMonthlyBudget: new SetMonthlyBudgetUseCase(c.repos.family),
    removeMember: new RemoveMemberUseCase(c.repos.family),
    listJoinRequests: new ListJoinRequestsUseCase(c.repos.family),
    approveJoinRequest: new ApproveJoinRequestUseCase(c.repos.family),
    rejectJoinRequest: new RejectJoinRequestUseCase(c.repos.family),
    updateOwnProfile: new UpdateOwnProfileUseCase(c.repos.family),
    addMemberByManager: new AddMemberByManagerUseCase(c.repos.family),
    setTheme: new SetThemeUseCase(c.repos.family),
    setCurrency: new SetCurrencyUseCase(c.repos.family),
    setMemberRelation: new SetMemberRelationUseCase(c.repos.family),
    checkBudgetStatus: new CheckBudgetStatusUseCase(),
    buildBackupJson: new BuildBackupJsonUseCase(),

    listEvents: new ListEventsUseCase(c.repos.events),
    addEvent: new AddEventUseCase(c.repos.events),
    deleteEvent: new DeleteEventUseCase(c.repos.events),
    syncBirthdays: new SyncBirthdaysUseCase(c.repos.events),

    listAccounts: new ListAccountsUseCase(c.repos.accounts),
    walletCorrections: new WalletCorrectionUseCase(c.repos.wallets, c.storage),
    addAccount: new AddAccountUseCase(c.repos.accounts),
    updateAccount: new UpdateAccountUseCase(c.repos.accounts),
    deleteAccount: new DeleteAccountUseCase(c.repos.accounts),

    getBridge: new GetBridgeUseCase(c.repos.bridges),
    createBridge: new CreateBridgeUseCase(c.repos.bridges),

    listSubcategories: new ListSubcategoriesUseCase(c.repos.subcategories),
    addSubcategory: new AddSubcategoryUseCase(c.repos.subcategories),
    deleteSubcategory: new DeleteSubcategoryUseCase(c.repos.subcategories),

    listCustomCategories: new ListCustomCategoriesUseCase(
      c.repos.customCategories,
    ),
    addCustomCategory: new AddCustomCategoryUseCase(c.repos.customCategories),
    deleteCustomCategory: new DeleteCustomCategoryUseCase(
      c.repos.customCategories,
    ),

    listCategoryBudgets: new ListCategoryBudgetsUseCase(
      c.repos.categoryBudgets,
    ),
    setCategoryBudget: new SetCategoryBudgetUseCase(c.repos.categoryBudgets),
    deleteCategoryBudget: new DeleteCategoryBudgetUseCase(
      c.repos.categoryBudgets,
    ),

    getMarketSnapshot: new GetMarketSnapshotUseCase(c.repos.market),
    searchStocks: new SearchStocksUseCase(c.repos.market),

    listHoldings: new ListHoldingsUseCase(c.repos.holdings),
    addHolding: new AddHoldingUseCase(c.repos.holdings),
    updateHolding: new UpdateHoldingUseCase(c.repos.holdings),
    deleteHolding: new DeleteHoldingUseCase(c.repos.holdings),

    getNotificationState: new GetNotificationStateUseCase(c.repos.notifications),
    updateNotificationPrefs: new UpdateNotificationPrefsUseCase(
      c.repos.notifications,
    ),
    dismissNotification: new DismissNotificationUseCase(c.repos.notifications),
    undismissNotification: new UndismissNotificationUseCase(
      c.repos.notifications,
    ),

    listBills: new ListBillsUseCase(c.repos.bills),
    addBill: new AddBillUseCase(c.repos.bills),
    updateBill: new UpdateBillUseCase(c.repos.bills),
    deleteBill: new DeleteBillUseCase(c.repos.bills),
    payBill: new PayBillUseCase(c.repos.bills),
    unpayBill: new UnpayBillUseCase(c.repos.bills),
    cancelBill: new CancelBillUseCase(c.repos.bills),

    listShoppingLists: new ListShoppingListsUseCase(c.repos.shopping),
    addShoppingList: new AddShoppingListUseCase(c.repos.shopping),
    renameShoppingList: new RenameShoppingListUseCase(c.repos.shopping),
    deleteShoppingList: new DeleteShoppingListUseCase(c.repos.shopping),
    addShoppingItem: new AddShoppingItemUseCase(c.repos.shopping),
    updateShoppingItem: new UpdateShoppingItemUseCase(c.repos.shopping),
    checkShoppingItem: new CheckShoppingItemUseCase(c.repos.shopping),
    deleteShoppingItem: new DeleteShoppingItemUseCase(c.repos.shopping),
    completeTrip: new CompleteTripUseCase(c.repos.shopping),
    listInventory: new ListInventoryUseCase(c.repos.inventory),
    addInventoryItem: new AddInventoryItemUseCase(c.repos.inventory),
    updateInventoryItem: new UpdateInventoryItemUseCase(c.repos.inventory),
    adjustInventory: new AdjustInventoryUseCase(c.repos.inventory),
    deleteInventoryItem: new DeleteInventoryItemUseCase(c.repos.inventory),
  };
}
