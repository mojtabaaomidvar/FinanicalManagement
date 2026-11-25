export type AnalyticsDays = 7 | 30 | 90;
export type AnalyticsModule = "dashboard" | "transactions" | "accounts" | "budgets" | "bills" | "reports" | "calendar"
  | "shopping" | "inventory" | "tasks" | "documents" | "meals" | "equipment" | "vehicles" | "goals" | "activities"
  | "children" | "pets" | "market" | "settings" | "notifications";
export type ModuleCounts = { module: AnalyticsModule; opens: number; creates: number; updates: number; completes: number; deletes: number };
export type AnalyticsPoint = { day: string; families_created: number; registrations_completed: number; opens: number | null; requests: number | null; errors: number | null };
export type ProductReport = {
  days: AnalyticsDays; start_at: string; checked_at: string;
  snapshot: {
    families: number; families_with_accounts: number; profiles: number; registered_accounts: number;
    introduced_profiles: number; managed_profiles: number; active_accounts: number; pending_accounts: number;
    inactive_accounts: number; accounts_with_login: number; families_with_login: number;
    accounts_without_login_history: number; accounts_without_registration_history: number;
  };
  daily: AnalyticsPoint[];
  modules: ModuleCounts[] | null;
  usage: { opens: number; requests: number } | null;
  lifetime_usage: { opens: number; requests: number } | null;
  errors: { login: number; registration: number; server: number; total: number } | null;
  records: { transactions: number; scheduled_plans: number; open_tasks: number; completed_tasks: number; shopping_lists: number; documents: number } | null;
  record_inventory: Record<"wallets" | "budget_limits" | "bills" | "inventory_items" | "shopping_items" | "meal_dishes" | "meal_entries"
    | "equipment" | "vehicles" | "maintenance_records" | "calendar_events" | "goals" | "pets" | "bank_messages", number | null>;
  measurement: {
    usage_available: boolean; errors_available: boolean; records_available: boolean;
    first_usage_counter: string | null; first_error_counter: string | null;
    website: "not_measured"; unique_active_users: "not_measured"; retention: "not_measured";
    session_duration: "not_measured"; assistant_usage: "not_measured";
  };
};
