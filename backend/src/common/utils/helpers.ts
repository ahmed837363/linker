import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function encrypt(text: string, encryptionKey: string): string {
  const key = crypto.scryptSync(encryptionKey, 'salt', 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string, encryptionKey: string): string {
  const key = crypto.scryptSync(encryptionKey, 'salt', 32);
  const [ivHex, tagHex, encrypted] = encryptedText.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export function encryptCredentials(
  credentials: Record<string, any>,
  encryptionKey: string,
): string {
  return encrypt(JSON.stringify(credentials), encryptionKey);
}

export function decryptCredentials(
  encryptedCredentials: string,
  encryptionKey: string,
): Record<string, any> {
  const decrypted = decrypt(encryptedCredentials, encryptionKey);
  return JSON.parse(decrypted);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export function generateIdempotencyKey(
  platform: string,
  eventId?: string,
  payload?: any,
): string {
  if (eventId) {
    return `${platform}:${eventId}`;
  }
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  return `${platform}:${hash}`;
}

export function normalizePrice(
  price: number,
  fromCurrency: string,
  toCurrency: string,
): number {
  // In production, use a real exchange rate API
  // This is a placeholder for the conversion logic
  if (fromCurrency === toCurrency) return price;

  const rates: Record<string, number> = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    SAR: 3.75,
    AED: 3.67,
    BRL: 4.97,
    MXN: 17.15,
    CNY: 7.24,
  };

  const fromRate = rates[fromCurrency] || 1;
  const toRate = rates[toCurrency] || 1;

  return (price / fromRate) * toRate;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}
