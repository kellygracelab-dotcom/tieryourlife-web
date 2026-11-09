import { getFirebaseAuth, getFirebaseStorage } from "./firebase";
import { MAX_PICTURE_BYTES } from "./privatePictureRef";

// The cache holds bytes, never a URL that a board could persist. Each consumer owns its object URL.
const CACHE_BYTES = 12 * 1024 * 1024;
const CACHE_ENTRIES = 64;
const cached = new Map<string, Blob>();
const pending = new Map<string, Promise<Blob | null>>();
let cachedBytes = 0;
let owner: string | null = null;
let watching = false;
function setCacheOwner(uid: string | null) {
  if (uid === owner) return;
  owner = uid;
  cached.clear();
  cachedBytes = 0;
  pending.clear();
}
function currentOwner(): string | null {
  const auth = getFirebaseAuth();
  if (!watching) {
    auth.onAuthStateChanged(() => setCacheOwner(signedInUid()));
    watching = true;
  }
  const uid = signedInUid();
  setCacheOwner(uid);
  return uid;
}
function signedInUid() {
  const user = getFirebaseAuth().currentUser;
  return user && !user.isAnonymous ? user.uid : null;
}
function allowed(path: string) {
  const uid = currentOwner();
  return uid !== null && path.startsWith("users/" + uid + "/pictures/");
}
export function forgetPrivateBytes(path: string) {
  pending.delete(path);
  const bytes = cached.get(path);
  if (bytes) {
    cachedBytes -= bytes.size;
    cached.delete(path);
  }
}
export function keepPrivateBytes(path: string, bytes: Blob) {
  if (!bytes.size || bytes.size >= MAX_PICTURE_BYTES || !allowed(path)) return;
  const previous = cached.get(path);
  if (previous) {
    cachedBytes -= previous.size;
    cached.delete(path);
  }
  cached.set(path, bytes);
  cachedBytes += bytes.size;
  while (cached.size > CACHE_ENTRIES || cachedBytes > CACHE_BYTES) {
    const oldest = cached.keys().next().value!;
    cachedBytes -= cached.get(oldest)!.size;
    cached.delete(oldest);
  }
}
export async function privatePictureBytes(path: string): Promise<Blob | null> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  if (!allowed(path)) return null;
  const bytes = cached.get(path);
  if (bytes) {
    cached.delete(path);
    cached.set(path, bytes);
    return bytes;
  }
  const existing = pending.get(path);
  if (existing) return existing;
  const read = async () => {
    const [storage, { getBlob, ref }] = await Promise.all([
      getFirebaseStorage(),
      import("firebase/storage"),
    ]);
    if (!allowed(path)) return null;
    // The SDK truncates a ranged result to this size. Reaching the bucket's exclusive limit is a rejection.
    const blob = await getBlob(ref(storage, path), MAX_PICTURE_BYTES);
    if (
      !blob.size ||
      blob.size >= MAX_PICTURE_BYTES ||
      !allowed(path) ||
      pending.get(path) !== request
    )
      return null;
    keepPrivateBytes(path, blob);
    return blob;
  };
  const request: Promise<Blob | null> = read()
    .catch(() => null)
    .finally(() => {
      if (pending.get(path) === request) pending.delete(path);
    });
  pending.set(path, request);
  return request;
}
