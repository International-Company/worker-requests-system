import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { APP_CONFIG, AppConfig } from '../../config/app-config';

export const PIN_REGEX = /^\d{4}$/;

/**
 * PINs are only 4 digits and login is "PIN only", so we need a deterministic lookup
 * and a uniqueness check — impossible with salted slow hashes. We therefore store a
 * keyed HMAC (secret held only by the server). Without AUTH_SECRET the stored values
 * cannot be reversed; the raw PIN is never persisted, returned or logged.
 */
@Injectable()
export class PinService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  hash(pin: string): string {
    if (!PIN_REGEX.test(pin)) throw new Error('PIN must be exactly 4 digits');
    return createHmac('sha256', this.config.authSecret).update(`pin:${pin}`).digest('hex');
  }

  hashSessionToken(token: string): string {
    return createHmac('sha256', this.config.authSecret).update(`session:${token}`).digest('hex');
  }
}
