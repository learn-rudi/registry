/**
 * Model configurations
 */

export const MODEL_TYPES = {
  GEMINI_IMAGE: 'GEMINI_IMAGE',
  IMAGEN: 'IMAGEN',
  VEO_VIDEO: 'VEO_VIDEO'
};

export const MODELS = {
  NANO_BANANA: {
    id: 'gemini-2.5-flash-image',
    name: 'Nano Banana',
    type: MODEL_TYPES.GEMINI_IMAGE,
    endpoint: 'generateContent',
    rateLimits: { rpm: 500, tpm: 500000, rpd: 2000 }
  },
  NANO_BANANA_PRO: {
    id: 'gemini-3-pro-image-preview',
    name: 'Nano Banana Pro',
    type: MODEL_TYPES.GEMINI_IMAGE,
    endpoint: 'generateContent',
    rateLimits: { rpm: 20, tpm: 100000, rpd: 250 }
  },
  IMAGEN_4_ULTRA: {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'Imagen 4 Ultra',
    type: MODEL_TYPES.IMAGEN,
    endpoint: 'predict',
    rateLimits: { rpm: 5, rpd: 30 }
  },
  IMAGEN_4_STANDARD: {
    id: 'imagen-4.0-generate-001',
    name: 'Imagen 4 Standard',
    type: MODEL_TYPES.IMAGEN,
    endpoint: 'predict',
    rateLimits: { rpm: 10, rpd: 70 }
  },
  IMAGEN_4_FAST: {
    id: 'imagen-4.0-fast-generate-001',
    name: 'Imagen 4 Fast',
    type: MODEL_TYPES.IMAGEN,
    endpoint: 'predict',
    rateLimits: { rpm: 10, rpd: 70 }
  },
  VEO_3_1_STANDARD: {
    id: 'veo-3.1-generate-preview',
    name: 'Veo 3.1 Standard',
    type: MODEL_TYPES.VEO_VIDEO,
    endpoint: 'predictLongRunning',
    rateLimits: { rpm: 2, rpd: 10 }
  },
  VEO_3_1_FAST: {
    id: 'veo-3.1-fast-generate-preview',
    name: 'Veo 3.1 Fast',
    type: MODEL_TYPES.VEO_VIDEO,
    endpoint: 'predictLongRunning',
    rateLimits: { rpm: 2, rpd: 10 }
  }
};

export function getModelById(modelId) {
  return Object.values(MODELS).find(m => m.id === modelId) || null;
}

export function getModelsByType(type) {
  return Object.values(MODELS).filter(m => m.type === type);
}
