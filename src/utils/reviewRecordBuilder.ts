import { BulkMatchResult, BulkRawItem } from '../services/bulkMatchingService';
import { PipelineResult } from './finalMatchPipeline';

/**
 * Extended raw item type for review record building.
 */
export interface RawItemInput extends BulkRawItem {
  rawPrice?: number | null;
  rawCurrency?: string | null;
}

/**
 * Interface representing a draft match review record.
 */
export interface MatchReviewRecord {
  ownerUserId: string;
  uploadId: string;
  supplierId: string | null;
  rawItemId?: string;
  rawName: string;
  rawCode: string | null;
  rawPrice: number | null;
  rawCurrency: string | null;
  suggestedProductId: string | null;
  suggestedProductName: string | null;
  confidenceScore: number;
  matchType: string;
  reasons: string[];
  warnings: string[];
  dangerFlags: string[];
  alternativeCandidates: Array<{
    productId: string;
    name: string;
    score: number;
    blocked: boolean;
  }>;
  reviewStatus: 'pending' | 'approved';
  finalProductId: string | null;
  finalAction: string | null;
  reviewedBy: string | null;
  reviewedAt: any | null;
  createdAt: any;
}

/**
 * Pure utility that converts a single matching result into a draft match review record.
 * 
 * @param params Object containing ownerUserId, uploadId, supplierId, rawItem, and pipeline result.
 * @returns A draft MatchReviewRecord.
 */
export function buildReviewRecord(params: {
  ownerUserId: string;
  uploadId: string;
  supplierId?: string | null;
  rawItem: RawItemInput;
  result: PipelineResult;
}): MatchReviewRecord {
  const { ownerUserId, uploadId, supplierId, rawItem, result } = params;

  let suggestedProductId: string | null = null;
  let suggestedProductName: string | null = null;
  let confidenceScore = 0;
  let matchType = 'none';
  let reasons: string[] = [];
  let warnings: string[] = [];
  let dangerFlags: string[] = [];

  if (result.aliasHit) {
    suggestedProductId = result.aliasHit.canonicalProductId;
    confidenceScore = 1;
    matchType = 'alias';
    reasons = [result.aliasHit.reason];
    // Note: suggestedProductName is not available in aliasHit memory. 
    // It may be enriched later from the canonical catalog data if needed.
    suggestedProductName = null;
  } else if (result.bestCandidate) {
    const best = result.bestCandidate;
    suggestedProductId = best.candidateProductId;
    suggestedProductName = best.candidateName;
    confidenceScore = best.score;
    matchType = best.matchType;
    reasons = best.reasons;
    warnings = best.warnings;
    dangerFlags = best.dangerFlags;
  }

  // Map top 5 candidates as alternatives
  const alternativeCandidates = result.candidates
    .slice(0, 5)
    .map(c => ({
      productId: c.candidateProductId,
      name: c.candidateName,
      score: c.score,
      blocked: c.blocked
    }));

  return {
    ownerUserId,
    uploadId,
    supplierId: supplierId ?? null,
    rawItemId: rawItem.id,
    rawName: rawItem.rawName,
    rawCode: rawItem.rawCode ?? null,
    rawPrice: rawItem.rawPrice ?? null,
    rawCurrency: rawItem.rawCurrency ?? null,
    suggestedProductId,
    suggestedProductName,
    confidenceScore,
    matchType,
    reasons,
    warnings,
    dangerFlags,
    alternativeCandidates,
    reviewStatus: (confidenceScore >= 0.95 && dangerFlags.length === 0 && suggestedProductId) ? 'approved' : 'pending',
    finalProductId: (confidenceScore >= 0.95 && dangerFlags.length === 0 && suggestedProductId) ? suggestedProductId : null,
    finalAction: (confidenceScore >= 0.95 && dangerFlags.length === 0 && suggestedProductId) ? 'approve_suggested' : null,
    reviewedBy: (confidenceScore >= 0.95 && dangerFlags.length === 0 && suggestedProductId) ? 'system_auto_approve' : null,
    reviewedAt: (confidenceScore >= 0.95 && dangerFlags.length === 0 && suggestedProductId) ? null : null, // Will be set by serverTimestamp if needed, but we'll handle it in write service
    createdAt: null
  };
}

/**
 * Pure utility that converts bulk matching results into an array of draft match review records.
 * 
 * @param params Object containing ownerUserId, uploadId, supplierId, and bulk results.
 * @returns An array of draft MatchReviewRecords.
 */
export function buildReviewRecordsForBulk(params: {
  ownerUserId: string;
  uploadId: string;
  supplierId?: string | null;
  results: BulkMatchResult<RawItemInput>[];
}): MatchReviewRecord[] {
  const { ownerUserId, uploadId, supplierId, results } = params;

  return results.map(item => buildReviewRecord({
    ownerUserId,
    uploadId,
    supplierId,
    rawItem: item.rawItem,
    result: item.result
  }));
}
