import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ExtractedItem {
  rawName: string;
  rawCode?: string;
  price: number;
  currency: string;
  quantity?: number;
}

export async function extractQuotationData(fileBase64: string, mimeType: string): Promise<ExtractedItem[]> {
  const model = "gemini-3.1-pro-preview";
  
  const prompt = `
    Extract all product items from this supplier quotation.
    For each item, identify:
    - rawName: The exact product name as written.
    - rawCode: Any internal code or SKU if present.
    - price: The unit price as a number.
    - currency: The currency symbol or code (e.g., USD, EUR).
    - quantity: The quantity if specified.

    Return the data as a JSON array.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: fileBase64,
              mimeType: mimeType,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            rawName: { type: Type.STRING },
            rawCode: { type: Type.STRING },
            price: { type: Type.NUMBER },
            currency: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
          },
          required: ["rawName", "price", "currency"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse Gemini response:", e);
    return [];
  }
}

export interface MatchSuggestion {
  productId: string;
  confidence: number;
  reason: string;
  warnings: string[];
}

export async function suggestProductMatch(
  rawName: string, 
  catalog: any[]
): Promise<MatchSuggestion | null> {
  const model = "gemini-3.1-pro-preview";
  
  const prompt = `
    Compare the supplier product name "${rawName}" against our internal catalog.
    
    Catalog:
    ${JSON.stringify(catalog.map(p => ({ id: p.id, name: p.name, specs: p.specs })))}

    Rules:
    - Be very strict about mismatches (e.g., 128GB vs 256GB, Body vs Kit).
    - If a mismatch is detected, set confidence to 0 and list the warning.
    - If a match is found, provide the productId and a confidence score (0-1).
    - Explain the reason for the match.

    Return a single JSON object.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          productId: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          reason: { type: Type.STRING },
          warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "null");
  } catch (e) {
    return null;
  }
}
