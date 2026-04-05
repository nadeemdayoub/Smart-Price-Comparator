import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Timestamp } from 'firebase/firestore';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Development-only logging utility.
 * Logs are completely stripped in production builds.
 */
export const devLog = {
  log: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.log(...args);
    }
  },
  error: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.error(...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.warn(...args);
    }
  },
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.debug(...args);
    }
  },
};

/**
 * Safely normalizes various date formats into a JS Date object.
 * Supports: Firestore Timestamp, JS Date, ISO string, or numeric timestamp.
 */
export function normalizeDate(date: any): Date | null {
  if (!date) return null;

  // Firestore Timestamp
  if (typeof date.toDate === 'function') {
    return date.toDate();
  }

  // JS Date object
  if (date instanceof Date) {
    return isNaN(date.getTime()) ? null : date;
  }

  // ISO string or numeric timestamp
  const parsed = new Date(date);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

/**
 * Formats a snapshot date using the specified fallback logic:
 * finalizedAt -> createdAt -> updatedAt -> N/A
 */
export function formatSnapshotDate(snapshot: any): string {
  if (!snapshot) return 'N/A';
  
  const dateObj = normalizeDate(snapshot.finalizedAt) || 
                  normalizeDate(snapshot.createdAt) || 
                  normalizeDate(snapshot.updatedAt);
                  
  if (!dateObj) return 'N/A';
  
  return dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatCurrency(amount: number, currency: string | null | undefined = 'USD') {
  // Safe fallback for currency
  const safeCurrency = (currency && typeof currency === 'string' && currency.length === 3) 
    ? currency.toUpperCase() 
    : 'USD';

  try {
    // KWD and some other currencies use 3 decimal places
    const fractionDigits = safeCurrency === 'KWD' || safeCurrency === 'BHD' || safeCurrency === 'OMR' || safeCurrency === 'JOD' ? 3 : 2;
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch (error) {
    devLog.warn(`[utils] Invalid currency code: ${currency}. Falling back to USD.`);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }
}
