import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, AppConfig } from './config/app-config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('Bootstrap');

  configureApp(app, config);
  app.enableShutdownHooks();

  if (!config.isProduction || process.env.ENABLE_SWAGGER === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('نظام طلبات وتواصل العمال — API')
      .setDescription(
        'Session cookie auth (POST /api/auth/login). State-changing requests require the header X-Requested-With: XMLHttpRequest.',
      )
      .setVersion('1.0.0')
      .addCookieAuth('wr_session')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
    logger.log('Swagger UI at /api/docs');
  }

  serveWebApp(app, config, logger);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`Listening on :${config.port} (${config.nodeEnv})`);
}

/**
 * Serves the built React PWA from the same origin as the API.
 * sw.js / manifest / index.html are revalidated on every load; hashed assets are immutable.
 */
function serveWebApp(app: NestExpressApplication, config: AppConfig, logger: Logger) {
  const dist = resolve(config.webDistPath ?? join(__dirname, '..', '..', 'web', 'dist'));
  const indexHtml = join(dist, 'index.html');
  if (!existsSync(indexHtml)) {
    logger.warn(`Web build not found at ${dist} — only the API is served`);
    return;
  }
  app.useStaticAssets(dist, {
    index: false,
    setHeaders: (res, path) => {
      if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  });
  // SPA fallback for client-side routes (never for /api).
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
  logger.log(`Serving web app from ${dist}`);
}

void bootstrap();
