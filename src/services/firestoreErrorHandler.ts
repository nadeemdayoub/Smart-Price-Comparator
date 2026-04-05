import { auth } from '../firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  
  const jsonString = JSON.stringify(errInfo);
  console.error('Firestore Error: ', jsonString);
  
  throw new Error(jsonString);
}

/**
 * Parses a JSON stringified FirestoreErrorInfo from an Error object.
 */
export function parseFirestoreError(error: unknown): FirestoreErrorInfo | null {
  if (error instanceof Error) {
    try {
      return JSON.parse(error.message) as FirestoreErrorInfo;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Extracts a user-friendly message from a Firestore error.
 */
export function getFirestoreErrorMessage(error: unknown, fallback: string = "An unexpected database error occurred."): string {
  const info = parseFirestoreError(error);
  if (!info) return fallback;

  if (info.error.includes('resource-exhausted') || info.error.includes('quota-exceeded')) {
    return "Firestore quota exceeded. Please wait for the quota to reset.";
  }

  if (info.error.includes('permission-denied')) {
    return "You do not have permission to perform this action.";
  }

  return info.error || fallback;
}
