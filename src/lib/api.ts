import { createApiClient } from "../api/client";
import { getList } from "../api/lists";
import type { PublishedList } from "../api/types";
import { tokenProviders } from "./firebase";

export const api = createApiClient(tokenProviders);

export const loadList = (id: string): Promise<PublishedList> => getList(api, id);
