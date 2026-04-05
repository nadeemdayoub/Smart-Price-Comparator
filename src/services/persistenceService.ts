
/**
 * Generic persistence service for UI state
 */

export const savePageState = (pageKey: string, companyId: string | null, state: any) => {
  const identifier = companyId || 'super_admin';
  const key = `page_state_${pageKey}_${identifier}`;
  localStorage.setItem(key, JSON.stringify({
    ...state,
    _timestamp: Date.now()
  }));
};

export const loadPageState = (pageKey: string, companyId: string | null, expiryHours: number = 24) => {
  const identifier = companyId || 'super_admin';
  const key = `page_state_${pageKey}_${identifier}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  
  try {
    const data = JSON.parse(raw);
    // Check expiry
    if (Date.now() - data._timestamp > expiryHours * 60 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
};

export const clearPageState = (pageKey: string, companyId: string | null) => {
  const identifier = companyId || 'super_admin';
  const key = `page_state_${pageKey}_${identifier}`;
  localStorage.removeItem(key);
};
