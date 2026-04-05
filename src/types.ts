/**
 * Transition type for Firestore timestamps.
 * Using 'any' temporarily to support both legacy ISO strings and Firestore Timestamp objects
 * during the migration phase.
 */
export type Timestamp = any;

export type UserRole = 'super_admin' | 'user';
export type UserStatus = 'pending' | 'active' | 'blocked';

export interface UserMetrics {
  totalUploads: number;
  totalSnapshots: number;
  totalComparisons: number;
  timeSpent: number; // in seconds
  lastActivity: Timestamp;
}

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
  lastLogin?: Timestamp;
  createdAt?: Timestamp;
  status: UserStatus;
  role: UserRole;
  metrics?: UserMetrics;
}

export interface SystemStats {
  totalUsers: number;
  pendingUsers: number;
  totalUploads: number;
  totalSnapshots: number;
  totalComparisons: number;
  updatedAt: Timestamp;
}

export interface Supplier {
  id: string;
  ownerUserId: string;
  name: string;
  defaultCurrency: string;
  contactInfo?: string;
  website?: string;
  isVerified?: boolean;
  createdAt?: Timestamp;
}

export interface Product {
  id: string;
  ownerUserId: string;
  name: string;
  brand?: string;
  category?: string;
  internalReference?: string;
  specs?: {
    capacity?: string;
    color?: string;
    version?: string;
    type?: string;
    package?: string;
  };
  isArchived?: boolean;
}

export interface ProductAlias {
  id: string;
  ownerUserId: string;
  productId: string;
  
  // --- Legacy Transition Fields ---
  /** @deprecated Use aliasText instead */
  rawName: string;
  
  // --- New Schema Fields ---
  aliasText?: string; // The intended new field for the raw string
  normalizedAlias?: string;
  sourceType?: 'manual' | 'ai_approved';
  createdBy?: string;
  createdAt: Timestamp;
  supplierId?: string;
  isActive?: boolean;
  status?: 'active' | 'corrected' | 'archived';
  correctedAt?: Timestamp;
  correctedBy?: string;
}

export interface Quotation {
  id: string;
  ownerUserId: string;
  supplierId: string;
  status: 'pending' | 'reviewing' | 'completed';
  fileUrl?: string;
  uploadedBy: string;
  createdAt: Timestamp;
}

export interface QuotationItem {
  id: string;
  ownerUserId: string;
  quotationId: string;
  rawName: string;
  rawCode?: string;
  price: number;
  currency: string;
  suggestedProductId?: string;
  confidence?: number;
  matchReason?: string;
  warnings?: string[];
  status: 'pending' | 'approved' | 'rejected' | 'ignored';
  createdAt?: Timestamp;
}

export interface AuditLog {
  id: string;
  ownerUserId: string;
  userId: string;
  
  // --- Legacy Transition Fields ---
  /** @deprecated Use actionType instead */
  action: string;
  /** @deprecated Use meta instead */
  details?: any;
  /** @deprecated Use createdAt instead */
  timestamp: Timestamp;
  
  // --- New Schema Fields ---
  actionType?: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  meta?: Record<string, any>;
  createdAt?: Timestamp;
}

export interface CanonicalProduct {
  id: string;
  ownerUserId: string;
  canonicalName: string;
  normalizedName: string;
  brand?: string;
  category?: string;
  subCategory?: string; // New optional field
  internalReference?: string;
  modelFamily?: string;
  packageType?: string;
  capacity?: string;
  color?: string;
  version?: string;
  typeClass?: string;
  notes?: string; // New optional field
  searchTokens: string[];
  sensitiveSignature: string;
  costPrice?: number;
  stockQty?: number;
  status: 'active' | 'archived';
  meta?: Record<string, any>;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface SupplierUpload {
  id: string;
  ownerUserId: string;
  supplierId: string;
  fileName: string;
  status: 'draft' | 'needs_review' | 'ready_for_review' | 'finalized' | 'abandoned' | 'failed' | 'processing' | 'uploaded';
  totalRows: number;
  processedRows: number;
  currentStep?: string;
  error?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp;
  reviewedAt?: Timestamp;
  finalizedAt?: Timestamp;
  abandonedAt?: Timestamp;
}

export interface UploadItemRaw {
  id: string;
  ownerUserId: string;
  uploadId: string;
  rawName: string;
  rawCode: string | null;
  rawPrice: number;
  rawCurrency: string;
  createdAt: Timestamp;
  
  // --- New Optional Fields ---
  supplierId?: string;
  rowIndex?: number;
  rawQty?: number;
  rawRowData?: Record<string, any>;
  parseConfidence?: number;
  parseWarnings?: string[];
  updatedAt?: Timestamp;
}

export interface MatchReview {
  id: string;
  ownerUserId: string;
  rawItemId: string;
  rawName: string;
  rawCode?: string;
  rawPrice: number;
  rawCurrency: string;
  suggestedProductId?: string;
  suggestedProductName?: string;
  confidenceScore: number;
  matchType: 'exact' | 'fuzzy' | 'none';
  reasons: string[];
  warnings: string[];
  dangerFlags: string[];
  alternativeCandidates: any[];
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'changed' | 'new_product_created' | 'ignored' | 'no_match' | 'low_confidence' | 'duplicate';
  finalProductId?: string;
  finalAction?: 'approve_suggested' | 'approve_changed' | 'reject' | 'create_new_product' | 'ignore' | 'manual';
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  createdAt: Timestamp;
  
  // --- New Optional Fields ---
  uploadId?: string;
  supplierId?: string;
  originalSuggestedProductId?: string;
  isAliasCorrection?: boolean;
}

export interface RejectedMatch {
  id: string;
  ownerUserId: string;
  normalizedRawName: string;
  rawCode?: string;
  candidateProductId: string;
  reason: string;
  dangerFlags?: string[];
  rejectedBy: string;
  createdAt: Timestamp;
  
  // --- New Optional Fields ---
  supplierId?: string;
  rawName?: string;
}

export interface PriceEntry {
  id: string;
  ownerUserId: string;
  canonicalProductId: string; // Renamed from productId
  supplierId: string;
  price: number;
  currency: string;
  priceInDefaultCurrency: number;
  date: Timestamp;
  uploadId: string;
  createdAt: Timestamp;
  
  // --- New Optional Fields ---
  reviewItemId?: string;
  effectiveDate?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ExchangeRate {
  id: string;
  ownerUserId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  updatedAt: Timestamp;
}
