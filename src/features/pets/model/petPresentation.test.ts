import { describe, expect, it } from "vitest";
import type { Pet, PetCareTask } from "@/domain/pet/pet.types";
import { filterPetCare, filterPets } from "./petPresentation";

describe("pet and care presentation", () => {
  it("finds pets by name, species or optional breed", () => {
    const pets = [{ id: "a", name: "پیشی", species: "گربه", breed: null }, { id: "b", name: "برفی", species: "سگ", breed: "هاسکی" }] as Pet[];
    expect(filterPets(pets, " پیش ")).toEqual([pets[0]]); expect(filterPets(pets, "گربه")).toEqual([pets[0]]); expect(filterPets(pets, "هاسکی")).toEqual([pets[1]]);
    expect(filterPets(pets, "")).toEqual(pets);
  });
  it("shows open and completed care using the canonical Task state", () => {
    const tasks = [{ id: "a", completed: false }, { id: "b", completed: true }] as PetCareTask[];
    expect(filterPetCare(tasks, false)).toEqual([tasks[0]]); expect(filterPetCare(tasks, true)).toEqual([tasks[1]]);
  });
});
