import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
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

  const db = app.get(DatabaseService);
  app.useStaticAssets(db.imagesDirPath(), { prefix: '/images/' });

  const host = process.env.API_HOST || '0.0.0.0';
  const port = Number(process.env.API_PORT) || 8080;
  await app.listen(port, host);

  console.log(`bulkly listening on ${host}:${port} (data ${process.env.DATA_DIR || './data'})`);
}

void bootstrap();
