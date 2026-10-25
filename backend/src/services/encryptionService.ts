import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Provides AES-256-GCM authenticated encryption and decryption for sensitive tokens at rest.
 */
export class EncryptionService {
  private static cachedKey: Buffer | null = null;

  /**
   * Retrieves or derives a 32-byte (256-bit) encryption key from the environment.
   */
  public static getKey(): Buffer {
    if (this.cachedKey) {
      return this.cachedKey;
    }

    if (env.ENCRYPTION_KEY) {
      // If 64 hex characters (32 bytes), parse directly; otherwise hash to 32 bytes
      if (/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY)) {
        this.cachedKey = Buffer.from(env.ENCRYPTION_KEY, 'hex');
      } else {
        this.cachedKey = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();
      }
    } else {
      // Securely derive 32-byte key from SESSION_SECRET with a domain separation salt
      this.cachedKey = crypto
        .createHash('sha256')
        .update(`slack-token-encryption:${env.SESSION_SECRET}`)
        .digest();
    }

    return this.cachedKey;
  }

  /**
   * Encrypts plaintext string using AES-256-GCM.
   * Returns a serialized string: `${ivHex}:${authTagHex}:${encryptedHex}`
   */
  public static encrypt(plainText: string): string {
    if (!plainText) return '';
    const key = this.getKey();
    const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypts a serialized AES-256-GCM string into plaintext.
   * Format: `${ivHex}:${authTagHex}:${encryptedHex}`
   */
  public static decrypt(cipherText: string): string {
    if (!cipherText) return '';
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format. Expected iv:authTag:encrypted');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = this.getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
