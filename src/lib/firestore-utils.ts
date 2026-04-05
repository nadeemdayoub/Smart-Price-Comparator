/**
 * Recursively removes undefined keys from an object to make it safe for Firestore.
 * Firestore does not allow 'undefined' as a value, so we must either remove the key
 * or convert it to 'null'. This helper removes the keys.
 */
export function sanitizeFirestoreData(data: any): any {
  if (data === null || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeFirestoreData);
  }

  const sanitized: any = {};
  Object.keys(data).forEach(key => {
    const value = data[key];
    if (value !== undefined) {
      sanitized[key] = sanitizeFirestoreData(value);
    }
  });
  return sanitized;
}

/**
 * Safely converts a Firestore value to a Date object.
 * Supports Timestamps, ISO strings, and plain objects with seconds/nanoseconds.
 */
export function safeToDate(val: any): Date | null {
  if (!val) return null;
  
  // 1. Firestore Timestamp
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate();
    } catch (e) {
      // Fall through
    }
  }

  // 2. Plain object with seconds (common in some runtime environments)
  if (val.seconds !== undefined) {
    return new Date(val.seconds * 1000 + (val.nanoseconds || 0) / 1000000);
  }

  // 3. String or Number
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // 4. Date object
  if (val instanceof Date) {
    return val;
  }

  return null;
}
