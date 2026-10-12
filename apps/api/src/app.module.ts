import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { RequestIdMiddleware } from './common/http/request-id.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [DatabaseModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
