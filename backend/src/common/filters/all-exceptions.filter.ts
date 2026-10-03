import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app.exception';
import { ERRORS, ErrorCode } from '../errors/error-codes';

interface ErrorBody {
  statusCode: number;
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

/**
 * Normalises every error into `{ statusCode, code, message(ar), details? }`.
 * Stack traces are logged server-side only, never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (body.statusCode !== 401 && body.statusCode !== 404) {
      this.logger.warn(`${req.method} ${req.originalUrl} -> ${body.statusCode} ${body.code}`);
    }

    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: ERRORS[exception.code].message,
        details: exception.details,
      };
    }
    if (exception instanceof ThrottlerException) {
      return this.fromCode('TOO_MANY_REQUESTS');
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') return this.fromCode('NOT_FOUND');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as string | { message?: unknown };
      if (status === HttpStatus.BAD_REQUEST) {
        const details = typeof response === 'object' ? response.message : response;
        return { ...this.fromCode('VALIDATION_FAILED'), details };
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) return this.fromCode('IMAGE_TOO_LARGE');
      if (status === HttpStatus.UNAUTHORIZED) return this.fromCode('UNAUTHENTICATED');
      if (status === HttpStatus.FORBIDDEN) return this.fromCode('FORBIDDEN');
      if (status === HttpStatus.NOT_FOUND) return this.fromCode('NOT_FOUND');
      if (status === HttpStatus.TOO_MANY_REQUESTS) return this.fromCode('TOO_MANY_REQUESTS');
      if (status < 500) {
        return { statusCode: status, code: 'HTTP_ERROR', message: ERRORS.VALIDATION_FAILED.message };
      }
    }
    return this.fromCode('INTERNAL');
  }

  private fromCode(code: ErrorCode): ErrorBody {
    return { statusCode: ERRORS[code].status, code, message: ERRORS[code].message };
  }
}
