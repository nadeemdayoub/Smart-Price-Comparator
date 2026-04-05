import React from 'react';

/**
 * Normalizes text for searching by trimming and converting to lowercase.
 */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return '';
  return text.toString().toLowerCase().trim();
}

/**
 * Checks if a search query matches a given text.
 */
export function matchesSearch(text: string | null | undefined, query: string): boolean {
  if (!query) return true;
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  return normalizedText.includes(normalizedQuery);
}

/**
 * Highlights matching search text within a string.
 */
export function highlightSearchText(text: string | null | undefined, query: string): React.ReactNode {
  if (!text) return null;
  if (!query || !query.trim()) return text;

  const normalizedQuery = query.toLowerCase().trim();
  const parts = text.toString().split(new RegExp(`(${normalizedQuery})`, 'gi'));

  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === normalizedQuery ? (
          <mark key={i} className="bg-amber-200 text-stone-900 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}
