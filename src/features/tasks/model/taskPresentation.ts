import type { Task } from "@/domain/task/task.types";
import type { Member } from "@/domain/family/family.types";

export type TaskFilter = "open" | "mine" | "overdue" | "completed";

export interface TaskActor {
  id: string;
  role: string;
}

/** Introduced children may receive shared chores before they have a login. */
export const isTaskAssignee = (member: Pick<Member, "status" | "membershipState" | "relation">): boolean =>
  member.membershipState === "active" &&
  (member.status === "active" || (member.status === "pending" && member.relation === "فرزند"));

export const isTaskOverdue = (task: Task, todayIso: string): boolean =>
  !task.completed && task.dueDate !== null && task.dueDate < todayIso;

export const filterTasks = (
  tasks: Task[], filter: TaskFilter, memberId: string, todayIso: string,
): Task[] => tasks.filter((task) => {
  if (filter === "completed") return task.completed;
  if (filter === "overdue") return isTaskOverdue(task, todayIso);
  if (filter === "mine") return !task.completed && task.assigneeId === memberId;
  return !task.completed;
});

/** Role rights are used only after the server has validated the online session. */
export const canEditTask = (
  task: Task, actor: TaskActor | null, offline: boolean,
): boolean => Boolean(actor && (task.createdBy === actor.id ||
  (!offline && (actor.role === "owner" || actor.role === "admin"))));

export const canCompleteTask = (
  task: Task, actor: TaskActor | null, offline: boolean,
): boolean => canEditTask(task, actor, offline) ||
  Boolean(actor && task.assigneeId === actor.id);

/** An offline edit can keep its existing assignee but cannot select a new peer. */
export const canAssignOffline = (
  assigneeId: string | null, memberId: string, existingAssigneeId: string | null,
): boolean => assigneeId === null || assigneeId === memberId ||
  assigneeId === existingAssigneeId;
