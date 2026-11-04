import { Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { AuthModule, InternalAuthModule } from '@nick-lukashik/auth/nest'
import { DatabaseModule } from './common/database/database.module.js'
import { HealthModule } from './common/health/health.module.js'
import { JobsModule } from './common/jobs/jobs.module.js'
import { createLoggerModule } from './common/logging/logger.module.js'
import { MessagingModule } from './common/messaging/messaging.module.js'
import { MetricsModule } from './common/metrics/metrics.module.js'
import { appConfig, authConfig, dbConfig, rabbitConfig } from './config/config.js'
import { AppConfigModule } from './config/config.module.js'
import * as schema from './db/schema.js'
import { NotificationsModule } from './notifications.module.js'

type App = ConfigType<typeof appConfig>

@Module({
    imports: [
        AppConfigModule,
        createLoggerModule({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                service: app.service,
                version: app.version,
                level: app.logLevel,
            }),
        }),
        HealthModule.forRootAsync({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                shutdownDelayMs: app.shutdownDelayMs,
            }),
        }),
        MetricsModule.forRootAsync({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                service: app.service,
                version: app.version,
                port: app.metricsPort,
            }),
        }),
        DatabaseModule.forRootAsync({
            schema,
            inject: [
                dbConfig.KEY,
                appConfig.KEY,
            ],
            useFactory: (db: ConfigType<typeof dbConfig>, app: App) => ({
                url: db.url,
                max: db.max,
                applicationName: app.service,
            }),
        }),
        MessagingModule.forRootAsync({
            inject: [
                rabbitConfig.KEY,
                appConfig.KEY,
            ],
            useFactory: (rabbit: ConfigType<typeof rabbitConfig>, app: App) => ({
                url: rabbit.url,
                connectionName: app.service,
                // Consumes only; publishes nothing.
                exchanges: [],
            }),
        }),
        JobsModule.forRootAsync({
            inject: [
                dbConfig.KEY,
                appConfig.KEY,
            ],
            useFactory: (db: ConfigType<typeof dbConfig>, app: App) => ({
                connectionString: db.url,
                applicationName: `${app.service}-jobs`,
            }),
        }),
        AuthModule.forRootAsync({
            inject: [
                authConfig.KEY,
            ],
            useFactory: (auth: ConfigType<typeof authConfig>) => ({
                jwksUrl: auth.jwksUrl,
                issuer: auth.issuer,
                audience: auth.audience,
            }),
        }),
        InternalAuthModule.forRootAsync({
            inject: [
                authConfig.KEY,
            ],
            useFactory: (auth: ConfigType<typeof authConfig>) => auth.internalToken,
        }),
        NotificationsModule,
    ],
})
export class AppModule {}
