import type { Pet, PetCareTask } from "@/domain/pet/pet.types";

export function filterPets(pets: Pet[], query: string): Pet[] {
  const search = query.trim().toLocaleLowerCase("fa");
  return search ? pets.filter((pet) => [pet.name, pet.species, pet.breed ?? ""].some((value) => value.toLocaleLowerCase("fa").includes(search))) : pets;
}
export function filterPetCare(tasks: PetCareTask[], completed: boolean): PetCareTask[] { return tasks.filter((task) => task.completed === completed); }
