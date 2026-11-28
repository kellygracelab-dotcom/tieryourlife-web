import { initializeApp } from "firebase-admin/app";

initializeApp();

export { cdnPurge } from "./cdnPurge";
export { onUserDeleted } from "./userDeleted";
export { web } from "./web";
