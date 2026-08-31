/* فانری use-cases — دسترسی یکجا برای UI (بدون نشت infrastructure) */

import type { Container } from "@/infrastructure/repositories/container";
import {
  AcceptInviteUseCase,
  CheckPasswordUseCase,
  CreateInviteUseCase,
  GetInviteUseCase,
  GetPublicConfigUseCase,
  LoginWithOtpUseCase,
  LogoutUseCase,
  RegisterUseCase,
  RequestOtpUseCase,
  RestoreSessionUseCase,
  SaveSessionUseCase,
} from "./auth/auth.usecases";
import {
  AddTransactionUseCase,
  DeleteTransactionUseCase,
  ListTransactionsUseCase,
  UpdateTransactionUseCase,
} from "./transaction/transaction.usecases";
import {
  GetDashboardUseCase,
  GetMonthlyReportUseCase,
} from "./report/report.usecases";
import {
  AddSmsBatchUseCase,
  IgnoreSmsUseCase,
  ListPendingSmsUseCase,
  ParseSmsImportUseCase,
  RecordSmsUseCase,
} from "./sms/sms.usecases";
import { CreateBridgeUseCase, GetBridgeUseCase } from "./sms/bridge.usecases";
import {
  BuildBackupJsonUseCase,
  CheckBudgetStatusUseCase,
  GetFamilyUseCase,
  GetMembersUseCase,
  RemoveMemberUseCase,
  UpdateFamilySettingsUseCase,
} from "./family/family.usecases";
import {
  AddAccountUseCase,
  DeleteAccountUseCase,
  ListAccountsUseCase,
} from "./account/account.usecases";

export interface UseCases {
  getPublicConfig: GetPublicConfigUseCase;
  requestOtp: RequestOtpUseCase;
  checkPassword: CheckPasswordUseCase;
  loginWithOtp: LoginWithOtpUseCase;
  register: RegisterUseCase;
  acceptInvite: AcceptInviteUseCase;
  getInvite: GetInviteUseCase;
  createInvite: CreateInviteUseCase;
  saveSession: SaveSessionUseCase;
  restoreSession: RestoreSessionUseCase;
  logout: LogoutUseCase;

  listTransactions: ListTransactionsUseCase;
  addTransaction: AddTransactionUseCase;
  updateTransaction: UpdateTransactionUseCase;
  deleteTransaction: DeleteTransactionUseCase;

  getDashboard: GetDashboardUseCase;
  getMonthlyReport: GetMonthlyReportUseCase;

  parseSmsImport: ParseSmsImportUseCase;
  addSmsBatch: AddSmsBatchUseCase;
  listPendingSms: ListPendingSmsUseCase;
  ignoreSms: IgnoreSmsUseCase;
  recordSms: RecordSmsUseCase;

  getFamily: GetFamilyUseCase;
  getMembers: GetMembersUseCase;
  updateFamilySettings: UpdateFamilySettingsUseCase;
  removeMember: RemoveMemberUseCase;
  checkBudgetStatus: CheckBudgetStatusUseCase;
  buildBackupJson: BuildBackupJsonUseCase;

  listAccounts: ListAccountsUseCase;
  addAccount: AddAccountUseCase;
  deleteAccount: DeleteAccountUseCase;

  getBridge: GetBridgeUseCase;
  createBridge: CreateBridgeUseCase;
}

export function createUseCases(c: Container): UseCases {
  return {
    getPublicConfig: new GetPublicConfigUseCase(c.repos.auth),
    requestOtp: new RequestOtpUseCase(c.repos.auth),
    checkPassword: new CheckPasswordUseCase(c.repos.auth),
    loginWithOtp: new LoginWithOtpUseCase(c.repos.auth),
    register: new RegisterUseCase(c.repos.auth),
    acceptInvite: new AcceptInviteUseCase(c.repos.auth),
    getInvite: new GetInviteUseCase(c.repos.auth),
    createInvite: new CreateInviteUseCase(c.repos.auth),
    saveSession: new SaveSessionUseCase(c.session),
    restoreSession: new RestoreSessionUseCase(c.session, c.repos.auth),
    logout: new LogoutUseCase(c.session, c.repos.auth),

    listTransactions: new ListTransactionsUseCase(c.repos.transactions),
    addTransaction: new AddTransactionUseCase(c.repos.transactions),
    updateTransaction: new UpdateTransactionUseCase(c.repos.transactions),
    deleteTransaction: new DeleteTransactionUseCase(c.repos.transactions),

    getDashboard: new GetDashboardUseCase(c.repos.transactions),
    getMonthlyReport: new GetMonthlyReportUseCase(c.repos.transactions),

    parseSmsImport: new ParseSmsImportUseCase(),
    addSmsBatch: new AddSmsBatchUseCase(c.repos.sms),
    listPendingSms: new ListPendingSmsUseCase(c.repos.sms),
    ignoreSms: new IgnoreSmsUseCase(c.repos.sms),
    recordSms: new RecordSmsUseCase(
      c.repos.sms,
      new AddTransactionUseCase(c.repos.transactions),
    ),

    getFamily: new GetFamilyUseCase(c.repos.family),
    getMembers: new GetMembersUseCase(c.repos.family),
    updateFamilySettings: new UpdateFamilySettingsUseCase(c.repos.family),
    removeMember: new RemoveMemberUseCase(c.repos.family),
    checkBudgetStatus: new CheckBudgetStatusUseCase(),
    buildBackupJson: new BuildBackupJsonUseCase(),

    listAccounts: new ListAccountsUseCase(c.repos.accounts),
    addAccount: new AddAccountUseCase(c.repos.accounts),
    deleteAccount: new DeleteAccountUseCase(c.repos.accounts),

    getBridge: new GetBridgeUseCase(c.repos.bridges),
    createBridge: new CreateBridgeUseCase(c.repos.bridges),
  };
}
