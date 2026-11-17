/** Child profiles share the canonical family Member identity. */
export interface Child {
  id: string;
  name: string;
  birthDate: string | null;
  ageYears: number | null;
  status: "pending" | "active";
  revision: number;
  canEdit: boolean;
}

export interface ChildInput { name: string; birthDate: string | null }
export interface ChildList { children: Child[]; canCreate: boolean }
export interface ChildTask { id: string; title: string; dueDate: string | null; completed: boolean }
export interface ChildActivity { id: string; title: string; date: string; location: string | null; status: "planned" | "done" | "cancelled" }
export interface ChildBirthday { id: string; title: string; date: string }
export interface ChildDetail {
  child: Child;
  tasks: ChildTask[];
  activities: ChildActivity[];
  birthday: ChildBirthday | null;
}
