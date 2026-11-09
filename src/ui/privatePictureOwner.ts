import { createContext } from "react";

/** The signed-in owner whose private previews may be displayed in this React tree. */
export const PrivatePictureOwner = createContext<string | null>(null);
