import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppConfig } from './config/app-config';

/** HTTP pipeline shared by production (main.ts) and the e2e tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // Railway terminates TLS at its proxy: trust it so req.ip / req.secure are correct.
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'", 'data:'],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
          'media-src': ["'self'", 'data:', 'blob:'],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  if (config.isProduction) {
    // Enforce HTTPS behind the proxy (PWA, service worker and push all require it).
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.secure && req.path !== '/api/health') return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
      next();
    });
  }

  app.use(cookieParser());
  app.useBodyParser('json', { limit: '256kb' });

  // Same-origin by design (the API serves the PWA). Extra origins only for local development.
  if (config.corsOrigins.length) {
    app.enableCors({ origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
  }

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}
