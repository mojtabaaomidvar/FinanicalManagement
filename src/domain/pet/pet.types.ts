/** Pet profiles are fetched online; care refers to existing household Tasks. */
export interface Pet {
  id: string; name: string; species: string; breed: string | null; birthDate: string | null;
  revision: number; createdAt: string; updatedAt: string; canEdit: boolean; canDelete: boolean;
}
export interface PetInput { name: string; species: string; breed?: string | null; birthDate: string | null }
export interface PetList { pets: Pet[]; canCreate: boolean }
export interface PetCareTask {
  id: string; title: string; assigneeId: string | null; dueDate: string | null;
  completed: boolean; revision: number; canComplete: boolean;
}
export interface PetDetail { pet: Pet; careTasks: PetCareTask[]; canCreateCare: boolean }
export interface PetCareInput { title: string; assigneeId: string | null; dueDate: string | null }
