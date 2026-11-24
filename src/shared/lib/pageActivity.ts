import { createContext, useContext } from "react";

// A cached page is mounted, but must not own global UI while inactive.
export const PageActivityContext = createContext(true);
export function usePageActivity() { return useContext(PageActivityContext); }
