import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import hbs from 'hbs';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { parseListenAddr } from './config/env';
import { registerHandlebarsHelpers, setCurrencySymbol } from './web/helpers';
import { HtmlExceptionFilter } from './web/html-exception.filter';
import { StoreService } from './store/store.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '12mb' }));
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new BadRequestException({ error: issues[0]?.message ?? 'Invalid input.' }),
    }),
  );
  app.useGlobalFilters(new HtmlExceptionFilter());

  const viewsDir = join(__dirname, '..', 'views');
  const publicDir = join(__dirname, '..', 'public');

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
  const store = app.get(StoreService);
  app.useStaticAssets(store.imagesDir(), { prefix: '/images/' });

  const addr = parseListenAddr(process.env.ADDR || ':8080');
  await app.listen(addr.port, addr.host);
  
  console.log(`bulkly listening on ${addr.host}:${addr.port} (data ${process.env.DATA_DIR || './data'})`);
}

void bootstrap();
