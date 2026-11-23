import type { MealType } from "@/domain/meal/meal.types";

/** Local, decorative kitchen linework; not a photograph of any specific recipe. */
export function FoodArt({ kind = "table", className = "" }: { kind?: MealType | "table"; className?: string }) {
  return <svg className={`food-art ${className}`} viewBox="0 0 240 200" fill="none" aria-hidden="true" focusable="false">
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {kind === "breakfast" ? <>
        <ellipse cx="105" cy="150" rx="67" ry="12" />
        <path d="M66 96h77l-5 35c-2 20-65 20-67 0zM143 101h9c22 0 21 29-12 28M83 77c-11-10 8-16 0-27M109 76c-11-10 8-16 0-27" />
        <path d="M151 69l37-20c6-3 14 12 11 18l-24 37-24-11zM158 73l22 13M163 65l22 13M152 84l23 13" />
        <path d="M35 150l-8-47M27 103c-16-7-17-18-8-21 11 2 12 13 8 21M30 120c10-1 18-9 15-15-10-1-16 8-15 15" />
      </> : kind === "dinner" ? <>
        <ellipse cx="119" cy="150" rx="89" ry="13" />
        <path d="M41 95h158c-9 47-29 54-79 54S51 142 41 95z" />
        <path d="M64 91c-2-16 15-16 11-31M108 89c-4-15 12-17 7-32M153 89c-2-15 14-15 11-29" />
        <path d="M64 98c22 12 87 14 111 0M82 119h3M114 128h4M148 119h3" />
        <path d="M183 63l24-32M181 57c-8-15 1-27 12-25M188 53c13 1 23-7 22-19" />
      </> : <>
        <ellipse cx="123" cy="111" rx="76" ry="57" />
        <ellipse cx="123" cy="111" rx="59" ry="42" />
        <path d="M84 122c13-10 31-11 44-3 13-14 31-16 39-5-7 13-21 22-44 23-20 0-33-4-39-15zM92 111l5-3M107 105l4-3M119 115l4-2M136 105l5-2M148 122l5-2" />
        <path d="M116 90c-2-17 16-25 24-12-2 10-9 17-24 12zM133 89c13-17 32-7 21 6-8 5-16 1-21-6zM113 95c-21 3-26-11-14-17 10 2 16 8 14 17z" />
        <path d="M25 57v103M15 58v30c0 16 20 16 20 0V58M25 59v36M213 59c-13 17-15 45 0 54v47M213 59v54" />
        <path d="M67 161l-28 21M53 170c-16-11-25-3-19 8M56 168c0 15-10 23-20 16M161 39l17-23M170 28c-2-16-16-19-21-10 1 10 10 16 21 10M172 28c16 1 26-10 18-17-10-1-18 5-18 17" />
      </>}
    </g>
  </svg>;
}
