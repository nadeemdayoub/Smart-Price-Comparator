export interface DangerTokens {
  capacity?: string;
  packageType?: string;
  typeClass?: string;
  color?: string;
  version?: string;
  editionKeywords: string[];
}

/**
 * Extracts sensitive product attributes from a normalized product name.
 * It uses explicit rules to detect attributes that are critical for product matching.
 * 
 * @param normalizedName The product name in normalized format (lowercase, no special chars).
 * @returns A structured object containing detected danger tokens.
 */
export function extractDangerTokens(normalizedName: string): DangerTokens {
  const result: DangerTokens = {
    editionKeywords: []
  };

  if (!normalizedName) return result;

  // 1. Capacity (e.g., 64gb, 128gb, 256gb, 512gb, 1tb)
  const capacityMatch = normalizedName.match(/\b\d+(gb|tb|mb)\b/);
  if (capacityMatch) {
    result.capacity = capacityMatch[0];
  }

  // 2. Package Type (e.g., body, kit, combo, creator combo, standard combo, adventure combo)
  /**
   * Priority order is critical here. 
   * Specific multi-word phrases (e.g., "creator combo") must be matched before 
   * broader single-word phrases (e.g., "combo") to prevent incorrect partial matching.
   */
  const packageTypes = [
    'creator combo',
    'standard combo',
    'adventure combo',
    'combo',
    'body',
    'kit'
  ];
  for (const pt of packageTypes) {
    const regex = new RegExp(`\\b${pt}\\b`);
    if (regex.test(normalizedName)) {
      result.packageType = pt;
      break;
    }
  }

  // 3. Type Class (e.g., type a, type b, tx, rx)
  const typeClasses = ['type a', 'type b', 'tx', 'rx'];
  for (const tc of typeClasses) {
    const regex = new RegExp(`\\b${tc}\\b`);
    if (regex.test(normalizedName)) {
      result.typeClass = tc;
      break;
    }
  }

  // 4. Color (e.g., black, white, silver)
  const colors = ['black', 'white', 'silver', 'gold', 'grey', 'gray'];
  for (const c of colors) {
    const regex = new RegExp(`\\b${c}\\b`);
    if (regex.test(normalizedName)) {
      result.color = c;
      break;
    }
  }

  // 5. Version (e.g., mark ii, mark iii, ii, iii, iv, v2, v3)
  // Normalizing detected versions into a canonical form (e.g., "mark ii" -> "mark_ii")
  const versionMap: Record<string, string> = {
    'mark ii': 'mark_ii',
    'mark iii': 'mark_iii',
    'ii': 'ii',
    'iii': 'iii',
    'iv': 'iv',
    'v2': 'v2',
    'v3': 'v3'
  };
  
  // Check in order of length/specificity
  const versions = Object.keys(versionMap).sort((a, b) => b.length - a.length);
  for (const v of versions) {
    const regex = new RegExp(`\\b${v}\\b`);
    if (regex.test(normalizedName)) {
      result.version = versionMap[v];
      break;
    }
  }

  // 6. Edition Keywords (e.g., mini, pro, max, ultra)
  const editions = ['mini', 'pro', 'max', 'ultra'];
  const detectedEditions = new Set<string>();
  for (const e of editions) {
    const regex = new RegExp(`\\b${e}\\b`);
    if (regex.test(normalizedName)) {
      detectedEditions.add(e);
    }
  }
  result.editionKeywords = Array.from(detectedEditions).sort();

  return result;
}

/**
 * Compares two extracted danger-token objects and returns whether they explicitly conflict.
 * A conflict occurs when both objects have a value for a specific field, but the values differ.
 * 
 * @param a First danger tokens object.
 * @param b Second danger tokens object.
 * @returns An object with conflict status and reasons.
 */
export function hasDangerConflict(a: DangerTokens, b: DangerTokens): { conflict: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Helper to check simple field conflicts
  const checkFieldConflict = (field: keyof Omit<DangerTokens, 'editionKeywords'>, label: string) => {
    if (a[field] && b[field] && a[field] !== b[field]) {
      reasons.push(`${label} mismatch: ${a[field]} vs ${b[field]}`);
    }
  };

  checkFieldConflict('capacity', 'Capacity');
  checkFieldConflict('packageType', 'Package type');
  checkFieldConflict('typeClass', 'Type class');
  checkFieldConflict('color', 'Color');
  checkFieldConflict('version', 'Version');

  // Edition keywords conflict
  // Compare sorted unique keyword sets deterministically
  if (a.editionKeywords.length > 0 && b.editionKeywords.length > 0) {
    const aSorted = [...a.editionKeywords].sort().join(',');
    const bSorted = [...b.editionKeywords].sort().join(',');
    
    if (aSorted !== bSorted) {
      reasons.push(`Edition mismatch: [${a.editionKeywords.join(', ')}] vs [${b.editionKeywords.join(', ')}]`);
    }
  }

  return {
    conflict: reasons.length > 0,
    reasons
  };
}
