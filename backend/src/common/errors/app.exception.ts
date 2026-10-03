import { HttpException } from '@nestjs/common';
import { ERRORS, ErrorCode } from './error-codes';

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: unknown,
  ) {
    super({ code, message: ERRORS[code].message, details }, ERRORS[code].status);
  }
}
