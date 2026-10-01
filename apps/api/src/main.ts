import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import hbs from 'hbs';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
import { parseListenAddr } from './config/env.js';
import { registerHandlebarsHelpers, setCurrencySymbol } from './web/helpers.js';
import { ProblemFilter } from './web/problem.filter.js';
import { DatabaseService } from './db/database.service.js';

const WEB_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.enableCors({ origin: WEB_ORIGINS });
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '12mb' }));
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new BadRequestException({ error: issues[0]?.message ?? 'Invalid input.' }),
    }),
  );
  app.useGlobalFilters(new ProblemFilter());

  const viewsDir = join(import.meta.dirname, '..', 'views');
  const publicDir = join(import.meta.dirname, '..', 'public');

  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('hbs');

  await new Promise<void>((resolve, reject) => {
    hbs.registerPartials(join(viewsDir, 'partials'), (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  registerHandlebarsHelpers();
  setCurrencySymbol(process.env.CURRENCY_SYMBOL || 'zł');

  app.useStaticAssets(publicDir, { prefix: '/static/' });
  const db = app.get(DatabaseService);
  app.useStaticAssets(db.imagesDirPath(), { prefix: '/images/' });

  const addr = parseListenAddr(process.env.ADDR || ':8080');
  await app.listen(addr.port, addr.host);

  console.log(`bulkly listening on ${addr.host}:${addr.port} (data ${process.env.DATA_DIR || './data'})`);
}

void bootstrap();
